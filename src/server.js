// The MCP server factory: a fresh McpServer per request (stateless, no Durable Objects), four read-only tools
// and one MCP Apps view resource. Imported by the Worker (src/index.js) and by the tests.
import { McpServer } from "@modelcontextprotocol/server";
import * as checkout from "./tools/checkout.js";
import * as toolcost from "./tools/toolcost.js";
import * as preview from "./tools/preview.js";
import * as services from "./tools/services.js";
import { VIEW_URI, VIEW_MIME, VIEW_HTML } from "./ui/result-view.js";

export const SERVER_INFO = { name: "giannis-builds-mcp", title: "Giannis Builds: calculators and checks", version: "1.0.0" };
export const TOOLS = [checkout, toolcost, preview, services];

/** A tool result: the summary and the full data as text (what every model sees), the same data as structuredContent. */
export function toResult(r) {
  if (!r.ok) {
    const lines = Object.entries(r.errors).map(([k, v]) => `- ${k}: ${v}`);
    return { isError: true, content: [{ type: "text", text: `Check the input:\n${lines.join("\n")}` }], structuredContent: r };
  }
  const { summary, ...rest } = r;
  return { content: [{ type: "text", text: `${summary}\n\n${JSON.stringify(rest)}` }], structuredContent: r };
}

export function createServer(opts = {}) {
  const server = new McpServer(SERVER_INFO, {
    instructions:
      "Read-only calculators and checks from giannis-builds.pages.dev. Every number comes from a dated public source listed in the result's sources. " +
      "Quote ranges as ranges; do not present Klaviyo-attributed revenue as profit.",
  });
  for (const t of TOOLS) {
    server.registerTool(
      t.name,
      { ...t.config, _meta: { ui: { resourceUri: VIEW_URI } } },
      async (args) => {
        try {
          return toResult(await t.run(args ?? {}, opts));
        } catch (e) {
          return { isError: true, content: [{ type: "text", text: `${t.name} failed: ${String(e?.message ?? e).slice(0, 300)}` }] };
        }
      },
    );
  }
  server.registerResource(
    "result-view",
    VIEW_URI,
    { title: "Result view", description: "Renders the result of any tool on this server inside the chat (MCP Apps).", mimeType: VIEW_MIME },
    async (uri) => ({
      contents: [{ uri: uri.href ?? String(uri), mimeType: VIEW_MIME, text: VIEW_HTML, _meta: { ui: { prefersBorder: true, csp: { connectDomains: [], resourceDomains: [] } } } }],
    }),
  );
  return server;
}
