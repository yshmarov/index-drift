import { QuotaExhausted, fetchWithRetry, sleep as defaultSleep } from "./http.js";

const INSPECT_URL = "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect";
const SITES_URL = "https://www.googleapis.com/webmasters/v3/sites";

export { QuotaExhausted };

export class SearchConsole {
  constructor({ token, site, fetch = globalThis.fetch, sleep = defaultSleep, retries = 3 }) {
    this.token = token;
    this.site = site;
    this.fetch = fetch;
    this.sleep = sleep;
    this.retries = retries;
  }

  async listSitemaps() {
    const top = await this.#sitemapList();
    const children = [];
    for (const sitemap of top.filter((s) => s.isSitemapsIndex && !s.isPending)) {
      for (const child of await this.#sitemapList(sitemap.path)) {
        if (!top.some((s) => s.path === child.path)) children.push({ ...child, parent: sitemap.path });
      }
    }
    return [...top, ...children];
  }

  async inspect(url, { languageCode = "en-US" } = {}) {
    const body = await this.#request(INSPECT_URL, {
      method: "POST",
      body: JSON.stringify({ inspectionUrl: url, siteUrl: this.site, languageCode }),
    });
    return body.inspectionResult?.indexStatusResult ?? {};
  }

  async #sitemapList(sitemapIndex) {
    const query = sitemapIndex ? `?sitemapIndex=${encodeURIComponent(sitemapIndex)}` : "";
    const body = await this.#request(`${SITES_URL}/${encodeURIComponent(this.site)}/sitemaps${query}`);
    return body.sitemap ?? [];
  }

  async #request(url, options = {}) {
    for (let attempt = 0; ; attempt++) {
      const response = await fetchWithRetry(
        this.fetch,
        url,
        { ...options, headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" } },
        { sleep: this.sleep },
      );
      if (response.ok) return response.json();

      const body = await response.json().catch(() => ({}));
      const message = body.error?.message || response.statusText;
      const retryable = response.status === 429 || response.status >= 500;

      if (retryable && attempt < this.retries) {
        await this.sleep(2 ** attempt * 15_000);
        continue;
      }
      // A 429 that survives a minute of backoff is the daily quota, not the per-minute one.
      if (response.status === 429) throw new QuotaExhausted(message);
      if (response.status === 403) throw new Error(`${message} — check that the service account is a user on ${this.site} (domain properties use the sc-domain:example.com form).`);
      throw new Error(`Search Console API ${response.status}: ${message}`);
    }
  }
}
