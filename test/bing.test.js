import assert from "node:assert/strict";
import { test } from "node:test";
import { bingFeedProblems } from "../src/analyze.js";
import { BingWebmaster, bingSiteFor, parseDate } from "../src/bing.js";
import { QuotaExhausted } from "../src/http.js";
import { run } from "../src/run.js";
import { emptyState } from "../src/state.js";

test("parseDate reads Bing dates and treats year 0001 as unknown", () => {
  assert.equal(parseDate("/Date(1789801200000)/"), "2026-09-19T07:00:00.000Z");
  assert.equal(parseDate("/Date(1789801200000-0700)/"), "2026-09-19T07:00:00.000Z");
  assert.equal(parseDate("/Date(-62135596800000)/"), null);
  assert.equal(parseDate(undefined), null);
});

test("bingSiteFor turns a domain property into a Bing site URL", () => {
  assert.equal(bingSiteFor("sc-domain:example.com"), "https://example.com/");
  assert.equal(bingSiteFor("https://www.example.com/"), "https://www.example.com/");
});

test("BingWebmaster reads URL info and gives up on throttling as a quota", async () => {
  const ok = async () => ({ ok: true, json: async () => ({ d: { DiscoveryDate: "/Date(-62135596800000)/", LastCrawledDate: "/Date(-62135596800000)/" } }) });
  const bing = new BingWebmaster({ apiKey: "k", site: "https://x.com/", fetch: ok, sleep: async () => {} });
  assert.deepEqual(await bing.urlInfo("https://x.com/new/"), { discovered: null, lastCrawled: null });

  const throttled = async () => ({ ok: false, status: 400, json: async () => ({ Message: "ThrottleUser" }) });
  const limited = new BingWebmaster({ apiKey: "k", site: "https://x.com/", fetch: throttled, sleep: async () => {} });
  await assert.rejects(limited.urlInfo("https://x.com/"), QuotaExhausted);
});

test("bingFeedProblems flags a sitemap Bing has not read for a month", () => {
  const now = Date.parse("2026-11-16T00:00:00Z");
  const problems = bingFeedProblems([{ path: "https://x.com/sitemap.xml", status: "Success", lastCrawled: "2026-10-01T00:00:00Z" }], now);
  assert.deepEqual(problems, [{ sitemap: "https://x.com/sitemap.xml", problem: "last read by Bing 46 days ago" }]);
});

test("run reports a page Bing forgot and keeps the Google result next to it", async () => {
  const state = emptyState("sc-domain:x.com");
  state.urls["https://x.com/a"] = {
    checkedAt: "2026-11-01",
    verdict: "PASS",
    bing: { checkedAt: "2026-11-01", discovered: "2026-09-01T00:00:00.000Z", lastCrawled: "2026-10-01T00:00:00.000Z" },
  };
  const gsc = { site: "sc-domain:x.com", listSitemaps: async () => [{ path: "https://x.com/sitemap.xml", lastDownloaded: new Date().toISOString() }], inspect: async () => ({}), pageImpressions: async () => new Map() };
  const bing = { site: "https://x.com/", feeds: async () => [], urlInfo: async () => ({ discovered: null, lastCrawled: null }) };
  const fetch = async () => ({ ok: true, arrayBuffer: async () => Buffer.from("<urlset><url><loc>https://x.com/a</loc></url></urlset>") });

  const result = await run({ gsc, bing, state, budget: 0, bingSpacingMs: 0, fetch });

  assert.deepEqual(result.changes.map((c) => c.type), ["bingForgot"]);
  assert.deepEqual(result.bing.unknown, ["https://x.com/a"]);
  assert.equal(state.urls["https://x.com/a"].verdict, "PASS");
  assert.equal(result.bing.problems[0].problem, "no sitemap submitted to Bing Webmaster Tools");
});

test("run sends pages Bing has not seen to IndexNow once a week, not every run", async () => {
  const state = emptyState("sc-domain:x.com");
  const gsc = { site: "sc-domain:x.com", listSitemaps: async () => [], inspect: async () => ({}), pageImpressions: async () => new Map() };
  const bing = { site: "https://x.com/", feeds: async () => [], urlInfo: async () => ({ discovered: null, lastCrawled: null }) };
  const sitemap = async () => ({ ok: true, arrayBuffer: async () => Buffer.from("<urlset><url><loc>https://x.com/a</loc></url></urlset>") });
  const posts = [];
  const indexnow = { key: "k", fetch: async (url, options) => (posts.push(JSON.parse(options.body)), { ok: true, status: 202 }) };

  const first = await run({ gsc, bing, state, sitemaps: ["https://x.com/sitemap.xml"], budget: 0, bingSpacingMs: 0, fetch: sitemap, indexnow });
  const second = await run({ gsc, bing, state, sitemaps: ["https://x.com/sitemap.xml"], budget: 0, bingSpacingMs: 0, fetch: sitemap, indexnow });

  assert.deepEqual(first.indexnow.submitted, ["https://x.com/a"]);
  assert.deepEqual(posts, [{ host: "x.com", key: "k", urlList: ["https://x.com/a"] }]);
  assert.deepEqual(second.indexnow.submitted, []);
});
