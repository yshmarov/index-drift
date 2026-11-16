#!/usr/bin/env node
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { accessToken, loadCredentials } from "../src/auth.js";
import { SearchConsole } from "../src/gsc.js";
import { markdownReport, terminalReport } from "../src/report.js";
import { run } from "../src/run.js";
import { defaultStatePath, loadState, saveState } from "../src/state.js";

const HELP = `Usage: index-drift --site <property> [options]

Checks every URL in your sitemaps with the Search Console URL Inspection API,
saves the result, and reports what changed since the last run.

  --site <property>     Search Console property: sc-domain:example.com or https://example.com/
  --sitemap <url>       Sitemap to read (repeat for more). Default: the sitemaps submitted in Search Console
  --state <file>        Where results are kept. Default: .index-drift/<site>.json
  --budget <n>          URLs to inspect this run (Google allows 2,000 a day per property). Default: 2000
                        Use 0 to only check sitemap health
  --concurrency <n>     Parallel inspections. Default: 5
  --report <file>       Also write a Markdown report (for GitHub issues and job summaries)
  --json <file>         Also write the full result as JSON
  --limit <n>           URLs shown per section in the terminal. Default: 10
  --language <code>     Language of Google's messages, e.g. en-US. Default: en-US
  --credentials <file>  Service account key. Default: GOOGLE_APPLICATION_CREDENTIALS or GSC_CREDENTIALS (JSON)
  --fail-on-drop        Exit with code 2 when a URL dropped out of the index
  -h, --help            Show this help
  -v, --version         Show the version
`;

async function main() {
  const { values } = parseArgs({
    options: {
      site: { type: "string" },
      sitemap: { type: "string", multiple: true, default: [] },
      state: { type: "string" },
      budget: { type: "string", default: "2000" },
      concurrency: { type: "string", default: "5" },
      report: { type: "string" },
      json: { type: "string" },
      limit: { type: "string", default: "10" },
      language: { type: "string", default: "en-US" },
      credentials: { type: "string" },
      "fail-on-drop": { type: "boolean", default: false },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
  });

  if (values.help) return void process.stdout.write(HELP);
  if (values.version) {
    const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
    return void console.log(pkg.version);
  }
  if (!values.site) {
    process.stderr.write(`Missing --site.\n\n${HELP}`);
    return 1;
  }

  const site = values.site;
  const statePath = values.state || defaultStatePath(site);
  const sitemaps = values.sitemap.flatMap((s) => s.split(/[\s,]+/)).filter(Boolean);
  const budget = integer(values.budget, "--budget");

  const key = await loadCredentials({ file: values.credentials });
  const gsc = new SearchConsole({ token: await accessToken(key), site });
  const state = await loadState(statePath, site);
  const progress = process.stderr.isTTY
    ? (done, total) => process.stderr.write(`\rInspecting ${done}/${total}`)
    : (done, total) => done % 100 === 0 && process.stderr.write(`Inspected ${done}/${total}\n`);

  const result = await run({
    checkpoint: () => saveState(statePath, state),
    gsc,
    state,
    sitemaps,
    budget,
    concurrency: integer(values.concurrency, "--concurrency"),
    languageCode: values.language,
    onProgress: progress,
  });
  if (process.stderr.isTTY && result.inspected) process.stderr.write("\r\x1b[K");

  await saveState(statePath, state);
  if (values.report) await writeFile(values.report, markdownReport(result));
  if (values.json) await writeFile(values.json, `${JSON.stringify(result, null, 2)}\n`);

  const dropped = result.changes.filter((c) => c.type === "dropped").length;
  if (process.env.GITHUB_OUTPUT) {
    const folded = result.overrides.filter((o) => o.otherLocale).length;
    await appendFile(
      process.env.GITHUB_OUTPUT,
      `dropped=${dropped}\nsitemap-problems=${result.sitemapProblems.length}\nfolded=${folded}\nindexed=${result.indexed}\nchecked=${result.checked}\nstate=${statePath}\n`,
    );
  }

  console.log(terminalReport(result, { limit: integer(values.limit, "--limit"), color: process.stdout.isTTY }));
  console.log(`State saved to ${statePath}`);
  return values["fail-on-drop"] && dropped ? 2 : 0;
}

function integer(value, flag) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${flag} must be a whole number, got "${value}".`);
  return n;
}

main().then(
  (code) => (process.exitCode = code ?? 0),
  (error) => {
    console.error(`index-drift: ${error.message}`);
    process.exitCode = 1;
  },
);
