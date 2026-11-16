import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname } from "node:path";
import { SCOPE, TOKEN_URL, userCredentialsPath } from "./auth.js";
import { fetchWithRetry } from "./http.js";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";

// Google treats a desktop app's client secret as public: it ships inside every installed copy.
export const BUILT_IN_CLIENT = { client_id: "", client_secret: "" };

export async function readClientFile(path) {
  const json = JSON.parse(await readFile(path, "utf8"));
  const client = json.installed ?? json.web ?? json;
  if (!client.client_id || !client.client_secret) throw new Error(`${path} is not an OAuth client file (needs client_id and client_secret).`);
  return { client_id: client.client_id, client_secret: client.client_secret };
}

export async function login({ client = BUILT_IN_CLIENT, openBrowser = openUrl, fetch = globalThis.fetch, log = (line) => process.stderr.write(`${line}\n`) } = {}) {
  if (!client.client_id) throw new Error("This version has no built-in sign-in client. Pass --client <file> with your own OAuth desktop client.");

  const verifier = randomBytes(32).toString("base64url");
  const state = randomBytes(16).toString("hex");
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const redirectUri = `http://127.0.0.1:${server.address().port}`;

  const received = new Promise((resolve, reject) => {
    server.on("request", (req, res) => {
      const params = new URL(req.url, redirectUri).searchParams;
      if (!params.has("code") && !params.has("error")) return void res.writeHead(404).end();
      const ok = params.get("state") === state && params.get("code");
      res.writeHead(ok ? 200 : 400, { "content-type": "text/plain; charset=utf-8" });
      res.end(ok ? "Signed in to index-drift. You can close this tab." : `Sign-in failed: ${params.get("error") || "the reply did not match this sign-in"}.`);
      if (ok) resolve(params.get("code"));
      else reject(new Error(`Sign-in failed: ${params.get("error") || "state mismatch"}.`));
    });
  });

  const url = `${AUTH_URL}?${new URLSearchParams({
    client_id: client.client_id,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    state,
  })}`;
  log(`Opening your browser to sign in with Google. If it does not open, visit:\n${url}`);

  let code;
  try {
    openBrowser(url);
    code = await received;
  } finally {
    server.closeAllConnections();
    server.close();
  }

  const response = await fetchWithRetry(fetch, TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...client, code, code_verifier: verifier, redirect_uri: redirectUri, grant_type: "authorization_code" }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Google token request failed (${response.status}): ${body.error_description || body.error || "no details"}`);
  if (!body.refresh_token) throw new Error("Google returned no refresh token. Run index-drift login again.");
  return { type: "authorized_user", ...client, refresh_token: body.refresh_token };
}

export async function saveUserCredentials(credentials, path = userCredentialsPath()) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 });
}

export async function logout({ path = userCredentialsPath(), fetch = globalThis.fetch } = {}) {
  let credentials;
  try {
    credentials = JSON.parse(await readFile(path, "utf8"));
  } catch {
    return false;
  }
  await fetch(REVOKE_URL, { method: "POST", body: new URLSearchParams({ token: credentials.refresh_token ?? "" }) }).catch(() => {});
  await rm(path, { force: true });
  return true;
}

function openUrl(url) {
  const [command, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
        : ["xdg-open", [url]];
  const child = spawn(command, args, { stdio: "ignore", detached: true });
  child.on("error", () => {});
  child.unref();
}
