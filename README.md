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

No dependencies. Node 20 or newer.

```
index-drift · sc-domain:example.com · 2026-11-16
722 URLs in sitemaps · 708 of 722 checked are indexed (98%)
Inspected 722 this run

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

Not indexed: Crawled - currently not indexed (6)
  https://example.com/fr/blog/checklist/
  …
```

## Setup

The URL Inspection API needs a service account. API keys do not work.

1. In [Google Cloud Console](https://console.cloud.google.com/), create a project (or use one you have) and enable the **Google Search Console API**.
2. Create a **service account** and download a JSON key for it.
3. In [Search Console](https://search.google.com/search-console), open your property → **Settings → Users and permissions → Add user**. Add the service account email (`…@….iam.gserviceaccount.com`) with **Restricted** permission. Read access is enough.
4. Point index-drift to the key:

```sh
export GOOGLE_APPLICATION_CREDENTIALS=path/to/key.json
npx index-drift --site sc-domain:example.com
```

**Property names.** A domain property is `sc-domain:example.com`. A URL-prefix property is `https://example.com/` with the trailing slash. Use the exact form Search Console shows. The wrong form returns 403.

## Options

```
--site <property>     sc-domain:example.com or https://example.com/
--sitemap <url>       Sitemap to read (repeat for more). Default: the sitemaps submitted in Search Console
--state <file>        Where results are kept. Default: .index-drift/<site>.json
--budget <n>          URLs to inspect this run. Default: 2000. Use 0 to only check sitemap health
--concurrency <n>     Parallel inspections. Default: 5
--report <file>       Also write a Markdown report
--json <file>         Also write the full result as JSON
--limit <n>           URLs shown per section in the terminal. Default: 10
--language <code>     Language of Google's messages. Default: en-US
--credentials <file>  Service account key. Default: GOOGLE_APPLICATION_CREDENTIALS, or the key JSON in GSC_CREDENTIALS
--fail-on-drop        Exit with code 2 when a URL dropped out of the index
```

## Large sites and the daily quota

Google allows 2,000 inspections a day per property, and 600 a minute. index-drift spaces requests to stay under the per-minute limit. For the daily limit, it saves the time of each check and always inspects the URLs it checked longest ago, with new URLs first. A site with 6,000 URLs is checked in full every 3 days, and each day's run reports what changed in its part.

When Google returns "quota exceeded", index-drift stops, saves what it has, and continues from there on the next run.

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

Action outputs: `dropped`, `sitemap-problems`, `folded`, `indexed`, `checked`, `state`, `report`.

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
  "userCanonical": "https://example.com/fr/tarifs/"
}
```

URLs that leave your sitemaps are removed from the file.

## How locales are detected

A URL's locale is its first path segment (`/fr/`, `/pt-br/`) or its subdomain (`de.example.com`), when that is an ISO 639-1 language code. If the URL and the canonical Google chose have different locales, the page is reported as folded into another locale. Other overrides are reported as "Google chose a different canonical".

## What it does not do

It does not ask Google to index anything. Google supports the Indexing API only for job posting and livestream pages, runs spam checks on every submission, and can revoke access for misuse. index-drift only reads data. The scope it asks for is `webmasters.readonly`.

## License

MIT
