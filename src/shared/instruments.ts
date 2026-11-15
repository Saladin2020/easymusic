/**
 * Instrument voices, synthesized from code (no samples). Each voice returns mono float samples for one
 * note or hit; the mixer places them on the timeline. Deterministic: noise comes from a seeded PRNG.
 *
 * Thai instruments are approximations built from additive partials, plucked-string and bowed/reed models:
 *  ranat (xylophone), khong wong (gong circle), saw (bowed fiddle), khim (hammered dulcimer), pi (oboe),
 *  khlui-like flute, ching/chap (small cymbals), klong thon + rammana (goblet drum + frame drum),
 *  kompang / rebana (Malay frame drums) and khong mong (hanging gong). There is no vocal or chant voice.
 */
import { rng } from "./theory.js";
import type { InstrumentId, PercInstrument, TonalInstrument } from "./types.js";

const TAU = Math.PI * 2;

export const INSTRUMENT_INFO: Record<InstrumentId, { th: string; en: string; kind: "tonal" | "perc"; roles: string[] }> = {
  ranat: { th: "ระนาดเอก", en: "Ranat ek (bamboo/wood xylophone)", kind: "tonal", roles: ["lead", "counter"] },
  khong_wong: { th: "ฆ้องวง", en: "Khong wong (gong circle)", kind: "tonal", roles: ["skeleton", "lead"] },
  saw: { th: "ซอ", en: "Saw (bowed fiddle)", kind: "tonal", roles: ["lead"] },
  khim: { th: "ขิม", en: "Khim (hammered dulcimer)", kind: "tonal", roles: ["lead", "counter"] },
  pi: { th: "ปี่", en: "Pi (quadruple-reed oboe)", kind: "tonal", roles: ["lead"] },
  flute: { th: "ขลุ่ย", en: "Khlui-style bamboo flute", kind: "tonal", roles: ["lead"] },
  chip_square: { th: "ชิปทูน สี่เหลี่ยม", en: "Chiptune square lead", kind: "tonal", roles: ["lead", "counter"] },
  chip_pulse: { th: "ชิปทูน พัลส์แคบ", en: "Chiptune 12.5% pulse (arps, counter)", kind: "tonal", roles: ["counter", "skeleton", "lead"] },
  chip_triangle: { th: "ชิปทูน สามเหลี่ยม", en: "Chiptune 4-bit triangle bass", kind: "tonal", roles: ["bass", "skeleton"] },
  synth_pad: { th: "ซินธ์แพด", en: "Soft synth pad", kind: "tonal", roles: ["pad", "drone"] },
  synth_bass: { th: "ซินธ์เบส", en: "Warm synth bass", kind: "tonal", roles: ["bass"] },
  ching: { th: "ฉิ่ง ฉาบ", en: "Ching / chap (small cymbals, the time cycle)", kind: "perc", roles: ["perc"] },
  klong_thon: { th: "โทน รำมะนา", en: "Klong thon + rammana (goblet + frame drum)", kind: "perc", roles: ["perc"] },
  kompang: { th: "กอมปัง รือบานา", en: "Kompang / rebana (Malay frame drums, interlocking)", kind: "perc", roles: ["perc"] },
  chip_drums: { th: "กลองชิปทูน", en: "Chiptune noise drums", kind: "perc", roles: ["perc"] },
  gong: { th: "ฆ้องโหม่ง", en: "Khong mong (hanging gong on phrase starts)", kind: "perc", roles: ["perc"] },
};

/** One-pole low-pass coefficient. */
const lpCoef = (hz: number, sr: number) => 1 - Math.exp((-TAU * hz) / sr);

/** Chamberlin state-variable filter (returns low / band / high). */
function svf(sr: number, hz: number, q: number) {
  let low = 0;
  let band = 0;
  const f = 2 * Math.sin((Math.PI * Math.min(hz, sr / 6)) / sr);
  const damp = 1 / q;
  return (x: number) => {
    low += f * band;
    const high = x - low - damp * band;
    band += f * high;
    return { low, band, high };
  };
}

/** PolyBLEP residual for band-limited saw / pulse edges. */
function blep(t: number, dt: number): number {
  if (t < dt) {
    const x = t / dt;
    return x + x - x * x - 1;
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
}

export interface VoiceInput {
  /** Frequency at time t (seconds since note start), handles glides. */
  hz: (t: number) => number;
  /** Held seconds. */
  dur: number;
  vel: number;
  seed: number;
  sr: number;
}

/** Extra seconds each instrument rings after the held part. */
export const RELEASE: Record<TonalInstrument, number> = {
  ranat: 0.9,
  khong_wong: 2.2,
  saw: 0.09,
  khim: 1.4,
  pi: 0.07,
  flute: 0.1,
  chip_square: 0.04,
  chip_pulse: 0.03,
  chip_triangle: 0.03,
  synth_pad: 0.7,
  synth_bass: 0.08,
};

/** Struck instruments ring for a fixed time regardless of the held length. */
const STRUCK = new Set<TonalInstrument>(["ranat", "khong_wong", "khim"]);

function mallet(v: VoiceInput, partials: [number, number, number][], click: number, ringFor: number): Float32Array {
  const n = Math.ceil(ringFor * v.sr);
  const out = new Float32Array(n);
  const r = rng(v.seed);
  const f0 = v.hz(0);
  const brightness = Math.min(1.4, Math.max(0.5, (440 / f0) ** 0.3));
  const phases = partials.map(() => 0);
  const sum = partials.reduce((a, p) => a + p[1], 0);
  let lp = 0;
  const lpa = lpCoef(2500, v.sr);
  for (let i = 0; i < n; i++) {
    const t = i / v.sr;
    let s = 0;
    for (let k = 0; k < partials.length; k++) {
      const [ratio, amp, tau] = partials[k]!;
      phases[k]! += (f0 * ratio) / v.sr;
      s += Math.sin(TAU * phases[k]!) * amp * Math.exp(-t / (tau * brightness));
    }
    s /= sum;
    if (t < 0.006) {
      lp += lpa * (r() * 2 - 1 - lp);
      s += lp * click * (1 - t / 0.006);
    }
    const atk = t < 0.002 ? t / 0.002 : 1;
    out[i] = s * atk * v.vel;
  }
  return out;
}

function karplus(v: VoiceInput, ringFor: number): Float32Array {
  const n = Math.ceil(ringFor * v.sr);
  const out = new Float32Array(n);
  const r = rng(v.seed);
  const strings = [0, 4].map((cents) => {
    const len = Math.max(2, Math.round(v.sr / (v.hz(0) * 2 ** (cents / 1200))));
    const b = new Float32Array(len);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      lp += 0.6 * (r() * 2 - 1 - lp);
      b[i] = lp;
    }
    return { b, i: 0 };
  });
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (const st of strings) {
      const a = st.b[st.i]!;
      const b2 = st.b[(st.i + 1) % st.b.length]!;
      st.b[st.i] = (0.52 * a + 0.48 * b2) * 0.9978;
      st.i = (st.i + 1) % st.b.length;
      s += a;
    }
    out[i] = s * 0.6 * v.vel;
  }
  return out;
}

/** Sustained voices (bowed, reed, flute, chip, synth): envelope over `dur` + release. */
function sustained(v: VoiceInput, inst: TonalInstrument): Float32Array {
  const rel = RELEASE[inst];
  const n = Math.ceil((v.dur + rel) * v.sr);
  const out = new Float32Array(n);
  const r = rng(v.seed);
  let ph = 0;
  const ph2 = [0, 0.31, 0.67];
  const dt = 1 / v.sr;
  const filt = svf(v.sr, inst === "pi" ? 1350 : 1150, inst === "pi" ? 1.6 : 1.1);
  const filt2 = svf(v.sr, inst === "saw" ? 2600 : 3200, 0.8);
  let lp1 = 0;
  let lp2 = 0;
  let noise = 0;
  const env = (t: number) => {
    const a = { saw: 0.06, pi: 0.025, flute: 0.04, chip_square: 0.004, chip_pulse: 0.003, chip_triangle: 0.003, synth_pad: 0.35, synth_bass: 0.006 }[inst as string] ?? 0.01;
    const sus = { chip_square: 0.62, chip_pulse: 0.35, synth_bass: 0.7, chip_triangle: 0.9 }[inst as string] ?? 0.88;
    const dec = inst === "chip_pulse" ? 0.08 : 0.12;
    let e = t < a ? t / a : t < a + dec ? 1 - (1 - sus) * ((t - a) / dec) : sus;
    if (t > v.dur) e *= Math.max(0, 1 - (t - v.dur) / rel);
    return e;
  };
  for (let i = 0; i < n; i++) {
    const t = i * dt;
    let f = v.hz(t);
    // vibrato after a short delay (saw / pi / flute / chip lead)
    const vib = { saw: [5.6, 0.28, 0.12], pi: [6.3, 0.38, 0.08], flute: [5.0, 0.22, 0.15], chip_square: [6, 0.18, 0.22] }[inst as string];
    if (vib && t > vib[2]!) f *= 2 ** ((vib[1]! * Math.sin(TAU * vib[0]! * (t - vib[2]!)) * Math.min(1, (t - vib[2]!) / 0.15)) / 12);
    if (inst === "pi" && t < 0.04) f *= 2 ** ((-60 * (1 - t / 0.04)) / 1200);
    const inc = f * dt;
    ph += inc;
    ph -= Math.floor(ph);
    let s: number;
    switch (inst) {
      case "saw": {
        const raw = 2 * ph - 1 - blep(ph, inc);
        const a = filt(raw);
        const b = filt2(raw);
        s = 0.55 * b.low + 0.9 * a.band;
        break;
      }
      case "pi": {
        const d = 0.2;
        let p = (ph < d ? 1 : -1) + blep(ph, inc) - blep((ph - d + 1) % 1, inc);
        noise = r() * 2 - 1;
        p += noise * 0.08;
        const a = filt(p);
        s = 0.6 * a.band + 0.35 * filt2(p).low;
        break;
      }
      case "flute": {
        noise = r() * 2 - 1;
        lp1 += lpCoef(2200, v.sr) * (noise - lp1);
        s = Math.sin(TAU * ph) * 0.85 + Math.sin(2 * TAU * ph) * 0.12 + lp1 * 0.12;
        break;
      }
      case "chip_square":
        s = ph < 0.5 ? 0.6 : -0.6;
        break;
      case "chip_pulse":
        s = ph < 0.125 ? 0.6 : -0.6;
        break;
      case "chip_triangle":
        s = (Math.round((4 * Math.abs(ph - 0.5) - 1) * 7.5) / 7.5) * 0.8;
        break;
      case "synth_pad": {
        let x = 0;
        [-7, 0, 7].forEach((c, k) => {
          ph2[k] = (ph2[k]! + (f * 2 ** (c / 1200)) * dt) % 1;
          x += 2 * ph2[k]! - 1;
        });
        lp1 += lpCoef(1100, v.sr) * (x / 3 - lp1);
        lp2 += lpCoef(1100, v.sr) * (lp1 - lp2);
        s = lp2 * 1.2;
        break;
      }
      default: {
        // synth_bass
        const x = 2 * ph - 1 - blep(ph, inc);
        const cut = 300 + 1400 * Math.exp(-t / 0.09);
        lp1 += lpCoef(cut, v.sr) * (x - lp1);
        s = lp1 * 0.8 + Math.sin(TAU * ph) * 0.4;
      }
    }
    out[i] = s * env(t) * v.vel;
  }
  return out;
}

/** Render one tonal note. Long ranat notes become a "kro" tremolo roll. */
export function renderTonal(inst: TonalInstrument, v: VoiceInput): Float32Array {
  if (inst === "ranat") {
    const ring = 1.1;
    if (v.dur >= 0.9) {
      // kro: re-strike every ~70 ms while held
      const rate = 0.072;
      const strikes = Math.floor(v.dur / rate);
      const out = new Float32Array(Math.ceil((v.dur + ring) * v.sr));
      for (let k = 0; k < strikes; k++) {
        const one = mallet({ ...v, vel: v.vel * (k === 0 ? 1 : 0.5 + 0.08 * Math.sin(k)), seed: v.seed + k }, RANAT, 0.5, 0.4);
        const at = Math.round(k * rate * v.sr);
        for (let i = 0; i < one.length && at + i < out.length; i++) out[at + i]! += one[i]!;
      }
      return out;
    }
    return mallet(v, RANAT, 0.6, ring);
  }
  if (inst === "khong_wong") return mallet(v, KHONG, 0.25, 2.6);
  if (inst === "khim") return karplus(v, 1.6);
  return sustained(v, inst);
}

const RANAT: [number, number, number][] = [
  [1, 1, 0.42],
  [3.93, 0.42, 0.11],
  [9.7, 0.14, 0.035],
  [2.01, 0.05, 0.2],
];
const KHONG: [number, number, number][] = [
  [1, 1, 1.5],
  [1.0028, 0.55, 1.5],
  [2.0, 0.16, 0.8],
  [2.76, 0.3, 0.55],
  [5.42, 0.12, 0.22],
  [8.2, 0.05, 0.09],
];

export const isStruck = (inst: TonalInstrument) => STRUCK.has(inst);

/** Render one percussion hit. `rootHz` tunes the gong and the drums slightly to the key. */
export function renderHit(inst: PercInstrument, tok: string, vel: number, seed: number, sr: number, rootHz: number): Float32Array {
  const r = rng(seed);
  const len = (s: number) => new Float32Array(Math.ceil(s * sr));
  const noiseLp = (hz: number) => {
    let y = 0;
    const a = lpCoef(hz, sr);
    return () => (y += a * (r() * 2 - 1 - y));
  };
  if (inst === "ching") {
    const open = tok === "o";
    const out = len(open ? 1.1 : 0.12);
    const ratios = [1, 1.53, 2.27, 2.99, 4.11, 5.3];
    const base = 2380;
    const ph = ratios.map(() => r());
    let hp = 0;
    let prev = 0;
    for (let i = 0; i < out.length; i++) {
      const t = i / sr;
      let s = 0;
      ratios.forEach((q, k) => {
        ph[k]! += (base * q) / sr;
        s += Math.sin(TAU * ph[k]!) / (k + 1.5);
      });
      const nz = r() * 2 - 1;
      hp = 0.92 * (hp + nz - prev);
      prev = nz;
      const tau = open ? 0.32 : 0.025;
      s = s * 0.55 * Math.exp(-t / tau) + hp * (open ? 0.25 : 0.6) * Math.exp(-t / (open ? 0.03 : 0.02));
      out[i] = s * vel * 0.5;
    }
    return out;
  }
  if (inst === "gong") {
    const out = len(3.6);
    const f = rootHz / 4;
    const parts: [number, number, number][] = [
      [1, 1, 2.6],
      [1.004, 0.6, 2.6],
      [2.41, 0.3, 1.2],
      [3.82, 0.18, 0.6],
      [5.1, 0.06, 0.25],
    ];
    const ph = parts.map(() => 0);
    const n = noiseLp(400);
    for (let i = 0; i < out.length; i++) {
      const t = i / sr;
      let s = 0;
      parts.forEach(([q, a, tau], k) => {
        ph[k]! += (f * q) / sr;
        s += Math.sin(TAU * ph[k]!) * a * Math.exp(-t / tau);
      });
      const atk = t < 0.012 ? t / 0.012 : 1;
      out[i] = (s * 0.5 + n() * 0.4 * Math.exp(-t / 0.02)) * atk * vel * 0.8;
    }
    return out;
  }
  // membranes: pitched body with a pitch drop + slap noise
  const drum = (dur: number, f0: number, f1: number, drop: number, tau: number, slap: number, slapHz: number, body = 1, overtone = 0) => {
    const out = len(dur);
    let ph = 0;
    let ph2 = 0;
    const n = noiseLp(slapHz);
    let hp = 0;
    let prev = 0;
    for (let i = 0; i < out.length; i++) {
      const t = i / sr;
      const f = f1 + (f0 - f1) * Math.exp(-t / drop);
      ph += f / sr;
      ph2 += (f * 1.59) / sr;
      const nz = n();
      hp = 0.9 * (hp + nz - prev);
      prev = nz;
      const s = (Math.sin(TAU * ph) + overtone * Math.sin(TAU * ph2)) * body * Math.exp(-t / tau) + hp * slap * Math.exp(-t / 0.018);
      out[i] = Math.tanh(s * 1.2) * vel * 0.75;
    }
    return out;
  };
  if (inst === "klong_thon") {
    if (tok === "T") return drum(0.6, 120, 78, 0.05, 0.2, 0.25, 1500);
    if (tok === "t") return drum(0.2, 420, 360, 0.02, 0.06, 0.55, 5000, 0.6, 0.4);
    return drum(0.12, 900, 700, 0.01, 0.02, 1.0, 6000, 0.15);
  }
  if (inst === "kompang") {
    if (tok === "b") return drum(0.3, 260, 190, 0.03, 0.09, 0.35, 3000);
    if (tok === "k") return drum(0.12, 700, 620, 0.01, 0.025, 1.0, 7000, 0.25, 0.5);
    return drum(0.45, 120, 95, 0.04, 0.16, 0.2, 1200);
  }
  // chip_drums (stepped noise, 8-bit flavour)
  const out = len(tok === "O" ? 0.25 : tok === "K" ? 0.18 : 0.14);
  let held = 0;
  let ph = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    if (i % (tok === "h" || tok === "O" ? 2 : 6) === 0) held = r() < 0.5 ? -1 : 1;
    let s = 0;
    if (tok === "K") {
      ph += (55 + 140 * Math.exp(-t / 0.03)) / sr;
      s = (ph % 1 < 0.5 ? 1 : -1) * 0.8 * Math.exp(-t / 0.06);
    } else if (tok === "S") {
      ph += 190 / sr;
      s = (held * 0.6 + (ph % 1 < 0.5 ? 0.3 : -0.3)) * Math.exp(-t / 0.05);
    } else s = held * 0.35 * Math.exp(-t / (tok === "O" ? 0.08 : 0.012));
    out[i] = s * vel * 0.7;
  }
  return out;
}
