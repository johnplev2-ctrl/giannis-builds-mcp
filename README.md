# giannis-builds-mcp

A remote MCP server on Cloudflare Workers with four read-only tools that do real work, plus an MCP Apps view that shows each result inside the chat. It works in Claude, ChatGPT, Grok and any other MCP client.

**Server URL:** `https://giannis-builds-mcp.focalvero-desks.workers.dev/mcp`
**Landing page:** https://giannis-builds-mcp.focalvero-desks.workers.dev
**Health:** https://giannis-builds-mcp.focalvero-desks.workers.dev/health

- **Transport:** streamable HTTP. The server is stateless: each request gets a fresh server, with no sessions and no Durable Objects. It uses `createMcpHandler` from the Cloudflare Agents SDK (`agents` 0.34.0) with the MCP TypeScript SDK v2 (`@modelcontextprotocol/server` 2.4.0).
- **Protocol versions:** it answers both the 2025-11-25 handshake (`initialize`, as most clients send today) and 2026-07-28 requests (`server/discover`, with the version carried on every request). Both are checked live in `qa/live-curl-2026-11-20.txt`.
- **Runs on:** the Workers Free plan. The bundle is 243 KiB gzipped and starts in 57 ms. It has no bindings, no secrets and no storage.
- **Safety:** every tool is read-only and declares `readOnlyHint: true` and `destructiveHint: false`. A browser `Origin` that is not allowed gets a 403, which protects against DNS rebinding.
- **`video_url` limits:** https only, no credentials in the URL, at most 24 reads per call, and a whole-file fallback of at most 64 MB when the host ignores range requests. Only box headers and the index are parsed. Nothing is stored, and only the measurements are returned.

## Tools

| Tool | What it does | Source of the numbers |
| --- | --- | --- |
| `estimate_abandoned_checkout_recovery` | Estimates monthly revenue from a 3-email abandoned-checkout flow for a Shopify store, as a low / likely / high range. It also gives a verdict and the benchmark row it used. | Klaviyo's published revenue per recipient (25th and 75th percentile, by revenue band and AOV), read 20 Nov 2026 |
| `estimate_internal_tool_cost` | Compares the per-seat cost of Retool, Airtable, Softr, Glide or Notion with a one-off custom tool on the buyer's own Cloudflare account, month by month, and gives the break-even month. | Each vendor's own pricing page, read 20 Nov 2026 |
| `check_app_preview_spec` | Checks an App Store preview against Apple's App Preview spec: size per device class, 15 to 30 s, up to 30 fps, codec, profile and level, audio, file size. It gives a fix for every failed line and one `ffmpeg` command. Pass `video_url` and the Worker reads only the file's index over HTTP range requests (an MP4/QuickTime box parser written for this). Or pass the measured values. | Apple's App Preview specifications, read 20 Nov 2026 |
| `list_services` | Lists the fixed-price services and free tools published on giannis-builds.pages.dev, with prices. | `src/lib/services.json` |

The maths is the same code that runs the free calculators on https://giannis-builds.pages.dev (`src/lib/*.js`, copied unchanged from the proof page, MIT). Each result returns its sources and the date they were read. Every result also comes in two forms: as text for the model and as `structuredContent` for the view.

**Errors are specific.** Bad input gets an `isError` result that names the field and the reason, in the tool's own field names, for example `builders: The people who build it are part of the team, so this cannot be more than team_size.` A schema mismatch gets a JSON-RPC error that names the field.

## The in-chat view (MCP Apps)

Every tool points to `ui://giannis-builds/result-view-v1.html` (`_meta.ui.resourceUri`, MIME type `text/html;profile=mcp-app`, MCP Apps spec 2026-01-26). Hosts that support MCP Apps, such as Claude on web and desktop or ChatGPT, render the result as a card in the conversation:

- the checkout range as bars;
- the vendor comparison as a table;
- the preview check as pass / fail rows with the fix command.

The view uses no SDK and makes no external requests. It runs the spec's postMessage handshake (`ui/initialize` → `ui/notifications/initialized` → `ui/notifications/tool-result`), reports its height, and takes the host's theme variables. Hosts without MCP Apps show the text result instead.

`test/view.test.mjs` runs the view script against a fake host. It checks the spec handshake order, the rendering of every tool's real result, and HTML escaping. `test/view.check.mjs` renders the view in Chromium with a simulated host fed by the live server and saves screenshots to `qa/view/` (it needs a browser, so it is not part of `npm test`).

## Add it to your assistant

**Claude** (web, desktop and mobile; Free, Pro, Max, Team, Enterprise; the Free plan allows one custom connector):
1. Go to **Customize → Connectors**, then click **+ Add → Add custom connector**.
2. Enter a name and the server URL above, then click **Continue**.
3. Under Authentication, choose **No sign in**, then click **Add**.

On Team and Enterprise, an Owner adds it once under **Organization settings → Connectors → Add → Custom → Web**. Members then click **Connect**. (Steps checked on Claude's help center, 20 Nov 2026.)

**ChatGPT:**
1. Go to **chatgpt.com/plugins**, then **+ → Add custom MCP server**.
2. Enter a name and a description.
3. Under **Connection**, choose **Public endpoint** and paste the URL.
4. Set no authentication, then click **I understand and want to continue → Create as a plugin**.
5. Review the discovered tools.

Workspace policies apply. (OpenAI Apps SDK docs, "Connect from ChatGPT", read 20 Nov 2026.)

**Grok:** go to **grok.com/connectors**, then **New Connector → Custom**, and paste the URL. Business and Enterprise admins use **+ Add Connector → Other**. (docs.x.ai, read 20 Nov 2026.)

**Any MCP client** that speaks streamable HTTP can use the URL as it is. For example:

```bash
claude mcp add --transport http giannis-builds https://giannis-builds-mcp.focalvero-desks.workers.dev/mcp   # Claude Code
npx @modelcontextprotocol/inspector                                                                      # then connect to the URL
```

You can also call it as plain JSON-RPC:

```bash
curl -s https://giannis-builds-mcp.focalvero-desks.workers.dev/mcp \
  -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"estimate_internal_tool_cost","arguments":{"team_size":12,"builders":2,"saas_tool":"airtable"}}}'
```

## Tests

```bash
npm install
npm test                      # 42 tests: unit tests per tool (incl. 8 real MP4 fixtures through the range reader), the protocol suite in-process, the view script
npm run test:live             # 13 tests against the deployed URL: initialize, tools/list, resources/read, tools/call for every tool, errors, Origin, video_url on a real hosted file
npm run check:view            # the MCP Apps view in Chromium with a simulated host (needs Playwright)
```

The protocol tests use plain `fetch` JSON-RPC, not the MCP SDK, so they test what any client sends. The live run from 20 Nov 2026 is in `qa/live-test-2026-11-20.txt`.

## Deploy and roll back

```bash
npx wrangler deploy                          # Workers Free plan; prints the workers.dev URL
npx wrangler rollback                        # back to the previous version
npx wrangler delete giannis-builds-mcp       # remove it entirely
```

## What you get when I build yours

This server is the proof. A client build follows the same pattern around **your** API, on **your** Cloudflare account:

- **Your API behind OAuth 2.1 with PKCE.** Account linking for your users is done with Cloudflare's `workers-oauth-provider`. The tokens are scoped to your API, and no secrets reach the model.
- **Typed tools** that call your existing endpoints, with clear errors and read-only or destructive hints. Long-running jobs report progress and are polled, never blocking the chat.
- **An MCP Apps view** for previews, results or forms. It renders in Claude and ChatGPT, with a text fallback everywhere else.
- **Unit tests and a live protocol test** against your deployed URL. You also get setup notes for Claude, ChatGPT and Grok, and a handover doc.

| | Starter | Standard |
| --- | --- | --- |
| Price (fixed) | **USD 450** | **USD 900**, in two milestones of 50 % |
| Delivery | 7 days | 10 days |
| Scope | up to 5 tools over your existing API, OAuth 2.1 + PKCE, tests, deploy, setup notes | Starter, plus up to 12 tools, one MCP Apps view, long-running jobs with progress, one webhook or billing integration |

These are the builder line's two published prices (giannis-builds.pages.dev/cloudflare-workers-developer). This is a new service: there are no client builds or reviews yet, and this repository is the work to judge.

Contact: through https://giannis-builds.pages.dev.

## Licence

MIT. Copyright (c) 2026 Giannis Plevris.
