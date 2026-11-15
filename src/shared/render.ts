/** Mixer: score → stereo float samples with a seamless loop region. Pure; runs in Node and the browser. */
import { compose, type Score } from "./compose.js";
import { RELEASE, isStruck, renderHit, renderTonal } from "./instruments.js";
import { degreeHz, subSeed } from "./theory.js";
import { PERC, SAMPLE_RATE, type MusicParams, type PercInstrument, type Role, type TonalInstrument } from "./types.js";

export interface SongRender {
  left: Float32Array;
  right: Float32Array;
  sampleRate: number;
  /** Loop region in samples: [loopStart, loopEnd) — loopEnd is the file length. */
  loopStart: number;
  loopEnd: number;
  seconds: number;
  score: Score;
  /** Per-layer mono stems (after level matching), when asked for. */
  stems?: Float32Array[];
}

/** Target RMS per role, so presets stay balanced whatever the instrument. */
const ROLE_RMS: Record<Role, number> = { lead: 0.12, counter: 0.065, skeleton: 0.07, bass: 0.095, drone: 0.045, pad: 0.05, perc: 0.08 };
const PERC_RMS: Record<PercInstrument, number> = { ching: 0.03, gong: 0.045, kompang: 0.08, klong_thon: 0.075, chip_drums: 0.07 };
const DEFAULT_PAN: Record<Role, number> = { lead: 0, counter: 0.3, skeleton: -0.3, bass: 0, drone: -0.12, pad: 0.15, perc: 0 };
const PERC_PAN: Record<PercInstrument, number> = { ching: 0.28, gong: -0.2, kompang: -0.1, klong_thon: 0.08, chip_drums: 0 };

const isPerc = (i: string): i is PercInstrument => (PERC as readonly string[]).includes(i);

function hashKey(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** Sample position of a grid step, with swing on off-beat 8ths. */
export function stepToSample(step: number, stepSec: number, swing: number, sr: number): number {
  const sw = step % 4 === 2 ? swing * 2 : 0;
  return Math.round((step + sw) * stepSec * sr);
}

export function renderSong(p: MusicParams, opts: { sampleRate?: number; stems?: boolean } = {}): SongRender {
  const sr = opts.sampleRate ?? SAMPLE_RATE;
  const score = compose(p);
  const total = Math.round(score.totalSteps * score.stepSec * sr);
  const intro = Math.round(score.introSteps * score.stepSec * sr);
  const loopLen = total - intro;
  const rootHz = degreeHz(0, p.key, p.mode, p.tuning);
  const stems: Float32Array[] = [];
  const pans: number[] = [];

  for (const ls of score.layers) {
    const buf = new Float32Array(total);
    const { layer } = ls;
    pans.push(layer.pan ?? (isPerc(layer.instrument) ? PERC_PAN[layer.instrument] : DEFAULT_PAN[layer.role]));
    if (layer.mute || (!ls.notes.length && !ls.hits.length)) {
      stems.push(buf);
      continue;
    }
    const cache = new Map<string, Float32Array>();
    const place = (at: number, v: Float32Array, fromIntro: boolean) => {
      for (let i = 0; i < v.length; i++) {
        let j = at + i;
        if (fromIntro && j >= intro) {
          // intro tails fade out at the loop point so they never replay on each loop
          const k = j - intro;
          const fade = Math.round(0.15 * sr);
          if (k >= fade) break;
          buf[j]! += v[i]! * (1 - k / fade);
          continue;
        }
        if (j >= total) j = intro + ((j - total) % loopLen);
        buf[j]! += v[i]!;
      }
    };
    if (isPerc(layer.instrument)) {
      for (const h of ls.hits) {
        const velQ = Math.round(h.vel * 20) / 20;
        const key = `${h.tok}|${velQ}`;
        let v = cache.get(key);
        if (!v) {
          v = renderHit(layer.instrument, h.tok, velQ, subSeed(p.seed, `hit:${ls.index}:${key}`), sr, rootHz);
          cache.set(key, v);
        }
        place(stepToSample(h.step, score.stepSec, p.swing, sr), v, h.step < score.introSteps);
      }
    } else {
      const inst = layer.instrument as TonalInstrument;
      for (const n of ls.notes) {
        const dur = n.len * score.stepSec;
        const velQ = Math.round(n.vel * 20) / 20;
        const durKey = isStruck(inst) && !(inst === "ranat" && dur >= 0.9) ? 0 : Math.round(dur * 1000);
        const key = `${n.deg}|${durKey}|${velQ}|${n.from ?? ""}`;
        let v = cache.get(key);
        if (!v) {
          const f1 = degreeHz(n.deg, p.key, p.mode, p.tuning);
          const f0 = n.from !== undefined ? degreeHz(n.from, p.key, p.mode, p.tuning) : f1;
          const hz = f0 === f1 ? () => f1 : (t: number) => f1 * (f0 / f1) ** Math.exp(-t / 0.035);
          v = renderTonal(inst, { hz, dur, vel: velQ, seed: subSeed(p.seed, `note:${ls.index}:${key}`) ^ hashKey(inst), sr });
          cache.set(key, v);
        }
        place(stepToSample(n.step, score.stepSec, p.swing, sr), v, n.step < score.introSteps && n.step * score.stepSec + dur + RELEASE[inst] > score.introSteps * score.stepSec);
      }
    }
    // level-match the stem to its role
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i]! * buf[i]!;
    const rms = Math.sqrt(sum / Math.max(1, buf.length));
    const target = (isPerc(layer.instrument) ? PERC_RMS[layer.instrument] : ROLE_RMS[layer.role]) * layer.volume;
    if (rms > 1e-6) {
      const g = target / rms;
      for (let i = 0; i < buf.length; i++) buf[i]! *= g;
    }
    stems.push(buf);
  }

  const left = new Float32Array(total);
  const right = new Float32Array(total);
  stems.forEach((s, k) => {
    const pan = Math.max(-1, Math.min(1, pans[k]!));
    const a = ((pan + 1) * Math.PI) / 4;
    const gl = Math.cos(a) * Math.SQRT2;
    const gr = Math.sin(a) * Math.SQRT2;
    for (let i = 0; i < total; i++) {
      left[i]! += s[i]! * gl;
      right[i]! += s[i]! * gr;
    }
  });
  let peak = 0;
  for (let i = 0; i < total; i++) {
    left[i] = Math.tanh(left[i]! * 1.1);
    right[i] = Math.tanh(right[i]! * 1.1);
    peak = Math.max(peak, Math.abs(left[i]!), Math.abs(right[i]!));
  }
  const g = peak > 0 ? (0.9 * p.gain) / peak : 1;
  for (let i = 0; i < total; i++) {
    left[i]! *= g;
    right[i]! *= g;
  }
  return { left, right, sampleRate: sr, loopStart: intro, loopEnd: total, seconds: total / sr, score, ...(opts.stems ? { stems } : {}) };
}

/** Intro once, then the loop region `loops` times (for previews and mp3 samples). Optional fade-out at the end. */
export function unroll(r: SongRender, loops: number, fadeSec = 0): { left: Float32Array; right: Float32Array } {
  const loopLen = r.loopEnd - r.loopStart;
  const n = r.loopStart + loopLen * Math.max(1, loops);
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const j = i < r.loopStart ? i : r.loopStart + ((i - r.loopStart) % loopLen);
    left[i] = r.left[j]!;
    right[i] = r.right[j]!;
  }
  const f = Math.round(fadeSec * r.sampleRate);
  for (let i = 0; i < f && i < n; i++) {
    const g = i / f;
    left[n - 1 - i]! *= g;
    right[n - 1 - i]! *= g;
  }
  return { left, right };
}

/** Mono mix (for waveforms and stats). */
export function monoOf(left: Float32Array, right: Float32Array): Float32Array {
  const m = new Float32Array(left.length);
  for (let i = 0; i < m.length; i++) m[i] = (left[i]! + right[i]!) * 0.5;
  return m;
}

export function stats(left: Float32Array, right: Float32Array, sr = SAMPLE_RATE) {
  let peak = 0;
  let sum = 0;
  for (let i = 0; i < left.length; i++) {
    const a = Math.max(Math.abs(left[i]!), Math.abs(right[i]!));
    if (a > peak) peak = a;
    sum += (left[i]! * left[i]! + right[i]! * right[i]!) / 2;
  }
  return { seconds: +(left.length / sr).toFixed(4), samples: left.length, peak: +peak.toFixed(4), rms: +Math.sqrt(sum / Math.max(1, left.length)).toFixed(4) };
}

/**
 * Seam check: the loop is seamless when the jump from the last sample back to loopStart is no bigger than
 * normal sample-to-sample motion. Returns the jump and the 99.9th percentile of |Δ| inside the loop.
 */
export function seamJump(r: SongRender): { jump: number; typical: number } {
  const d = (x: Float32Array) => Math.abs(x[r.loopStart]! - x[r.loopEnd - 1]!);
  const jump = Math.max(d(r.left), d(r.right));
  const deltas: number[] = [];
  for (let i = r.loopStart + 1; i < r.loopEnd; i += 7) deltas.push(Math.abs(r.left[i]! - r.left[i - 1]!));
  deltas.sort((a, b) => a - b);
  return { jump, typical: deltas[Math.floor(deltas.length * 0.999)] ?? 0 };
}
