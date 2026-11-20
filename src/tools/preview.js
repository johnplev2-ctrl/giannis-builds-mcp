// check_app_preview_spec: Apple's App Preview rules (src/lib/preview-spec.js, the same checks as
// https://giannis-builds.pages.dev/app-store-preview-checker) behind a typed MCP tool. Two ways in:
//  - video_url: the Worker reads the file's box headers and index (moov) over HTTP range requests with
//    src/lib/mp4-probe.js, never the media data when the server honours Range, and checks what it measured;
//  - metadata: width, height, length, frame rate (and optionally codec, profile, level, audio, size) as typed in.
// Read-only; nothing is stored.
import { z } from "zod";
import { checkPreview, fixCommand, ACCEPTED, APPLE, SOURCES, READ_ON } from "../lib/preview-spec.js";
import { probe, ProbeError } from "../lib/mp4-probe.js";

export const name = "check_app_preview_spec";

const H264_PROFILES = ["Constrained Baseline", "Baseline", "Main", "High", "High 10", "High 4:2:2", "High 4:4:4"];

export const config = {
  title: "Check an App Store preview video against Apple's spec",
  description:
    "Checks an App Store app preview against Apple's App Preview specification (read " + READ_ON + "): accepted size per device class, 15 to 30 seconds, " +
    "up to 30 fps, H.264 up to High profile level 4.0 or ProRes 422 HQ, stereo AAC at 44.1 or 48 kHz, up to 500 MB. " +
    "Either pass video_url (a public https link to the .mp4/.mov; the server reads only the file's index) or the measured metadata " +
    "(width, height, duration_seconds, fps, plus any of codec, profile, level, audio, size). Returns pass/fail per line, a fix for each failure and one ffmpeg command.",
  inputSchema: z.object({
    video_url: z.string().url().optional().describe("Public https URL of the preview file. When given, every other measurement is read from the file."),
    width: z.number().int().positive().optional().describe("Displayed width in pixels (after any rotation)."),
    height: z.number().int().positive().optional().describe("Displayed height in pixels."),
    duration_seconds: z.number().positive().optional().describe("Length in seconds."),
    fps: z.number().positive().optional().describe("Frame rate (average)."),
    file_name: z.string().max(200).optional().describe('File name with extension, e.g. "preview.mp4". Default preview.mp4.'),
    file_size_mb: z.number().positive().optional().describe("File size in MB (decimal)."),
    video_codec: z.enum(["h264", "hevc", "prores_422_hq", "prores_other", "other"]).optional(),
    h264_profile: z.enum(H264_PROFILES).optional(),
    h264_level: z.number().min(1).max(6.2).optional().describe("H.264 level, e.g. 4.0 or 4.2."),
    interlaced: z.boolean().optional(),
    rotation_degrees: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).optional().describe("Rotation flag in the file, if known."),
    audio_channels: z.number().int().min(0).max(8).optional().describe("0 = no audio track, 1 = mono, 2 = stereo."),
    audio_codec: z.enum(["aac", "pcm", "other"]).optional(),
    audio_sample_rate_hz: z.number().int().positive().optional(),
  }),
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
};

// ---- video_url: range reads over fetch ------------------------------------------------------------------------
const BLOCK = 256 * 1024;
const MAX_WHOLE = 64 * 1024 * 1024; // a server that ignores Range: read the whole file only up to this
const MAX_FETCHES = 24; // well under the Workers Free plan's 50 subrequests per invocation

export class UrlError extends Error {}

/** A probe() reader over HTTP: 256 KB blocks, cached; falls back to one whole-file read when Range is ignored. */
export async function urlReader(url, fetchImpl = fetch) {
  let u;
  try { u = new URL(url); } catch { throw new UrlError("video_url is not a full URL."); }
  if (u.protocol !== "https:") throw new UrlError("video_url must start with https://");
  if (u.username || u.password) throw new UrlError("video_url must not carry a user name or password.");
  let fetches = 0, whole = null, size = null;
  const cache = new Map();
  const get = async (start, end) => {
    if (++fetches > MAX_FETCHES) throw new UrlError("The file needs too many reads to find its index. Re-save it with the index first (ffmpeg -movflags +faststart).");
    const res = await fetchImpl(u.href, { headers: { Range: `bytes=${start}-${end}` }, redirect: "follow", cf: { cacheTtl: 0 } });
    const type = res.headers.get("content-type") ?? "";
    if (fetches === 1 && (type.toLowerCase().startsWith("text/html") || type.toLowerCase().startsWith("application/json"))) {
      await res.body?.cancel();
      throw new UrlError(`The URL returned a web page (${type}), not the video file. Use a direct link to the .mp4 or .mov file itself.`);
    }
    if (res.status === 206) {
      const cr = /\/(\d+)\s*$/.exec(res.headers.get("content-range") ?? "");
      if (cr) size = Number(cr[1]);
      return { partial: true, bytes: new Uint8Array(await res.arrayBuffer()) };
    }
    if (res.status === 200) {
      const len = Number(res.headers.get("content-length") ?? NaN);
      if (Number.isFinite(len) && len > MAX_WHOLE) { await res.body?.cancel(); throw new UrlError(`The server ignores range requests and the file is ${Math.round(len / 1e6)} MB; only files up to 64 MB can be read whole. Host it where range requests work (S3, R2, GCS, most CDNs).`); }
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.length > MAX_WHOLE) throw new UrlError("The file is over 64 MB and the server ignores range requests.");
      return { partial: false, bytes };
    }
    await res.body?.cancel();
    throw new UrlError(`The URL answered HTTP ${res.status}. Use a public link that downloads the file itself.`);
  };
  const first = await get(0, BLOCK - 1);
  if (!first.partial) { whole = first.bytes; size = whole.length; }
  else { cache.set(0, first.bytes); if (size == null) throw new UrlError("The server did not state the file's total size (Content-Range)."); }
  const read = async (offset, length) => {
    if (whole) return whole.subarray(offset, offset + length);
    const out = new Uint8Array(length);
    let done = 0;
    // A large read (the moov box) goes in one request; small header reads share cached blocks.
    if (length > BLOCK) {
      const r = await get(offset, offset + length - 1);
      return r.partial ? r.bytes : r.bytes.subarray(offset, offset + length);
    }
    while (done < length) {
      const pos = offset + done;
      const b = Math.floor(pos / BLOCK) * BLOCK;
      if (!cache.has(b)) {
        const r = await get(b, Math.min(size, b + BLOCK) - 1);
        cache.set(b, r.partial ? r.bytes : r.bytes.subarray(b, b + BLOCK));
      }
      const blk = cache.get(b);
      const n = Math.min(length - done, blk.length - (pos - b));
      if (n <= 0) break;
      out.set(blk.subarray(pos - b, pos - b + n), done);
      done += n;
    }
    return out.subarray(0, done);
  };
  return { read, size, fetches: () => fetches };
}

// ---- metadata: a probe()-shaped object from typed-in values ------------------------------------------------------
const CODEC = {
  h264: { codec: "H.264", format: "avc1" }, hevc: { codec: "HEVC (H.265)", format: "hvc1" },
  prores_422_hq: { codec: "ProRes 422 HQ", format: "apch" }, prores_other: { codec: "ProRes 422", format: "apcn" }, other: { codec: "other", format: "othr" },
};

/** Builds the probe()-shaped info and the set of row ids nobody measured (reported as not_checked, never as a failure). */
export function infoFromMetadata(a) {
  const unchecked = new Set();
  if (!a.file_name) unchecked.add("container");
  if (a.file_size_mb == null) unchecked.add("filesize");
  unchecked.add("enabled"); // only a real file can say
  const c = CODEC[a.video_codec ?? "h264"];
  if (!a.video_codec) unchecked.add("codec");
  const v = { format: c.format, codec: c.codec, width: a.width, height: a.height };
  if (c.codec === "H.264") {
    v.profile = a.h264_profile ?? "High";
    if (!a.h264_profile) unchecked.add("profile");
    if (a.h264_level != null) { v.levelIdc = Math.round(a.h264_level * 10); v.level = a.h264_level.toFixed(1); }
    else { v.levelIdc = 40; v.level = "4.0"; unchecked.add("level"); }
  }
  if (a.interlaced != null) v.fields = a.interlaced ? 2 : 1;
  else { v.fields = 1; unchecked.add("progressive"); }
  if (a.rotation_degrees == null) unchecked.add("rotation");
  const tracks = [{ kind: "video", enabled: true, rotation: a.rotation_degrees ?? 0, video: v, fps: { avg: a.fps, peak: a.fps, min: a.fps, constant: true, fastShare: 0 } }];
  if (a.rotation_degrees === 90 || a.rotation_degrees === 270) { v.width = a.height; v.height = a.width; } // stored size; the check turns it back
  if (a.audio_channels == null) { ["audio", "audiocodec", "samplerate"].forEach((id) => unchecked.add(id)); tracks.push(audioTrack(2, "aac", 48000)); }
  else if (a.audio_channels > 0) {
    if (!a.audio_codec) unchecked.add("audiocodec");
    if (!a.audio_sample_rate_hz) unchecked.add("samplerate");
    tracks.push(audioTrack(a.audio_channels, a.audio_codec ?? "aac", a.audio_sample_rate_hz ?? 48000));
  }
  const fileName = a.file_name ?? "preview.mp4";
  return { info: { size: a.file_size_mb != null ? Math.round(a.file_size_mb * 1e6) : 1, duration: a.duration_seconds, quicktime: /\.mov$/i.test(fileName), fragmented: false, tracks }, unchecked, fileName };
}
const audioTrack = (channels, codec, rate) => ({ kind: "audio", enabled: true, audio: { codec: codec === "aac" ? "AAC" : codec === "pcm" ? "PCM" : "other", profile: "AAC-LC", channels, sampleRate: rate, bitDepth: 16 } });

/** Marks unmeasured rows, then re-derives the verdict and the ffmpeg command from what was measured. */
export function applyUnchecked(info, result, unchecked, fileName) {
  const rows = result.rows.map((r) => (unchecked.has(r.id) ? { ...r, measured: "not given", status: "not_checked", fix: "" } : r));
  const fails = rows.filter((r) => r.status === "fail" || r.status === "unknown");
  return { ...result, rows, fails, verdict: fails.length ? "fail" : "pass", command: fails.length ? fixCommand(info, rows, fileName, result.display) : null };
}

function shape(result, extra) {
  const accepted = ACCEPTED.map((s) => ({ width: s.w, height: s.h, devices: s.label }));
  const notChecked = result.rows.filter((r) => r.status === "not_checked").map((r) => r.id);
  const failing = result.rows.filter((r) => r.status === "fail" || r.status === "unknown");
  const summary = failing.length
    ? `Fails Apple's App Preview spec on ${failing.length} line${failing.length > 1 ? "s" : ""}: ${failing.map((r) => r.label.toLowerCase()).join(", ")}.`
    : notChecked.length ? `Passes every line that was given (${notChecked.length} not checked: ${notChecked.join(", ")}). Pass video_url to check the rest from the file.` : "Passes every line of Apple's App Preview spec that applies.";
  return {
    ok: true,
    kind: "preview",
    verdict: failing.length ? "fail" : notChecked.length ? "pass_on_given_fields" : "pass",
    summary,
    ...extra,
    display_size: result.display ? { width: result.display.w, height: result.display.h } : null,
    // preview-spec.js builds a fix string for every row; only a failing or unreadable row may carry one, or the model
    // reads "Cut -10 s" or "No accepted size has this shape" next to a pass.
    checks: result.rows.map((r) => ({ id: r.id, check: r.label, apple_spec: r.spec, measured: r.measured, status: r.status, fix: (r.status === "fail" || r.status === "unknown") && r.fix ? r.fix : undefined })),
    advice: result.advice.map((r) => ({ id: r.id, check: r.label, target: r.spec, measured: r.measured, status: r.status, note: r.status !== "pass" && r.fix ? r.fix : undefined })),
    ffmpeg_fix_command: result.command,
    accepted_sizes: failing.some((r) => r.id === "size") ? accepted : undefined,
    limits: { seconds: [APPLE.minSec, APPLE.maxSec], max_fps: APPLE.maxFps, max_mb: APPLE.maxBytes / 1e6 },
    sources: [{ name: "Apple, App preview specifications", url: SOURCES.appleSpec }, { name: "Apple, App previews", url: SOURCES.appleGuidance }],
    checker: "https://giannis-builds.pages.dev/app-store-preview-checker",
  };
}

export async function run(args, { fetchImpl = fetch } = {}) {
  if (args.video_url) {
    let reader, info;
    try {
      reader = await urlReader(args.video_url, fetchImpl);
      info = await probe(reader.read, reader.size);
    } catch (e) {
      if (e instanceof UrlError || e instanceof ProbeError) return { ok: false, errors: { video_url: e.message } };
      return { ok: false, errors: { video_url: `The file could not be read: ${String(e?.message ?? e).slice(0, 200)}` } };
    }
    const fileName = decodeURIComponent(new URL(args.video_url).pathname.split("/").pop() || "preview.mp4");
    const result = checkPreview(info, { name: fileName });
    return shape(result, { source: "video_url", file: { name: fileName, bytes: info.size, faststart: info.faststart, http_reads: reader.fetches() } });
  }
  const missing = ["width", "height", "duration_seconds", "fps"].filter((k) => args[k] == null);
  if (missing.length) return { ok: false, errors: Object.fromEntries(missing.map((k) => [k, `Give ${k}, or pass video_url instead.`])) };
  const { info, unchecked, fileName } = infoFromMetadata(args);
  const result = applyUnchecked(info, checkPreview(info, { name: fileName }), unchecked, fileName);
  return shape(result, { source: "metadata" });
}
