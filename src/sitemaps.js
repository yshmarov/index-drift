import { gunzipSync } from "node:zlib";
import { fetchWithRetry } from "./http.js";

const USER_AGENT = "index-drift (+https://github.com/yshmarov/index-drift)";

export async function collectUrls(sitemapUrls, { fetch = globalThis.fetch, maxSitemaps = 1000 } = {}) {
  const queue = [...sitemapUrls];
  const seen = new Set();
  const urls = new Map();
  const failures = [];

  while (queue.length && seen.size < maxSitemaps) {
    const sitemapUrl = queue.shift();
    if (seen.has(sitemapUrl)) continue;
    seen.add(sitemapUrl);

    let xml;
    try {
      xml = await fetchSitemap(sitemapUrl, fetch);
    } catch (error) {
      failures.push({ sitemap: sitemapUrl, error: error.message });
      continue;
    }

    const { kind, locs } = parseSitemap(xml);
    if (kind === "index") queue.push(...locs);
    else for (const loc of locs) if (!urls.has(loc)) urls.set(loc, sitemapUrl);
  }

  return { urls, sitemaps: [...seen], failures };
}

export function parseSitemap(xml) {
  const kind = /<(?:\w+:)?sitemapindex[\s>]/i.test(xml) ? "index" : "urlset";
  const container = kind === "index" ? "sitemap" : "url";
  const blocks = xml.match(new RegExp(`<(?:\\w+:)?${container}[\\s>][\\s\\S]*?</(?:\\w+:)?${container}>`, "gi")) ?? [];
  const locs = blocks
    .map((block) => block.match(/<(?:\w+:)?loc>\s*(?:<!\[CDATA\[)?\s*([\s\S]*?)\s*(?:\]\]>)?\s*<\/(?:\w+:)?loc>/i)?.[1])
    .filter(Boolean)
    .map(decodeEntities);
  return { kind, locs };
}

async function fetchSitemap(url, fetch) {
  const response = await fetchWithRetry(fetch, url, { headers: { "user-agent": USER_AGENT } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const gzipped = bytes[0] === 0x1f && bytes[1] === 0x8b;
  return (gzipped ? gunzipSync(bytes) : bytes).toString("utf8");
}

function decodeEntities(text) {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}
