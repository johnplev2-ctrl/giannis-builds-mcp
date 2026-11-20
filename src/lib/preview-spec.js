// preview-spec.js: Apple's App Preview rules and the checks the App Store preview checker runs on a probe().
// The sizes and numbers are a copy of builder/app-preview/src/spec.js (read live 19 Nov 2026); the test
// "spec drift" fails if that file changes and this one does not. Three sizes the pipeline does not build
// are added from the same Apple page, re-read on 20 Nov 2026 (see EXTRA_SIZES).
// Pure functions, no DOM and no network APIs. MIT licence (the repository's LICENSE).

export const READ_ON = "2026-11-20";

export const SOURCES = Object.freeze({
  appleSpec: "https://developer.apple.com/help/app-store-connect/reference/app-information/app-preview-specifications",
  appleGuidance: "https://developer.apple.com/app-store/app-previews/",
  googlePlay: "https://support.google.com/googleplay/android-developer/answer/9866151",
});

// From builder/app-preview/src/spec.js (APPLE), unchanged.
export const APPLE = Object.freeze({
  minSec: 15,
  maxSec: 30,
  maxBytes: 500_000_000, // "500MB", read as decimal megabytes: the stricter reading
  maxFps: 30,
  extensions: Object.freeze([".mov", ".m4v", ".mp4"]),
  h264: Object.freeze({
    profiles: Object.freeze(["Constrained Baseline", "Baseline", "Main", "High"]),
    maxLevel: 40,
    targetMbps: Object.freeze([10, 12]),
    toleranceMbps: Object.freeze([9.5, 12.6]),
  }),
  audio: Object.freeze({ codec: "aac", channels: 2, sampleRates: Object.freeze([44100, 48000]), kbps: 256 }),
  defaultPosterSec: 5,
});

// From builder/app-preview/src/spec.js (TARGETS, store "apple"), unchanged.
export const TARGETS = Object.freeze({
  "appstore-iphone": Object.freeze({ w: 886, h: 1920, classes: "iPhone Duo; iPhone with Dynamic Island (large, medium); iPhone with Face ID (large, medium)" }),
  "appstore-iphone-landscape": Object.freeze({ w: 1920, h: 886, classes: "same classes, landscape" }),
  "appstore-iphone-16x9": Object.freeze({ w: 1080, h: 1920, classes: 'Home Button (large) 5.5" and Home Button (4")' }),
  "appstore-iphone-4.7": Object.freeze({ w: 750, h: 1334, classes: 'Home Button (medium) 4.7"' }),
  "appstore-iphone-4.7-landscape": Object.freeze({ w: 1334, h: 750, classes: 'Home Button (medium) 4.7", landscape' }),
  "appstore-ipad": Object.freeze({ w: 1200, h: 1600, classes: 'iPad 13", 12.9", 11", 10.5"' }),
  "appstore-ipad-landscape": Object.freeze({ w: 1600, h: 1200, classes: 'iPad 13", 12.9", 11", 10.5", landscape' }),
  "appstore-ipad-9.7": Object.freeze({ w: 900, h: 1200, classes: 'iPad 9.7" and 12.9" (2nd gen)' }),
  "appstore-mac": Object.freeze({ w: 1920, h: 1080, classes: "Mac and Apple TV (landscape only)" }),
});

// Accepted on Apple's page but not built by the pipeline (re-read 20 Nov 2026).
export const EXTRA_SIZES = Object.freeze([
  Object.freeze({ w: 1920, h: 1080, classes: 'iPhone with Home Button (large) and (4"), landscape' }),
  Object.freeze({ w: 1200, h: 900, classes: 'iPad 9.7" and 12.9" (2nd gen), landscape' }),
  Object.freeze({ w: 3840, h: 2160, classes: "Apple Vision Pro (landscape only)" }),
]);

// Every accepted size once, with the device classes it serves, in plain words for the result table.
export const ACCEPTED = Object.freeze([
  { w: 886, h: 1920, label: "iPhone with Face ID or Dynamic Island, and iPhone Duo, portrait" },
  { w: 1920, h: 886, label: "iPhone with Face ID or Dynamic Island, and iPhone Duo, landscape" },
  { w: 1080, h: 1920, label: "iPhone with a Home button (5.5-inch and 4-inch), portrait" },
  { w: 1920, h: 1080, label: "iPhone with a Home button (5.5-inch and 4-inch), landscape; Mac; Apple TV" },
  { w: 750, h: 1334, label: "iPhone with a Home button (4.7-inch), portrait" },
  { w: 1334, h: 750, label: "iPhone with a Home button (4.7-inch), landscape" },
  { w: 1200, h: 1600, label: "iPad 13-inch, 12.9-inch, 11-inch and 10.5-inch, portrait" },
  { w: 1600, h: 1200, label: "iPad 13-inch, 12.9-inch, 11-inch and 10.5-inch, landscape" },
  { w: 900, h: 1200, label: "iPad 9.7-inch and 12.9-inch (2nd generation), portrait" },
  { w: 1200, h: 900, label: "iPad 9.7-inch and 12.9-inch (2nd generation), landscape" },
  { w: 3840, h: 2160, label: "Apple Vision Pro, landscape" },
].map(Object.freeze));

const x = (w, h) => `${w} × ${h}`;
const r1 = (n) => (Math.round(n * 10) / 10).toString();
const r2 = (n) => (Math.round(n * 100) / 100).toFixed(2);
export const mb = (bytes) => (bytes >= 1e6 ? `${r1(bytes / 1e6)} MB` : `${r1(bytes / 1e3)} KB`);
const fpsText = (f) => `${Math.abs(f - Math.round(f)) < 0.01 ? Math.round(f) : r1(f)} fps`;

/** The accepted entry for an exact size, or null. */
export const acceptedFor = (w, h) => ACCEPTED.find((a) => a.w === w && a.h === h) ?? null;

/** Accepted sizes with the same shape (within 1.5 %, the pipeline's tolerance), largest first. */
export function sameShape(w, h) {
  const r = w / h;
  return ACCEPTED.filter((a) => Math.abs(a.w / a.h - r) / (a.w / a.h) <= 0.015).sort((p, q) => q.w * q.h - p.w * p.h);
}

/** The first audio layout Apple names: 1 track with 2 channels, or 2 tracks with 1 channel each. */
function stereo(audio) {
  if (audio.length === 1 && audio[0].audio?.channels === 2) return true;
  if (audio.length === 2 && audio.every((t) => t.audio?.channels === 1)) return true;
  return false;
}

/**
 * Check a probe() result against Apple's App Preview spec.
 * @returns {{verdict: "pass"|"fail", rows: object[], advice: object[], fails: object[], command: string|null, display: {w:number,h:number}|null, summary: object}}
 */
export function checkPreview(info, { name = "preview.mp4" } = {}) {
  const rows = [], advice = [];
  const add = (list, id, label, spec, measured, status, fix = "") => list.push({ id, label, spec, measured, status, fix });
  const ext = (/\.[A-Za-z0-9]+$/.exec(name)?.[0] ?? "").toLowerCase();
  const videos = info.tracks.filter((t) => t.kind === "video");
  const audios = info.tracks.filter((t) => t.kind === "audio");
  const vt = videos[0];
  const v = vt?.video;
  const prores = /^ap(ch|cn|cs|co|4h|4x)$/.test(v?.format ?? "");
  const hq = v?.format === "apch";
  const h264 = v?.codec === "H.264";

  // 1. File type
  const extOk = APPLE.extensions.includes(ext) && (!prores || ext === ".mov");
  add(rows, "container", "File type", ".mov, .m4v or .mp4 (ProRes: .mov only)", `${ext || "no extension"}, ${info.quicktime ? "QuickTime" : "MP4"}${info.fragmented ? " (fragmented)" : ""}`,
    extOk ? "pass" : "fail",
    prores && ext !== ".mov" && APPLE.extensions.includes(ext) ? "A ProRes preview has to be a .mov file. Save it as .mov, or convert it to H.264 in an .mp4." : "Save or export the file as .mp4 or .mov.");

  // 2. File size
  add(rows, "filesize", "File size", "Up to 500 MB", mb(info.size), info.size <= APPLE.maxBytes ? "pass" : "fail",
    "Export at a lower bitrate. At Apple's H.264 target of 10 to 12 Mbps, a 30-second preview is about 45 MB.");

  // 3. Length
  const d = info.duration;
  const lengthOk = d != null && d >= APPLE.minSec - 0.005 && d <= APPLE.maxSec + 0.005;
  add(rows, "length", "Length", "15 to 30 seconds", d != null ? `${r2(d)} s` : "unreadable", d == null ? "unknown" : lengthOk ? "pass" : "fail",
    d == null ? "The file does not state its length. Re-export it." : d < APPLE.minSec ? `Add ${r1(APPLE.minSec - d)} s of your app's screen recording. Apple refuses previews under 15 seconds.` : `Cut ${r1(d - APPLE.maxSec)} s. Apple takes at most 30 seconds.`);

  if (!vt || !v) {
    add(rows, "video", "Video track", "One H.264 or ProRes 422 HQ video track", "none", "fail", "The file has no video track. Export the preview again from your editor.");
    return finish(info, rows, advice, name, null);
  }

  // 4. Size (displayed, after the rotation flag)
  const quarter = vt.rotation === 90 || vt.rotation === 270;
  const dw = quarter ? v.height : v.width, dh = quarter ? v.width : v.height;
  const exact = acceptedFor(dw, dh);
  const shapes = exact ? [] : sameShape(dw, dh);
  const best = shapes[0];
  add(rows, "size", "Size", "A size Apple accepts for a device class", exact ? `${x(dw, dh)}: ${exact.label}` : x(dw, dh), exact ? "pass" : "fail",
    best ? `Scale it to ${x(best.w, best.h)} (${best.label}). The shape is the same, so nothing is cropped.`
      : `No accepted size has this shape. Record on an iPhone, an iPad or the Simulator for that device, and keep the full screen: cropping through your app's screen is not a fix.`);
  if (exact && exact.w === 3840) advice.push({ id: "vision", label: "Device class", spec: "Apple Vision Pro", measured: x(dw, dh), status: "info", fix: "At 3840 × 2160, H.264 needs a level above 4.0, so this size is in practice a ProRes 422 HQ .mov." });

  // 5. Rotation flag (our rule)
  add(rows, "rotation", "Rotation flag", "Pixels stored upright (our safety rule)", vt.rotation ? `Stored ${x(v.width, v.height)}, turned ${vt.rotation === 180 ? "upside down" : "a quarter turn"} on playback` : "None", vt.rotation ? "fail" : "pass",
    "Re-encode it so the pixels are stored upright; any re-export from an editor does this. Apple's spec lists pixel sizes and does not say how it reads a rotation flag, so this rule is ours.");

  // 6. Codec
  add(rows, "codec", "Video codec", "H.264, or ProRes 422 HQ in a .mov", v.codec, h264 || hq ? "pass" : "fail",
    /HEVC/.test(v.codec) ? "Re-encode to H.264. iPhones and the Simulator record HEVC by default; Apple's preview spec takes H.264 or ProRes 422 HQ only."
      : prores ? `Apple takes ProRes 422 HQ only. Export as ProRes 422 HQ, or as H.264.` : "Re-encode to H.264 (High profile, level 4.0).");

  // 7-9. H.264 profile, level, progressive
  if (h264) {
    add(rows, "profile", "H.264 profile", "Up to High", v.profile ?? "unreadable", !v.profile ? "unknown" : APPLE.h264.profiles.includes(v.profile) ? "pass" : "fail",
      "Re-encode with the High profile. High 10, 4:2:2 and 4:4:4 profiles are above what Apple takes.");
    add(rows, "level", "H.264 level", "Up to 4.0", v.level ?? "unreadable", v.levelIdc == null ? "unknown" : v.levelIdc <= APPLE.h264.maxLevel ? "pass" : "fail",
      "Re-encode at level 4.0. At every iPhone and iPad preview size and 30 fps, level 4.0 has room.");
  }
  const progressive = v.sps ? v.sps.progressive : v.fields != null ? v.fields === 1 : h264 ? null : true;
  add(rows, "progressive", "Scan", "Progressive", progressive === null ? "unreadable" : progressive ? "Progressive" : "Interlaced", progressive === null ? "unknown" : progressive ? "pass" : "fail",
    "Re-encode it as progressive video (deinterlace).");

  // 10. Frame rate
  const f = vt.fps;
  let fpsStatus = "unknown", fpsMeasured = "unreadable", fpsFix = "The frame timing could not be read (often a fragmented MP4). Re-save it as a regular MP4.";
  if (f) {
    const avgOver = f.avg > APPLE.maxFps + 0.05;
    const bursts = !avgOver && f.fastShare > 0.01;
    fpsStatus = avgOver || bursts ? "fail" : "pass";
    fpsMeasured = f.constant ? fpsText(f.avg) : `${fpsText(f.avg)} on average, up to ${fpsText(f.peak)}${bursts ? ` for ${Math.max(1, Math.round(f.fastShare * 100))} % of frames` : ""}`;
    fpsFix = bursts ? "Convert it to a constant 30 fps. The recording has a variable frame rate and runs faster than 30 fps in places." : "Convert it to 30 fps. Screen recordings often run at 60.";
  }
  add(rows, "fps", "Frame rate", "Up to 30 fps", fpsMeasured, fpsStatus, fpsFix);

  // 11. Pixel shape (only when the file says)
  if (v.pixelAspect && v.pixelAspect[0] !== v.pixelAspect[1]) {
    add(rows, "pixels", "Pixel shape", "Square pixels", `${v.pixelAspect[0]}:${v.pixelAspect[1]}`, "fail", "Re-encode with square pixels at the accepted size.");
  }

  // 12-14. Audio
  const audioOk = stereo(audios);
  const chans = audios.map((t) => t.audio?.channels ?? 0);
  add(rows, "audio", "Audio track", "Stereo: one 2-channel track, or two 1-channel tracks", !audios.length ? "None" : audios.length === 1 ? `${chans[0] === 1 ? "Mono" : `${chans[0]} channels`}` : `${audios.length} tracks (${chans.join(" + ")} channels)`,
    audioOk ? "pass" : "fail",
    !audios.length ? "Add a silent stereo AAC track if the preview has no sound. Apple's spec describes the audio as stereo AAC and has no silent option."
      : chans[0] === 1 && audios.length === 1 ? "Convert the audio to stereo (2 channels)." : "Mix the audio down to one stereo track.");
  if (audios.length) {
    const okCodec = audios.every((t) => t.audio?.codec === "AAC" || (prores && /^PCM/.test(t.audio?.codec ?? "") && [16, 24, 32].includes(t.audio.bitDepth)));
    const names = [...new Set(audios.map((t) => (t.audio?.codec === "AAC" ? t.audio.profile ?? "AAC" : t.audio?.codec === "PCM" ? `PCM ${t.audio.bitDepth}-bit` : t.audio?.codec ?? "unknown")))];
    add(rows, "audiocodec", "Audio codec", prores ? "AAC, or 16, 24 or 32-bit PCM" : "AAC", names.join(", "), okCodec ? "pass" : "fail", "Re-encode the audio to AAC at 256 kbps.");
    const rates = [...new Set(audios.map((t) => Math.round(t.audio?.sampleRate ?? 0)))];
    add(rows, "samplerate", "Sample rate", "44.1 or 48 kHz", rates.map((r) => `${r1(r / 1000)} kHz`).join(", "), rates.every((r) => APPLE.audio.sampleRates.includes(r)) ? "pass" : "fail", "Resample the audio to 48 kHz.");
  }

  // 15. Tracks enabled
  const disabled = info.tracks.filter((t) => !t.enabled && (t.kind === "video" || t.kind === "audio"));
  add(rows, "enabled", "Tracks enabled", "All tracks enabled", disabled.length ? `${disabled.length} disabled` : "All enabled", disabled.length ? "fail" : "pass",
    "Every track must be enabled. Re-export, or remove the disabled track.");

  if (prores && info.tracks.some((t) => t.external)) {
    add(rows, "external", "External references", "None (ProRes)", "Media stored outside this file", "fail", "Export a self-contained .mov.");
  }

  // Advice: Apple's targets and what makes uploads smoother. Never part of the verdict.
  if (vt.bitrate) {
    const mbps = vt.bitrate / 1e6;
    const [lo, hi] = APPLE.h264.toleranceMbps;
    add(advice, "bitrate", "Video bitrate", hq ? "About 220 Mbps (VBR)" : "Target 10 to 12 Mbps", `${mbps < 1 ? mbps.toFixed(2) : r1(mbps)} Mbps`, hq || (mbps >= lo && mbps <= hi) ? "pass" : "warn",
      mbps < lo ? "Below Apple's target. That is not a refusal line, but a low bitrate can look soft on the store." : "Above Apple's target. That is not a refusal line; it only makes the upload bigger.");
  }
  for (const t of audios) {
    if (t.audio?.codec !== "AAC" || !t.bitrate) continue;
    const kbps = t.bitrate / 1000;
    add(advice, "audiobitrate", "Audio bitrate", "256 kbps AAC", `${Math.round(kbps)} kbps`, kbps >= 230 && kbps <= 280 ? "pass" : "warn",
      "Apple's spec names 256 kbps. A silent track always comes out far lower, which is normal.");
    break;
  }
  if (f && !f.constant && fpsStatus === "pass") {
    add(advice, "cfr", "Frame timing", "Constant frame rate", `Variable, ${fpsText(f.min)} to ${fpsText(f.peak)}`, "warn",
      "Apple sets only a 30 fps maximum. A constant rate is the safer upload; convert with fps=30.");
  }
  if (videos.length > 1) add(advice, "videos", "Video tracks", "One", `${videos.length}`, "warn", "Keep one video track; extra ones are a common export mistake.");
  add(advice, "poster", "Poster frame", "Taken at 5 s unless you set another", d != null && d >= 5 ? "Shown on the sheet" : "The file is shorter than 5 s", "info",
    "Until a preview plays, the App Store shows this still. Make it a settled frame with its caption fully on screen.");

  return finish(info, rows, advice, name, { w: dw, h: dh, best: exact ?? best ?? null });
}

function finish(info, rows, advice, name, display) {
  const fails = rows.filter((r) => r.status === "fail" || r.status === "unknown");
  return {
    verdict: fails.length ? "fail" : "pass",
    rows, advice, fails, display,
    command: fails.length ? fixCommand(info, rows, name, display) : null,
  };
}

/** One ffmpeg command that fixes everything a re-encode can fix, or null when nothing can be fixed this way. */
export function fixCommand(info, rows, name, display) {
  const st = (id) => rows.find((r) => r.id === id)?.status;
  // In a fragmented MP4 the length and frame timing are unreadable, not wrong: a lossless remux makes them readable.
  const failing = (id) => st(id) === "fail" || (st(id) === "unknown" && !info.fragmented);
  const audios = info.tracks.filter((t) => t.kind === "audio");
  // The output is always an .mp4, and ffmpeg's MP4 muxer takes neither ProRes nor PCM: those are re-encoded.
  const prores = info.tracks.some((t) => /^ap(ch|cn|cs|co|4h|4x)$/.test(t.video?.format ?? ""));
  const videoIds = ["size", "rotation", "codec", "profile", "level", "progressive", "fps", "pixels", "filesize"];
  const audioIds = ["audio", "audiocodec", "samplerate"];
  const needVideo = videoIds.some(failing);
  const needAudio = audioIds.some(failing);
  const long = st("length") === "fail" && info.duration > APPLE.maxSec;
  const remux = failing("container") || failing("enabled") || failing("external") || info.fragmented;
  const scale = failing("size") && display?.best && (display.best.w !== display.w || display.best.h !== display.h) ? display.best : null;
  const noShape = failing("size") && !scale;
  if (!needVideo && !needAudio && !long && !remux) return null;
  // Above 8,192 macroblocks a frame (3840 x 2160, Vision Pro) H.264 level 4.0 can't hold it: that file is a ProRes 422 HQ job.
  if (display && Math.ceil(display.w / 16) * Math.ceil(display.h / 16) > 8192 && !scale && (needVideo || prores)) return null;
  if (noShape && !needAudio && !long && !remux && videoIds.filter(failing).length === 1) return null; // only a re-record fixes it
  const reVideo = needVideo || prores;
  const reAudio = needAudio || audios.some((t) => t.audio?.codec !== "AAC");
  const safe = name.replace(/["`$\\]/g, "");
  const base = safe.replace(/\.[A-Za-z0-9]+$/, "");
  const parts = ["ffmpeg", "-i", `"${safe}"`];
  if (!audios.length) parts.push("-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000");
  parts.push("-map", "0:v:0", "-map", audios.length ? "0:a:0" : "1:a:0");
  if (reVideo) {
    const vf = [];
    if (scale) vf.push(`scale=${scale.w}:${scale.h}:flags=lanczos`);
    if (scale || failing("pixels")) vf.push("setsar=1");
    if (failing("fps")) vf.push("fps=30");
    if (vf.length) parts.push("-vf", `"${vf.join(",")}"`);
    parts.push("-c:v", "libx264", "-profile:v", "high", "-level:v", "4.0", "-pix_fmt", "yuv420p", "-b:v", "11M", "-maxrate", "12M", "-bufsize", "24M");
  } else parts.push("-c:v", "copy");
  if (reAudio || !audios.length) parts.push("-c:a", "aac", "-b:a", "256k", "-ar", "48000", "-ac", "2");
  else parts.push("-c:a", "copy");
  if (!audios.length) parts.push("-shortest");
  if (long) parts.push("-t", "30");
  parts.push("-movflags", "+faststart", `"${base}-appstore.mp4"`);
  return parts.join(" ");
}

// Google Play: the preview video is one YouTube URL (answer 9866151). Same rules as
// builder/app-preview/src/play.js checkPlayVideoUrl; only the URL's shape can be checked here.
export function checkPlayVideoUrl(input) {
  const problems = [];
  let u;
  try { u = new URL(String(input).trim()); } catch { return { ok: false, id: null, problems: ["This is not a full URL. Paste the link that starts with https://"] }; }
  if (u.protocol !== "https:") problems.push("Use the https:// link.");
  const host = u.hostname.replace(/^www\.|^m\./, "");
  let id = null;
  if (host === "youtu.be") id = u.pathname.slice(1).split("/")[0] || null;
  else if (host === "youtube.com") {
    if (u.pathname === "/watch") id = u.searchParams.get("v");
    else if (u.pathname.startsWith("/shorts/")) {
      id = u.pathname.split("/")[2] || null;
      if (id) problems.push(`Use the watch link instead of the Shorts link: https://www.youtube.com/watch?v=${id}`);
    } else if (/^\/(playlist|channel|c\/|user\/|@)/.test(u.pathname)) problems.push("Play needs one video's link, not a playlist or a channel.");
  } else problems.push("This is not a YouTube link. Play takes a YouTube video URL only.");
  if (u.searchParams.has("list")) problems.push("Remove the playlist part (list=).");
  if (u.searchParams.has("t") || u.searchParams.has("start") || u.hash.includes("t=")) problems.push("Remove the timecode (t=).");
  const extra = [...u.searchParams.keys()].filter((k) => !(host === "youtube.com" && k === "v") && !["list", "t", "start"].includes(k));
  if (extra.length) problems.push(`Remove the extra parameters: ${extra.join(", ")}.`);
  if (id && !/^[A-Za-z0-9_-]{11}$/.test(id)) problems.push("The video id should be 11 characters.");
  if (!id && !problems.length) problems.push("No video id found in this link.");
  return { ok: problems.length === 0, id, problems };
}
