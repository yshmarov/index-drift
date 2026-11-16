import assert from "node:assert/strict";
import { test } from "node:test";
import { gzipSync } from "node:zlib";
import { collectUrls, parseSitemap } from "../src/sitemaps.js";

const urlset = (...locs) =>
  `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${locs
    .map((loc) => `<url><loc>${loc}</loc><xhtml:link rel="alternate" hreflang="fr" href="https://x.com/fr/"/></url>`)
    .join("")}</urlset>`;

test("parseSitemap reads URLs but not hreflang alternates", () => {
  assert.deepEqual(parseSitemap(urlset("https://x.com/", "https://x.com/a?b=1&amp;c=2")), {
    kind: "urlset",
    locs: ["https://x.com/", "https://x.com/a?b=1&c=2"],
  });
});

test("parseSitemap reads CDATA and prefixed tags", () => {
  const xml = `<ns:sitemapindex xmlns:ns="http://www.sitemaps.org/schemas/sitemap/0.9"><ns:sitemap><ns:loc><![CDATA[ https://x.com/en.xml ]]></ns:loc></ns:sitemap></ns:sitemapindex>`;
  assert.deepEqual(parseSitemap(xml), { kind: "index", locs: ["https://x.com/en.xml"] });
});

test("collectUrls follows indexes, unzips, and records failures", async () => {
  const pages = {
    "https://x.com/sitemap.xml": `<sitemapindex><sitemap><loc>https://x.com/en.xml.gz</loc></sitemap><sitemap><loc>https://x.com/gone.xml</loc></sitemap></sitemapindex>`,
    "https://x.com/en.xml.gz": gzipSync(urlset("https://x.com/", "https://x.com/b/")),
  };
  const fetch = async (url) =>
    pages[url] ? { ok: true, arrayBuffer: async () => Buffer.from(pages[url]) } : { ok: false, status: 404 };

  const { urls, failures } = await collectUrls(["https://x.com/sitemap.xml"], { fetch });
  assert.deepEqual([...urls.keys()], ["https://x.com/", "https://x.com/b/"]);
  assert.deepEqual(failures, [{ sitemap: "https://x.com/gone.xml", error: "HTTP 404" }]);
});
