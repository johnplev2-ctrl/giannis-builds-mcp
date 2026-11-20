// The protocol suite against the deployed Worker, over plain HTTPS JSON-RPC (no MCP SDK):
//   MCP_URL=https://<worker>.<subdomain>.workers.dev/mcp node --test test/live.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { protocolSuite } from "./suite.mjs";
import { client } from "./rpc.mjs";

const url = process.env.MCP_URL ?? "https://giannis-builds-mcp.focalvero-desks.workers.dev/mcp";
const origin = new URL(url).origin;

protocolSuite("live", url);

test("live: check_app_preview_spec reads a real hosted preview by URL", async () => {
  const send = client(url);
  const { message } = await send("tools/call", { name: "check_app_preview_spec", arguments: { video_url: "https://giannis-builds.pages.dev/media/opsdesk-appstore-886x1920-web.mp4" } });
  const r = message.result.structuredContent;
  assert.equal(r.ok, true, JSON.stringify(message.result).slice(0, 400));
  assert.equal(r.source, "video_url");
  assert.deepEqual(r.display_size, { width: 886, height: 1920 });
  assert.ok(r.checks.find((c) => c.id === "size").status === "pass");
});

test("live: / and /health answer, GET /mcp is not a session stream", async () => {
  const home = await fetch(`${origin}/`);
  assert.equal(home.status, 200);
  assert.match(await home.text(), /Add custom connector/);
  const health = await (await fetch(`${origin}/health`)).json();
  assert.equal(health.ok, true);
  assert.equal(health.tools.length, 4);
  const get = await fetch(url, { headers: { accept: "text/event-stream" } });
  assert.ok([405, 400].includes(get.status), `GET /mcp → ${get.status}`);
});
