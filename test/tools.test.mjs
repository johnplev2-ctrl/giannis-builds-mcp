// Unit tests for each tool's logic (no network): node --test test/tools.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as checkout from "../src/tools/checkout.js";
import * as toolcost from "../src/tools/toolcost.js";
import * as preview from "../src/tools/preview.js";
import * as services from "../src/tools/services.js";
import { toResult } from "../src/server.js";

const fixture = (f) => new Uint8Array(readFileSync(new URL(`./fixtures/${f}`, import.meta.url)));

/** A fetch that serves a fixture like a CDN: honours Range (206 + Content-Range), or ignores it (200). */
function fileServer(bytes, { ranges = true, status = 200, type = "video/mp4" } = {}) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push(init?.headers?.Range);
    if (status !== 200) return new Response("nope", { status });
    const m = /bytes=(\d+)-(\d+)/.exec(init?.headers?.Range ?? "");
    if (ranges && m) {
      const s = Number(m[1]), e = Math.min(Number(m[2]), bytes.length - 1);
      return new Response(bytes.slice(s, e + 1), { status: 206, headers: { "content-type": type, "content-range": `bytes ${s}-${e}/${bytes.length}` } });
    }
    return new Response(bytes, { status: 200, headers: { "content-type": type, "content-length": String(bytes.length) } });
  };
  impl.calls = calls;
  return impl;
}

// ---- estimate_abandoned_checkout_recovery ----
test("checkout: Shopify count, USD 60 AOV, under USD 1M → Klaviyo's USD 44-83 row, worth it", () => {
  const r = checkout.run({ monthly_amount: 40000, conversion_rate_pct: 2, average_order_value_usd: 60, abandoned_checkouts_per_month: 900 });
  assert.equal(r.ok, true);
  assert.equal(r.kind, "checkout");
  assert.equal(r.benchmark.aov_row, "USD 44 to 83");
  assert.equal(r.benchmark.revenue_band, "under USD 1M a year"); // 800 orders x 60 x 12 = 576,000
  assert.equal(r.counts.emails_delivered, 2700); // 900 x 3 emails
  assert.deepEqual(r.monthly_usd, { low: Math.round(2700 * 0.86), likely: Math.round(2700 * 1.58), high: Math.round(2700 * 2.91) });
  assert.equal(r.verdict, "worth");
  assert.match(r.summary, /pays its way/);
  assert.ok(r.sources.every((s) => s.url.startsWith("https://")));
});

test("checkout: from sessions only, a strong result is capped at check-count (a ceiling, never proof)", () => {
  const r = checkout.run({ monthly_amount: 100000, conversion_rate_pct: 2, checkout_reached_pct: 6, average_order_value_usd: 90 });
  assert.equal(r.ok, true);
  assert.equal(r.counts.abandoned_from, "sessions_estimate");
  assert.equal(r.counts.abandoned, 4000); // 100,000 x (6 - 2) %
  assert.equal(r.verdict, "check-count");
});

test("checkout: a tiny store gets skip, and a full flow above p75 gets leave", () => {
  assert.equal(checkout.run({ monthly_amount: 300, conversion_rate_pct: 1, checkout_reached_pct: 2, average_order_value_usd: 20 }).verdict, "skip");
  const leave = checkout.run({ monthly_amount: 40000, conversion_rate_pct: 2, average_order_value_usd: 60, abandoned_checkouts_per_month: 900, current_flow: "full", current_flow_revenue_per_recipient_usd: 5 });
  assert.equal(leave.verdict, "leave");
});

test("checkout: clear errors with the tool's own field names", () => {
  const r = checkout.run({ monthly_amount: 1000, conversion_rate_pct: 5, checkout_reached_pct: 3, average_order_value_usd: 50 });
  assert.equal(r.ok, false);
  assert.match(r.errors.checkout_reached_pct, /higher than the conversion rate/);
  const e = toResult(r);
  assert.equal(e.isError, true);
  assert.match(e.content[0].text, /checkout_reached_pct/);
});

// ---- estimate_internal_tool_cost ----
test("toolcost: 12 people, 2 builders, 24 months, all five vendors compared", () => {
  const r = toolcost.run({ team_size: 12, builders: 2, months: 24 });
  assert.equal(r.ok, true);
  assert.equal(r.comparisons.length, 5);
  const airtable = r.comparisons.find((c) => c.tool === "Airtable");
  assert.equal(airtable.plan, "Team");
  assert.equal(airtable.saas_usd_per_month, 240); // 12 seats x USD 20
  assert.equal(airtable.custom_build_usd, 450);
  assert.equal(airtable.break_even_month, 2); // ceil(450 / 240)
  assert.equal(airtable.verdict, "build");
  const retool = r.comparisons.find((c) => c.tool === "Retool");
  assert.equal(retool.saas_usd_per_month, 10 * 2 + 5 * 10);
});

test("toolcost: one vendor, Standard build with care; free plan gives saas-free", () => {
  const r = toolcost.run({ team_size: 30, builders: 3, saas_tool: "notion", months: 12, build: "standard", care_plan: true });
  assert.equal(r.comparisons.length, 1);
  assert.equal(r.comparisons[0].custom_build_usd, 900);
  assert.equal(r.comparisons[0].custom_usd_per_month, 90);
  assert.equal(toolcost.run({ team_size: 4, builders: 1, saas_tool: "airtable" }).comparisons[0].verdict, "saas-free");
});

test("toolcost: errors for builders > team and for a plan with no vendor", () => {
  assert.match(toolcost.run({ team_size: 3, builders: 5 }).errors.builders, /cannot be more than team_size/);
  assert.match(toolcost.run({ team_size: 10, builders: 2, plan: "team" }).errors.plan, /needs one saas_tool/);
  assert.match(toolcost.run({ team_size: 10, builders: 3, saas_tool: "glide", plan: "basic" }).errors.plan, /does not take/);
});

// ---- check_app_preview_spec: metadata ----
test("preview metadata: 886x1920, 20 s, 30 fps passes on the given fields and lists what was not checked", async () => {
  const r = await preview.run({ width: 886, height: 1920, duration_seconds: 20, fps: 30 });
  assert.equal(r.ok, true);
  assert.equal(r.verdict, "pass_on_given_fields");
  assert.ok(r.checks.some((c) => c.id === "codec" && c.status === "not_checked"));
  assert.equal(r.ffmpeg_fix_command, null);
});

test("preview metadata: an iPhone's raw 1170x2532, 34 s, 60 fps fails size, length and fps, with one ffmpeg command", async () => {
  const r = await preview.run({ width: 1170, height: 2532, duration_seconds: 34, fps: 60 });
  assert.equal(r.verdict, "fail");
  const failed = r.checks.filter((c) => c.status === "fail").map((c) => c.id).sort();
  assert.deepEqual(failed, ["fps", "length", "size"]);
  assert.match(r.ffmpeg_fix_command, /fps=30/);
  assert.match(r.ffmpeg_fix_command, /-t 30/);
  assert.ok(r.accepted_sizes.some((s) => s.width === 886 && s.height === 1920));
});

test("preview metadata: full spec given (HEVC, mono, 44.1 kHz) fails codec and audio only", async () => {
  const r = await preview.run({ width: 1080, height: 1920, duration_seconds: 25, fps: 30, file_name: "p.mov", file_size_mb: 40, video_codec: "hevc", interlaced: false, rotation_degrees: 0, audio_channels: 1, audio_codec: "aac", audio_sample_rate_hz: 44100 });
  const failed = r.checks.filter((c) => c.status === "fail").map((c) => c.id).sort();
  assert.deepEqual(failed, ["audio", "codec"]);
  assert.match(r.ffmpeg_fix_command, /libx264/);
});

test("preview metadata: a passing row never carries a fix (886x1920, 20 s, 30 fps, 40 MB)", async () => {
  const r = await preview.run({ width: 886, height: 1920, duration_seconds: 20, fps: 30, file_size_mb: 40 });
  const passing = r.checks.filter((c) => c.status === "pass");
  assert.ok(passing.length >= 4);
  for (const c of passing) assert.equal(c.fix, undefined, `${c.id} passes but carries fix: ${c.fix}`);
  for (const a of r.advice.filter((x) => x.status === "pass")) assert.equal(a.note, undefined, `${a.id} passes but carries a note`);
  assert.doesNotMatch(JSON.stringify(r), /Cut -|No accepted size has this shape|Convert it to 30 fps|Export at a lower bitrate/);
});

test("preview metadata: a failing row keeps its fix", async () => {
  const r = await preview.run({ width: 1170, height: 2532, duration_seconds: 34, fps: 60 });
  for (const c of r.checks.filter((x) => x.status === "fail")) assert.ok(c.fix && c.fix.length > 10, `${c.id} fails without a fix`);
  assert.match(r.checks.find((c) => c.id === "length").fix, /^Cut 4 s/);
});

test("preview metadata: missing fields give a clear error", async () => {
  const r = await preview.run({ width: 886 });
  assert.equal(r.ok, false);
  assert.deepEqual(Object.keys(r.errors).sort(), ["duration_seconds", "fps", "height"]);
});

// ---- check_app_preview_spec: video_url over range reads (the same fixtures as the live checker's tests) ----
const EXPECT = [
  ["good-886x1920-15s.mp4", "pass", []],
  ["bad-12s.mp4", "fail", ["length"]],
  ["bad-60fps.mp4", "fail", ["fps"]],
  ["bad-size-1170x2532.mp4", "fail", ["level", "size"]],
  ["bad-no-audio.mp4", "fail", ["audio"]],
  ["bad-rotated.mp4", "fail", ["rotation"]],
  ["bad-hevc.mp4", "fail", ["codec"]],
  ["bad-vfr-bursts.mp4", "fail", ["fps"]],
];
for (const [file, verdict, fails] of EXPECT) {
  test(`preview video_url: ${file} → ${verdict}${fails.length ? ` (${fails.join(", ")})` : ""}`, async () => {
    const fetchImpl = fileServer(fixture(file));
    const r = await preview.run({ video_url: `https://cdn.example.test/${file}` }, { fetchImpl });
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.equal(r.verdict, verdict);
    assert.deepEqual(r.checks.filter((c) => c.status === "fail" || c.status === "unknown").map((c) => c.id).sort(), fails);
    assert.ok(fetchImpl.calls.every((h) => /^bytes=\d+-\d+$/.test(h)), "every read is a range read");
    for (const c of r.checks) if (c.status === "pass") assert.equal(c.fix, undefined, `${c.id} passes but carries a fix`);
  });
}

test("preview video_url: a server that ignores Range is read whole (small file)", async () => {
  const r = await preview.run({ video_url: "https://cdn.example.test/good.mp4" }, { fetchImpl: fileServer(fixture("good-886x1920-15s.mp4"), { ranges: false }) });
  assert.equal(r.verdict, "pass");
  assert.equal(r.file.http_reads, 1);
});

test("preview video_url: http, credentials, 404 and a non-video file give clear errors", async () => {
  assert.match((await preview.run({ video_url: "http://x.test/a.mp4" })).errors.video_url, /https/);
  assert.match((await preview.run({ video_url: "https://u:p@x.test/a.mp4" })).errors.video_url, /user name or password/);
  assert.match((await preview.run({ video_url: "https://x.test/a.mp4" }, { fetchImpl: fileServer(new Uint8Array(1), { status: 404 }) })).errors.video_url, /HTTP 404/);
  const html = new TextEncoder().encode("<!doctype html><html><body>not a video</body></html>".repeat(4));
  assert.match((await preview.run({ video_url: "https://x.test/a.mp4" }, { fetchImpl: fileServer(html, { type: "text/html; charset=utf-8" }) })).errors.video_url, /web page/);
  // Served as a video but not one: the probe's own message.
  assert.match((await preview.run({ video_url: "https://x.test/a.mp4" }, { fetchImpl: fileServer(fixture("good-886x1920-15s.mp4").slice(0, 4000)) })).errors.video_url, /cut short|no index/);
});

// ---- list_services ----
test("services: builder line has the two published prices and the MCP build at the same prices", () => {
  const r = services.run({ line: "builder" });
  assert.equal(r.services.length, 1);
  assert.deepEqual(r.services[0].offers.map((o) => o.price_usd), [450, 900]);
  assert.deepEqual(r.mcp_connector_build.offers.map((o) => [o.price_usd, o.days]), [[450, 7], [900, 10]]);
  assert.match(r.terms, /No reviews or ratings/);
  // The connector build is not on giannis-builds.pages.dev: the result must not call it published there.
  assert.equal(r.mcp_connector_build.listed_on_site, false);
  assert.match(r.summary, /not on the site yet/);
  assert.doesNotMatch(services.config.description, /MCP connectors on Cloudflare Workers, Klaviyo/);
});

test("services: all lines and the three free tools; no email address, rating or review in the output", () => {
  const r = services.run({});
  assert.equal(r.services.length, 3);
  assert.equal(r.free_tools.length, 3);
  const text = JSON.stringify(r);
  assert.doesNotMatch(text, /[\w.+-]+@[\w-]+\.[a-z]{2,}/i, "no email address in the output");
  assert.doesNotMatch(text, /ratingValue|aggregateRating|review"/);
});
