import { createSign } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fetchWithRetry } from "./http.js";

export const TOKEN_URL = "https://oauth2.googleapis.com/token";
export const SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

export function userCredentialsPath(env = process.env) {
  return join(env.XDG_CONFIG_HOME || join(homedir(), ".config"), "index-drift", "credentials.json");
}

export async function loadCredentials({ file, env = process.env } = {}) {
  if (file) return parseCredentials(await readFile(file, "utf8"), file);
  if (env.GSC_CREDENTIALS?.trim()) return parseCredentials(env.GSC_CREDENTIALS, "GSC_CREDENTIALS");
  if (env.GOOGLE_APPLICATION_CREDENTIALS) return parseCredentials(await readFile(env.GOOGLE_APPLICATION_CREDENTIALS, "utf8"), env.GOOGLE_APPLICATION_CREDENTIALS);

  const path = userCredentialsPath(env);
  const json = await readFile(path, "utf8").catch(() => null);
  if (json) return parseCredentials(json, path);
  throw new Error(
    "Not signed in. Run: npx index-drift login\n" +
      "For CI and servers, use a service account key: set GOOGLE_APPLICATION_CREDENTIALS to the key file, " +
      "set GSC_CREDENTIALS to the key JSON, or pass --credentials <file>.",
  );
}

function parseCredentials(json, source) {
  let key;
  try {
    key = JSON.parse(json);
  } catch {
    throw new Error(`${source} is not valid JSON.`);
  }
  if (key.type === "authorized_user" && key.client_id && key.client_secret && key.refresh_token) return key;
  if (key.type === "service_account" && key.client_email && key.private_key) return key;
  throw new Error(`${source} is neither a service account key nor saved sign-in credentials.`);
}

export async function accessToken(key, { fetch = globalThis.fetch, now = Date.now() } = {}) {
  const form =
    key.type === "authorized_user"
      ? { grant_type: "refresh_token", refresh_token: key.refresh_token, client_id: key.client_id, client_secret: key.client_secret }
      : { grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: serviceAccountAssertion(key, now) };

  const response = await fetchWithRetry(fetch, TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const hint = key.type === "authorized_user" && body.error === "invalid_grant" ? " Your sign-in expired or was revoked. Run: npx index-drift login" : "";
    throw new Error(`Google token request failed (${response.status}): ${body.error_description || body.error || "no details"}.${hint}`);
  }
  return body.access_token;
}

function serviceAccountAssertion(key, now) {
  const iat = Math.floor(now / 1000);
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({ iss: key.client_email, scope: SCOPE, aud: TOKEN_URL, iat, exp: iat + 3600 })}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(key.private_key).toString("base64url");
  return `${unsigned}.${signature}`;
}
