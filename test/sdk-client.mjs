// The server through the official MCP TypeScript client (@modelcontextprotocol/client, the SDK most hosts build on),
// not hand-written JSON-RPC: connect, list tools, call every tool, read the MCP Apps view. Run in-process by
// handler.test.mjs and against the deployed URL by live.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { CALLS } from "./rpc.mjs";

const VIEW = "ui://giannis-builds/result-view-v1.html";

export function sdkClientSuite(label, url, doFetch) {
  test(`${label}: the official MCP client connects, lists the 4 tools, calls each one and reads the view`, async () => {
    const client = new Client({ name: "giannis-builds-mcp-test", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(url), doFetch ? { fetch: doFetch } : {});
    await client.connect(transport);
    try {
      assert.equal(client.getServerVersion()?.name, "giannis-builds-mcp");
      const { tools } = await client.listTools();
      assert.deepEqual(tools.map((t) => t.name).sort(), ["check_app_preview_spec", "estimate_abandoned_checkout_recovery", "estimate_internal_tool_cost", "list_services"]);
      for (const t of tools) {
        assert.equal(t.annotations?.readOnlyHint, true, `${t.name} readOnlyHint`);
        assert.equal(t._meta?.ui?.resourceUri, VIEW, `${t.name} view`);
      }
      for (const [name, args] of Object.entries(CALLS)) {
        const r = await client.callTool({ name, arguments: args });
        assert.ok(!r.isError, `${name}: ${JSON.stringify(r).slice(0, 300)}`);
        assert.equal(r.structuredContent?.ok, true, name);
        assert.ok(r.content?.[0]?.text?.length > 20, `${name} text fallback`);
      }
      const view = await client.readResource({ uri: VIEW });
      assert.equal(view.contents[0].mimeType, "text/html;profile=mcp-app");
      assert.match(view.contents[0].text, /ui\/initialize/);
    } finally {
      await client.close();
    }
  });
}
