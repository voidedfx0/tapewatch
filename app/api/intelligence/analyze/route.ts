import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const MAX_PAGE_BYTES = 300 * 1024;
const MAX_PAGES = 7;
const TIMEOUT_MS = 9000;
const MAX_REDIRECTS = 3;

type Link = { label: string; url: string };
type PageProfile = {
  title: string | null;
  description: string | null;
  headings: string[];
  paragraphs: string[];
  links: Link[];
};

const SOCIAL_HOSTS: Record<string, string> = {
  "instagram.com": "Instagram",
  "www.instagram.com": "Instagram",
  "x.com": "X",
  "www.x.com": "X",
  "twitter.com": "X",
  "www.twitter.com": "X",
  "facebook.com": "Facebook",
  "www.facebook.com": "Facebook",
  "linkedin.com": "LinkedIn",
  "www.linkedin.com": "LinkedIn",
  "youtube.com": "YouTube",
  "www.youtube.com": "YouTube",
  "youtu.be": "YouTube",
  "www.tiktok.com": "TikTok",
  "tiktok.com": "TikTok",
  "t.me": "Telegram",
  "telegram.me": "Telegram",
  "discord.gg": "Discord",
  "discord.com": "Discord",
  "github.com": "GitHub",
  "www.github.com": "GitHub",
};

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
      const remaining = MAX_PAGE_BYTES - total;
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

function decode(value: string) {
  return value.replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">");
}

function clean(value: string) {
  return decode(value.replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function meta(html: string, key: string) {
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0];
    const name = tag.match(/\b(?:name|property)\s*=\s*["']([^"']*)["']/i)?.[1];
    const content = tag.match(/\bcontent\s*=\s*["']([^"']*)["']/i)?.[1];
    if (name?.toLowerCase() === key.toLowerCase() && content) return clean(content).slice(0, 500);
  }
  return null;
}

function extractPage(html: string, baseUrl: URL): PageProfile {
  const title = clean(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").slice(0, 200) || null;
  const description = meta(html, "description") || meta(html, "og:description") || meta(html, "twitter:description");
  const headings = [...html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)]
    .map((match) => clean(match[1])).filter((value) => value.length > 2).slice(0, 18);
  const paragraphs = [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((match) => clean(match[1])).filter((value) => value.length > 45).slice(0, 12);
  const links = [...html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map((match) => {
      try {
        const url = new URL(decode(match[1]), baseUrl);
        if (!["http:", "https:"].includes(url.protocol)) return null;
        url.hash = "";
        return { label: clean(match[2]).slice(0, 100), url: url.toString() };
      } catch { return null; }
    }).filter((item): item is Link => Boolean(item));
  return { title, description, headings, paragraphs, links };
}

async function fetchHtml(startUrl: URL) {
  let target = startUrl;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    await validatePublicTarget(target);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(target, {
        method: "GET", redirect: "manual", signal: controller.signal, cache: "no-store",
        headers: {
          "User-Agent": "TapeWatch-Intelligence/2.0",
          "Accept": "text/html,application/xhtml+xml",
        },
      });
    } finally {
      clearTimeout(timeout);
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location || redirects === MAX_REDIRECTS) throw new Error("The website redirected too many times.");
      target = new URL(location, target);
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error("The website returned HTTP " + response.status + ".");
    }
    if (!response.headers.get("content-type")?.toLowerCase().includes("text/html")) {
      await response.body?.cancel();
      throw new Error("This page did not return readable HTML.");
    }
    const body = await readLimitedBody(response);
    return { url: target, html: body.text, truncated: body.truncated };
  }
  throw new Error("The website could not be reached after redirects.");
}

function socialProfiles(links: Link[]) {
  const found = new Map<string, { platform: string; url: string }>();
  for (const link of links) {
    try {
      const url = new URL(link.url);
      const platform = SOCIAL_HOSTS[url.hostname.toLowerCase()];
      if (!platform) continue;
      url.search = "";
      url.hash = "";
      const normalized = url.toString().replace(/\/$/, "");
      if (!found.has(platform)) found.set(platform, { platform, url: normalized });
    } catch { /* Ignore malformed external links. */ }
  }
  return [...found.values()];
}

function pageCategory(url: URL, label: string) {
  const value = (url.pathname + " " + label).toLowerCase();
  if (/about|who-we-are|our-story|company/.test(value)) return "About";
  if (/service|product|solution|what-we-do|features/.test(value)) return "Products & Services";
  if (/price|pricing|plans|packages/.test(value)) return "Pricing";
  if (/contact|support|help/.test(value)) return "Contact & Support";
  if (/documentation|\/docs|developer|guides/.test(value)) return "Documentation";
  if (/blog|news|articles|insights/.test(value)) return "Blog & News";
  return null;
}

function pagePriority(link: Link) {
  const value = (link.url + " " + link.label).toLowerCase();
  if (/about|who-we-are|our-story|company/.test(value)) return 1;
  if (/service|product|solution|what-we-do|features/.test(value)) return 2;
  if (/price|pricing|plans|packages/.test(value)) return 3;
  if (/contact|support|help/.test(value)) return 4;
  if (/documentation|\/docs|developer|guides/.test(value)) return 5;
  if (/blog|news|articles|insights/.test(value)) return 6;
  return 99;
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
    const homepage = await fetchHtml(new URL(website.url));
    const origin = homepage.url.origin;
    const visited = new Set<string>([homepage.url.toString()]);
    const pages: { url: string; profile: PageProfile }[] = [];
    const homepageProfile = extractPage(homepage.html, homepage.url);
    pages.push({ url: homepage.url.toString(), profile: homepageProfile });

    const socialLinks: Link[] = [...homepageProfile.links];
    const candidates = homepageProfile.links
      .filter((link) => {
        try {
          const url = new URL(link.url);
          return url.origin === origin && url.pathname !== "/" && !/\.(pdf|jpg|jpeg|png|gif|svg|zip|mp4|mp3)$/i.test(url.pathname);
        } catch { return false; }
      })
      .sort((a, b) => pagePriority(a) - pagePriority(b.url ? b : a));

    for (const candidate of candidates) {
      if (pages.length >= MAX_PAGES) break;
      let pageUrl: URL;
      try { pageUrl = new URL(candidate.url); } catch { continue; }
      const key = pageUrl.toString();
      if (visited.has(key) || pagePriority(candidate) === 99) continue;
      visited.add(key);
      try {
        const fetched = await fetchHtml(pageUrl);
        if (fetched.url.origin !== origin) continue;
        const profile = extractPage(fetched.html, fetched.url);
        pages.push({ url: fetched.url.toString(), profile });
        socialLinks.push(...profile.links);
      } catch {
        // A secondary page may be unavailable; keep analysing the remaining public pages.
      }
    }

    const allHeadings = pages.flatMap((page) => page.profile.headings);
    const allDescriptions = pages.map((page) => page.profile.description).filter((value): value is string => Boolean(value));
    const allTitles = pages.map((page) => page.profile.title).filter((value): value is string => Boolean(value));
    const allParagraphs = pages.flatMap((page) => page.profile.paragraphs);
    const businessName = meta(homepage.html, "og:site_name") ||
      meta(homepage.html, "application-name") || homepageProfile.title;
    const summary = homepageProfile.description ||
      allDescriptions[0] ||
      allHeadings.slice(0, 4).join(" · ") ||
      allParagraphs[0]?.slice(0, 400) || homepageProfile.title;
    const services = [...new Set(allHeadings.filter((heading) =>
      /service|product|solution|platform|tool|feature|offer|consult|pricing|plan|we help|our work/i.test(heading)
    ))].slice(0, 12);
    const keyTopics = [...new Set([...allTitles, ...allHeadings])]
      .filter((item) => item.length > 2).slice(0, 18);
    const importantPages = [...new Map(pages.slice(1).map((page) => {
      const pageUrl = new URL(page.url);
      const category = pageCategory(pageUrl, page.profile.title || "");
      return category ? [category, { type: category, label: page.profile.title || category, url: page.url }] as const : null;
    }).filter((item): item is readonly [string, { type: string; label: string; url: string }] => Boolean(item))).values()].slice(0, 10);
    const socials = socialProfiles(socialLinks);
    const analyzedAt = new Date().toISOString();
    const profileData = {
      business_name: businessName,
      summary,
      purpose: summary,
      services,
      target_audience: null,
      key_topics: keyTopics,
      important_pages: importantPages,
      source_urls: pages.map((page) => page.url),
      social_profiles: socials,
      pages_analyzed: pages.map((page) => ({
        url: page.url,
        title: page.profile.title,
        description: page.profile.description,
      })),
      confidence: pages.length >= 3 && (summary || services.length) ? "moderate" : "limited",
    };

    if (!summary && !keyTopics.length && !socials.length) {
      throw new Error("TapeWatch could not find enough public information to build a profile.");
    }
    const { data, error } = await supabase.from("website_intelligence_profiles").upsert({
      website_id: website.id,
      user_id: userData.user.id,
      ...profileData,
      analyzed_at: analyzedAt,
      updated_at: analyzedAt,
    }, { onConflict: "website_id" })
      .select("id, website_id, business_name, summary, purpose, services, target_audience, key_topics, important_pages, source_urls, social_profiles, pages_analyzed, confidence, analyzed_at")
      .single();
    if (error) {
      console.error("TapeWatch intelligence profile save failed:", error);
      return NextResponse.json({ error: "The profile was analysed but could not be saved." }, { status: 500 });
    }
    return NextResponse.json({
      profile: data,
      pagesAnalysed: pages.length,
      socialProfilesFound: socials.length,
      analysisType: "multi-page-public-site-extraction",
    });
  } catch (error) {
    const message = error instanceof Error
      ? (error.name === "AbortError" ? "A website page took too long to respond." : error.message)
      : "The website could not be analysed.";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
