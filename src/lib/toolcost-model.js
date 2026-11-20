// toolcost-model.js: the maths behind /internal-tool-cost-calculator. No DOM, no network: it runs in the browser
// (toolcost-calc.js) and in Node (tests/calculators.spec.ts).
// MIT licence (the repository's LICENSE).
//
// List prices were read on each vendor's own pricing page on 20 November 2026, in USD, at the lowest list price
// shown (billed yearly where the vendor offers it), so the SaaS line is never overstated. Taxes are not included.
// "fits" = the vendor's published limits allow this many people; a plan that does not fit is never picked.

export const READ_ON = "20 November 2026";
export const BUILD = { starter: { usd: 450, label: "Ops tool Starter", days: 7 }, standard: { usd: 900, label: "Ops tool Standard", days: 10 } };
export const CARE_USD = 90;
// Cloudflare, read 20 Nov 2026: Zero Trust Free has a 50-user limit, then pay-as-you-go at USD 7 per user a month.
export const CF = {
  accessFreeUsers: 50, accessUserUsd: 7,
  sources: [
    { name: "Cloudflare, Zero Trust plans", url: "https://www.cloudflare.com/plans/zero-trust-services/" },
    { name: "Cloudflare, Workers pricing", url: "https://developers.cloudflare.com/workers/platform/pricing/" },
    { name: "Cloudflare, D1 pricing", url: "https://developers.cloudflare.com/d1/platform/pricing/" },
  ],
};

const others = (u, b) => Math.max(0, u - b);
const GLIDE_PRO = [[5, 125], [10, 175], [20, 275], [30, 375], [40, 475], [50, 575], [60, 675], [70, 775], [80, 875], [90, 975], [100, 1075]];

export const TOOLS = {
  retool: {
    name: "Retool", url: "https://retool.com/pricing",
    seats: "Builders (anyone who built or edited an app or workflow that month) and internal users (everyone else) are billed at different rates.",
    billing: "Billed yearly; monthly billing costs more.",
    plans: [
      { id: "free", name: "Free", fits: (u) => u <= 5, monthly: () => 0, terms: "USD 0, up to 5 users, production only, no audit logs." },
      { id: "team", name: "Team", fits: () => true, monthly: (u, b) => 10 * b + 5 * others(u, b), terms: "USD 10 a builder and USD 5 an internal user, a month; no audit logs." },
      { id: "business", name: "Business", fits: () => true, monthly: (u, b) => 50 * b + 15 * others(u, b), terms: "USD 50 a builder and USD 15 an internal user, a month; audit logs." },
    ],
  },
  airtable: {
    name: "Airtable", url: "https://www.airtable.com/pricing",
    seats: "Every person with edit rights on a base is a paid seat. Read-only people and form submissions are free; this counts everyone who enters or changes records.",
    billing: "Billed yearly; monthly billing is USD 24 on Team and USD 54 on Business.",
    plans: [
      { id: "free", name: "Free", fits: (u) => u <= 5, monthly: () => 0, terms: "USD 0, up to 5 editors, 1,000 records per base, 100 automation runs." },
      { id: "team", name: "Team", fits: () => true, monthly: (u) => 20 * u, terms: "USD 20 a seat a month; 50,000 records per base." },
      { id: "business", name: "Business", fits: () => true, monthly: (u) => 45 * u, terms: "USD 45 a seat a month; 125,000 records per base." },
    ],
  },
  softr: {
    name: "Softr", url: "https://www.softr.io/pricing",
    seats: "Builders are billed per seat above those included; the people who log in are app users, capped per plan. Builders log in free. Staff on your own email domain count as team users.",
    billing: "Billed yearly (2 months off monthly billing).",
    plans: [
      { id: "free", name: "Free", fits: (u, b) => b <= 3 && others(u, b) <= 5, monthly: () => 0, terms: "USD 0, up to 3 builders, 5 app users, 5,000 records." },
      { id: "basic", name: "Basic", fits: (u, b) => others(u, b) <= 5, monthly: (u, b) => 19 + 5 * Math.max(0, b - 1), terms: "USD 19 a month with 1 builder (USD 5 per extra builder), 5 team users." },
      // From Pro up, Softr sells app users beyond the allowance, "starting at" USD 1 (Pro) or USD 2 (Business) a month,
      // up to limits it does not publish: above the allowance the result is a floor.
      { id: "pro", name: "Pro", fits: () => true, monthly: (u, b) => 99 + 10 * Math.max(0, b - 2) + 1 * Math.max(0, others(u, b) - 10), atLeast: (u, b) => others(u, b) > 10, terms: "USD 99 a month with 2 builders (USD 10 per extra builder), 10 team users; extra app users from USD 1 a month." },
      { id: "business", name: "Business", fits: () => true, monthly: (u, b) => 329 + 20 * Math.max(0, b - 3) + 2 * Math.max(0, others(u, b) - 30), atLeast: (u, b) => others(u, b) > 30, terms: "USD 329 a month with 3 builders (USD 20 per extra builder), 30 team users; extra app users from USD 2 a month." },
    ],
  },
  glide: {
    name: "Glide", url: "https://www.glideapps.com/pricing",
    seats: "Team members (the people who build) are billed; app users, who only use a published app, are not team members.",
    billing: "Monthly; Glide says yearly plans are coming soon.",
    plans: [
      { id: "basic", name: "Basic", fits: (u, b) => b <= 2, monthly: () => 25, terms: "USD 25 a month, 2 team members, 2 published apps." },
      { id: "plus", name: "Plus", fits: (u, b) => b <= 3, monthly: () => 50, terms: "USD 50 a month, 3 team members, 5 published apps." },
      { id: "pro", name: "Pro", fits: (u, b) => b <= 100, monthly: (u, b) => GLIDE_PRO.find(([m]) => b <= m)[1], terms: "USD 125 a month for 5 team members, rising in steps to USD 1,075 for 100." },
    ],
  },
  notion: {
    name: "Notion", url: "https://www.notion.com/pricing",
    seats: "Every member is a paid seat. Guests are free but see only the pages they are invited to.",
    billing: "Billed yearly; monthly billing is USD 12 on Plus and USD 24 on Business.",
    plans: [
      { id: "free", name: "Free", fits: (u) => u <= 1, monthly: () => 0, terms: "USD 0; pages and blocks are limited for 2 or more members, so it counts for one person only." },
      { id: "plus", name: "Plus", fits: () => true, monthly: (u) => 10 * u, terms: "USD 10 a seat a month." },
      { id: "business", name: "Business", fits: () => true, monthly: (u) => 20 * u, terms: "USD 20 a seat a month." },
    ],
  },
};

const num = (v) => (v === "" || v == null ? null : Number(v));

/** The cheapest plan that fits, or the one asked for (if it fits). */
export function pickPlan(toolId, users, builders, planId = "auto") {
  const tool = TOOLS[toolId];
  const fitting = tool.plans.filter((p) => p.fits(users, builders));
  if (planId !== "auto") {
    const p = tool.plans.find((x) => x.id === planId);
    return p && p.fits(users, builders) ? p : null;
  }
  return fitting.reduce((best, p) => (best && best.monthly(users, builders) <= p.monthly(users, builders) ? best : p), null);
}

/**
 * input: { users, builders, tool, plan ("auto" or a plan id), months, build: "starter" | "standard", care: boolean }
 */
export function compare(raw) {
  const i = {
    users: num(raw.users), builders: num(raw.builders), tool: raw.tool in TOOLS ? raw.tool : "airtable",
    plan: raw.plan || "auto", months: num(raw.months), build: raw.build === "standard" ? "standard" : "starter", care: Boolean(raw.care),
  };
  const errors = {};
  const whole = (v) => Number.isInteger(v);
  if (!whole(i.users) || i.users < 1 || i.users > 500) errors.users = "Enter how many people use the tool, a whole number from 1 to 500.";
  if (!whole(i.builders) || i.builders < 1) errors.builders = "Enter at least 1 person who builds or changes the tool.";
  else if (!errors.users && i.builders > i.users) errors.builders = "The people who build it are part of the team, so this cannot be more than the team.";
  if (!whole(i.months) || i.months < 1 || i.months > 60) errors.months = "Enter a number of months from 1 to 60.";
  if (Object.keys(errors).length) return { ok: false, errors };

  const tool = TOOLS[i.tool];
  const plan = pickPlan(i.tool, i.users, i.builders, i.plan);
  if (!plan) return { ok: false, errors: { plan: `${tool.name}'s ${tool.plans.find((p) => p.id === i.plan)?.name ?? "chosen"} plan does not take ${i.users} people with ${i.builders} building. Pick another plan or "Cheapest that fits".` } };
  const saasMonthly = plan.monthly(i.users, i.builders);
  const atLeast = Boolean(plan.atLeast?.(i.users, i.builders));

  const buildUsd = BUILD[i.build].usd;
  const accessUsd = i.users > CF.accessFreeUsers ? i.users * CF.accessUserUsd : 0;
  const buildMonthly = (i.care ? CARE_USD : 0) + accessUsd;

  const saas = [], custom = [];
  for (let m = 0; m <= i.months; m++) { saas.push(m * saasMonthly); custom.push(buildUsd + m * buildMonthly); }
  // Break-even: the first month in which the SaaS total has reached the custom tool's total.
  let breakEven = null;
  if (saasMonthly > buildMonthly) breakEven = Math.max(1, Math.ceil(buildUsd / (saasMonthly - buildMonthly)));
  const saasTotal = saas[i.months], customTotal = custom[i.months];

  let verdict;
  if (saasMonthly === 0) verdict = "saas-free";
  else if (breakEven == null) verdict = "saas-always";
  else if (breakEven > i.months) verdict = "saas-horizon";
  else verdict = "build";

  return {
    ok: true, input: i, tool: { id: i.tool, name: tool.name, url: tool.url, seats: tool.seats, billing: tool.billing },
    plan: { id: plan.id, name: plan.name, terms: plan.terms }, saasMonthly, atLeast, buildUsd, buildMonthly, accessUsd,
    saas, custom, saasTotal, customTotal, difference: saasTotal - customTotal, breakEven, verdict,
  };
}

export const usd = (x) => `USD ${Math.round(x).toLocaleString("en-US")}`;
