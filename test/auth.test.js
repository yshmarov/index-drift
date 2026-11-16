import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { accessToken, loadCredentials, userCredentialsPath } from "../src/auth.js";
import { SearchConsole } from "../src/gsc.js";
import { login, readClientFile, saveUserCredentials } from "../src/oauth.js";

const client = { client_id: "id.apps.googleusercontent.com", client_secret: "secret" };
const signedIn = { type: "authorized_user", ...client, refresh_token: "refresh" };

test("loadCredentials falls back to the saved sign-in", async () => {
  const env = { XDG_CONFIG_HOME: await mkdtemp(join(tmpdir(), "index-drift-")) };
  await assert.rejects(loadCredentials({ env }), /Run: npx index-drift login/);

  await saveUserCredentials(signedIn, userCredentialsPath(env));
  assert.deepEqual(await loadCredentials({ env }), signedIn);
});

test("accessToken exchanges a saved sign-in's refresh token", async () => {
  let form;
  const fetch = async (_url, options) => {
    form = Object.fromEntries(options.body);
    return { ok: true, json: async () => ({ access_token: "access" }) };
  };
  assert.equal(await accessToken(signedIn, { fetch }), "access");
  assert.deepEqual(form, { grant_type: "refresh_token", refresh_token: "refresh", ...client });
});

test("login receives Google's redirect and returns a refresh token", async () => {
  let exchange;
  const fetch = async (url, options) => {
    if (!String(url).startsWith("https://oauth2.googleapis.com/token")) return globalThis.fetch(url, options);
    exchange = Object.fromEntries(options.body);
    return { ok: true, json: async () => ({ access_token: "a", refresh_token: "refresh" }) };
  };
  let browser;
  const openBrowser = (url) => {
    const auth = new URL(url).searchParams;
    browser = globalThis.fetch(`${auth.get("redirect_uri")}/?state=${auth.get("state")}&code=the-code`);
  };

  const credentials = await login({ client, openBrowser, fetch, log: () => {} });

  assert.equal((await browser).status, 200);
  assert.deepEqual(credentials, signedIn);
  assert.equal(exchange.code, "the-code");
  assert.ok(exchange.code_verifier);
});

test("login rejects a redirect from a different sign-in", async () => {
  let browser;
  const openBrowser = (url) => {
    browser = globalThis.fetch(`${new URL(url).searchParams.get("redirect_uri")}/?state=forged&code=x`);
  };
  await assert.rejects(login({ client, openBrowser, log: () => {} }), /state mismatch/);
  assert.equal((await browser).status, 400);
});

test("readClientFile reads the JSON Google Cloud downloads for a desktop client", async () => {
  const path = join(await mkdtemp(join(tmpdir(), "index-drift-")), "client.json");
  await writeFile(path, JSON.stringify({ installed: { ...client, redirect_uris: ["http://localhost"] } }));
  assert.deepEqual(await readClientFile(path), client);
});

test("a 403 names the service account to add in Search Console", async () => {
  const fetch = async () => ({ ok: false, status: 403, json: async () => ({ error: { message: "User does not have sufficient permission" } }) });
  const gsc = new SearchConsole({ token: "t", site: "sc-domain:x.com", serviceAccount: "bot@p.iam.gserviceaccount.com", fetch });
  await assert.rejects(gsc.inspect("https://x.com/"), /add bot@p\.iam\.gserviceaccount\.com as a user of sc-domain:x\.com/);
});
