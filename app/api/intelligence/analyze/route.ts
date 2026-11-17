import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const MAX_PAGE_BYTES = 300 * 1024;
const MAX_PAGES = 12;
const MAX_SITEMAP_BYTES = 300 * 1024;
const MAX_SITEMAP_URLS = 80;
const TIMEOUT_MS = 9000;
const MAX_REDIRECTS = 3;

type Link = { label: string; url: string };
type PageProfile = {
  title: string | null;
  description: string | null;
  headings: string[];
  paragraphs: string[];
  contentBlocks: string[];
  links: Link[];
  structured: { names: string[]; descriptions: string[]; products: string[]; services: string[]; features: string[]; topics: string[]; audiences: string[]; socials: string[] };
  emails: string[]; phones: string[]; locations: string[]; pricing: string[]; technologies: string[]; integrations: string[];
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

function extractStructuredData(html: string, baseUrl: URL) {
  const result = { names: [] as string[], descriptions: [] as string[], products: [] as string[], services: [] as string[], features: [] as string[], topics: [] as string[], audiences: [] as string[], socials: [] as string[], emails: [] as string[], phones: [] as string[], locations: [] as string[], prices: [] as string[] };
  const add = (list: string[], value: unknown) => {
    if (typeof value === "string" && value.trim()) list.push(value.trim().slice(0, 300));
    else if (Array.isArray(value)) for (const item of value) add(list, item);
    else if (value && typeof value === "object" && "name" in value) add(list, (value as { name?: unknown }).name);
  };
  const scripts = [...html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const script of scripts.slice(0, 12)) {
    try {
      const parsed: unknown = JSON.parse(script[1].trim());
      const queue: unknown[] = Array.isArray(parsed) ? [...parsed] : [parsed];
      let visited = 0;
      while (queue.length && visited < 100) {
        const item = queue.shift();
        visited++;
        if (!item || typeof item !== "object") continue;
        if (Array.isArray(item)) { queue.push(...item); continue; }
        const obj = item as Record<string, unknown>;
        if (obj["@graph"]) queue.push(obj["@graph"]);
        const type = Array.isArray(obj["@type"]) ? obj["@type"].join(" ") : String(obj["@type"] || "");
        if (/Organization|Corporation|LocalBusiness|ProfessionalService|NGO|EducationalOrganization|GovernmentOrganization|SportsOrganization|PerformingGroup|Store|MedicalOrganization/i.test(type)) {
          add(result.names, obj.name);
          add(result.names, obj.alternateName);
        }
        add(result.descriptions, obj.description);
        add(result.emails, obj.email);
        add(result.phones, obj.telephone);
        const address = obj.address;
        if (address && typeof address === "object") {
          const addressObject = address as Record<string, unknown>;
          for (const key of ["name", "streetAddress", "addressLocality", "addressRegion", "postalCode", "addressCountry"]) add(result.locations, addressObject[key]);
        } else add(result.locations, address);
        add(result.locations, obj.areaServed);
        const priceParts = [obj.price, obj.lowPrice, obj.highPrice].filter((value) => typeof value === "string" || typeof value === "number");
        if (priceParts.length) result.prices.push(`${priceParts.join("–")} ${typeof obj.priceCurrency === "string" ? obj.priceCurrency : ""}`.trim().slice(0, 180));
        if (/Product|SoftwareApplication|WebApplication/i.test(type)) add(result.products, obj.name);
        if (/Service|ProfessionalService/i.test(type)) add(result.services, obj.name);
        if (/Offer|Feature/i.test(type)) add(result.features, obj.name);
        add(result.topics, obj.knowsAbout);
        add(result.audiences, obj.audience);
        add(result.socials, obj.sameAs);
        for (const value of Object.values(obj)) {
          if (Array.isArray(value)) queue.push(...value.filter((entry) => entry && typeof entry === "object"));
          else if (value && typeof value === "object") queue.push(value);
        }
      }
    } catch { /* Ignore invalid JSON-LD blocks. */ }
  }
  result.socials = result.socials.filter((value) => {
    try { return ["http:", "https:"].includes(new URL(value, baseUrl).protocol); }
    catch { return false; }
  });
  return result;
}

function extractSocialMetadata(html: string, baseUrl: URL): Link[] {
  const found: Link[] = [];
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    const rel = tag.match(/\brel\s*=\s*["']([^"']+)["']/i)?.[1] || "";
    const href = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!href || !/(^|\s)me(\s|$)/i.test(rel)) continue;
    try {
      const url = new URL(decode(href), baseUrl);
      if (["http:", "https:"].includes(url.protocol)) found.push({ label: "Rel-me social profile", url: url.toString() });
    } catch { /* Ignore malformed profile links. */ }
  }

  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0];
    const key = tag.match(/\b(?:name|property)\s*=\s*["']([^"']*)["']/i)?.[1]?.toLowerCase();
    const value = tag.match(/\bcontent\s*=\s*["']([^"']*)["']/i)?.[1]?.trim();
    if (!key || !value) continue;
    if (key === "og:see_also" || key === "twitter:site" || key === "twitter:creator") {
      const candidate = value.startsWith("@") && (key === "twitter:site" || key === "twitter:creator")
        ? "https://x.com/" + value.slice(1)
        : value;
      try {
        const url = new URL(candidate, baseUrl);
        if (["http:", "https:"].includes(url.protocol)) found.push({ label: "Social profile metadata", url: url.toString() });
      } catch { /* Ignore handles or malformed metadata for unsupported networks. */ }
    }
  }
  return found;
}

function extractPage(html: string, baseUrl: URL): PageProfile {
  const title = clean(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").slice(0, 200) || null;
  const description = meta(html, "description") || meta(html, "og:description") || meta(html, "twitter:description");
  const headings = [...html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)]
    .map((match) => clean(match[1])).filter((value) => value.length > 2).slice(0, 18);
  const paragraphs = [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((match) => clean(match[1])).filter((value) => value.length > 45).slice(0, 12);
  const contentRoot = html.match(/<(?:main|article)\b[^>]*>([\s\S]*?)<\/(?:main|article)>/i)?.[1]
    || html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1]
    || html;
  const readableHtml = contentRoot
    .replace(/<(?:nav|header|footer|aside|form|script|style|noscript|svg)\b[\s\S]*?<\/(?:nav|header|footer|aside|form|script|style|noscript|svg)>/gi, " ");
  const contentBlocks = [...readableHtml.matchAll(/<(?:h[1-3]|p|li|blockquote)\b[^>]*>([\s\S]*?)<\/(?:h[1-3]|p|li|blockquote)>/gi)]
    .map((match) => clean(match[1]))
    .filter((value) => value.length >= 35 && value.length <= 1200)
    .filter((value, index, list) => list.findIndex((item) => item.toLowerCase() === value.toLowerCase()) === index)
    .slice(0, 24);
  const links = [...html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map((match) => {
      try {
        const url = new URL(decode(match[1]), baseUrl);
        if (!["http:", "https:"].includes(url.protocol)) return null;
        url.hash = "";
        return { label: clean(match[2]).slice(0, 100), url: url.toString() };
      } catch { return null; }
    }).filter((item): item is Link => Boolean(item));
  links.push(...extractSocialMetadata(html, baseUrl));
  const visibleText = clean(readableHtml).slice(0, 180000);
  const emails = [...new Set([...html.matchAll(/(?:mailto:)?([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/gi)].map((match) => match[1].toLowerCase()))].slice(0, 20);
  const phones = [...new Set([...html.matchAll(/(?:tel:)?(\+?[0-9][0-9().\s-]{6,}[0-9])/g)].map((match) => match[1].replace(/\s+/g, " ").trim()).filter((value) => value.replace(/\D/g, "").length >= 8 && value.replace(/\D/g, "").length <= 15))].slice(0, 15);
  const locations = [...visibleText.matchAll(/\b(?:headquarters|head office|based in|located in|office in|visit us at)\s*[:,-]?\s*([^.!?;]{3,90})/gi)].map((match) => match[1].trim()).slice(0, 8);
  const pricing = [...new Set([...headings, ...contentBlocks].filter((value) => /pricing|plans? from|free plan|free trial|per month|per year|\$\s?\d|USD\s?\d|NGN\s?\d|\d+\s?(?:USD|NGN|EUR|GBP)/i.test(value)).map((value) => value.slice(0, 220)))].slice(0, 12);
  const technologyTerms = ["Next.js","React","Vue","Angular","WordPress","Shopify","Webflow","Node.js","Python","PHP","Laravel","Django","Supabase","Firebase","AWS","Vercel","Cloudflare","Ethereum","Solana","IPFS"];
  const integrationTerms = ["Stripe","PayPal","Google Analytics","Google Maps","HubSpot","Salesforce","Slack","Discord","Telegram","GitHub","Zapier","Mailchimp","WooCommerce","Meta Pixel"];
  const technologies = technologyTerms.filter((term) => visibleText.toLowerCase().includes(term.toLowerCase()));
  const integrations = integrationTerms.filter((term) => visibleText.toLowerCase().includes(term.toLowerCase()));
  return { title, description, headings, paragraphs, contentBlocks, links, emails, phones, locations, pricing, technologies, integrations, structured: extractStructuredData(html, baseUrl) };
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


async function fetchSmallText(startUrl: URL) {
  let target = startUrl;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    await validatePublicTarget(target);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(target, { method: "GET", redirect: "manual", signal: controller.signal, cache: "no-store",
        headers: { "User-Agent": "TapeWatch-Intelligence/2.0", "Accept": "application/xml,text/xml,text/plain,*/*" } });
    } finally { clearTimeout(timeout); }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location || redirects === MAX_REDIRECTS) throw new Error("Sitemap redirected too many times.");
      target = new URL(location, target);
      if (target.origin !== startUrl.origin) throw new Error("External sitemap redirects are not followed.");
      continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error("Resource returned HTTP " + response.status + "."); }
    const type = response.headers.get("content-type")?.toLowerCase() || "";
    if (!(type.includes("xml") || type.includes("text/plain") || type.includes("octet-stream"))) {
      await response.body?.cancel(); throw new Error("Resource is not a supported sitemap or robots file.");
    }
    const reader = response.body?.getReader();
    if (!reader) return { url: target, text: "" };
    const chunks: Uint8Array[] = []; let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_SITEMAP_BYTES) { await reader.cancel(); throw new Error("Sitemap is too large."); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(total); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return { url: target, text: new TextDecoder("utf-8").decode(bytes) };
  }
  throw new Error("Resource could not be reached.");
}

function sitemapLocations(xml: string, baseUrl: URL) {
  const urls: URL[] = [];
  for (const match of xml.matchAll(/<loc[^>]*>\s*([\s\S]*?)\s*<\/loc>/gi)) {
    try {
      const raw = decode(match[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim());
      const url = new URL(raw, baseUrl);
      if (url.origin === baseUrl.origin && ["http:", "https:"].includes(url.protocol)) {
        url.hash = "";
        if (!urls.some((item) => item.toString() === url.toString())) urls.push(url);
      }
    } catch { /* Ignore invalid or off-origin entries. */ }
    if (urls.length >= MAX_SITEMAP_URLS) break;
  }
  return urls;
}

async function discoverSitemapPages(homepageUrl: URL) {
  const sitemapUrls = new Set<string>([new URL("/sitemap.xml", homepageUrl).toString()]);
  try {
    const robots = await fetchSmallText(new URL("/robots.txt", homepageUrl));
    for (const match of robots.text.matchAll(/^\s*Sitemap:\s*(\S+)/gim)) {
      try { const url = new URL(match[1], homepageUrl); if (url.origin === homepageUrl.origin) sitemapUrls.add(url.toString()); }
      catch { /* Ignore malformed declarations. */ }
    }
  } catch { /* robots.txt is optional. */ }

  const discovered: URL[] = []; let filesRead = 0;
  for (const sitemapUrl of sitemapUrls) {
    if (filesRead >= 3 || discovered.length >= MAX_SITEMAP_URLS) break;
    try {
      const fetched = await fetchSmallText(new URL(sitemapUrl));
      if (fetched.url.origin !== homepageUrl.origin) continue;
      filesRead++;
      const entries = sitemapLocations(fetched.text, fetched.url);
      if (/<sitemapindex\b/i.test(fetched.text)) {
        for (const child of entries.slice(0, 2)) {
          if (filesRead >= 3) break;
          try {
            const childFile = await fetchSmallText(child);
            if (childFile.url.origin !== homepageUrl.origin) continue;
            filesRead++; discovered.push(...sitemapLocations(childFile.text, childFile.url));
          } catch { /* Ignore unavailable child sitemaps. */ }
        }
      } else discovered.push(...entries);
    } catch { /* Sitemap discovery is optional. */ }
  }
  return [...new Map(discovered.map((url) => [url.toString(), url])).values()].slice(0, MAX_SITEMAP_URLS);
}

function socialProfiles(links: Link[]) {
  const found = new Map<string, { platform: string; url: string; evidence: string }>();
  const evidenceLabel = (label: string) => {
    if (label === "Structured social profile") return "Declared in structured site data";
    if (label === "Rel-me social profile") return "Linked with rel=me";
    if (label === "Social profile metadata") return "Declared in social metadata";
    return "Linked directly from the website";
  };
  for (const link of links) {
    try {
      const url = new URL(link.url);
      const hostname = url.hostname.toLowerCase().replace(/^(www|m|mobile)\./, "");
      const platform = SOCIAL_HOSTS[hostname] || SOCIAL_HOSTS["www." + hostname];
      if (!platform) continue;
      url.search = "";
      url.hash = "";
      const normalized = url.toString().replace(/\/$/, "");
      const evidence = evidenceLabel(link.label);
      const existing = found.get(platform);
      if (!existing || (existing.evidence === "Linked directly from the website" && evidence !== existing.evidence)) {
        found.set(platform, { platform, url: normalized, evidence });
      }
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
    const sitemapPages = await discoverSitemapPages(homepage.url);
    const sitemapLinks: Link[] = sitemapPages.map((url) => ({ label: url.pathname.split("/").filter(Boolean).pop() || "Sitemap page", url: url.toString() }));
    const combinedLinks = [...homepageProfile.links, ...sitemapLinks];
    const candidates = [...new Map(combinedLinks
      .filter((link) => {
        try {
          const url = new URL(link.url);
          return url.origin === origin && url.pathname !== "/" && !/\.(pdf|jpg|jpeg|png|gif|svg|zip|mp4|mp3|xml)$/i.test(url.pathname);
        } catch { return false; }
      })
      .sort((a, b) => pagePriority(a) - pagePriority(b))
      .map((link) => [new URL(link.url).toString(), link])).values()];

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
    const allContentBlocks = pages.flatMap((page) => page.profile.contentBlocks);
    const contactEmails = [...new Set([...pages.flatMap((page) => page.profile.emails), ...pages.flatMap((page) => page.profile.structured.emails)])].slice(0, 20);
    const contactPhones = [...new Set([...pages.flatMap((page) => page.profile.phones), ...pages.flatMap((page) => page.profile.structured.phones)])].slice(0, 15);
    const locations = [...new Set([...pages.flatMap((page) => page.profile.locations), ...pages.flatMap((page) => page.profile.structured.locations)])].slice(0, 16);
    const pricingDetails = [...new Set([...pages.flatMap((page) => page.profile.pricing), ...pages.flatMap((page) => page.profile.structured.prices)])].slice(0, 18);
    const technologies = [...new Set(pages.flatMap((page) => page.profile.technologies))].slice(0, 20);
    const integrations = [...new Set(pages.flatMap((page) => page.profile.integrations))].slice(0, 20);
    const discoveryEvidence = pages.flatMap((page) => {
      const fields: [string, string[]][] = [
        ["Email", [...page.profile.emails, ...page.profile.structured.emails]], ["Phone", [...page.profile.phones, ...page.profile.structured.phones]], ["Location", [...page.profile.locations, ...page.profile.structured.locations]],
        ["Pricing", [...page.profile.pricing, ...page.profile.structured.prices]], ["Technology mention", page.profile.technologies], ["Integration mention", page.profile.integrations],
        ["Product", page.profile.structured.products], ["Service", page.profile.structured.services], ["Feature", page.profile.structured.features],
      ];
      return fields.flatMap(([type, values]) => values.map((value) => ({
        type, value, source_url: page.url,
        excerpt: page.profile.contentBlocks.find((block) => block.toLowerCase().includes(value.toLowerCase()))?.slice(0, 280)
          || page.profile.description || page.profile.title || "Found in the page HTML or structured metadata.",
      })));
    }).filter((item, index, list) => list.findIndex((other) => other.type === item.type && other.value.toLowerCase() === item.value.toLowerCase() && other.source_url === item.source_url) === index).slice(0, 100);
    const structured = pages.map((page) => page.profile.structured);
    const structuredNames = structured.flatMap((item) => item.names);
    const structuredDescriptions = structured.flatMap((item) => item.descriptions);
    const structuredProducts = structured.flatMap((item) => item.products);
    const structuredServices = structured.flatMap((item) => item.services);
    const structuredFeatures = structured.flatMap((item) => item.features);
    const structuredTopics = structured.flatMap((item) => item.topics);
    const structuredAudiences = structured.flatMap((item) => item.audiences);
    for (const value of structured.flatMap((item) => item.socials)) socialLinks.push({ label: "Structured social profile", url: value });
    const businessName = meta(homepage.html, "og:site_name") ||
      meta(homepage.html, "application-name") ||
      structuredNames[0] ||
      meta(homepage.html, "author") ||
      homepageProfile.title;
    const alternateNames = [...new Set(structuredNames.filter((name) => name !== businessName))].slice(0, 8);
    const identityType = structuredNames.length ? "Structured organisation identity" :
      meta(homepage.html, "og:site_name") || meta(homepage.html, "application-name") ? "Website metadata identity" : "Page-title identity";
    const summaryCandidate = homepageProfile.description || structuredDescriptions[0] || allDescriptions[0] ||
      allContentBlocks.find((block) => block.length >= 90 && /\b(we |our |provides|offers|helps|platform|company|business|organisation|organization|service|product)\b/i.test(block)) ||
      allParagraphs.find((paragraph) => paragraph.length >= 90) || allContentBlocks.slice(0, 2).join(" ");
    const summary = summaryCandidate?.replace(/\s+/g, " ").trim().slice(0, 700) ||
      [businessName, ...allHeadings.slice(0, 3)].filter(Boolean).join(" — ") || homepageProfile.title;
    const products = [...new Set([...structuredProducts, ...allHeadings.filter((heading) => /product|platform|software|application|tool|app|catalogue|catalog/i.test(heading)), ...allContentBlocks.filter((block) => /\b(our products|our platform|our software|we built|product includes|available products)\b/i.test(block)).map((block) => block.slice(0, 180))])].filter((value) => value.length > 2).slice(0, 12);
    const services = [...new Set([...structuredServices, ...allHeadings.filter((heading) => /service|consult|support|implementation|maintenance|delivery|solutions/i.test(heading)), ...allContentBlocks.filter((block) => /\b(we offer|our services|services include|we provide|we help|professional services)\b/i.test(block)).map((block) => block.slice(0, 180))])].filter((value) => value.length > 2).slice(0, 12);
    const features = [...new Set([...structuredFeatures, ...allHeadings.filter((heading) => /feature|capabilit|functionality|benefit/i.test(heading)), ...allContentBlocks.filter((block) => /\b(features include|key features|built-in|supports)\b/i.test(block)).map((block) => block.slice(0, 180))])].filter((value) => value.length > 2).slice(0, 12);
    const keyTopics = [...new Set([...allTitles, ...allHeadings, ...structuredTopics])]
      .filter((item) => item.length > 2).slice(0, 18);
    const importantPageMap = new Map<string, { type: string; label: string; url: string }>();
    for (const page of pages.slice(1)) {
      const pageUrl = new URL(page.url);
      const category = pageCategory(pageUrl, page.profile.title || "");
      if (category && !importantPageMap.has(category)) {
        importantPageMap.set(category, { type: category, label: page.profile.title || category, url: page.url });
      }
    }
    const importantPages = [...importantPageMap.values()].slice(0, 10);
    const socials = socialProfiles(socialLinks);
    const analyzedAt = new Date().toISOString();
    const profileData = {
      business_name: businessName,
      summary,
      purpose: summary,
      products,
      services,
      features,
      identity_type: identityType,
      alternate_names: alternateNames,
      field_evidence: { business_name: structuredNames.length ? "Structured organisation data or site metadata" : "Homepage metadata or title", products: structuredProducts.length ? "Structured product data and page content" : "Page headings and descriptive content", services: structuredServices.length ? "Structured service data and page content" : "Page headings and descriptive content", features: structuredFeatures.length ? "Structured feature data and page content" : "Page headings and descriptive content", social_profiles: "Public links and metadata published by analysed pages", contact_details: "Email and phone-like text found in analysed HTML", locations: "Location phrases found in page text; not independently geocoded", pricing: "Pricing-related headings and text; not independently validated", technologies: "Technology names mentioned in page text, not technical fingerprinting", integrations: "Integration names mentioned in page text, not confirmed active connections" },
      contact_emails: contactEmails, contact_phones: contactPhones, locations, pricing_details: pricingDetails, technologies, integrations,
      discovery_evidence: discoveryEvidence,
      target_audience: structuredAudiences[0] || null,
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
      .select("id, website_id, business_name, summary, purpose, products, services, features, identity_type, alternate_names, field_evidence, contact_emails, contact_phones, locations, pricing_details, technologies, integrations, discovery_evidence, target_audience, key_topics, important_pages, source_urls, social_profiles, pages_analyzed, confidence, analyzed_at")
      .single();
    if (error) {
      console.error("TapeWatch intelligence profile save failed:", error);
      return NextResponse.json({ error: "The profile was analysed but could not be saved." }, { status: 500 });
    }
    return NextResponse.json({
      profile: data,
      pagesAnalysed: pages.length,
      socialProfilesFound: socials.length,
      analysisType: "deep-content-multi-page-sitemap-jsonld-contact-commercial-social-and-evidence-extraction",
      sitemapPagesDiscovered: sitemapPages.length,
    });
  } catch (error) {
    const message = error instanceof Error
      ? (error.name === "AbortError" ? "A website page took too long to respond." : error.message)
      : "The website could not be analysed.";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
