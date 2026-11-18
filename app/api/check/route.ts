import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isBlockedAddress } from "../../../lib/public-target.mjs";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const MAX_BYTES = 1024 * 1024;
const TIMEOUT_MS = 12000;
const MAX_REDIRECTS = 3;

async function validatePublicTarget(url: URL) {
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Only public HTTP and HTTPS websites can be checked.");
  if (url.username || url.password) throw new Error("Website addresses cannot contain login credentials.");
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") ||
      hostname.endsWith(".local") || hostname.endsWith(".internal") ||
      hostname.endsWith(".test") || hostname.endsWith(".invalid")) {
    throw new Error("This address is not a publicly reachable website.");
  }

  const version = isIP(hostname);
  const addresses = version ? [{ address: hostname }] : await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isBlockedAddress(address))) {
    throw new Error("This website resolves to a private or reserved network address and cannot be checked.");
  }
}

async function readLimitedBody(response: Response) {
  if (!response.body) return { body: new Uint8Array(), truncated: false };
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
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { body, truncated };
}

function extractTitle(bytes: Uint8Array, contentType: string | null) {
  if (!contentType?.toLowerCase().includes("text/html")) return null;
  const html = new TextDecoder("utf-8").decode(bytes);
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match?.[1]?.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200) || null;
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
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid check request." }, { status: 400 });
  }
  if (!payload.websiteId || !/^[0-9a-f-]{36}$/i.test(payload.websiteId)) {
    return NextResponse.json({ error: "A valid website entry is required." }, { status: 400 });
  }

  const { data: website, error: websiteError } = await supabase
    .from("websites")
    .select("id, url")
    .eq("id", payload.websiteId)
    .eq("user_id", userData.user.id)
    .single();

  if (websiteError || !website) {
    return NextResponse.json({ error: "That website was not found in your workspace." }, { status: 404 });
  }

  const { data: previousCheck, error: previousCheckError } = await supabase
    .from("website_checks")
    .select("id, content_hash, page_title")
    .eq("website_id", website.id)
    .eq("user_id", userData.user.id)
    .not("content_hash", "is", null)
    .order("checked_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (previousCheckError) {
    console.error("TapeWatch previous baseline lookup failed:", previousCheckError);
    return NextResponse.json({ error: "The previous website baseline could not be loaded. Please try again." }, { status: 500 });
  }

  const startedAt = Date.now();
  let status = "unreachable";
  let httpStatus: number | null = null;
  let finalUrl: string | null = null;
  let contentHash: string | null = null;
  let pageTitle: string | null = null;
  let errorMessage: string | null = null;

  try {
    let target = new URL(website.url);
    let response: Response | null = null;
    let bodyResult: { body: Uint8Array; truncated: boolean } | null = null;

    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
      await validatePublicTarget(target);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        response = await fetch(target, {
          method: "GET",
          redirect: "manual",
          signal: controller.signal,
          headers: { "User-Agent": "TapeWatch-Monitor/1.0 (+https://tapewatch.app)", "Accept": "text/html,application/xhtml+xml,application/json,text/plain;q=0.9,*/*;q=0.5" },
          cache: "no-store",
        });
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get("location");
          await response.body?.cancel();
          if (!location || redirects === MAX_REDIRECTS) throw new Error("The website redirected too many times or returned an invalid redirect.");
          target = new URL(location, target);
          continue;
        }
        bodyResult = await readLimitedBody(response);
      } finally {
        clearTimeout(timeout);
      }
      break;
    }

    if (!response || !bodyResult) throw new Error("The website did not return a complete response.");
    httpStatus = response.status;
    finalUrl = target.toString();
    const result = bodyResult;
    const contentType = response.headers.get("content-type");
    if (!result.truncated) {
      contentHash = createHash("sha256").update(result.body).digest("hex");
    }
    pageTitle = extractTitle(result.body, contentType);
    status = response.ok ? (result.truncated ? "reachable_partial" : "reachable") : "http_error";
    if (result.truncated) errorMessage = "Response exceeded the 1 MB capture limit; no full-body fingerprint was stored.";
  } catch (error) {
    errorMessage = error instanceof Error
      ? (error.name === "AbortError" ? "The website check timed out." : error.message)
      : "The website could not be checked.";
  }

  const checkedAt = new Date().toISOString();
  const { data: check, error: insertError } = await supabase
    .from("website_checks")
    .insert({
      website_id: website.id,
      user_id: userData.user.id,
      checked_at: checkedAt,
      status,
      http_status: httpStatus,
      final_url: finalUrl,
      content_hash: contentHash,
      page_title: pageTitle,
      error_message: errorMessage,
    })
    .select("id, checked_at, status, http_status, final_url, content_hash, page_title, error_message")
    .single();

  if (insertError) {
    console.error("TapeWatch check record save failed:", insertError);
    return NextResponse.json({ error: "The website was checked, but its result could not be saved." }, { status: 500 });
  }

  let change: Record<string, unknown> | null = null;
  let changeDetectionError: string | null = null;

  if (previousCheck?.content_hash && check.content_hash && previousCheck.content_hash !== check.content_hash) {
    const { data: savedChange, error: changeError } = await supabase
      .from("website_changes")
      .insert({
        website_id: website.id,
        user_id: userData.user.id,
        previous_check_id: previousCheck.id,
        current_check_id: check.id,
        change_type: "content_changed",
        previous_hash: previousCheck.content_hash,
        current_hash: check.content_hash,
        previous_title: previousCheck.page_title,
        current_title: check.page_title,
      })
      .select("id, detected_at, change_type, previous_hash, current_hash, previous_title, current_title")
      .single();

    if (changeError) {
      console.error("TapeWatch change record save failed:", changeError);
      changeDetectionError = "The check was saved, but the detected change could not be recorded.";
    } else {
      change = savedChange;
    }
  }

  return NextResponse.json({
    check,
    change,
    changeDetectionError,
    baselineCaptured: !previousCheck,
    durationMs: Date.now() - startedAt,
  });
}
