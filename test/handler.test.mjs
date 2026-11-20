// The protocol suite against the Worker in-process (no network, no workerd): node --test test/handler.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { protocolSuite } from "./suite.mjs";
import { sdkClientSuite } from "./sdk-client.mjs";

const ORIGIN = "https://giannis-builds-mcp.example.workers.dev";
const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} };
// Node's fetch drops the Host header, which the handler checks (DNS-rebinding protection): set it the way a Worker sees it.
const doFetch = (url, init = {}) => worker.fetch(new Request(url, { ...init, headers: { host: new URL(url).host, ...(init.headers ?? {}) } }), {}, ctx);

protocolSuite("local", `${ORIGIN}/mcp`, doFetch);
// The SDK client passes a URL object and a Headers instance: rebuild the Request and add Host the same way.
const sdkFetch = (u, init = {}) => { const req = new Request(u, init); const h = new Headers(req.headers); h.set("host", new URL(String(u)).host); return worker.fetch(new Request(req, { headers: h }), {}, ctx); };
sdkClientSuite("local", `${ORIGIN}/mcp`, sdkFetch);

test("local: / explains how to connect, /health lists the tools, other paths 404", async () => {
  const home = await doFetch(`${ORIGIN}/`);
  assert.equal(home.status, 200);
  const html = await home.text();
  assert.match(html, /Add custom connector/);
  assert.match(html, new RegExp(`${ORIGIN}/mcp`));
  const health = await (await doFetch(`${ORIGIN}/health`)).json();
  assert.equal(health.tools.length, 4);
  assert.equal((await doFetch(`${ORIGIN}/nope`)).status, 404);
});
