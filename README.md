# index-drift

Google drops pages from its index without telling you. It also picks a different canonical than the one you set, and on multilingual sites it often folds a translation into another language version. Search Console shows this one URL at a time.

index-drift checks every URL in your sitemaps with the Search Console URL Inspection API, saves the result, and reports what changed since the last run.

```sh
npx index-drift --site sc-domain:example.com
```

It finds:

- **Pages that dropped out of the index** since their last check
- **Translations folded into another locale**: Google chose `/pricing/` as the canonical for `/fr/tarifs/`, so the French page does not show in search
- **Other canonical overrides**: Google ignored your `rel=canonical`
- **Sitemaps Google never read**: "pending" for days, never downloaded, or with errors
- **Every page that is not indexed**, grouped by Google's reason ("Crawled - currently not indexed", "URL is unknown to Google", …)
- **Indexed pages nobody sees**: indexed, but zero impressions in the last 90 days
- **Bing (optional)**: pages Bing has never seen, has not crawled for 30+ days, or has forgotten. ChatGPT search and Copilot answer from Bing's index, so a page Bing does not have is a page they cannot cite.

With an IndexNow key, it also sends the pages Bing is missing to IndexNow.

No dependencies. Node 20 or newer.

```
index-drift · sc-domain:example.com · 2026-11-16
722 URLs in sitemaps · 708 of 722 checked are indexed (98%)
Inspected 722 this run
Bing (https://example.com/): 96 of 100 checked were crawled · 4 never seen · checked 100 this run
211 of 708 indexed pages (30%) got zero impressions in the last 90 days

Sitemap problems (1)
  https://example.com/sitemap.xml: pending for 20 days: Google has not read it

Dropped from the index (2)
  https://example.com/blog/pricing-guide/ (Crawled - currently not indexed)
  https://example.com/de/preise/ (Duplicate, Google chose different canonical than user)

Folded into another locale (1)
  https://example.com/de/preise/ → https://example.com/pricing/

Not indexed: URL is unknown to Google (6)
  https://example.com/changelog/single-sign-on/
  …

Bing: never seen (4)
  https://example.com/docs/authentication/
  …

Sent to IndexNow (14)
  https://example.com/docs/authentication/
  …
```

## Setup

```sh
npx index-drift login
npx index-drift --site sc-domain:example.com
```

`login` opens your browser. Sign in with a Google account that can open the property in Search Console, and allow read-only access. The sign-in is saved on your computer in `~/.config/index-drift/credentials.json`. It is sent only to Google: index-drift has no server. `npx index-drift logout` deletes it and revokes it at Google. See [PRIVACY.md](PRIVACY.md).

### Service account, for CI and servers

GitHub Actions, cron jobs and servers cannot open a browser. Use a service account there.

1. In [Google Cloud Console](https://console.cloud.google.com/), create a project (or use one you have) and enable the **Google Search Console API**.
2. Create a **service account** and download a JSON key for it.
3. In [Search Console](https://search.google.com/search-console), open your property → **Settings → Users and permissions → Add user**. Add the service account email (`…@….iam.gserviceaccount.com`) with **Restricted** permission. Read access is enough.
4. Point index-drift to the key:

```sh
export GOOGLE_APPLICATION_CREDENTIALS=path/to/key.json
npx index-drift --site sc-domain:example.com
```

index-drift uses, in this order: `--credentials <file>`, `GSC_CREDENTIALS` (the key JSON), `GOOGLE_APPLICATION_CREDENTIALS`, then your `login`.

### Your own sign-in client

If your company does not allow third-party apps on its Google accounts, create an OAuth client of type **Desktop app** in your own Google Cloud project, download its JSON, and run `npx index-drift login --client client.json`.

**Property names.** A domain property is `sc-domain:example.com`. A URL-prefix property is `https://example.com/` with the trailing slash. Use the exact form Search Console shows. The wrong form returns 403.

## Options

```
--site <property>     sc-domain:example.com or https://example.com/
--sitemap <url>       Sitemap to read (repeat for more). Default: the sitemaps submitted in Search Console
--state <file>        Where results are kept. Default: .index-drift/<site>.json
--budget <n>          URLs to inspect this run. Default: 2000. Use 0 to skip URL inspection
--concurrency <n>     Parallel inspections. Default: 5
--report <file>       Also write a Markdown report
--json <file>         Also write the full result as JSON. Use - to print only JSON to stdout
--limit <n>           URLs shown per section in the terminal. Default: 10
--language <code>     Language of Google's messages. Default: en-US
--credentials <file>  Service account key. Default: GSC_CREDENTIALS, GOOGLE_APPLICATION_CREDENTIALS, then your login
--fail-on-drop        Exit with code 2 when a URL dropped out of the Google index, or Bing forgot it
--skip-impressions    Do not look up which indexed pages got zero impressions
--bing                Also check each URL in Bing Webmaster Tools (key in BING_WEBMASTER_API_KEY)
--bing-site <url>     Bing site URL. Default: https://<domain>/ from --site
--bing-budget <n>     URLs to check in Bing this run. Default: 100
--indexnow-key <key>  With --bing: send pages Bing is missing to IndexNow. Or set INDEXNOW_KEY
--indexnow-key-location <url>  Key file URL, if it is not at https://<host>/<key>.txt
```

## Large sites and the daily quota

Google allows 2,000 inspections a day per property, and 600 a minute. index-drift spaces requests to stay under the per-minute limit. For the daily limit, it saves the time of each check and always inspects the URLs it checked longest ago, with new URLs first. A site with 6,000 URLs is checked in full every 3 days, and each day's run reports what changed in its part.

When Google returns "quota exceeded", index-drift stops, saves what it has, and continues from there on the next run.

**More quota.** The limit is per property. If one folder holds most of your pages, add it in Search Console as its own URL-prefix property (`https://example.com/blog/`). Then run index-drift for it with its own sitemap and state file. Each property gets its own 2,000 a day.

## Indexed pages nobody sees

Each run makes one Search Analytics request for the last 90 days of page data. The window ends 3 days ago, because the data arrives with a delay. An indexed page with no row got zero impressions. These are the pages to improve, merge, or remove. This request does not use the inspection quota.

## Bing

```sh
export BING_WEBMASTER_API_KEY=...   # Bing Webmaster Tools → Settings → API access
npx index-drift --site sc-domain:example.com --bing
```

Bing's API has no "indexed" verdict like Google's. It gives the date Bing discovered a URL and the date it last crawled it. index-drift reports:

- **Never seen**: Bing has no record of the URL
- **Forgot**: Bing knew the URL at the last check and does not now
- **Not crawled in 30+ days**
- **Sitemap problems**: no sitemap submitted, a failed status, or a sitemap Bing has not read for 30+ days

Bing throttles this API after about 10 calls a minute, so Bing checks run one at a time, 6 seconds apart. The default of 100 URLs a run takes about 10 minutes. Rotation works the same way as for Google: a 722-URL site gets a full Bing pass every 8 runs.

If your Bing site is `https://www.example.com/`, pass `--bing-site https://www.example.com/`.

## IndexNow

[IndexNow](https://www.indexnow.org/) tells Bing, Yandex, Seznam, Naver and the other participating engines that a page exists or changed. Google does not take part. It is free and made for your own pages.

1. Make a key: 8 to 128 characters, letters, numbers and dashes.
2. Publish it as a text file at `https://example.com/<key>.txt`. The file contains only the key.
3. Run with `--bing --indexnow-key <key>`.

index-drift sends the pages Bing has never seen or has not crawled for 30+ days. It sends each URL at most once a week.

## Use it from scripts and AI agents

`--json -` prints the full result as JSON to stdout and nothing else. Progress goes to stderr. Exit codes: `0` done, `1` error, `2` a page dropped (with `--fail-on-drop`).

The main fields:

- `changes`: `dropped`, `indexed`, `canonicalChanged` and `bingForgot` events, each with `url`, `from` and `to`
- `reasons`: URLs that are not indexed, grouped by Google's reason
- `overrides`: canonical overrides, with `otherLocale: true` for folded translations
- `sitemapProblems`, `impressions.invisible`, `bing.unknown`, `bing.stale`, `indexnow.submitted`
- `total`, `checked`, `indexed`, `unchecked`, `quotaHit`

The state file keeps one summary per day in `history`, for up to a year. That is enough to chart the trend without reading the git log.

## Run it every day with GitHub Actions

Copy [`examples/index-drift.yml`](examples/index-drift.yml) to `.github/workflows/` in any repository, and save the key JSON as the `GSC_CREDENTIALS` secret.

```yaml
- id: drift
  uses: yshmarov/index-drift@v0
  with:
    site: sc-domain:example.com
    credentials: ${{ secrets.GSC_CREDENTIALS }}
```

The example workflow commits the state file after each run, so `git log -p .index-drift/` is the index history of your site. It opens one issue, and comments on it, when pages drop or a sitemap has a problem. The report also goes to the job summary.

For the Bing check, add a `BING_WEBMASTER_API_KEY` secret and pass `bing-key: ${{ secrets.BING_WEBMASTER_API_KEY }}`. If the job runs longer than you want, lower `bing-budget`. For IndexNow, also pass `indexnow-key`.

Action outputs: `dropped`, `sitemap-problems`, `folded`, `indexed`, `checked`, `invisible`, `bing-unknown`, `bing-problems`, `indexnow-submitted`, `state`, `report`.

## The state file

One JSON file per property, with sorted keys, so each run is a small, readable diff:

```json
"https://example.com/fr/tarifs/": {
  "checkedAt": "2026-11-16T09:56:30.924Z",
  "verdict": "NEUTRAL",
  "coverageState": "Duplicate, Google chose different canonical than user",
  "indexingState": "INDEXING_ALLOWED",
  "pageFetchState": "SUCCESSFUL",
  "robotsTxtState": "ALLOWED",
  "lastCrawlTime": "2026-11-12T05:02:10Z",
  "googleCanonical": "https://example.com/pricing/",
  "userCanonical": "https://example.com/fr/tarifs/",
  "bing": {
    "checkedAt": "2026-11-16T12:12:08.464Z",
    "discovered": "2026-09-19T07:00:00.000Z",
    "lastCrawled": "2026-10-31T19:27:08.000Z"
  }
}
```

Impression counts are not saved per URL. They change every day and would fill the git history with noise.

URLs that leave your sitemaps are removed from the file.

## How locales are detected

A URL's locale is its first path segment (`/fr/`, `/pt-br/`) or its subdomain (`de.example.com`), when that is an ISO 639-1 language code. If the URL and the canonical Google chose have different locales, the page is reported as folded into another locale. Other overrides are reported as "Google chose a different canonical".

## What it does not do

It does not ask Google to index anything. Google supports the Indexing API only for job posting and livestream pages, runs spam checks on every submission, and can revoke access for misuse. The Google scope index-drift asks for is `webmasters.readonly`. The Bing calls only read. The one write is IndexNow, and only when you pass a key.

It does not check pages on other sites, such as your backlinks. Search Console and Bing Webmaster Tools only answer for sites you have verified.

## License

MIT
