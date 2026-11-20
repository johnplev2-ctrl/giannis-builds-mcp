// list_services: the fixed-price services and free tools published on https://giannis-builds.pages.dev,
// from src/lib/services.json (a copy of the proof page's source of truth; the same prices are on each service page).
import { z } from "zod";
import data from "../lib/services.json" with { type: "json" };

export const name = "list_services";
const SITE = "https://giannis-builds.pages.dev";
const LINES = { builder: "cloudflare-workers-developer", klaviyo: "klaviyo-flows-setup", "app-preview": "app-store-preview-video" };

export const config = {
  title: "List services and free tools",
  description:
    "Lists the fixed-price services (internal tools and MCP connectors on Cloudflare Workers, Klaviyo flows, App Store preview videos) and the free tools " +
    "published on giannis-builds.pages.dev, with prices in USD, delivery and the page for each. Read-only.",
  inputSchema: z.object({
    line: z.enum(["all", "builder", "klaviyo", "app-preview"]).default("all").describe("Filter to one service line."),
  }),
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
};

// The MCP connector build is sold at the builder line's two published prices (services.json, "Ops tool" offers).
export const MCP_BUILD = {
  name: "MCP connector for your API (Claude, ChatGPT, Grok)",
  runs_on: "your own Cloudflare account (Workers), your API behind OAuth 2.1 with PKCE",
  offers: [
    { name: "Starter", price_usd: 450, days: 7, scope: "Up to 5 tools over your existing API, OAuth 2.1 + PKCE account linking, typed schemas, unit and live protocol tests, deployed to your account, setup notes for Claude, ChatGPT and Grok." },
    { name: "Standard", price_usd: 900, days: 10, scope: "Starter, plus up to 12 tools, one MCP Apps in-chat view (renders in Claude and ChatGPT), long-running jobs with progress, and one webhook or billing integration. Two milestones of 50 %." },
  ],
  proof: "This server: https://github.com/johnplev2-ctrl/giannis-builds-mcp",
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
    summary: `${services.length} service line${services.length === 1 ? "" : "s"}${tools.length ? ` and ${tools.length} free tools` : ""} on ${SITE}.`,
  };
}
