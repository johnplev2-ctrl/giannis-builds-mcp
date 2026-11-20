// estimate_abandoned_checkout_recovery: the maths of https://giannis-builds.pages.dev/abandoned-checkout-calculator
// (src/lib/checkout-model.js, copied unchanged) behind a typed MCP tool. Pure: no network, no state.
import { z } from "zod";
import { estimate, RECOVERY_USD, SOURCES, READ_ON, usd, usd2, duration } from "../lib/checkout-model.js";

export const name = "estimate_abandoned_checkout_recovery";

export const config = {
  title: "Estimate abandoned-checkout recovery",
  description:
    "Estimates the monthly Klaviyo-attributed revenue of a 3-email abandoned-checkout flow for a Shopify store, as a low / likely / high range " +
    "from Klaviyo's published revenue per delivered email (25th and 75th percentile by yearly revenue and average order value, read " + READ_ON + "). " +
    "Give either monthly sessions with the share that reached checkout, or the store's own abandoned-checkout count from the Shopify admin (more accurate). " +
    "Read-only; nothing is stored.",
  inputSchema: z.object({
    basis: z.enum(["sessions", "orders"]).default("sessions").describe("What monthly_amount counts: sessions or orders a month."),
    monthly_amount: z.number().positive().describe("Sessions a month (basis=sessions) or orders a month (basis=orders)."),
    conversion_rate_pct: z.number().gt(0).max(100).describe("Store conversion rate in %, e.g. 2.1."),
    average_order_value_usd: z.number().positive().describe("Average order value in USD."),
    checkout_reached_pct: z.number().gt(0).max(100).optional()
      .describe("Share of sessions that reached checkout, in %. Required unless abandoned_checkouts_per_month is given; must be higher than the conversion rate."),
    abandoned_checkouts_per_month: z.number().min(0).optional()
      .describe("Abandoned checkouts last month from the Shopify admin (Orders > Abandoned checkouts). Replaces the estimate from sessions."),
    emailable_pct: z.number().min(0).max(100).default(100).describe("Share of abandoned checkouts with an email you may contact, in %."),
    current_flow: z.enum(["none", "basic", "full"]).default("none").describe("What runs today: nothing, one email, or a full flow."),
    current_flow_revenue_usd_per_month: z.number().min(0).optional().describe("current_flow=basic: what the one email earned last month, USD."),
    current_flow_revenue_per_recipient_usd: z.number().min(0).optional().describe("current_flow=full: the flow's revenue per recipient, USD."),
  }),
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
};

/** The plain-language verdict, same wording rules as the live calculator. */
export function verdictText(r) {
  const g = r.gain;
  const what = r.status === "full-gap" ? "Lifting the flow to Klaviyo's range" : r.status === "basic-net" ? "Moving from one email to a 3-email flow" : "The flow";
  switch (r.verdict) {
    case "leave":
      return `The flow already beats Klaviyo's 75th percentile for stores like this: ${usd2(r.input.currentRpr)} against ${usd2(r.row.p75)} per email. Leave it running.`;
    case "need-rpr":
      return "A full flow already runs, so the flow itself is not new revenue. Give its revenue per recipient to see how far it sits from Klaviyo's range.";
    case "check-count":
      return `From sessions, ${what[0].toLowerCase()}${what.slice(1)} comes to ${usd(g.low)} to ${usd(g.high)} a month. That count includes shoppers who never typed an email address, so it is a ceiling: use the Shopify admin's abandoned-checkout count for a figure to act on.`;
    case "worth":
      return `${what} pays its way: even at the low end, ${usd(g.low)} a month, Klaviyo-attributed revenue passes the USD ${RECOVERY_USD} of Checkout Recovery in ${duration(r.payback.low)}. Likely ${usd(g.likely)} a month.`;
    case "maybe": {
      const [end, amount, months] = g.likely * 12 >= RECOVERY_USD ? ["likely", g.likely, r.payback.likely] : ["high", g.high, r.payback.high];
      return `A close call. At the low end (${usd(g.low)} a month) it takes more than a year to bring in the USD ${RECOVERY_USD} of Checkout Recovery; at the ${end} end (${usd(amount)} a month) it takes ${duration(months)}.`;
    }
    default:
      return `Not worth a paid build yet: even the high estimate is ${usd(g.high)} a month. Shopify's own abandoned checkout email is free (Apps, Messaging, Automations).`;
  }
}

/** Tool input (snake_case) → the model's input (the live page's field names). */
export function toModelInput(a) {
  return {
    basis: a.basis ?? "sessions",
    amount: a.monthly_amount,
    reachedPct: a.checkout_reached_pct ?? null,
    convPct: a.conversion_rate_pct,
    aov: a.average_order_value_usd,
    abandoned: a.abandoned_checkouts_per_month ?? null,
    emailablePct: a.emailable_pct ?? 100,
    current: a.current_flow ?? "none",
    currentRevenue: a.current_flow_revenue_usd_per_month ?? null,
    currentRpr: a.current_flow_revenue_per_recipient_usd ?? null,
  };
}

const FIELD = {
  amount: "monthly_amount", convPct: "conversion_rate_pct", aov: "average_order_value_usd", reachedPct: "checkout_reached_pct",
  abandoned: "abandoned_checkouts_per_month", emailablePct: "emailable_pct", currentRevenue: "current_flow_revenue_usd_per_month",
  currentRpr: "current_flow_revenue_per_recipient_usd",
};

/** Run the estimate. Returns { ok:false, errors } with tool field names, or the structured result. */
export function run(args) {
  const r = estimate(toModelInput(args));
  if (!r.ok) return { ok: false, errors: Object.fromEntries(Object.entries(r.errors).map(([k, v]) => [FIELD[k] ?? k, v])) };
  const m = (x) => Math.round(x);
  return {
    ok: true,
    kind: "checkout",
    verdict: r.verdict,
    summary: verdictText(r),
    counts: { sessions: m(r.sessions), orders: m(r.orders), abandoned: m(r.abandoned), abandoned_from: r.fromShopify ? "shopify_admin" : "sessions_estimate", emails_delivered: m(r.delivered) },
    benchmark: { revenue_band: r.row.bandLabel, aov_row: r.row.aovLabel, rpr_p25_usd: r.row.p25, rpr_likely_usd: r.row.mid, rpr_p75_usd: r.row.p75 },
    monthly_usd: r.gain ? { low: m(r.gain.low), likely: m(r.gain.likely), high: m(r.gain.high) } : null,
    yearly_usd: r.gain ? { low: m(r.gain.low * 12), likely: m(r.gain.likely * 12), high: m(r.gain.high * 12) } : null,
    notes: [
      ...r.notes,
      "Klaviyo-attributed revenue (last touch, 5-day window by default), not profit and not proven incremental.",
      "The likely rate is the geometric mean of Klaviyo's 25th and 75th percentile; Klaviyo publishes no median.",
    ],
    sources: [SOURCES.bench, SOURCES.attribution, SOURCES.shopify],
    calculator: "https://giannis-builds.pages.dev/abandoned-checkout-calculator",
  };
}
