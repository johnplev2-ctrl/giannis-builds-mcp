// estimate_internal_tool_cost: the maths of https://giannis-builds.pages.dev/internal-tool-cost-calculator
// (src/lib/toolcost-model.js, copied unchanged) behind a typed MCP tool. Pure: no network, no state.
import { z } from "zod";
import { compare, TOOLS, BUILD, CARE_USD, CF, READ_ON, usd } from "../lib/toolcost-model.js";

export const name = "estimate_internal_tool_cost";
const TOOL_IDS = Object.keys(TOOLS);

export const config = {
  title: "Compare internal tool cost: SaaS vs custom",
  description:
    "Compares per-seat no-code tools (Retool, Airtable, Softr, Glide, Notion) at list prices read on the vendors' own pages on " + READ_ON +
    " with a one-off custom tool on the buyer's own Cloudflare account, month by month, and gives the break-even month. " +
    "Leave saas_tool empty to compare all five. Read-only; nothing is stored.",
  inputSchema: z.object({
    team_size: z.number().int().min(1).max(500).describe("People who use the tool, builders included (1 to 500)."),
    builders: z.number().int().min(1).describe("People who build or change the tool (at least 1, at most team_size)."),
    saas_tool: z.enum(TOOL_IDS).optional().describe("One vendor to compare; omit to compare all five."),
    plan: z.string().default("auto").describe('"auto" = the cheapest plan that fits, or a plan id such as "team", "business", "pro", "plus".'),
    months: z.number().int().min(1).max(60).default(24).describe("Horizon in months (1 to 60)."),
    build: z.enum(["starter", "standard"]).default("starter").describe(`Custom build: starter = USD ${BUILD.starter.usd} (${BUILD.starter.days} days), standard = USD ${BUILD.standard.usd} (${BUILD.standard.days} days).`),
    care_plan: z.boolean().default(false).describe(`Add the optional care plan, USD ${CARE_USD} a month.`),
  }),
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
};

export function verdictText(r) {
  const saas = `${r.tool.name} ${r.plan.name}`;
  const n = r.input.months;
  switch (r.verdict) {
    case "saas-free":
      return `${saas} costs nothing for this team. Use it while its limits hold; a custom tool only makes sense when you outgrow it.`;
    case "saas-always":
      return `${saas} stays cheaper: at ${usd(r.saasMonthly)} a month it costs no more than the custom tool's ${usd(r.buildMonthly)} a month, so the build never pays back.`;
    case "saas-horizon":
      return `Over ${n} months, ${saas} costs ${usd(-r.difference)} less. The custom tool only passes it in month ${r.breakEven}.`;
    default:
      return `Over ${n} months, the custom tool costs ${usd(r.difference)} less than ${saas}. It passes the SaaS bill in month ${r.breakEven}${r.atLeast ? " (Softr prices extra app users from USD 1 or 2, so its cost is a floor)" : ""}.`;
  }
}

const FIELD = { users: "team_size", builders: "builders", months: "months", plan: "plan" };

function one(args, toolId) {
  const r = compare({ users: args.team_size, builders: args.builders, tool: toolId, plan: args.plan ?? "auto", months: args.months ?? 24, build: args.build ?? "starter", care: args.care_plan ?? false });
  if (!r.ok) return r;
  return {
    ok: true,
    tool: r.tool.name, plan: r.plan.name, plan_terms: r.plan.terms, pricing_url: r.tool.url, seats_rule: r.tool.seats,
    saas_usd_per_month: Math.round(r.saasMonthly), saas_cost_is_floor: r.atLeast,
    custom_build_usd: r.buildUsd, custom_usd_per_month: r.buildMonthly, cloudflare_access_usd_per_month: r.accessUsd,
    saas_total_usd: Math.round(r.saasTotal), custom_total_usd: Math.round(r.customTotal), saving_usd: Math.round(r.difference),
    break_even_month: r.breakEven, verdict: r.verdict, summary: verdictText(r),
  };
}

export function run(args) {
  if (Number.isInteger(args.team_size) && Number.isInteger(args.builders) && args.builders > args.team_size)
    return { ok: false, errors: { builders: "The people who build it are part of the team, so this cannot be more than team_size." } };
  const ids = args.saas_tool ? [args.saas_tool] : TOOL_IDS;
  if (!args.saas_tool && args.plan && args.plan !== "auto")
    return { ok: false, errors: { plan: 'A named plan needs one saas_tool. Use plan "auto" to compare all five.' } };
  const rows = [];
  for (const id of ids) {
    const r = one(args, id);
    if (!r.ok) return { ok: false, errors: Object.fromEntries(Object.entries(r.errors).map(([k, v]) => [FIELD[k] ?? k, v])) };
    rows.push(r);
  }
  const months = args.months ?? 24;
  const build = args.build ?? "starter";
  const cheapest = rows.reduce((a, b) => (b.saas_total_usd < a.saas_total_usd ? b : a));
  return {
    ok: true,
    kind: "toolcost",
    months, team_size: args.team_size, builders: args.builders,
    custom: { tier: BUILD[build].label, usd: BUILD[build].usd, days: BUILD[build].days, care_usd_per_month: args.care_plan ? CARE_USD : 0, runs_on: "the buyer's own Cloudflare account (Workers free plan; Cloudflare Access free up to " + CF.accessFreeUsers + " users)" },
    comparisons: rows,
    summary: rows.length === 1 ? rows[0].summary : `Cheapest SaaS over ${months} months: ${cheapest.tool} ${cheapest.plan} at ${usd(cheapest.saas_total_usd)}; the custom tool totals ${usd(rows[0].custom_total_usd)}.`,
    notes: ["List prices in USD, billed yearly where offered, taxes excluded, read on each vendor's page on " + READ_ON + ".", "A plan that the vendor's published limits do not allow for this team is never picked."],
    sources: [...rows.map((r) => ({ name: `${r.tool} pricing`, url: r.pricing_url })), ...CF.sources],
    calculator: "https://giannis-builds.pages.dev/internal-tool-cost-calculator",
  };
}
