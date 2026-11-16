const DAY = 86_400_000;

// ISO 639-1. A first path segment or subdomain counts as a locale only if it is one of these,
// so /go/ or /ai/ are not mistaken for languages.
const LANGUAGES = new Set(
  ("aa ab ae af ak am an ar as av ay az ba be bg bh bi bm bn bo br bs ca ce ch co cr cs cu cv cy da de dv dz ee el en eo es " +
    "et eu fa ff fi fj fo fr fy ga gd gl gn gu gv ha he hi ho hr ht hu hy hz ia id ie ig ii ik io is it iu ja jv ka kg ki kj " +
    "kk kl km kn ko kr ks ku kv kw ky la lb lg li ln lo lt lu lv mg mh mi mk ml mn mr ms mt my na nb nd ne ng nl nn no nr nv " +
    "ny oc oj om or os pa pi pl ps pt qu rm rn ro ru rw sa sc sd se sg si sk sl sm sn so sq sr ss st su sv sw ta te tg th ti " +
    "tk tl tn to tr ts tt tw ty ug uk ur uz ve vi vo wa wo xh yi yo za zh zu").split(" "),
);
const LOCALE = /^([a-z]{2})(?:[-_][a-z0-9]{2,4})?$/i;

export function toRecord(result, checkedAt) {
  return {
    checkedAt,
    verdict: result.verdict ?? null,
    coverageState: result.coverageState ?? null,
    indexingState: result.indexingState ?? null,
    pageFetchState: result.pageFetchState ?? null,
    robotsTxtState: result.robotsTxtState ?? null,
    lastCrawlTime: result.lastCrawlTime ?? null,
    googleCanonical: result.googleCanonical ?? null,
    userCanonical: result.userCanonical ?? null,
  };
}

export const isIndexed = (record) => record?.verdict === "PASS";

export function compare(url, previous, current) {
  if (!previous) return [];
  const changes = [];
  if (isIndexed(previous) && !isIndexed(current)) changes.push({ type: "dropped", url, from: previous.coverageState, to: current.coverageState });
  if (!isIndexed(previous) && isIndexed(current)) changes.push({ type: "indexed", url, from: previous.coverageState });
  if (previous.googleCanonical && current.googleCanonical && previous.googleCanonical !== current.googleCanonical) {
    changes.push({ type: "canonicalChanged", url, from: previous.googleCanonical, to: current.googleCanonical });
  }
  return changes;
}

export function localeOf(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const segment = parsed.pathname.split("/")[1] ?? "";
  const subdomain = parsed.hostname.split(".").length > 2 ? parsed.hostname.split(".")[0] : "";
  for (const candidate of [segment, subdomain]) {
    const match = candidate.match(LOCALE);
    if (match && LANGUAGES.has(match[1].toLowerCase())) return candidate.toLowerCase().replace("_", "-");
  }
  return null;
}

// Google picked a canonical the site did not ask for. When the two URLs carry different locales,
// Google has folded a translation into another language version and will not show it.
export function canonicalOverride(url, record) {
  const expected = record?.userCanonical || url;
  if (!record?.googleCanonical || record.googleCanonical === expected) return null;
  const from = localeOf(url);
  const to = localeOf(record.googleCanonical);
  return { url, googleCanonical: record.googleCanonical, otherLocale: from !== to, from, to };
}

export function sitemapProblems({ submitted, requested, failures, now }) {
  const problems = [];
  const age = (date) => (date ? Math.floor((now - Date.parse(date)) / DAY) : null);

  for (const sitemap of submitted) {
    const errors = Number(sitemap.errors ?? 0);
    const warnings = Number(sitemap.warnings ?? 0);
    const submittedDays = age(sitemap.lastSubmitted);
    const downloadedDays = age(sitemap.lastDownloaded);

    if (sitemap.isPending && submittedDays >= 2) problems.push({ sitemap: sitemap.path, problem: `pending for ${submittedDays} days: Google has not read it` });
    else if (!sitemap.isPending && !sitemap.lastDownloaded) problems.push({ sitemap: sitemap.path, problem: "never downloaded by Google" });
    else if (downloadedDays >= 30) problems.push({ sitemap: sitemap.path, problem: `last read by Google ${downloadedDays} days ago` });
    if (errors) problems.push({ sitemap: sitemap.path, problem: `${errors} error${errors === 1 ? "" : "s"} in Search Console` });
    if (warnings) problems.push({ sitemap: sitemap.path, problem: `${warnings} warning${warnings === 1 ? "" : "s"} in Search Console` });
  }

  const known = new Set(submitted.map((s) => s.path));
  for (const path of requested) {
    if (!known.has(path)) problems.push({ sitemap: path, problem: "not submitted to Search Console" });
  }
  for (const { sitemap, error } of failures) problems.push({ sitemap, problem: `could not fetch (${error})` });

  return problems;
}

export function snapshot(urls, state) {
  const reasons = {};
  const overrides = [];
  let checked = 0;
  let indexed = 0;

  for (const url of urls) {
    const record = state.urls[url];
    if (!record) continue;
    checked++;
    if (isIndexed(record)) indexed++;
    else {
      const reason = record.coverageState || record.verdict || "Unknown";
      (reasons[reason] ??= []).push(url);
    }
    const override = canonicalOverride(url, record);
    if (override) overrides.push(override);
  }

  return { total: urls.length, checked, unchecked: urls.length - checked, indexed, reasons, overrides };
}
