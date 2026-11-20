// Worker entry. /mcp = the MCP endpoint (streamable HTTP, stateless, via the Agents SDK's createMcpHandler);
// / = a short page saying how to connect; /health = JSON for monitors. No bindings, no secrets, no storage.
import { createMcpHandler } from "agents/mcp/server";
import { createServer, SERVER_INFO, TOOLS } from "./server.js";

const REPO = "https://github.com/johnplev2-ctrl/giannis-builds-mcp";
const mcp = createMcpHandler(() => createServer(), { route: "/mcp" });

const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
};

function landing(origin) {
  const url = `${origin}/mcp`;
  const tools = TOOLS.map((t) => `<li><b>${t.name}</b>: ${t.config.description.split(". ")[0]}.</li>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Giannis Builds MCP</title><meta name="description" content="A remote MCP server on Cloudflare Workers with four read-only tools and an in-chat view.">
<style>:root{--bg:#fff;--fg:#14161a;--mute:#5b6270;--line:#e3e6eb;--accent:#2b59ff}
@media (prefers-color-scheme:dark){:root{--bg:#121418;--fg:#eef0f3;--mute:#a3abb8;--line:#2c313a;--accent:#7c9bff}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:720px;margin:0 auto;padding:40px 16px}h1{font-size:28px;margin:0 0 8px}h2{font-size:18px;margin:28px 0 8px}
code{background:rgba(127,127,127,.14);padding:2px 6px;border-radius:5px;word-break:break-all}.mute{color:var(--mute)}a{color:var(--accent)}li{margin:6px 0}</style></head>
<body><main><h1>Giannis Builds MCP</h1>
<p class="mute">A remote MCP server on Cloudflare Workers (streamable HTTP, stateless). Read-only tools that do real work, and one MCP Apps view that renders results inside the chat.</p>
<h2>Server URL</h2><p><code>${url}</code></p>
<h2>Connect</h2><ul>
<li><b>Claude</b> (web, desktop, mobile): Customize, Connectors, + Add, Add custom connector. Paste the URL, choose No sign in, Add.</li>
<li><b>ChatGPT</b>: chatgpt.com/plugins, +, Add custom MCP server. Paste the URL, no authentication.</li>
<li><b>Grok</b>: grok.com/connectors, New Connector, Custom. Paste the URL.</li>
<li><b>Any MCP client</b>: streamable HTTP transport at the URL above.</li></ul>
<h2>Tools</h2><ul>${tools}</ul>
<p class="mute">Source and tests: <a href="${REPO}">${REPO.replace("https://", "")}</a> · Built by Giannis Plevris · <a href="https://giannis-builds.pages.dev">giannis-builds.pages.dev</a></p>
</main></body></html>`;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/mcp") return mcp(request, env, ctx);
    if (request.method === "GET" || request.method === "HEAD") {
      if (url.pathname === "/health")
        return Response.json({ ok: true, server: SERVER_INFO.name, version: SERVER_INFO.version, tools: TOOLS.map((t) => t.name), mcp: `${url.origin}/mcp` }, { headers: { ...SECURITY_HEADERS, "cache-control": "no-store" } });
      if (url.pathname === "/")
        return new Response(landing(url.origin), { headers: { ...SECURITY_HEADERS, "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'" } });
    }
    return new Response("Not found. The MCP endpoint is /mcp.", { status: 404, headers: { ...SECURITY_HEADERS, "content-type": "text/plain; charset=utf-8" } });
  },
};
