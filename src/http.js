export class QuotaExhausted extends Error {}

const sleepFor = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// fetch() throws a bare "fetch failed" on resets and DNS blips. Retry those, and name the cause when giving up.
export async function fetchWithRetry(fetch, url, options = {}, { retries = 3, sleep = sleepFor, baseMs = 2000 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetch(url, options);
    } catch (error) {
      if (attempt >= retries) {
        const cause = error.cause?.code || error.cause?.message;
        throw new Error(cause ? `${error.message} (${cause})` : error.message);
      }
      await sleep(2 ** attempt * baseMs);
    }
  }
}

export { sleepFor as sleep };
