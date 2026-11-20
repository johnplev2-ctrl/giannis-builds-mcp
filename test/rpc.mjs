// Plain JSON-RPC over streamable HTTP, no MCP SDK: what any client sends. Used by the local and the live tests.
export const PROTOCOL = "2025-11-25";

/** Reads a JSON or SSE response body and returns the JSON-RPC message with the given id. */
export async function readMessage(res, id) {
  const ct = res.headers.get("content-type") ?? "";
  const text = await res.text();
  if (ct.includes("application/json")) return JSON.parse(text);
  if (!ct.includes("text/event-stream")) throw new Error(`Unexpected content-type ${ct}: ${text.slice(0, 200)}`);
  const messages = text.split(/\r?\n\r?\n/).map((ev) => ev.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trimStart()).join("\n")).filter(Boolean).map((d) => JSON.parse(d));
  const hit = messages.find((m) => m.id === id);
  if (!hit) throw new Error(`No response with id ${id} in: ${text.slice(0, 300)}`);
  return hit;
}

/** send(url, method, params) → the JSON-RPC response. `doFetch` lets the local test call the Worker directly. */
export function client(url, doFetch = fetch, extraHeaders = {}) {
  let id = 0;
  return async function send(method, params = {}, { notification = false } = {}) {
    const body = notification ? { jsonrpc: "2.0", method, params } : { jsonrpc: "2.0", id: ++id, method, params };
    const res = await doFetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": PROTOCOL, ...extraHeaders },
      body: JSON.stringify(body),
    });
    if (notification) return { status: res.status };
    if (res.status !== 200) throw new Error(`${method}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
    return { status: res.status, headers: res.headers, message: await readMessage(res, body.id) };
  };
}

export const INITIALIZE = {
  protocolVersion: PROTOCOL,
  capabilities: { extensions: { "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] } } },
  clientInfo: { name: "giannis-builds-mcp-tests", version: "1.0.0" },
};

/** One valid call per tool: the protocol suites run all of them. */
export const CALLS = {
  estimate_abandoned_checkout_recovery: { monthly_amount: 40000, conversion_rate_pct: 2, average_order_value_usd: 60, abandoned_checkouts_per_month: 900 },
  estimate_internal_tool_cost: { team_size: 12, builders: 2, months: 24 },
  check_app_preview_spec: { width: 1170, height: 2532, duration_seconds: 34, fps: 60 },
  list_services: { line: "builder" },
};
