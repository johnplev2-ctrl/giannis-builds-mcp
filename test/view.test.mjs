// The MCP Apps view's script, run in Node against a minimal fake window/document: the handshake order the spec
// requires, and the rendered markup for every tool's real result. (test/view.check.mjs does the same in Chromium.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { VIEW_HTML, VIEW_URI, VIEW_MIME } from "../src/ui/result-view.js";
import * as checkout from "../src/tools/checkout.js";
import * as toolcost from "../src/tools/toolcost.js";
import * as preview from "../src/tools/preview.js";
import * as services from "../src/tools/services.js";
import { toResult } from "../src/server.js";
import { CALLS } from "./rpc.mjs";

const script = /<script>([\s\S]*)<\/script>/.exec(VIEW_HTML)[1];

/** Boots the view with a fake host; returns { sent, root, deliver(msg) }. */
function boot({ answerInit = true } = {}) {
  const sent = [];
  const listeners = [];
  const root = { innerHTML: "" };
  const docEl = { scrollWidth: 720, scrollHeight: 300, style: { setProperty() {} }, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } };
  const deliver = (data) => listeners.forEach((fn) => fn({ data }));
  const parent = {
    postMessage(m) {
      sent.push(m);
      if (answerInit && m.method === "ui/initialize") queueMicrotask(() => deliver({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: "2026-01-26", hostContext: { theme: "dark" } } }));
    },
  };
  const win = { parent, addEventListener: (t, fn) => t === "message" && listeners.push(fn) };
  const doc = { getElementById: (id) => (id === "root" ? root : null), documentElement: docEl };
  new Function("window", "document", "setTimeout", script)(win, doc, (fn, ms) => setTimeout(fn, Math.min(ms, 20)));
  return { sent, root, deliver, docEl };
}
const tick = () => new Promise((r) => setTimeout(r, 5));

test("view resource: MCP Apps URI and MIME type, no external URLs", () => {
  assert.match(VIEW_URI, /^ui:\/\//);
  assert.equal(VIEW_MIME, "text/html;profile=mcp-app");
  assert.doesNotMatch(VIEW_HTML, /https?:\/\/(?!www\.w3)/, "the view loads nothing from the network");
});

test("view handshake: ui/initialize (appInfo, appCapabilities, protocolVersion) then ui/notifications/initialized", async () => {
  const v = boot();
  await tick();
  assert.equal(v.sent[0].method, "ui/initialize");
  assert.deepEqual(Object.keys(v.sent[0].params).sort(), ["appCapabilities", "appInfo", "protocolVersion"]);
  assert.equal(v.sent[0].params.protocolVersion, "2026-01-26");
  assert.equal(v.sent[1].method, "ui/notifications/initialized");
  assert.equal(v.docEl.attrs["data-theme"], "dark", "host theme applied");
});

const results = {
  checkout: [toResult(checkout.run(CALLS.estimate_abandoned_checkout_recovery)), /Abandoned-checkout flow, a month[\s\S]*USD 2,322[\s\S]*USD 4,266[\s\S]*USD 7,857/],
  toolcost: [toResult(toolcost.run(CALLS.estimate_internal_tool_cost)), /12 people, 24 months[\s\S]*Airtable Team[\s\S]*month 2/],
  preview: [toResult(await preview.run(CALLS.check_app_preview_spec)), /App Store preview check[\s\S]*fail[\s\S]*scale=886:1920/],
  services: [toResult(services.run(CALLS.list_services)), /MCP connector for your API[\s\S]*USD 450[\s\S]*USD 900/],
};
for (const [kind, [result, expected]] of Object.entries(results)) {
  test(`view renders the ${kind} result from ui/notifications/tool-result and reports its size`, async () => {
    const v = boot();
    await tick();
    v.deliver({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: result });
    assert.match(v.root.innerHTML, expected);
    assert.ok(v.sent.some((m) => m.method === "ui/notifications/size-changed" && m.params.height > 0));
  });
}

test("view renders an error result as the field list, and escapes HTML", async () => {
  const v = boot();
  await tick();
  v.deliver({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: toResult({ ok: false, errors: { team_size: "<img src=x onerror=alert(1)>" } }) });
  assert.match(v.root.innerHTML, /Check the input/);
  assert.doesNotMatch(v.root.innerHTML, /<img/);
  assert.match(v.root.innerHTML, /&lt;img/);
});
