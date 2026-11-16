import { fetchWithRetry } from "./http.js";

const ENDPOINT = "https://api.indexnow.org/indexnow";
const MAX_URLS = 10_000;

const MESSAGES = {
  400: "bad request",
  403: "key not valid: host the key file at https://<host>/<key>.txt, or pass --indexnow-key-location",
  422: "URLs do not belong to the host, or the key does not match",
  429: "too many requests",
};

// IndexNow reaches Bing, Yandex, Seznam, Naver and the other participating engines. Not Google.
export async function submitIndexNow(urls, { key, keyLocation, fetch = globalThis.fetch }) {
  const byHost = new Map();
  for (const url of urls) {
    const host = new URL(url).host;
    byHost.set(host, [...(byHost.get(host) ?? []), url]);
  }
  const results = [];

  for (const [host, hostUrls] of byHost) {
    for (let i = 0; i < hostUrls.length; i += MAX_URLS) {
      const urlList = hostUrls.slice(i, i + MAX_URLS);
      const response = await fetchWithRetry(fetch, ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify({ host, key, ...(keyLocation && { keyLocation }), urlList }),
      });
      results.push({
        host,
        count: urlList.length,
        ok: response.ok,
        status: response.status,
        ...(!response.ok && { error: MESSAGES[response.status] ?? `HTTP ${response.status}` }),
      });
    }
  }
  return results;
}
