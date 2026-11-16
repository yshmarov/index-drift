#!/usr/bin/env node
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { accessToken, loadCredentials, userCredentialsPath } from "../src/auth.js";
import { BingWebmaster, bingSiteFor } from "../src/bing.js";
import { SearchConsole } from "../src/gsc.js";
import { login, logout, readClientFile, saveUserCredentials } from "../src/oauth.js";
import { markdownReport, terminalReport } from "../src/report.js";
import { run } from "../src/run.js";
import { defaultStatePath, loadState, saveState } from "../src/state.js";

const HELP = `Usage: index-drift --site <property> [options]
       index-drift login [--client <file>]
       index-drift logout

Checks every URL in your sitemaps with the Search Console URL Inspection API,
saves the result, and reports what changed since the last run.

  --site <property>     Search Console property: sc-domain:example.com or https://example.com/
  --sitemap <url>       Sitemap to read (repeat for more). Default: the sitemaps submitted in Search Console
  --state <file>        Where results are kept. Default: .index-drift/<site>.json
  --budget <n>          URLs to inspect this run (Google allows 2,000 a day per property). Default: 2000
                        Use 0 to only check sitemap health
  --concurrency <n>     Parallel inspections. Default: 5
  --report <file>       Also write a Markdown report (for GitHub issues and job summaries)
  --json <file>         Also write the full result as JSON. Use - to print only JSON to stdout
  --limit <n>           URLs shown per section in the terminal. Default: 10
  --language <code>     Language of Google's messages, e.g. en-US. Default: en-US
  --credentials <file>  Service account key. Default: GSC_CREDENTIALS (JSON), GOOGLE_APPLICATION_CREDENTIALS,
                        then your sign-in from index-drift login
  --fail-on-drop        Exit with code 2 when a URL dropped out of the Google index, or Bing forgot it
  --bing                Also check each URL in Bing Webmaster Tools (key in BING_WEBMASTER_API_KEY)
  --bing-site <url>     Bing site URL. Default: https://<domain>/ from --site
  --bing-budget <n>     URLs to check in Bing this run (Bing allows about 10 a minute). Default: 100
  --indexnow-key <key>  With --bing: send pages Bing has not seen, or not crawled in 30+ days, to IndexNow
                        (Bing, Yandex, Seznam, Naver; not Google). Or set INDEXNOW_KEY
  --indexnow-key-location <url>  Key file URL, if it is not at https://<host>/<key>.txt
  --skip-impressions    Do not look up which indexed pages got zero impressions in 90 days
  --client <file>       With login: your own OAuth desktop client file instead of the built-in one
  -h, --help            Show this help
  -v, --version         Show the version
`;

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      client: { type: "string" },
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
      bing: { type: "boolean", default: false },
      "bing-site": { type: "string" },
      "bing-budget": { type: "string", default: "100" },
      "indexnow-key": { type: "string" },
      "indexnow-key-location": { type: "string" },
      "skip-impressions": { type: "boolean", default: false },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
  });

  if (values.help) return void process.stdout.write(HELP);
  if (values.version) {
    const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
    return void console.log(pkg.version);
  }
  const [command] = positionals;
  if (command === "login") {
    const credentials = await login({ client: values.client ? await readClientFile(values.client) : undefined });
    const path = userCredentialsPath();
    await saveUserCredentials(credentials, path);
    console.log(`Signed in. Saved to ${path}`);
    if (process.env.GSC_CREDENTIALS || process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      console.log("GSC_CREDENTIALS or GOOGLE_APPLICATION_CREDENTIALS is set in this shell and is used before this sign-in.");
    }
    return 0;
  }
  if (command === "logout") {
    console.log((await logout()) ? "Signed out." : "Not signed in.");
    return 0;
  }
  if (command) {
    process.stderr.write(`Unknown command: ${command}\n\n${HELP}`);
    return 1;
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
  const gsc = new SearchConsole({ token: await accessToken(key), site, serviceAccount: key.client_email });
  const state = await loadState(statePath, site);

  let bing;
  if (values.bing) {
    const apiKey = process.env.BING_WEBMASTER_API_KEY?.trim();
    if (!apiKey)
      throw new Error("--bing needs the BING_WEBMASTER_API_KEY environment variable (Bing Webmaster Tools → Settings → API access).");
    bing = new BingWebmaster({ apiKey, site: values["bing-site"] || bingSiteFor(site) });
  }

  const indexnowKey = values["indexnow-key"] || process.env.INDEXNOW_KEY?.trim();
  if (indexnowKey && !bing)
    throw new Error("IndexNow needs --bing: index-drift submits the pages Bing has not seen or has not crawled lately.");
  const indexnow = indexnowKey ? { key: indexnowKey, keyLocation: values["indexnow-key-location"] } : undefined;

  const progress = process.stderr.isTTY
    ? (done, total, engine) => process.stderr.write(`\r\x1b[K${engine}: ${done}/${total}`)
    : (done, total, engine) => done % 100 === 0 && process.stderr.write(`${engine}: ${done}/${total}\n`);

  let result;
  try {
    result = await run({
      checkpoint: () => saveState(statePath, state),
      gsc,
      state,
      bing,
      sitemaps,
      budget,
      bingBudget: integer(values["bing-budget"], "--bing-budget"),
      concurrency: integer(values.concurrency, "--concurrency"),
      languageCode: values.language,
      onProgress: progress,
      impressions: !values["skip-impressions"],
      indexnow,
    });
  } finally {
    // Keep finished checks even when the run fails part way.
    await saveState(statePath, state);
  }
  if (process.stderr.isTTY && (result.inspected || result.bing?.inspected)) process.stderr.write("\r\x1b[K");

  if (values.report) await writeFile(values.report, markdownReport(result));
  const json = `${JSON.stringify(result, null, 2)}\n`;
  if (values.json && values.json !== "-") await writeFile(values.json, json);

  const dropped = result.changes.filter((c) => c.type === "dropped" || c.type === "bingForgot").length;
  if (process.env.GITHUB_OUTPUT) {
    const folded = result.overrides.filter((o) => o.otherLocale).length;
    await appendFile(
      process.env.GITHUB_OUTPUT,
      `dropped=${dropped}\nsitemap-problems=${result.sitemapProblems.length}\nfolded=${folded}\nindexed=${result.indexed}\nchecked=${result.checked}\nstate=${statePath}\n` +
        `bing-unknown=${result.bing?.unknown.length ?? 0}\nbing-problems=${result.bing?.problems.length ?? 0}\n` +
        `invisible=${result.impressions?.invisible.length ?? 0}\nindexnow-submitted=${result.indexnow?.submitted.length ?? 0}\n`,
    );
  }

  if (values.json === "-") process.stdout.write(json);
  else {
    console.log(terminalReport(result, { limit: integer(values.limit, "--limit"), color: process.stdout.isTTY }));
    console.log(`State saved to ${statePath}`);
  }
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
