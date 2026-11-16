import { bingFeedProblems, bingSnapshot, compare, sitemapProblems, snapshot, toRecord } from "./analyze.js";
import { QuotaExhausted } from "./http.js";
import { collectUrls } from "./sitemaps.js";
import { pickUrls } from "./state.js";

export async function run({
  gsc,
  bing,
  state,
  sitemaps: requested = [],
  budget = 2000,
  bingBudget = 100,
  bingSpacingMs = 6000,
  concurrency = 5,
  languageCode,
  fetch,
  now = new Date(),
  onProgress = () => {},
  checkpoint = async () => {},
  checkpointEvery = 100,
}) {
  const submitted = await gsc.listSitemaps();
  const sources = requested.length ? requested : submitted.filter((s) => !s.parent).map((s) => s.path);
  if (!sources.length) throw new Error(`No sitemaps: none are submitted for ${gsc.site}. Pass --sitemap <url>.`);

  const { urls: found, failures } = await collectUrls(sources, { fetch });
  const urls = [...found.keys()];

  // A sitemap that failed to load would otherwise look like all its URLs were removed.
  const removed = failures.length ? [] : Object.keys(state.urls).filter((url) => !found.has(url));
  for (const url of removed) delete state.urls[url];

  const changes = [];
  const google = await sweep({
    queue: pickUrls(urls, state, budget),
    concurrency,
    onProgress: (done, total) => onProgress(done, total, "Google"),
    checkpoint,
    checkpointEvery,
    check: async (url) => {
      const record = toRecord(await gsc.inspect(url, { languageCode }), new Date().toISOString());
      changes.push(...compare(url, state.urls[url], record));
      state.urls[url] = { ...state.urls[url], ...record };
    },
  });

  let bingResult = null;
  if (bing) {
    const feeds = await bing.feeds();
    const sweepResult = await sweep({
      queue: pickUrls(urls, state, bingBudget, (record) => record?.bing?.checkedAt),
      concurrency: 1,
      spacingMs: bingSpacingMs,
      onProgress: (done, total) => onProgress(done, total, "Bing"),
      checkpoint,
      checkpointEvery,
      check: async (url) => {
        const info = await bing.urlInfo(url);
        const previous = state.urls[url]?.bing;
        if (previous?.discovered && !info.discovered) changes.push({ type: "bingForgot", url, from: previous.lastCrawled });
        state.urls[url] = { ...state.urls[url], bing: { checkedAt: new Date().toISOString(), ...info } };
      },
    });
    bingResult = {
      site: bing.site,
      ...sweepResult,
      budget: bingBudget,
      problems: bingFeedProblems(feeds, now.getTime()),
      ...bingSnapshot(urls, state, now.getTime()),
    };
  }

  state.updatedAt = now.toISOString();
  state.sitemaps = Object.fromEntries(
    submitted.map((s) => [s.path, { isPending: s.isPending ?? false, lastSubmitted: s.lastSubmitted ?? null, lastDownloaded: s.lastDownloaded ?? null, errors: Number(s.errors ?? 0), warnings: Number(s.warnings ?? 0) }]),
  );

  return {
    site: gsc.site,
    date: now.toISOString().slice(0, 10),
    sources,
    inspected: google.inspected,
    queued: google.queued,
    budget,
    quotaHit: google.quotaHit,
    removed: removed.length,
    changes,
    errors: google.errors,
    sitemapProblems: sitemapProblems({ submitted, requested, failures, now: now.getTime() }),
    ...snapshot(urls, state),
    bing: bingResult,
  };
}

async function sweep({ queue, concurrency, spacingMs, check, onProgress, checkpoint, checkpointEvery }) {
  const errors = [];
  let inspected = 0;
  let quotaHit = false;

  await pool(queue, concurrency, async (url) => {
    if (quotaHit) return;
    try {
      await check(url);
      inspected++;
      onProgress(inspected, queue.length);
      if (inspected % checkpointEvery === 0) await checkpoint();
    } catch (error) {
      if (error instanceof QuotaExhausted) quotaHit = true;
      else errors.push({ url, error: error.message });
    }
  }, { spacingMs });

  return { inspected, queued: queue.length, quotaHit, errors };
}

// Google's URL Inspection API allows 600 requests a minute per property. Bing's GetUrlInfo throttles
// after about 10 calls a minute, so Bing runs one request at a time with a wider gap.
async function pool(items, size, worker, { spacingMs = 110 } = {}) {
  let next = 0;
  let lastStart = 0;
  const lane = async () => {
    while (next < items.length) {
      const item = items[next++];
      const wait = lastStart + spacingMs - Date.now();
      lastStart = Math.max(Date.now(), lastStart + spacingMs);
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      await worker(item);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, size) }, lane));
}
