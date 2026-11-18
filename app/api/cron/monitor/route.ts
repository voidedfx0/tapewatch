import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { isBlockedAddress } from "../../../../lib/public-target.mjs";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const MAX_BYTES = 1024 * 1024;
const TIMEOUT_MS = 12000;

async function capture(rawUrl: string) {
  let status = "unreachable";
  let httpStatus: number | null = null;
  let finalUrl: string | null = null;
  let contentHash: string | null = null;
  let pageTitle: string | null = null;
  let errorMessage: string | null = null;

  try {
    const url = new URL(rawUrl);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
      throw new Error("Only public HTTP and HTTPS website addresses can be checked.");
    }
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (!host || host === "localhost" || host.endsWith(".localhost") ||
        host.endsWith(".local") || host.endsWith(".internal") ||
        host.endsWith(".test") || host.endsWith(".invalid")) {
      throw new Error("This address is not a public website.");
    }
    const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true, verbatim: true });
    if (!addresses.length || addresses.some(({ address }) => isBlockedAddress(address))) {
      throw new Error("This website resolves to a private or reserved network address.");
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        cache: "no-store",
        headers: { "User-Agent": "TapeWatch-Monitor/1.0", "Accept": "text/html,application/xhtml+xml,application/json,text/plain;q=0.9,*/*;q=0.5" },
      });
      httpStatus = response.status;
      finalUrl = url.toString();
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel();
        throw new Error("The website redirected; scheduled capture requires a direct public URL for now.");
      }

      if (!response.body) throw new Error("The website returned an empty response.");
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      let truncated = false;
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
      const body = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
      if (!truncated) contentHash = createHash("sha256").update(body).digest("hex");
      const contentType = response.headers.get("content-type")?.toLowerCase() || "";
      if (contentType.includes("text/html")) {
        const html = new TextDecoder("utf-8").decode(body);
        const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        pageTitle = match?.[1]?.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200) || null;
      }
      status = response.ok ? (truncated ? "reachable_partial" : "reachable") : "http_error";
      if (truncated) errorMessage = "Response exceeded the 1 MB capture limit; no full-body fingerprint was stored.";
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    errorMessage = error instanceof Error
      ? (error.name === "AbortError" ? "The scheduled website check timed out." : error.message)
      : "The scheduled website check failed.";
  }
  return { status, httpStatus, finalUrl, contentHash, pageTitle, errorMessage };
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!secret || !serviceKey || !supabaseUrl ||
      request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized or missing server configuration." }, { status: 401 });
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const now = new Date();
  const { data: due, error: dueError } = await admin
    .from("website_monitoring_settings")
    .select("id, website_id, user_id")
    .eq("enabled", true)
    .or(`next_run_at.is.null,next_run_at.lte.${now.toISOString()}`)
    .order("next_run_at", { ascending: true })
    .limit(25);

  if (dueError) {
    console.error("TapeWatch scheduled queue lookup failed:", dueError);
    return NextResponse.json({ error: "Could not load scheduled checks." }, { status: 500 });
  }

  const results: { websiteId: string; status: string }[] = [];
  for (const setting of due ?? []) {
    const { data: website, error: websiteError } = await admin
      .from("websites").select("id, url").eq("id", setting.website_id)
      .eq("user_id", setting.user_id).maybeSingle();

    if (websiteError || !website) {
      const skippedAt = new Date().toISOString();
      const nextRun = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const { error: scheduleError } = await admin.from("website_monitoring_settings")
        .update({ last_run_at: skippedAt, next_run_at: nextRun, updated_at: skippedAt })
        .eq("id", setting.id);
      if (scheduleError) console.error("TapeWatch unavailable website schedule update failed:", scheduleError);
      results.push({ websiteId: setting.website_id, status: scheduleError ? "schedule_update_failed" : "website_unavailable" });
      continue;
    }

    const previousResult = await admin.from("website_checks")
      .select("id, content_hash, page_title")
      .eq("website_id", website.id).eq("user_id", setting.user_id)
      .not("content_hash", "is", null).order("checked_at", { ascending: false })
      .limit(1).maybeSingle();

    const observation = await capture(website.url);
    const checkedAt = new Date().toISOString();
    const { data: check, error: saveError } = await admin.from("website_checks").insert({
      website_id: website.id, user_id: setting.user_id, checked_at: checkedAt,
      status: observation.status, http_status: observation.httpStatus,
      final_url: observation.finalUrl, content_hash: observation.contentHash,
      page_title: observation.pageTitle, error_message: observation.errorMessage,
    }).select("id, content_hash, page_title").single();

    if (!saveError && check && previousResult.data?.content_hash && check.content_hash &&
        previousResult.data.content_hash !== check.content_hash) {
      const { error: changeError } = await admin.from("website_changes").insert({
        website_id: website.id, user_id: setting.user_id,
        previous_check_id: previousResult.data.id, current_check_id: check.id,
        change_type: "content_changed", previous_hash: previousResult.data.content_hash,
        current_hash: check.content_hash, previous_title: previousResult.data.page_title,
        current_title: check.page_title,
      });
      if (changeError) console.error("TapeWatch scheduled change save failed:", changeError);
    }

    const nextRun = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const { error: updateError } = await admin.from("website_monitoring_settings")
      .update({ last_run_at: checkedAt, next_run_at: nextRun, updated_at: checkedAt })
      .eq("id", setting.id);
    if (saveError || updateError) {
      console.error("TapeWatch scheduled result save failed:", saveError || updateError);
      results.push({ websiteId: website.id, status: "save_failed" });
    } else {
      results.push({ websiteId: website.id, status: observation.status });
    }
  }

  const successful = results.filter((item) => item.status === "reachable" || item.status === "reachable_partial").length;
  const failed = results.length - successful;
  return NextResponse.json({
    ok: failed === 0,
    processed: results.length,
    successful,
    failed,
    results,
    ranAt: now.toISOString(),
  }, { status: failed > 0 ? 500 : 200 });
}
