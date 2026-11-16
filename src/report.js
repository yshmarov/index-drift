const CHANGE_TITLES = {
  dropped: "Dropped from the index",
  indexed: "Newly indexed",
  canonicalChanged: "Google changed the canonical",
};

export function sections(result, { limit = 10 } = {}) {
  const out = [];
  const byType = (type) => result.changes.filter((c) => c.type === type);
  const folded = result.overrides.filter((o) => o.otherLocale);
  const otherCanonical = result.overrides.filter((o) => !o.otherLocale);

  if (result.sitemapProblems.length) {
    out.push({ title: "Sitemap problems", items: result.sitemapProblems.map((p) => `${p.sitemap}: ${p.problem}`), warn: true });
  }
  for (const type of Object.keys(CHANGE_TITLES)) {
    const changes = byType(type);
    if (!changes.length) continue;
    out.push({
      title: CHANGE_TITLES[type],
      warn: type !== "indexed",
      items: changes.map((c) => (type === "canonicalChanged" ? `${c.url}: ${c.from} → ${c.to}` : `${c.url} (${type === "dropped" ? c.to : `was: ${c.from}`})`)),
    });
  }
  if (folded.length) {
    out.push({ title: "Folded into another locale", warn: true, items: folded.map((o) => `${o.url} → ${o.googleCanonical}`) });
  }
  if (result.impressions?.invisible.length) {
    out.push({ title: `Indexed, but zero impressions from ${result.impressions.startDate} to ${result.impressions.endDate}`, items: result.impressions.invisible });
  }
  if (otherCanonical.length) {
    out.push({ title: "Google chose a different canonical", items: otherCanonical.map((o) => `${o.url} → ${o.googleCanonical}`) });
  }
  for (const [reason, urls] of Object.entries(result.reasons).sort((a, b) => b[1].length - a[1].length)) {
    out.push({ title: `Not indexed: ${reason}`, items: urls });
  }
  if (result.errors.length) {
    out.push({ title: "Inspection errors", warn: true, items: result.errors.map((e) => `${e.url}: ${e.error}`) });
  }
  if (result.bing) out.push(...bingSections(result));
  return out.map((s) => ({ ...s, count: s.items.length, shown: s.items.slice(0, limit) }));
}

function bingSections(result) {
  const bing = result.bing;
  const out = [];
  const forgot = result.changes.filter((c) => c.type === "bingForgot");
  if (bing.problems.length) out.push({ title: "Bing: sitemap problems", warn: true, items: bing.problems.map((p) => `${p.sitemap}: ${p.problem}`) });
  if (forgot.length) out.push({ title: "Bing: forgot these pages", warn: true, items: forgot.map((c) => `${c.url} (last crawled ${c.from?.slice(0, 10) ?? "never"})`) });
  if (bing.unknown.length) out.push({ title: "Bing: never seen", warn: true, items: bing.unknown });
  if (bing.stale.length) {
    out.push({
      title: "Bing: not crawled in 30+ days",
      items: bing.stale.sort((a, b) => (b.days ?? Infinity) - (a.days ?? Infinity)).map((s) => `${s.url} (${s.days === null ? "never crawled" : `${s.days} days`})`),
    });
  }
  if (bing.errors.length) out.push({ title: "Bing: errors", warn: true, items: bing.errors.map((e) => `${e.url}: ${e.error}`) });
  for (const response of result.indexnow?.responses.filter((r) => !r.ok) ?? []) {
    out.push({ title: "IndexNow: submission failed", warn: true, items: [`${response.host}: ${response.error} (${response.count} URLs not sent)`] });
  }
  if (result.indexnow?.submitted.length) out.push({ title: "Sent to IndexNow", items: result.indexnow.submitted });
  return out;
}

export function headline(result) {
  const pct = result.checked ? Math.round((result.indexed / result.checked) * 100) : 0;
  const cycle = result.budget > 0 ? Math.ceil(result.total / result.budget) : null;
  const lines = [
    `${fmt(result.total)} URLs in sitemaps · ${fmt(result.indexed)} of ${fmt(result.checked)} checked are indexed (${pct}%)`,
    `Inspected ${fmt(result.inspected)} this run${result.quotaHit ? " · stopped at the daily quota" : ""}${result.stoppedOnErrors ? " · stopped after 10 errors in a row" : ""}` +
      (result.unchecked ? ` · ${fmt(result.unchecked)} not checked yet` : "") +
      (cycle > 1 ? ` · full pass every ${cycle} runs` : ""),
  ];
  if (result.bing) {
    const bing = result.bing;
    lines.push(
      `Bing (${bing.site}): ${fmt(bing.crawled)} of ${fmt(bing.checked)} checked were crawled · ${fmt(bing.unknown.length)} never seen` +
        ` · checked ${fmt(bing.inspected)} this run${bing.quotaHit ? " · stopped at the Bing quota" : ""}${bing.stoppedOnErrors ? " · stopped after 10 errors in a row" : ""}`,
    );
  }
  if (result.impressions?.error) lines.push(`Impressions not checked: ${result.impressions.error}`);
  else if (result.impressions) {
    const invisible = result.impressions.invisible.length;
    const share = result.indexed ? Math.round((invisible / result.indexed) * 100) : 0;
    lines.push(`${fmt(invisible)} of ${fmt(result.indexed)} indexed pages (${share}%) got zero impressions in the last 90 days`);
  }
  if (result.removed) lines.push(`${fmt(result.removed)} URLs left the sitemaps since the last run`);
  return lines;
}

export function terminalReport(result, { limit = 10, color = false } = {}) {
  const paint = (code, text) => (color ? `\x1b[${code}m${text}\x1b[0m` : text);
  const lines = [paint("1", `index-drift · ${result.site} · ${result.date}`), ...headline(result), ""];
  const all = sections(result, { limit });
  if (!all.length) lines.push(paint("32", "Every checked URL is indexed. Nothing changed."));
  for (const section of all) {
    lines.push(paint(section.warn ? "33;1" : "1", `${section.title} (${fmt(section.count)})`));
    for (const item of section.shown) lines.push(`  ${item}`);
    if (section.count > section.shown.length) lines.push(paint("2", `  … ${fmt(section.count - section.shown.length)} more in the state file`));
    lines.push("");
  }
  return lines.join("\n");
}

export function markdownReport(result, { limit = 50 } = {}) {
  const lines = [`## index-drift · \`${result.site}\` · ${result.date}`, "", ...headline(result).map((l) => `- ${l}`), ""];
  const all = sections(result, { limit });
  if (!all.length) lines.push("Every checked URL is indexed. Nothing changed.");
  for (const section of all) {
    lines.push(`<details${section.warn ? " open" : ""}><summary><strong>${escape(section.title)}</strong> (${fmt(section.count)})</summary>`, "");
    for (const item of section.shown) lines.push(`- ${escape(item)}`);
    if (section.count > section.shown.length) lines.push(`- … ${fmt(section.count - section.shown.length)} more`);
    lines.push("", "</details>", "");
  }
  return lines.join("\n");
}

const fmt = (n) => n.toLocaleString("en-US");
const escape = (text) => text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
