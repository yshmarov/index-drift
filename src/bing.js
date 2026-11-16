import { QuotaExhausted, fetchWithRetry, sleep as defaultSleep } from "./http.js";

const API = "https://ssl.bing.com/webmaster/api.svc/json";

export class BingWebmaster {
  constructor({ apiKey, site, fetch = globalThis.fetch, sleep = defaultSleep, retries = 3 }) {
    this.apiKey = apiKey;
    this.site = site;
    this.fetch = fetch;
    this.sleep = sleep;
    this.retries = retries;
  }

  // Bing has no "indexed" verdict in its API. Discovery and last-crawl dates are what it exposes.
  async urlInfo(url) {
    const info = await this.#get("GetUrlInfo", { siteUrl: this.site, url });
    return { discovered: parseDate(info?.DiscoveryDate), lastCrawled: parseDate(info?.LastCrawledDate) };
  }

  async feeds() {
    const feeds = (await this.#get("GetFeeds", { siteUrl: this.site })) ?? [];
    return feeds.map((feed) => ({
      path: feed.Url,
      status: feed.Status,
      type: feed.Type,
      urlCount: feed.UrlCount,
      submitted: parseDate(feed.Submitted),
      lastCrawled: parseDate(feed.LastCrawled),
    }));
  }

  async #get(method, params) {
    const url = `${API}/${method}?${new URLSearchParams({ apikey: this.apiKey, ...params })}`;
    for (let attempt = 0; ; attempt++) {
      const response = await fetchWithRetry(this.fetch, url, {}, { sleep: this.sleep });
      if (response.ok) return (await response.json()).d;

      const body = await response.json().catch(() => ({}));
      const message = body.Message || response.statusText || `HTTP ${response.status}`;
      const throttled = response.status === 429 || /throttl|quota/i.test(message);

      if ((throttled || response.status >= 500) && attempt < this.retries) {
        await this.sleep(2 ** attempt * 15_000);
        continue;
      }
      if (throttled) throw new QuotaExhausted(message);
      if (/not authorized|not verified|InvalidApiKey/i.test(message)) {
        throw new Error(`Bing: ${message} — check the API key and that ${this.site} is verified in Bing Webmaster Tools (use --bing-site for www or other forms).`);
      }
      throw new Error(`Bing Webmaster API ${response.status}: ${message}`);
    }
  }
}

// "/Date(1789801200000)/", with an optional offset. Bing returns year 0001 for URLs it does not know.
export function parseDate(value) {
  const ms = Number(String(value ?? "").match(/Date\((-?\d+)/)?.[1]);
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null;
}

export function bingSiteFor(site) {
  return site.startsWith("sc-domain:") ? `https://${site.slice("sc-domain:".length)}/` : site;
}
