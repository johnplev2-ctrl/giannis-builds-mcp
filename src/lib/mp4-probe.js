// mp4-probe.js: a minimal ISO-BMFF / QuickTime reader for the App Store preview checker.
// Reads box headers and the moov box only, never the media data, from any random-access source:
//   const info = await probe((offset, length) => Promise<Uint8Array>, totalSize)
// In a browser the source is File.slice(); in Node, a Buffer (see tests/checker.spec.ts).
// It returns what Apple's App Preview spec asks about: the stored and displayed size (rotation matrix),
// duration, frame rate (average and peaks), video codec with H.264 profile, level and progressive flag,
// audio tracks with codec, channels, sample rate and bit depth, track flags, bitrates.
// No dependencies and no network APIs: nothing here can send the file anywhere.
// MIT licence, Copyright (c) 2026 Giannis Plevris (the repository's LICENSE).

const MAX_MOOV = 96 * 1024 * 1024; // a 30 s preview's moov is tens of KB; long recordings stay well under this

export class ProbeError extends Error {}
const mbText = (n) => (n >= 1e6 ? `${(Math.round(n / 1e5) / 10).toString()} MB` : `${(Math.round(n / 100) / 10).toString()} KB`);

const u16 = (b, p) => (b[p] << 8) | b[p + 1];
const u32 = (b, p) => ((b[p] << 24) >>> 0) + (b[p + 1] << 16) + (b[p + 2] << 8) + b[p + 3];
const s32 = (b, p) => u32(b, p) | 0;
const u64 = (b, p) => u32(b, p) * 4294967296 + u32(b, p + 4);
const cc = (b, p) => String.fromCharCode(b[p], b[p + 1], b[p + 2], b[p + 3]);
const printable = (t) => /^[\x20-\x7e\xa9]{4}$/.test(t);

/** Child boxes of b[start, end): {type, start (payload), end, size}. Stops quietly at a malformed box. */
function boxes(b, start, end) {
  const out = [];
  let p = start;
  while (p + 8 <= end) {
    let size = u32(b, p);
    const type = cc(b, p + 4);
    let hdr = 8;
    if (size === 1) { if (p + 16 > end) break; size = u64(b, p + 8); hdr = 16; }
    else if (size === 0) size = end - p;
    if (size < hdr || p + size > end || !printable(type)) break;
    out.push({ type, start: p + hdr, end: p + size, size });
    p += size;
  }
  return out;
}
const child = (b, box, type) => box && boxes(b, box.start, box.end).find((x) => x.type === type);
const path = (b, box, ...types) => types.reduce((cur, t) => child(b, cur, t), box);

/** Bit reader for SPS / AudioSpecificConfig. */
function bits(bytes) {
  let pos = 0;
  const bit = () => {
    if (pos >= bytes.length * 8) throw new RangeError("end of data");
    const v = (bytes[pos >> 3] >> (7 - (pos & 7))) & 1;
    pos++;
    return v;
  };
  const u = (n) => { let v = 0; for (let i = 0; i < n; i++) v = v * 2 + bit(); return v; };
  const ue = () => { let z = 0; while (bit() === 0) { if (++z > 31) throw new RangeError("bad exp-golomb"); } return 2 ** z - 1 + u(z); };
  const se = () => { const k = ue(); return k % 2 ? (k + 1) / 2 : -k / 2; };
  return { u, ue, se, bit };
}

// H.264 SPS (ITU-T H.264 7.3.2.1.1), as far as frame_mbs_only_flag (progressive) and the coded size.
const HIGH_PROFILES = new Set([100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135]);
export function parseSps(nal) {
  // Drop the NAL header byte and the emulation-prevention bytes (00 00 03 -> 00 00).
  const rbsp = [];
  let zeros = 0;
  for (let i = 1; i < nal.length; i++) {
    const x = nal[i];
    if (zeros >= 2 && x === 3) { zeros = 0; continue; }
    rbsp.push(x);
    zeros = x === 0 ? zeros + 1 : 0;
  }
  const r = bits(rbsp);
  const profileIdc = r.u(8), constraints = r.u(8), levelIdc = r.u(8);
  r.ue(); // seq_parameter_set_id
  let chroma = 1, bitDepth = 8;
  if (HIGH_PROFILES.has(profileIdc)) {
    chroma = r.ue();
    if (chroma === 3) r.bit();
    bitDepth = r.ue() + 8;
    r.ue(); // bit_depth_chroma_minus8
    r.bit(); // qpprime_y_zero_transform_bypass_flag
    if (r.bit()) { // seq_scaling_matrix_present_flag
      for (let i = 0; i < (chroma !== 3 ? 8 : 12); i++) {
        if (!r.bit()) continue;
        let last = 8, next = 8;
        for (let j = 0; j < (i < 6 ? 16 : 64); j++) {
          if (next !== 0) next = (last + r.se() + 256) % 256;
          last = next === 0 ? last : next;
        }
      }
    }
  }
  r.ue(); // log2_max_frame_num_minus4
  const pocType = r.ue();
  if (pocType === 0) r.ue();
  else if (pocType === 1) { r.bit(); r.se(); r.se(); const n = r.ue(); for (let i = 0; i < n; i++) r.se(); }
  r.ue(); // max_num_ref_frames
  r.bit(); // gaps_in_frame_num_value_allowed_flag
  const wMbs = r.ue() + 1, hMap = r.ue() + 1;
  const frameMbsOnly = r.bit() === 1;
  return { profileIdc, constraints, levelIdc, chroma, bitDepth, progressive: frameMbsOnly, codedW: wMbs * 16, codedH: hMap * 16 * (frameMbsOnly ? 1 : 2) };
}

export function h264ProfileName(idc, constraints) {
  const c1 = (constraints >> 6) & 1; // constraint_set1_flag
  switch (idc) {
    case 66: return c1 ? "Constrained Baseline" : "Baseline";
    case 77: return "Main";
    case 88: return "Extended";
    case 100: return "High";
    case 110: return "High 10";
    case 122: return "High 4:2:2";
    case 244: return "High 4:4:4 Predictive";
    case 44: return "CAVLC 4:4:4 Intra";
    default: return `profile ${idc}`;
  }
}
/** "4.0", "5.1", "1b". */
export function h264LevelName(idc, profileIdc, constraints) {
  if (idc === 9 || (idc === 11 && (profileIdc === 66 || profileIdc === 77) && (constraints >> 4) & 1)) return "1b";
  return (idc / 10).toFixed(1);
}

const VIDEO_CODECS = {
  avc1: "H.264", avc3: "H.264", hvc1: "HEVC (H.265)", hev1: "HEVC (H.265)", dvh1: "Dolby Vision (HEVC)", dvhe: "Dolby Vision (HEVC)",
  apch: "ProRes 422 HQ", apcn: "ProRes 422", apcs: "ProRes 422 LT", apco: "ProRes 422 Proxy", ap4h: "ProRes 4444", ap4x: "ProRes 4444 XQ",
  vp09: "VP9", av01: "AV1", mp4v: "MPEG-4 Part 2", jpeg: "Motion JPEG", mjpa: "Motion JPEG", "s263": "H.263", hdv1: "HDV",
};
const PCM = { lpcm: 0, sowt: 16, twos: 16, in24: 24, in32: 32, fl32: 32, fl64: 64, "raw ": 8 };
const AAC_OBJECT = { 1: "AAC Main", 2: "AAC-LC", 3: "AAC SSR", 4: "AAC LTP", 5: "HE-AAC", 23: "AAC-LD", 29: "HE-AAC v2", 39: "AAC-ELD", 42: "xHE-AAC" };
const AAC_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

function parseEsds(b, box) {
  let p = box.start + 4; // version + flags
  const end = box.end;
  const desc = () => {
    const tag = b[p++];
    let len = 0;
    for (let i = 0; i < 4; i++) { const c = b[p++]; len = (len << 7) | (c & 0x7f); if (!(c & 0x80)) break; }
    return { tag, len };
  };
  let oti = null, avgBitrate = null, asc = null;
  try {
    let d = desc();
    if (d.tag !== 3) return null;
    p += 2; // ES_ID
    const flags = b[p++];
    if (flags & 0x80) p += 2;
    if (flags & 0x40) p += 1 + b[p];
    if (flags & 0x20) p += 2;
    d = desc();
    if (d.tag !== 4) return null;
    oti = b[p];
    avgBitrate = u32(b, p + 9) || null;
    p += 13;
    if (p < end) {
      d = desc();
      if (d.tag === 5) asc = b.subarray(p, Math.min(p + d.len, end));
    }
  } catch { /* truncated descriptor: keep what was read */ }
  let object = null, channelConfig = null, rate = null;
  if (asc && asc.length >= 2) {
    try {
      const r = bits(asc);
      object = r.u(5);
      if (object === 31) object = 32 + r.u(6);
      const sfi = r.u(4);
      rate = sfi === 15 ? r.u(24) : AAC_RATES[sfi] ?? null;
      channelConfig = r.u(4);
    } catch { /* short ASC */ }
  }
  return { oti, avgBitrate, object, channelConfig, rate };
}

/** First box of `type` inside a sample entry's children, looking into QuickTime 'wave' boxes too. */
function findIn(b, start, end, type, depth = 0) {
  for (const x of boxes(b, start, end)) {
    if (x.type === type) return x;
    if (depth < 2 && (x.type === "wave" || x.type === "mp4a")) { const f = findIn(b, x.start, x.end, type, depth + 1); if (f) return f; }
  }
  return null;
}

function videoEntry(b, e) {
  const fmt = cc(b, e.start - 4);
  const v = { format: fmt, codec: VIDEO_CODECS[fmt] ?? `unknown (${fmt.trim()})`, width: u16(b, e.start + 24), height: u16(b, e.start + 26) };
  for (const x of boxes(b, e.start + 78, e.end)) {
    if (x.type === "avcC" && x.end - x.start >= 7) {
      v.profileIdc = b[x.start + 1];
      v.constraints = b[x.start + 2];
      v.levelIdc = b[x.start + 3];
      const nSps = b[x.start + 5] & 0x1f;
      if (nSps > 0) {
        const len = u16(b, x.start + 6);
        try { v.sps = parseSps(b.subarray(x.start + 8, x.start + 8 + len)); } catch { v.sps = null; }
      }
      v.profile = h264ProfileName(v.profileIdc, v.constraints);
      v.level = h264LevelName(v.levelIdc, v.profileIdc, v.constraints);
    } else if (x.type === "hvcC" && x.end - x.start >= 13) {
      const pidc = b[x.start + 1] & 0x1f;
      v.profile = { 1: "Main", 2: "Main 10", 3: "Main Still Picture", 4: "Range extensions" }[pidc] ?? `profile ${pidc}`;
      v.level = (b[x.start + 12] / 30).toFixed(1);
    } else if (x.type === "pasp" && x.end - x.start >= 8) {
      v.pixelAspect = [u32(b, x.start), u32(b, x.start + 4)];
    } else if (x.type === "fiel" && x.end - x.start >= 1) {
      v.fields = b[x.start];
    }
  }
  return v;
}

function audioEntry(b, e) {
  const fmt = cc(b, e.start - 4);
  const version = u16(b, e.start + 8);
  const a = { format: fmt, channels: u16(b, e.start + 16), bitDepth: u16(b, e.start + 18), sampleRate: u32(b, e.start + 24) / 65536 };
  let kids = e.start + 28;
  if (version === 1) kids = e.start + 44;
  if (version === 2) {
    const dv = new DataView(b.buffer, b.byteOffset + e.start + 32, 8);
    a.sampleRate = dv.getFloat64(0);
    a.channels = u32(b, e.start + 40);
    a.bitDepth = u32(b, e.start + 48);
    kids = e.start + 64;
  }
  if (fmt in PCM) {
    a.codec = "PCM";
    if (PCM[fmt]) a.bitDepth = PCM[fmt];
    if (fmt === "fl32" || fmt === "fl64") a.codec = "PCM (float)";
  } else if (fmt === "mp4a") {
    const esds = findIn(b, kids, e.end, "esds");
    const es = esds && parseEsds(b, esds);
    if (!es || es.oti === 0x40 || (es.oti >= 0x66 && es.oti <= 0x68)) {
      a.codec = "AAC";
      if (es?.object) a.profile = AAC_OBJECT[es.object] ?? `AAC object ${es.object}`;
      // channelConfiguration 1-6 = that many channels, 7 = 7.1; 0 means "in the stream": keep the entry's count.
      if (es?.channelConfig >= 1 && es.channelConfig <= 7) a.channels = es.channelConfig === 7 ? 8 : es.channelConfig;
      if (!a.sampleRate && es?.rate) a.sampleRate = es.rate;
    } else a.codec = es.oti === 0x6b || es.oti === 0x69 ? "MP3" : `MPEG-4 audio type 0x${es.oti.toString(16)}`;
    a.avgBitrate = es?.avgBitrate ?? null;
  } else {
    a.codec = { alac: "Apple Lossless", "ac-3": "AC-3", "ec-3": "E-AC-3", Opus: "Opus", ".mp3": "MP3", samr: "AMR", ulaw: "µ-law", alaw: "A-law", ima4: "IMA ADPCM" }[fmt] ?? `unknown (${fmt.trim()})`;
  }
  return a;
}

function parseTrak(b, trak, movieScale) {
  const t = { kind: "other", enabled: true };
  const tkhd = child(b, trak, "tkhd");
  if (tkhd) {
    const p = tkhd.start, v = b[p];
    t.enabled = (b[p + 3] & 1) === 1;
    t.id = v === 1 ? u32(b, p + 20) : u32(b, p + 12);
    const dur = v === 1 ? u64(b, p + 28) : u32(b, p + 20);
    t.tkhdSec = movieScale ? dur / movieScale : null;
    const m = p + (v === 1 ? 52 : 40);
    if (m + 44 <= tkhd.end) {
      const A = s32(b, m) / 65536, B = s32(b, m + 4) / 65536, C = s32(b, m + 12) / 65536, D = s32(b, m + 16) / 65536;
      const deg = (Math.atan2(B, A) * 180) / Math.PI;
      t.rotation = (((Math.round(deg / 90) * 90) % 360) + 360) % 360;
      t.matrixPlain = Math.abs(Math.abs(A * D - B * C) - 1) < 0.01 && Math.abs(A) + Math.abs(B) > 0.99;
      t.mirrored = A * D - B * C < 0;
      t.tkhdW = u32(b, m + 36) / 65536;
      t.tkhdH = u32(b, m + 40) / 65536;
    }
  }
  const mdia = child(b, trak, "mdia");
  const mdhd = child(b, mdia, "mdhd");
  if (mdhd) {
    const p = mdhd.start, v = b[p];
    t.timescale = v === 1 ? u32(b, p + 20) : u32(b, p + 12);
    const dur = v === 1 ? u64(b, p + 24) : u32(b, p + 16);
    t.mediaSec = t.timescale ? dur / t.timescale : null;
  }
  const hdlr = child(b, mdia, "hdlr");
  const handler = hdlr ? cc(b, hdlr.start + 8) : "";
  t.kind = handler === "vide" ? "video" : handler === "soun" ? "audio" : handler === "tmcd" ? "timecode" : handler.trim() || "other";
  const stbl = path(b, mdia, "minf", "stbl");
  const stsd = child(b, stbl, "stsd");
  if (stsd && stsd.end - stsd.start >= 16) {
    const entries = boxes(b, stsd.start + 8, stsd.end);
    if (entries[0]) {
      if (t.kind === "video") t.video = videoEntry(b, entries[0]);
      else if (t.kind === "audio") t.audio = audioEntry(b, entries[0]);
    }
  }
  // Decode-time deltas: the frame rate, its peaks and whether it is constant.
  const stts = child(b, stbl, "stts");
  if (stts) {
    const n = u32(b, stts.start + 4);
    const runs = [];
    for (let i = 0, p = stts.start + 8; i < n && p + 8 <= stts.end; i++, p += 8) runs.push([u32(b, p), u32(b, p + 4)]);
    t.stts = runs;
  }
  const stsz = child(b, stbl, "stsz");
  if (stsz) {
    const fixed = u32(b, stsz.start + 4), count = u32(b, stsz.start + 8);
    let bytes = 0;
    if (fixed) bytes = fixed * count;
    else for (let i = 0, p = stsz.start + 12; i < count && p + 4 <= stsz.end; i++, p += 4) bytes += u32(b, p);
    t.samples = count;
    t.sampleBytes = bytes;
  } else {
    const stz2 = child(b, stbl, "stz2");
    if (stz2) {
      const field = b[stz2.start + 7], count = u32(b, stz2.start + 8);
      let bytes = 0;
      // Bounded by the box, not by the count it states: a hostile count must not spin the loop.
      const n = Math.min(count, field ? Math.floor(((stz2.end - stz2.start - 12) * 8) / field) : 0);
      for (let i = 0; i < n; i++) {
        const bit = i * field, p = stz2.start + 12 + (bit >> 3);
        bytes += field === 4 ? (b[p] >> (4 - (bit & 7))) & 15 : field === 8 ? b[p] : u16(b, p);
      }
      t.samples = count;
      t.sampleBytes = bytes;
    }
  }
  // Self-contained media: a data reference flag of 1 means "in this file" (ProRes: "no external references").
  const dref = path(b, mdia, "minf", "dinf", "dref");
  if (dref) t.external = boxes(b, dref.start + 8, dref.end).some((x) => (b[x.start + 3] & 1) === 0);
  return t;
}

/** Frame-rate summary from stts runs: average, peak, constant, share of frames faster than `limit` fps. */
export function frameRate(runs, timescale, limit = 30) {
  if (!runs?.length || !timescale) return null;
  let frames = 0, ticks = 0;
  for (const [n, d] of runs) { frames += n; ticks += n * d; }
  if (!frames || !ticks) return null;
  // A single odd last delta is how muxers end a track: leave it out of the peak and the constancy test.
  const body = runs.length > 1 && runs[runs.length - 1][0] === 1 ? runs.slice(0, -1) : runs;
  // A loop, not Math.min(...deltas): an hour of variable-rate recording has hundreds of thousands of runs.
  let minDelta = Infinity, maxDelta = 0;
  for (const [, d] of body) if (d > 0) { if (d < minDelta) minDelta = d; if (d > maxDelta) maxDelta = d; }
  if (!maxDelta) return null;
  const tooFast = body.reduce((s, [n, d]) => s + (d > 0 && timescale / d > limit + 0.5 ? n : 0), 0);
  return {
    avg: frames / (ticks / timescale),
    peak: timescale / minDelta,
    min: timescale / maxDelta,
    constant: maxDelta - minDelta <= Math.max(1, minDelta * 0.002),
    frames,
    fastShare: tooFast / frames,
  };
}

/**
 * @param {(offset: number, length: number) => Promise<Uint8Array>} read
 * @param {number} size total bytes
 */
export async function probe(read, size) {
  if (!(size > 8)) throw new ProbeError("The file is empty.");
  const top = [];
  let off = 0, moov = null, ftyp = null;
  while (off + 8 <= size && top.length < 10000) {
    const h = await read(off, Math.min(16, size - off));
    let len = u32(h, 0);
    const type = cc(h, 4);
    let hdr = 8;
    if (len === 1 && h.length >= 16) { len = u64(h, 8); hdr = 16; }
    else if (len === 0) len = size - off;
    if (len < hdr || !printable(type)) {
      if (!top.length) throw new ProbeError("This is not an MP4 or QuickTime file: its first bytes are not a box header.");
      break; // trailing garbage after valid boxes
    }
    // A box that runs past the end of the file: the copy or download stopped early, or the recording was cut off.
    // Its index may still read as complete, so this is refused rather than checked.
    if (off + len > size) {
      const what = type === "moov" ? "index (moov box)" : type === "mdat" ? "media data (mdat box)" : `"${type}" box`;
      throw new ProbeError(`The file is cut short: its ${what} runs to ${mbText(off + len)}, but the file ends at ${mbText(size)}. It may still be copying or downloading, or the export was interrupted. Copy or export it again.`);
    }
    top.push({ type, offset: off, size: len });
    if (type === "ftyp" && len <= 4096) { const fb = await read(off, len); ftyp = { major: cc(fb, 8), brands: [] }; for (let p = 16; p + 4 <= len; p += 4) ftyp.brands.push(cc(fb, p)); }
    if (type === "moov") {
      if (len > MAX_MOOV) throw new ProbeError("The file's index (moov box) is too large to read in the browser.");
      moov = await read(off, len);
    }
    off += len;
    // Enough once the index is read and the media's position is known (a fragmented file has thousands of boxes).
    if (moov && top.some((b) => b.type === "mdat" || b.type === "moof")) break;
  }
  if (!moov) {
    const first = top[0]?.type;
    if (!["ftyp", "moov", "mdat", "wide", "free", "skip", "pnot", "uuid"].includes(first)) throw new ProbeError("This is not an MP4 or QuickTime file.");
    throw new ProbeError("The file has no index (moov box). It may be cut short, still downloading, or saved by a recording that was interrupted.");
  }
  const root = { start: 8, end: moov.length };
  const mvhd = child(moov, root, "mvhd");
  let movieScale = 0, movieSec = null;
  if (mvhd) {
    const v = moov[mvhd.start];
    movieScale = v === 1 ? u32(moov, mvhd.start + 20) : u32(moov, mvhd.start + 12);
    const dur = v === 1 ? u64(moov, mvhd.start + 24) : u32(moov, mvhd.start + 16);
    movieSec = movieScale ? dur / movieScale : null;
  }
  const mvex = child(moov, root, "mvex");
  const fragmented = Boolean(mvex);
  if (fragmented && !movieSec) {
    const mehd = child(moov, mvex, "mehd");
    if (mehd && movieScale) movieSec = (moov[mehd.start] === 1 ? u64(moov, mehd.start + 4) : u32(moov, mehd.start + 4)) / movieScale;
  }
  const tracks = boxes(moov, root.start, root.end).filter((x) => x.type === "trak").map((t) => parseTrak(moov, t, movieScale));
  for (const t of tracks) {
    if (t.kind === "video") t.fps = frameRate(t.stts, t.timescale);
    if (t.mediaSec && t.sampleBytes) t.bitrate = (t.sampleBytes * 8) / t.mediaSec;
  }
  const order = top.map((x) => x.type);
  return {
    size,
    brand: ftyp?.major ?? null,
    brands: ftyp?.brands ?? [],
    quicktime: ftyp ? ftyp.major === "qt  " : !order.includes("ftyp"),
    // mvhd, else the longest track; 0 means "not stated" (a fragmented file without mehd).
    duration: movieSec || Math.max(0, ...tracks.map((t) => t.tkhdSec || t.mediaSec || 0)) || null,
    fragmented,
    faststart: order.indexOf("moov") < (order.includes("mdat") ? order.indexOf("mdat") : Infinity),
    topLevel: order.slice(0, 12),
    tracks,
  };
}

/** probe() over a browser File or Blob (reads slices; the file never leaves the device). */
export function probeFile(file) {
  return probe(async (offset, length) => new Uint8Array(await file.slice(offset, offset + length).arrayBuffer()), file.size);
}
