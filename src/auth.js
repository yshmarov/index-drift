import { createSign } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fetchWithRetry } from "./http.js";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

export async function loadCredentials({ file, env = process.env } = {}) {
  if (env.GSC_CREDENTIALS?.trim()) return parseCredentials(env.GSC_CREDENTIALS, "GSC_CREDENTIALS");

  const path = file || env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!path) {
    throw new Error(
      "No credentials. Set GOOGLE_APPLICATION_CREDENTIALS to a service account key file, " +
        "set GSC_CREDENTIALS to the key JSON, or pass --credentials <file>.",
    );
  }
  return parseCredentials(await readFile(path, "utf8"), path);
}

function parseCredentials(json, source) {
  let key;
  try {
    key = JSON.parse(json);
  } catch {
    throw new Error(`${source} is not valid JSON.`);
  }
  if (key.type !== "service_account" || !key.client_email || !key.private_key) {
    throw new Error(`${source} is not a service account key (needs client_email and private_key).`);
  }
  return key;
}

export async function accessToken(key, { fetch = globalThis.fetch, now = Date.now() } = {}) {
  const iat = Math.floor(now / 1000);
  const assertion = signJwt(
    { iss: key.client_email, scope: SCOPE, aud: TOKEN_URL, iat, exp: iat + 3600 },
    key.private_key,
  );

  const response = await fetchWithRetry(fetch, TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Google token request failed (${response.status}): ${body.error_description || body.error || "no details"}`);
  }
  return body.access_token;
}

function signJwt(claims, privateKey) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode(claims)}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(privateKey).toString("base64url");
  return `${unsigned}.${signature}`;
}
