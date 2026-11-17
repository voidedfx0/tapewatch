import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const MAX_BYTES = 512 * 1024;
const TIMEOUT_MS = 10000;
const MAX_REDIRECTS = 3;

function isBlockedAddress(address: string) {
  const version = isIP(address);
  if (version === 4) {
    const [a, b, c] = address.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) ||
      (a === 192 && b === 0 && c === 0) || (a === 198 && (b === 18 || b === 19));
  }
  if (version === 6) {
    const value = address.toLowerCase();
    return value === "::" || value === "::1" || value.startsWith("fc") ||
      value.startsWith("fd") || value.startsWith("fe8") || value.startsWith("fe9") ||
      value.startsWith("fea") || value.startsWith("feb") || value.startsWith("ff") ||
      value.startsWith("::ffff:");
  }
  return true;
}

async function validatePublicTarget(url: URL) {
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Only public HTTP and HTTPS website addresses are supported.");
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") ||
      hostname.endsWith(".local") || hostname.endsWith(".internal") ||
      hostname.endsWith(".test") || hostname.endsWith(".invalid")) {
    throw new Error("This address is not a publicly reachable website.");
  }
  const version = isIP(hostname);
  const addresses = version ? [{ address: hostname }] : await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isBlockedAddress(address))) {
    throw new Error("This website resolves to a private or reserved network address.");
  }
}

async function readLimitedBody(response: Response) {
  if (!response.body) return { text: "", truncated: false };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = MAX_BYTES - total;
      if (value.byteLength > remaining) {
        if (remaining > 0) chunks.push(value.slice(0, remaining));
        total += Math.max(remaining, 0);
        truncated = true;
        await reader.cancel();
        break;
      }
      chunks.push(value);
      total += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { text: new TextDecoder("utf-8").decode(bytes), truncated };
}

function clean(value: string) {
  return value.replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ").trim();
}

function meta(html: string, key: string) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp('<meta[^>]+name=["\\']' + escaped + '["\\'][^>]+content=["\\']([^"\\']*)["\\'][^>]*>', "i"),
    new RegExp('<meta[^>]+property=["\\']' + escaped + '["\\'][^>]+content=["\\']([^"\\']*)["\\'][^>]*>', "i"),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return clean(match[1]).slice(0, 500);
  }
  return null;
}

function extractProfile(html: string, baseUrl: URL) {
  const title = clean(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").slice(0, 200) || null;
  const description = meta(html, "description") || meta(html, "og:description");
  const businessName = meta(html, "og:site_name");
  const headings = [...html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)]
    .map((match) => clean(match[1])).filter(Boolean).slice(0, 12);
  const services = [...new Set(headings.filter((heading) =>
    /service|product|solution|platform|tool|feature|offer|consult|pricing|plan/i.test(heading)
  ))].slice(0, 8);
  const keyTopics = [...new Set([...(title ? [title] : []), ...headings])]
    .filter((item) => item.length > 2).slice(0, 10);
  const links = [...html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map((match) => {
      try {
        const url = new URL(match[1], baseUrl);
        if (url.origin !== baseUrl.origin) return null;
        const label = clean(match[2]).slice(0, 80);
        const path = url.pathname.toLowerCase();
        const category = /about|who-we-are|company/.test(path) ? "About"
          : /service|product|solution/.test(path) ? "Services"
          : /price|pricing|plan/.test(path) ? "Pricing"
          : /contact|support/.test(path) ? "Contact"
          : /docs|documentation|guide/.test(path) ? "Documentation" : null;
        return category ? { type: category, label: label || category, url: url.toString() } : null;
      } catch { return null; }
    }).filter((item): item is { type: string; label: string; url: string } => Boolean(item));
  const importantPages = [...new Map(links.map((item) => [item.type, item])).values()].slice(0, 8);
  const summary = description || (headings.length ? headings.slice(0, 3).join(" · ") : title);
  return {
    business_name: businessName,
    summary,
    purpose: description,
    services,
    target_audience: null,
    key_topics: keyTopics,
    important_pages: importantPages,
    source_urls: [baseUrl.toString()],
    confidence: description || headings.length >= 2 ? "moderate" : "limited",
  };
}

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization");
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!authorization?.startsWith("Bearer ") || !supabaseUrl || !anonKey) {
    return NextResponse.json({ error: "Your workspace session is missing. Refresh and try again." }, { status: 401 });
  }

  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: authError } = await supabase.auth.getUser();
  if (authError || !userData.user) {
    return NextResponse.json({ error: "Your workspace session is invalid. Refresh and try again." }, { status: 401 });
  }

  let payload: { websiteId?: string };
  try { payload = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid intelligence request." }, { status: 400 }); }
  if (!payload.websiteId || !/^[0-9a-f-]{36}$/i.test(payload.websiteId)) {
    return NextResponse.json({ error: "A valid website entry is required." }, { status: 400 });
  }

  const { data: website, error: websiteError } = await supabase.from("websites")
    .select("id, url").eq("id", payload.websiteId).eq("user_id", userData.user.id).single();
  if (websiteError || !website) {
    return NextResponse.json({ error: "That website was not found in your workspace." }, { status: 404 });
  }

  try {
    let target = new URL(website.url);
    let response: Response | null = null;
    let body: { text: string; truncated: boolean } | null = null;
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
      await validatePublicTarget(target);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        response = await fetch(target, {
          method: "GET", redirect: "manual", signal: controller.signal, cache: "no-store",
          headers: { "User-Agent": "TapeWatch-Intelligence/1.0", "Accept": "text/html,application/xhtml+xml" },
        });
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get("location");
          await response.body?.cancel();
          if (!location || redirects === MAX_REDIRECTS) throw new Error("The website redirected too many times.");
          target = new URL(location, target);
          continue;
        }
        if (!response.ok) throw new Error(`The website returned HTTP ${response.status}.`);
        if (!response.headers.get("content-type")?.toLowerCase().includes("text/html")) {
          throw new Error("This website did not return an HTML page that can be analysed.");
        }
        body = await readLimitedBody(response);
      } finally { clearTimeout(timeout); }
      break;
    }
    if (!response || !body) throw new Error("The website did not return a readable page.");

    const profile = extractProfile(body.text, target);
    if (!profile.summary && !profile.key_topics.length) {
      throw new Error("TapeWatch could not find enough public page information to build a profile.");
    }
    const analyzedAt = new Date().toISOString();
    const { data, error } = await supabase.from("website_intelligence_profiles").upsert({
      website_id: website.id,
      user_id: userData.user.id,
      ...profile,
      analyzed_at: analyzedAt,
      updated_at: analyzedAt,
    }, { onConflict: "website_id" })
      .select("id, website_id, business_name, summary, purpose, services, target_audience, key_topics, important_pages, source_urls, confidence, analyzed_at")
      .single();
    if (error) {
      console.error("TapeWatch intelligence profile save failed:", error);
      return NextResponse.json({ error: "The profile was analysed but could not be saved." }, { status: 500 });
    }
    return NextResponse.json({ profile: data, truncated: body.truncated, analysisType: "homepage-extraction" });
  } catch (error) {
    const message = error instanceof Error
      ? (error.name === "AbortError" ? "The website analysis timed out." : error.message)
      : "The website could not be analysed.";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
