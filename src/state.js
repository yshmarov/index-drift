import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const VERSION = 1;

export function emptyState(site) {
  return { version: VERSION, site, updatedAt: null, sitemaps: {}, urls: {} };
}

export async function loadState(path, site) {
  let raw;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return emptyState(site);
    throw error;
  }
  const state = JSON.parse(raw);
  if (state.site && state.site !== site) {
    throw new Error(`${path} belongs to ${state.site}, not ${site}. Use --state to pick another file.`);
  }
  return { ...emptyState(site), ...state };
}

// Sorted keys and one URL per line keep the file reviewable in git: each run's diff is the index history.
export async function saveState(path, state) {
  await mkdir(dirname(path), { recursive: true });
  const sorted = { ...state, sitemaps: sortKeys(state.sitemaps), urls: sortKeys(state.urls) };
  await writeFile(path, `${JSON.stringify(sorted, null, 2)}\n`);
}

// Never-checked URLs first, then the ones checked longest ago, so a site larger than the daily
// quota is covered in full every ceil(urls / budget) runs.
export function pickUrls(sitemapUrls, state, budget, checkedAt = (record) => record?.checkedAt) {
  return [...sitemapUrls]
    .map((url, order) => ({ url, order, checkedAt: checkedAt(state.urls[url]) ?? "" }))
    .sort((a, b) => a.checkedAt.localeCompare(b.checkedAt) || a.order - b.order)
    .slice(0, Math.max(0, budget))
    .map(({ url }) => url);
}

export function defaultStatePath(site) {
  const slug = site.replace(/^sc-domain:/, "").replace(/^https?:\/\//, "").replace(/[^a-z0-9.-]+/gi, "_").replace(/_+$/, "");
  return `.index-drift/${slug}.json`;
}

function sortKeys(object) {
  return Object.fromEntries(Object.entries(object).sort(([a], [b]) => a.localeCompare(b)));
}
