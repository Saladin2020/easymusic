import { spawnSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { monoOf, renderSong, stats, unroll, type SongRender } from "../shared/render.js";
import type { ResolvedSong } from "../shared/types.js";
import { drawWaveform, type Ctx2D } from "../shared/waveform.js";
import { encodeWav } from "../shared/wav.js";
import { registerFonts } from "./assets.js";

/** Render cache keyed by params JSON (export + waveform + audio reuse one render). */
const cache = new Map<string, SongRender>();
export function render(song: ResolvedSong): SongRender {
  const key = JSON.stringify(song.params);
  let r = cache.get(key);
  if (!r) {
    r = renderSong(song.params);
    if (cache.size > 24) cache.clear();
    cache.set(key, r);
  }
  return r;
}

/** WAV bytes of the loop file (intro + one loop, `smpl` loop points), or an unrolled preview (`loops` > 1, no loop chunk). */
export function wavBytes(r: SongRender, opts: { loops?: number; fade?: number } = {}): Buffer {
  if (opts.loops && opts.loops > 1) {
    const u = unroll(r, opts.loops, opts.fade ?? 0);
    return Buffer.from(encodeWav(u.left, u.right, r.sampleRate));
  }
  return Buffer.from(encodeWav(r.left, r.right, r.sampleRate, { start: r.loopStart, end: r.loopEnd }));
}

let ffmpegChecked: string | null | undefined;
/** ffmpeg binary (EASYMUSIC_FFMPEG or PATH) or null. */
export function ffmpegPath(): string | null {
  if (ffmpegChecked !== undefined) return ffmpegChecked;
  const bin = process.env.EASYMUSIC_FFMPEG?.trim() || "ffmpeg";
  const r = spawnSync(bin, ["-hide_banner", "-version"], { encoding: "utf8" });
  ffmpegChecked = r.status === 0 ? bin : null;
  return ffmpegChecked;
}

/**
 * Encode a WAV to .ogg (Vorbis, with LOOPSTART / LOOPLENGTH comments in samples) or .mp3. Returns false without ffmpeg.
 */
export function transcode(wavFile: string, outFile: string, loop?: { start: number; end: number }): boolean {
  const ff = ffmpegPath();
  if (!ff) return false;
  const ogg = outFile.endsWith(".ogg");
  const args = ["-hide_banner", "-loglevel", "error", "-y", "-i", wavFile, "-map_metadata", "-1", "-fflags", "+bitexact", "-flags:a", "+bitexact"];
  if (ogg) {
    args.push("-c:a", "libvorbis", "-q:a", "5", "-serial_offset", "1");
    if (loop) args.push("-metadata", `LOOPSTART=${loop.start}`, "-metadata", `LOOPLENGTH=${loop.end - loop.start}`);
  } else args.push("-c:a", "libmp3lame", "-q:a", "3", "-id3v2_version", "0", "-write_xing", "0");
  args.push(outFile);
  const r = spawnSync(ff, args, { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr.trim().split("\n").at(-1)}`);
  return true;
}

/** Write .wav / .ogg / .mp3 (by extension). `loops` > 1 writes a linear preview (intro + n loops, optional fade). */
export async function writeAudio(r: SongRender, out: string, opts: { loops?: number; fade?: number } = {}): Promise<{ file: string; format: string }> {
  await mkdir(path.dirname(path.resolve(out)), { recursive: true });
  const ext = path.extname(out).toLowerCase();
  const loopMeta = !opts.loops || opts.loops <= 1 ? { start: r.loopStart, end: r.loopEnd } : undefined;
  if (ext === ".wav") {
    await writeFile(out, wavBytes(r, opts));
    return { file: out, format: "wav" };
  }
  if (ext !== ".ogg" && ext !== ".mp3") throw new Error("--out must end in .wav, .ogg or .mp3");
  const tmp = `${out}.tmp.wav`;
  await writeFile(tmp, wavBytes(r, opts));
  try {
    if (!transcode(tmp, out, loopMeta)) throw new Error("ffmpeg not found: write a .wav instead (or set EASYMUSIC_FFMPEG)");
  } finally {
    await rm(tmp, { force: true });
  }
  return { file: out, format: ext.slice(1) };
}

/** Waveform PNG: 3px pixels, teak palette, title + timing, beat grid and loop markers. */
export function waveformPng(song: ResolvedSong, r: SongRender, opts: { width?: number; height?: number } = {}): Buffer {
  registerFonts();
  const w = opts.width ?? 960;
  const h = opts.height ?? 260;
  const c = createCanvas(w, h);
  const g = c.getContext("2d");
  const s = stats(r.left, r.right, r.sampleRate);
  const p = song.params;
  drawWaveform(g as unknown as Ctx2D, monoOf(r.left, r.right), {
    w,
    h,
    px: 3,
    sampleRate: r.sampleRate,
    title: `${song.id} · ${song.th}`,
    subtitle: `${p.bpm} bpm · ${p.bars} bars${p.introBars ? ` + ${p.introBars} intro` : ""} · ${p.mode} in ${p.key}${p.tuning === "thai7" ? " (Thai 7-tone)" : ""} · ${s.seconds.toFixed(1)} s · loop`,
    beatSec: (60 / p.bpm) * 4,
    loop: true,
  });
  if (r.loopStart > 0) {
    const px0 = 6;
    const pw = w - 12;
    g.fillStyle = "#79c48a";
    g.fillRect(px0 + Math.floor((r.loopStart / r.left.length) * pw), h * 0.3, 3, h * 0.7);
  }
  return c.toBuffer("image/png");
}

/** Contact sheet: one waveform row per song. */
export function waveformSheet(items: Array<{ song: ResolvedSong; r: SongRender }>, opts: { width?: number; rowHeight?: number } = {}): Buffer {
  registerFonts();
  const w = opts.width ?? 1200;
  const rh = opts.rowHeight ?? 130;
  const c = createCanvas(w, rh * items.length);
  const g = c.getContext("2d");
  items.forEach(({ song, r }, i) => {
    const p = song.params;
    drawWaveform(g as unknown as Ctx2D, monoOf(r.left, r.right), {
      y: i * rh,
      w,
      h: rh,
      px: 2,
      sampleRate: r.sampleRate,
      title: `${song.id} · ${song.th}`,
      subtitle: `${song.en} · ${p.bpm} bpm · ${r.seconds.toFixed(1)} s`,
      beatSec: (60 / p.bpm) * 4,
      loop: true,
    });
  });
  return c.toBuffer("image/png");
}

export { stats };
