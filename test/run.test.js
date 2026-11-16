import assert from "node:assert/strict";
import { test } from "node:test";
import { QuotaExhausted, SearchConsole } from "../src/gsc.js";
import { run } from "../src/run.js";
import { emptyState, pickUrls } from "../src/state.js";

const sitemapFetch = (locs) => async () => ({
  ok: true,
  arrayBuffer: async () => Buffer.from(`<urlset>${locs.map((l) => `<url><loc>${l}</loc></url>`).join("")}</urlset>`),
});

function fakeGsc(results, { quotaAfter = Infinity } = {}) {
  let calls = 0;
  return {
    site: "sc-domain:x.com",
    listSitemaps: async () => [{ path: "https://x.com/sitemap.xml", isPending: false, lastDownloaded: new Date().toISOString() }],
    inspect: async (url) => {
      if (++calls > quotaAfter) throw new QuotaExhausted("Quota exceeded");
      return results[url] ?? { verdict: "PASS", coverageState: "Submitted and indexed" };
    },
  };
}

test("pickUrls inspects new URLs first, then the oldest checks", () => {
  const state = emptyState("sc-domain:x.com");
  state.urls = { "https://x.com/a": { checkedAt: "2026-11-02" }, "https://x.com/b": { checkedAt: "2026-11-01" } };
  assert.deepEqual(pickUrls(["https://x.com/a", "https://x.com/b", "https://x.com/c"], state, 2), ["https://x.com/c", "https://x.com/b"]);
});

test("run reports drops, prunes URLs that left the sitemap, and keeps the rest", async () => {
  const state = emptyState("sc-domain:x.com");
  state.urls = {
    "https://x.com/a": { checkedAt: "2026-11-01", verdict: "PASS", coverageState: "Submitted and indexed" },
    "https://x.com/old": { checkedAt: "2026-11-01", verdict: "PASS" },
  };
  const gsc = fakeGsc({ "https://x.com/a": { verdict: "NEUTRAL", coverageState: "Crawled - currently not indexed" } });

  const result = await run({ gsc, state, fetch: sitemapFetch(["https://x.com/a", "https://x.com/b"]) });

  assert.deepEqual(result.changes.map((c) => [c.type, c.url]), [["dropped", "https://x.com/a"]]);
  assert.equal(result.removed, 1);
  assert.deepEqual(Object.keys(state.urls).sort(), ["https://x.com/a", "https://x.com/b"]);
  assert.deepEqual(result.reasons, { "Crawled - currently not indexed": ["https://x.com/a"] });
});

test("run stops at the daily quota and keeps what it already checked", async () => {
  const state = emptyState("sc-domain:x.com");
  const urls = ["https://x.com/1", "https://x.com/2", "https://x.com/3"];
  const result = await run({ gsc: fakeGsc({}, { quotaAfter: 1 }), state, concurrency: 1, fetch: sitemapFetch(urls) });

  assert.equal(result.quotaHit, true);
  assert.equal(result.inspected, 1);
  assert.deepEqual(Object.keys(state.urls), ["https://x.com/1"]);
});

test("SearchConsole treats a 429 that outlasts the retries as the daily quota", async () => {
  const fetch = async () => ({ ok: false, status: 429, json: async () => ({ error: { message: "Quota exceeded" } }) });
  const gsc = new SearchConsole({ token: "t", site: "sc-domain:x.com", fetch, sleep: async () => {} });
  await assert.rejects(gsc.inspect("https://x.com/"), QuotaExhausted);
});

test("SearchConsole retries a dropped connection", async () => {
  let calls = 0;
  const fetch = async () => {
    if (++calls === 1) throw new TypeError("fetch failed", { cause: { code: "ECONNRESET" } });
    return { ok: true, json: async () => ({ inspectionResult: { indexStatusResult: { verdict: "PASS" } } }) };
  };
  const gsc = new SearchConsole({ token: "t", site: "sc-domain:x.com", fetch, sleep: async () => {} });
  assert.deepEqual(await gsc.inspect("https://x.com/"), { verdict: "PASS" });
});

test("run keeps saved URLs when a sitemap could not be read", async () => {
  const state = emptyState("sc-domain:x.com");
  state.urls = { "https://x.com/kept": { checkedAt: "2026-11-01", verdict: "PASS" } };
  const fetch = async () => ({ ok: false, status: 503 });

  const result = await run({ gsc: fakeGsc({}), state, fetch });

  assert.equal(result.removed, 0);
  assert.deepEqual(Object.keys(state.urls), ["https://x.com/kept"]);
  assert.match(result.sitemapProblems[0].problem, /could not fetch \(HTTP 503\)/);
});
