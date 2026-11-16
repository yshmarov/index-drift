import { compare, sitemapProblems, snapshot, toRecord } from "./analyze.js";
import { QuotaExhausted } from "./gsc.js";
import { collectUrls } from "./sitemaps.js";
import { pickUrls } from "./state.js";

export async function run({ gsc, state, sitemaps: requested = [], budget = 2000, concurrency = 5, languageCode, fetch, now = new Date(), onProgress = () => {}, checkpoint = async () => {}, checkpointEvery = 100 }) {
  const submitted = await gsc.listSitemaps();
  const sources = requested.length ? requested : submitted.filter((s) => !s.parent).map((s) => s.path);
  if (!sources.length) throw new Error(`No sitemaps: none are submitted for ${gsc.site}. Pass --sitemap <url>.`);

  const { urls: found, failures } = await collectUrls(sources, { fetch });
  const urls = [...found.keys()];

  // A sitemap that failed to load would otherwise look like all its URLs were removed.
  const removed = failures.length ? [] : Object.keys(state.urls).filter((url) => !found.has(url));
  for (const url of removed) delete state.urls[url];

  const queue = pickUrls(urls, state, budget);
  const changes = [];
  const errors = [];
  let inspected = 0;
  let quotaHit = false;

  await pool(queue, concurrency, async (url) => {
    if (quotaHit) return;
    try {
      const record = toRecord(await gsc.inspect(url, { languageCode }), new Date().toISOString());
      changes.push(...compare(url, state.urls[url], record));
      state.urls[url] = record;
      inspected++;
      onProgress(inspected, queue.length);
      if (inspected % checkpointEvery === 0) await checkpoint();
    } catch (error) {
      if (error instanceof QuotaExhausted) quotaHit = true;
      else errors.push({ url, error: error.message });
    }
  });

  state.updatedAt = now.toISOString();
  state.sitemaps = Object.fromEntries(
    submitted.map((s) => [s.path, { isPending: s.isPending ?? false, lastSubmitted: s.lastSubmitted ?? null, lastDownloaded: s.lastDownloaded ?? null, errors: Number(s.errors ?? 0), warnings: Number(s.warnings ?? 0) }]),
  );

  return {
    site: gsc.site,
    date: now.toISOString().slice(0, 10),
    sources,
    inspected,
    queued: queue.length,
    budget,
    quotaHit,
    removed: removed.length,
    changes,
    errors,
    sitemapProblems: sitemapProblems({ submitted, requested, failures, now: now.getTime() }),
    ...snapshot(urls, state),
  };
}

// The URL Inspection API allows 600 requests a minute per property; starts are spaced to stay under it.
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
