import assert from "node:assert/strict";
import { test } from "node:test";
import { canonicalOverride, compare, localeOf, sitemapProblems } from "../src/analyze.js";

const indexed = { checkedAt: "2026-11-01", verdict: "PASS", coverageState: "Submitted and indexed", googleCanonical: "https://x.com/a/" };
const crawledNotIndexed = { checkedAt: "2026-11-02", verdict: "NEUTRAL", coverageState: "Crawled - currently not indexed", googleCanonical: null };

test("compare reports a URL that left the index", () => {
  assert.deepEqual(compare("https://x.com/a/", indexed, crawledNotIndexed), [
    { type: "dropped", url: "https://x.com/a/", from: "Submitted and indexed", to: "Crawled - currently not indexed" },
  ]);
});

test("compare reports nothing for a first inspection", () => {
  assert.deepEqual(compare("https://x.com/a/", undefined, crawledNotIndexed), []);
});

test("compare reports a canonical Google switched", () => {
  const changes = compare("https://x.com/a/", indexed, { ...indexed, googleCanonical: "https://x.com/b/" });
  assert.deepEqual(changes.map((c) => c.type), ["canonicalChanged"]);
});

test("localeOf reads path prefixes and subdomains, and ignores non-language segments", () => {
  assert.equal(localeOf("https://x.com/fr/pricing/"), "fr");
  assert.equal(localeOf("https://x.com/pt-BR/"), "pt-br");
  assert.equal(localeOf("https://de.x.com/preise/"), "de");
  assert.equal(localeOf("https://x.com/go/start/"), null);
  assert.equal(localeOf("https://x.com/pricing/"), null);
});

test("canonicalOverride flags a translation folded into another language", () => {
  const override = canonicalOverride("https://x.com/fr/tarifs/", { googleCanonical: "https://x.com/pricing/", userCanonical: "https://x.com/fr/tarifs/" });
  assert.equal(override.otherLocale, true);
  assert.equal(override.from, "fr");
  assert.equal(override.to, null);
});

test("canonicalOverride accepts a canonical the site itself declared", () => {
  assert.equal(canonicalOverride("https://x.com/a/?ref=1", { googleCanonical: "https://x.com/a/", userCanonical: "https://x.com/a/" }), null);
});

test("sitemapProblems flags a sitemap Google never read", () => {
  const now = Date.parse("2026-11-16T00:00:00Z");
  const problems = sitemapProblems({
    submitted: [
      { path: "https://x.com/sitemap.xml", isPending: true, lastSubmitted: "2026-10-26T00:00:00Z" },
      { path: "https://x.com/en/sitemap.xml", isPending: false, lastDownloaded: "2026-11-15T00:00:00Z", errors: "0", warnings: "2" },
    ],
    requested: ["https://x.com/blog/sitemap.xml"],
    failures: [],
    now,
  });
  assert.deepEqual(problems.map((p) => p.problem), [
    "pending for 21 days: Google has not read it",
    "2 warnings in Search Console",
    "not submitted to Search Console",
  ]);
});
