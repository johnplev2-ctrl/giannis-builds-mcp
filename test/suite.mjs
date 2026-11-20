// The protocol suite, run against the Worker in-process (handler.test.mjs) and against the deployed URL (live.test.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { client, INITIALIZE, CALLS, PROTOCOL } from "./rpc.mjs";

const VIEW = "ui://giannis-builds/result-view-v1.html";

export function protocolSuite(label, url, doFetch = fetch) {
  const send = client(url, doFetch);

  test(`${label}: initialize`, async () => {
    const { message } = await send("initialize", INITIALIZE);
    assert.equal(message.result.protocolVersion, PROTOCOL);
    assert.equal(message.result.serverInfo.name, "giannis-builds-mcp");
    assert.ok(message.result.capabilities.tools);
    assert.ok(message.result.capabilities.resources);
    const n = await send("notifications/initialized", {}, { notification: true });
    assert.equal(n.status, 202);
  });

  test(`${label}: tools/list has the four tools, typed schemas, read-only annotations and the MCP Apps view`, async () => {
    const { message } = await send("tools/list");
    const tools = message.result.tools;
    assert.deepEqual(tools.map((t) => t.name).sort(), Object.keys(CALLS).sort());
    for (const t of tools) {
      assert.equal(t.inputSchema.type, "object", t.name);
      assert.ok(Object.keys(t.inputSchema.properties).length > 0, t.name);
      assert.equal(t.annotations.readOnlyHint, true, t.name);
      assert.equal(t.annotations.destructiveHint, false, t.name);
      assert.equal(t._meta.ui.resourceUri, VIEW, t.name);
      assert.ok(t.description.length > 80, t.name);
    }
    const checkout = tools.find((t) => t.name === "estimate_abandoned_checkout_recovery");
    assert.deepEqual(checkout.inputSchema.required.sort(), ["average_order_value_usd", "conversion_rate_pct", "monthly_amount"]);
  });

  test(`${label}: resources/read returns the view as text/html;profile=mcp-app`, async () => {
    const { message } = await send("resources/read", { uri: VIEW });
    const c = message.result.contents[0];
    assert.equal(c.mimeType, "text/html;profile=mcp-app");
    assert.match(c.text, /ui\/initialize/);
    assert.match(c.text, /ui\/notifications\/tool-result/);
  });

  for (const [name, args] of Object.entries(CALLS)) {
    test(`${label}: tools/call ${name}`, async () => {
      const { message } = await send("tools/call", { name, arguments: args });
      const r = message.result;
      assert.ok(!r.isError, JSON.stringify(r).slice(0, 400));
      assert.equal(r.content[0].type, "text");
      assert.ok(r.content[0].text.length > 40);
      assert.equal(r.structuredContent.ok, true);
      assert.ok(["checkout", "toolcost", "preview", "services"].includes(r.structuredContent.kind));
    });
  }

  test(`${label}: tools/call results carry the real numbers`, async () => {
    const c = (await send("tools/call", { name: "estimate_abandoned_checkout_recovery", arguments: CALLS.estimate_abandoned_checkout_recovery })).message.result.structuredContent;
    assert.deepEqual(c.monthly_usd, { low: 2322, likely: 4266, high: 7857 });
    const p = (await send("tools/call", { name: "check_app_preview_spec", arguments: CALLS.check_app_preview_spec })).message.result.structuredContent;
    assert.equal(p.verdict, "fail");
    assert.match(p.ffmpeg_fix_command, /scale=886:1920/);
    const s = (await send("tools/call", { name: "list_services", arguments: CALLS.list_services })).message.result.structuredContent;
    assert.deepEqual(s.mcp_connector_build.offers.map((o) => o.price_usd), [450, 900]);
  });

  test(`${label}: bad input is refused clearly (schema and domain errors)`, async () => {
    const schema = (await send("tools/call", { name: "estimate_internal_tool_cost", arguments: { team_size: "twelve", builders: 2 } })).message;
    const text = JSON.stringify(schema);
    assert.ok(schema.error || schema.result?.isError, text.slice(0, 300));
    assert.match(text, /team_size/);
    const domain = (await send("tools/call", { name: "estimate_internal_tool_cost", arguments: { team_size: 3, builders: 5 } })).message.result;
    assert.equal(domain.isError, true);
    assert.match(domain.content[0].text, /builders: .*cannot be more than team_size/);
  });

  test(`${label}: an unknown tool is an error, not a crash`, async () => {
    const m = (await send("tools/call", { name: "delete_everything", arguments: {} })).message;
    assert.ok(m.error || m.result?.isError, JSON.stringify(m).slice(0, 300));
  });

  test(`${label}: a hostile browser Origin is refused`, async () => {
    const res = await doFetch(url, { method: "POST", headers: { origin: "https://evil.example", "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }) });
    assert.equal(res.status, 403);
  });
}
