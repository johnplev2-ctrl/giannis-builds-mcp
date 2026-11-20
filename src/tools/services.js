// list_services: the fixed-price services and free tools published on https://giannis-builds.pages.dev,
// from src/lib/services.json (a copy of the proof page's source of truth; the same prices are on each service page),
// plus the MCP connector build, which is offered through this server and is not listed on the site yet.
import { z } from "zod";
import data from "../lib/services.json" with { type: "json" };

export const name = "list_services";
const SITE = "https://giannis-builds.pages.dev";
const LINES = { builder: "cloudflare-workers-developer", klaviyo: "klaviyo-flows-setup", "app-preview": "app-store-preview-video" };

export const config = {
  title: "List services and free tools",
  description:
    "Lists the fixed-price services published on giannis-builds.pages.dev (internal tools on Cloudflare, Klaviyo flows, App Store preview videos) and its free tools, " +
    "with prices in USD, delivery and the page for each, plus the MCP connector build offered through this server (same two price points; not listed on the site yet). Read-only.",
  inputSchema: z.object({
    line: z.enum(["all", "builder", "klaviyo", "app-preview"]).default("all").describe("Filter to one service line."),
  }),
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
};

// The MCP connector build uses the builder line's two price points (services.json, "Ops tool" offers: USD 450 and 900).
// It is offered here and in the repo README; giannis-builds.pages.dev does not list it yet, and the result says so.
export const MCP_BUILD = {
  name: "MCP connector for your API (Claude, ChatGPT, Grok)",
  runs_on: "your own Cloudflare account (Workers), your API behind OAuth 2.1 with PKCE",
  offers: [
    { name: "Starter", price_usd: 450, days: 7, scope: "Up to 5 tools over your existing API, OAuth 2.1 + PKCE account linking, typed schemas, unit and live protocol tests, deployed to your account, setup notes for Claude, ChatGPT and Grok." },
    { name: "Standard", price_usd: 900, days: 10, scope: "Starter, plus up to 12 tools, one MCP Apps in-chat view (for hosts that support MCP Apps, such as Claude and ChatGPT), long-running jobs with progress, and one webhook or billing integration. Two milestones of 50 %." },
  ],
  proof: "This server: https://github.com/johnplev2-ctrl/giannis-builds-mcp",
  listed_on_site: false,
  note: "Offered through this server and its README. The prices are the builder line's published USD 450 / 900 (the Ops tool offers on giannis-builds.pages.dev/cloudflare-workers-developer); the connector build itself is not on the site yet. No client connectors have been delivered yet.",
};

export function run(args) {
  const line = args.line ?? "all";
  const services = data.services
    .filter((s) => line === "all" || LINES[line] === s.slug)
    .map((s) => ({ name: s.name, page: `${SITE}/${s.slug}`, description: s.description, offers: s.offers.map((o) => ({ name: o.name, price_usd: Number(o.price), includes: o.description })) }));
  const tools = line === "all" ? data.tools.map((t) => ({ name: t.name, page: `${SITE}/${t.slug}`, price_usd: 0, description: t.description })) : [];
  return {
    ok: true,
    kind: "services",
    provider: { name: data.person.name, role: data.person.jobTitle, site: SITE },
    services,
    mcp_connector_build: line === "all" || line === "builder" ? MCP_BUILD : undefined,
    free_tools: tools,
    terms: "Fixed price in USD, quoted before work starts. No reviews or ratings are published yet: these are new services.",
    summary: `${services.length} service line${services.length === 1 ? "" : "s"}${tools.length ? ` and ${tools.length} free tools` : ""} on ${SITE}${line === "all" || line === "builder" ? ", plus the MCP connector build offered through this server (not on the site yet)" : ""}.`,
  };
}
