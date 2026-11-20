// checkout-model.js: the maths behind /abandoned-checkout-calculator. No DOM, no network: it runs in the
// browser (checkout-calc.js) and in Node (tests/calculators.spec.ts), so every figure on the page is tested.
// MIT licence (the repository's LICENSE).
//
// Every rate comes from a published source, read on 20 November 2026:
//  - Klaviyo Help Center, "Benchmarks for flow emails reference" (page updated 25 Oct 2026): revenue per recipient
//    of the abandoned cart flow, "the revenue attributed to flow emails divided by the number of delivered emails",
//    25th and 75th percentile, by the store's annual revenue and average order value (AOV).
//  - Klaviyo Help Center, "Understanding message conversion tracking": last-touch attribution, 5-day window for
//    email opens and clicks by default on new accounts.
//  - Shopify Help Center, "Recovering abandoned checkouts": a checkout counts as abandoned when it stays incomplete
//    for more than ten minutes after the customer entered an email address.
// Nothing else is assumed except what the visitor types in, and the 3 emails of Checkout Recovery.

export const READ_ON = "20 November 2026";
export const SOURCES = {
  bench: { name: "Klaviyo, Benchmarks for flow emails reference", url: "https://help.klaviyo.com/hc/en-us/articles/360033669452", updated: "25 October 2026" },
  attribution: { name: "Klaviyo, Understanding message conversion tracking", url: "https://help.klaviyo.com/hc/en-us/articles/115005248128", updated: "28 October 2026" },
  shopify: { name: "Shopify, Recovering abandoned checkouts", url: "https://help.shopify.com/en/manual/promoting-marketing/create-marketing/abandoned-checkouts" },
};

// Checkout Recovery (the service this page points to): 3 abandoned-checkout emails, USD 250 once.
export const EMAILS = 3;
export const RECOVERY_USD = 250;

// Klaviyo's table, abandoned cart flow: [AOV from, AOV to, RPR 25th percentile, RPR 75th percentile], USD.
// AOV ranges include their lower bound. Klaviyo's "$1-1M" band is read as under USD 1M a year.
export const BANDS = [
  {
    id: "lt1m", label: "under USD 1M a year", from: 0, to: 1e6,
    rows: [[0, 28, 0.13, 0.81], [28, 37, 0.34, 1.28], [37, 44, 0.49, 1.62], [44, 83, 0.86, 2.91], [83, 112, 1.76, 5.32], [112, 163, 2.69, 8.9], [163, 291, 4.3, 13.75], [291, Infinity, 7.77, 43.51]],
  },
  {
    id: "1m5m", label: "USD 1M to 5M a year", from: 1e6, to: 5e6,
    rows: [[0, 28, 0.2, 0.73], [28, 37, 0.3, 1.13], [37, 44, 0.71, 1.68], [44, 83, 1.12, 3.03], [83, 112, 2.39, 5.86], [112, 163, 3.86, 8.63], [163, 291, 6, 16.4], [291, Infinity, 13.97, 60.48]],
  },
  {
    id: "5m20m", label: "USD 5M to 20M a year", from: 5e6, to: 20e6,
    rows: [[44, 83, 1.3, 2.88], [83, 112, 3.03, 5.07], [112, 163, 4.52, 8.13], [163, 291, 6, 13.58], [291, Infinity, 15.74, 51.07]],
  },
];

const round2 = (x) => Math.round(x * 100) / 100;
/** The likely rate: √(25th × 75th), the median if the spread is log-normal. Klaviyo publishes no median. */
export const midRate = (p25, p75) => round2(Math.sqrt(p25 * p75));

const aovLabel = (r) => (r[1] === Infinity ? `USD ${r[0]} and up` : `USD ${r[0]} to ${r[1]}`);

/** The benchmark row for a store: its revenue band and AOV row, with a note when Klaviyo has no exact row. */
export function benchmarkRow(annualRevenue, aov) {
  const notes = [];
  let band = BANDS.find((b) => annualRevenue >= b.from && annualRevenue < b.to);
  if (!band) {
    band = BANDS[BANDS.length - 1];
    notes.push("Your store is above Klaviyo's largest published band (USD 5M to 20M a year), so that band is used.");
  }
  let row = band.rows.find((r) => aov >= r[0] && aov < r[1]);
  if (!row) {
    // Klaviyo's USD 5M-20M table starts at an AOV of USD 44.
    const lower = BANDS[BANDS.indexOf(band) - 1];
    row = lower.rows.find((r) => aov >= r[0] && aov < r[1]);
    notes.push(`Klaviyo publishes no row for an AOV under USD 44 in the ${band.label} band, so the ${lower.label} row is used.`);
    band = lower;
  }
  return { band: band.id, bandLabel: band.label, from: row[0], aovLabel: aovLabel(row), p25: row[2], p75: row[3], mid: midRate(row[2], row[3]), notes };
}

const num = (v) => (v === "" || v == null ? null : Number(v));
const bad = (v) => v == null || !Number.isFinite(v);

/**
 * input: { basis: "sessions" | "orders", amount, reachedPct, convPct, aov, abandoned?, emailablePct?,
 *          current: "none" | "basic" | "full", currentRevenue?, currentRpr? }
 * Numbers may be strings (form values); empty optional fields are null.
 */
export function estimate(raw) {
  const i = {
    basis: raw.basis === "orders" ? "orders" : "sessions",
    amount: num(raw.amount), reachedPct: num(raw.reachedPct), convPct: num(raw.convPct), aov: num(raw.aov),
    abandoned: num(raw.abandoned), emailablePct: num(raw.emailablePct) ?? 100,
    current: ["none", "basic", "full"].includes(raw.current) ? raw.current : "none",
    currentRevenue: num(raw.currentRevenue), currentRpr: num(raw.currentRpr),
  };
  const errors = {};
  if (bad(i.amount) || i.amount <= 0) errors.amount = i.basis === "orders" ? "Enter your orders per month, more than 0." : "Enter your sessions per month, more than 0.";
  if (bad(i.convPct) || i.convPct <= 0 || i.convPct > 100) errors.convPct = "Enter your conversion rate, between 0 and 100 %.";
  if (bad(i.aov) || i.aov <= 0) errors.aov = "Enter your average order value in USD, more than 0.";
  if (i.abandoned != null && (bad(i.abandoned) || i.abandoned < 0)) errors.abandoned = "Enter the count from your Shopify admin, or leave it empty.";
  if (i.abandoned == null) {
    if (bad(i.reachedPct) || i.reachedPct <= 0 || i.reachedPct > 100) errors.reachedPct = "Enter the share of sessions that reached checkout, between 0 and 100 %.";
    else if (!errors.convPct && i.reachedPct <= i.convPct) errors.reachedPct = "Reached checkout must be higher than the conversion rate: every order passed through checkout.";
  }
  if (bad(i.emailablePct) || i.emailablePct < 0 || i.emailablePct > 100) errors.emailablePct = "Enter a share between 0 and 100 %.";
  if (i.current === "basic" && i.currentRevenue != null && (bad(i.currentRevenue) || i.currentRevenue < 0)) errors.currentRevenue = "Enter what the email earned last month in USD, or leave it empty.";
  if (i.current === "full" && i.currentRpr != null && (bad(i.currentRpr) || i.currentRpr < 0)) errors.currentRpr = "Enter your flow's revenue per recipient in USD, or leave it empty.";
  if (Object.keys(errors).length) return { ok: false, errors };

  const conv = i.convPct / 100;
  const sessions = i.basis === "sessions" ? i.amount : i.amount / conv;
  const orders = i.basis === "orders" ? i.amount : i.amount * conv;
  // Sessions that reached checkout and did not order: an upper bound, because Shopify counts a checkout as
  // abandoned only once an email address was entered. The count from the Shopify admin replaces it.
  const fromShopify = i.abandoned != null;
  const abandoned = fromShopify ? i.abandoned : sessions * (i.reachedPct - i.convPct) / 100;
  const emailable = abandoned * i.emailablePct / 100;
  const delivered = emailable * EMAILS;
  const annualRevenue = orders * i.aov * 12;
  const row = benchmarkRow(annualRevenue, i.aov);
  const flow = { low: delivered * row.p25, likely: delivered * row.mid, high: delivered * row.p75 };

  let gain = { ...flow };
  let status = "new";
  const notes = [...row.notes];
  if (i.current === "basic") {
    if (i.currentRevenue != null) {
      gain = { low: Math.max(0, flow.low - i.currentRevenue), likely: Math.max(0, flow.likely - i.currentRevenue), high: Math.max(0, flow.high - i.currentRevenue) };
      status = "basic-net";
    } else {
      status = "basic-gross";
      notes.push("Your one email already earns part of this. Add what it earned last month to take it off.");
    }
  } else if (i.current === "full") {
    if (i.currentRpr != null) {
      const lift = (rate) => Math.max(0, rate - i.currentRpr) * delivered;
      gain = { low: lift(row.p25), likely: lift(row.mid), high: lift(row.p75) };
      status = i.currentRpr >= row.p75 ? "full-top" : "full-gap";
    } else {
      gain = null;
      status = "full-unknown";
    }
  }

  // The verdict compares Klaviyo-attributed revenue a month with the one-off USD 250. Revenue, not profit.
  let verdict;
  if (status === "full-top") verdict = "leave";
  else if (status === "full-unknown") verdict = "need-rpr";
  else if (gain.low * 12 >= RECOVERY_USD) verdict = "worth";
  else if (gain.high * 12 >= RECOVERY_USD) verdict = "maybe";
  else verdict = "skip";
  // The count from sessions includes shoppers who never entered an email, while Klaviyo's rates are per email
  // delivered to shoppers who did. That count is a ceiling: it can show a flow is not worth it ("skip"), never that
  // it pays its way. Only the Shopify admin count can.
  if (verdict === "worth" && !fromShopify) verdict = "check-count";
  const months = (m) => (m > 0 ? RECOVERY_USD / m : null);
  const payback = gain ? { low: months(gain.low), likely: months(gain.likely), high: months(gain.high) } : null;

  return {
    ok: true, input: i, sessions, orders, abandoned, fromShopify, emailable, delivered, emails: EMAILS,
    annualRevenue, row, flow, gain, status, verdict, payback, notes,
  };
}

export const usd = (x) => `USD ${Math.round(x).toLocaleString("en-US")}`;
export const usd2 = (x) => `USD ${x.toFixed(2)}`;
export const count = (x) => Math.round(x).toLocaleString("en-US");
/** "about 3 weeks", "about 5 months": rounded the way a person says it. */
export function duration(months) {
  if (months == null || !Number.isFinite(months)) return null;
  const weeks = months * 52 / 12;
  if (weeks < 1.5) return "about a week";
  if (months < 2) return `about ${Math.round(weeks)} weeks`;
  return `about ${Math.round(months)} months`;
}
