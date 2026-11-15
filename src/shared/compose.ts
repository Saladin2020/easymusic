/**
 * The seeded composer: params → a score of note and drum events on a 16th-note grid.
 *
 * Thai-flavoured structure: a lead melody built from repeated phrases (A A' B A''), a khong wong
 * "skeleton" that marks the melody's main notes on the beat (in octaves), a ranat / khim elaboration that
 * runs between skeleton notes (heterophony), a bass, a drone or pad, and a percussion cycle (ching-chap,
 * klong thon, kompang interlock, chip drums, gong on phrase starts). The loop always cadences on the tonic,
 * so the end flows back into the start.
 */
import { pick, rng, subSeed } from "./theory.js";
import { BEATS_PER_BAR, PERC, STEPS_PER_BEAT, type Layer, type Mood, type MusicParams, type PercInstrument } from "./types.js";

export const STEPS_PER_BAR = BEATS_PER_BAR * STEPS_PER_BEAT;

export interface NoteEv {
  /** Step from the start of the file (intro included). */
  step: number;
  /** Held steps. */
  len: number;
  /** Pentatonic degree (0 = root, octave 4). */
  deg: number;
  /** 0..1 */
  vel: number;
  /** Glide from this degree (saw / pi slides). */
  from?: number;
}

export interface HitEv {
  step: number;
  /** Drum token, see PERC_TOKENS. */
  tok: string;
  vel: number;
}

export interface LayerScore {
  index: number;
  layer: Layer;
  notes: NoteEv[];
  hits: HitEv[];
}

export interface Score {
  stepSec: number;
  introSteps: number;
  loopSteps: number;
  totalSteps: number;
  /** Phrase labels of the loop, one per phrase (A, A', B …). */
  form: string[];
  phraseBars: number;
  layers: LayerScore[];
}

/** Drum tokens per percussion set (for docs, the editor and validation). */
export const PERC_TOKENS: Record<PercInstrument, Record<string, string>> = {
  ching: { o: "ching (open ring)", c: "chap (closed)" },
  klong_thon: { T: "thon (deep open)", t: "ting (rammana, high)", p: "slap" },
  kompang: { b: "bung (open bass)", k: "pak (slap)", g: "rebana bass" },
  chip_drums: { K: "kick", S: "snare", h: "hat", O: "open hat" },
  gong: { G: "khong mong (hanging gong)" },
};

interface MoodStyle {
  rhythms: string[];
  /** Lead register (degrees). */
  lo: number;
  hi: number;
  leap: number;
  /** Ranat notes per beat. */
  counter: 2 | 4;
  /** Skeleton every n beats. */
  skel: 1 | 2;
  cycle: "slow" | "medium" | "fast";
  bass: "roots" | "walk" | "octave" | "pulse";
  /** Probability a note gets a glide on slide-capable instruments. */
  glide: number;
}

const CALM = ["x-------x-------", "x-----x-x-------", "x---x---x-------", "x-------x---x---", "x-----x---x-----"];
const WALK = ["x---x---x-x-x---", "x-x-x---x---x---", "x---x-x-x---x---", "x-x-x-x-x-------", "x---x---x---x-x-"];
const BUSY = ["x-x-x-x-x-xxx-x-", "x-xxx-x-x-x-x---", "xx-x-x-xx-x-x---", "x-x-x-x-x-x-x-x-", "x-x-xx-xx-x-x---"];
const FIGHT = ["x-x-xxx-x-x-xxx-", "xxx-x-x-xxx-x-x-", "x-xxx-xxx-xxx-x-", "x-x-x-x-xxxxx-x-"];
const JOGET = ["x--x--x-x--x--x-", "x-x--x-xx-x--x--", "x--x--x-x-x-x---", "x--x-xx-x--x-x--"];
const STATELY = ["x-----x-x---x---", "x---x---x-x-x---", "x-------x-x-x-x-", "x---x-----x-x---"];

export const MOOD_STYLE: Record<Mood, MoodStyle> = {
  village: { rhythms: WALK, lo: 0, hi: 8, leap: 0.12, counter: 2, skel: 1, cycle: "medium", bass: "roots", glide: 0.25 },
  market: { rhythms: BUSY, lo: 1, hi: 9, leap: 0.18, counter: 4, skel: 1, cycle: "fast", bass: "octave", glide: 0.15 },
  temple: { rhythms: CALM, lo: -1, hi: 6, leap: 0.05, counter: 2, skel: 2, cycle: "slow", bass: "roots", glide: 0.45 },
  night: { rhythms: CALM, lo: 0, hi: 7, leap: 0.1, counter: 2, skel: 2, cycle: "slow", bass: "roots", glide: 0.35 },
  river: { rhythms: WALK, lo: 0, hi: 7, leap: 0.08, counter: 2, skel: 1, cycle: "medium", bass: "roots", glide: 0.4 },
  festival: { rhythms: BUSY, lo: 2, hi: 10, leap: 0.2, counter: 4, skel: 1, cycle: "fast", bass: "walk", glide: 0.2 },
  songkran: { rhythms: BUSY, lo: 2, hi: 10, leap: 0.22, counter: 4, skel: 1, cycle: "fast", bass: "octave", glide: 0.15 },
  raya: { rhythms: JOGET, lo: 1, hi: 9, leap: 0.15, counter: 2, skel: 1, cycle: "medium", bass: "walk", glide: 0.3 },
  battle: { rhythms: FIGHT, lo: 0, hi: 9, leap: 0.25, counter: 4, skel: 1, cycle: "fast", bass: "pulse", glide: 0.05 },
  shop: { rhythms: WALK, lo: 2, hi: 9, leap: 0.15, counter: 2, skel: 1, cycle: "medium", bass: "walk", glide: 0.1 },
  title: { rhythms: STATELY, lo: 0, hi: 10, leap: 0.2, counter: 4, skel: 2, cycle: "medium", bass: "roots", glide: 0.3 },
  shrine: { rhythms: CALM.concat(STATELY), lo: 0, hi: 8, leap: 0.12, counter: 2, skel: 2, cycle: "slow", bass: "roots", glide: 0.3 },
};

/** Phrase labels for a loop of n phrases. */
export function formOf(n: number): string[] {
  const table: Record<number, string[]> = {
    1: ["A"],
    2: ["A", "B"],
    3: ["A", "A'", "B"],
    4: ["A", "A'", "B", "A''"],
    6: ["A", "A'", "B", "B'", "A", "A''"],
    8: ["A", "A'", "B", "A''", "C", "C'", "B", "A''"],
  };
  return table[n] ?? Array.from({ length: n }, (_, i) => (i === n - 1 ? "A''" : ["A", "A'", "B", "B'", "C"][i % 5]!));
}

const clampI = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Generate one phrase of lead notes (relative steps). Ends on `endDeg`. */
function phrase(seed: number, style: MoodStyle, bars: number, density: number, center: number, endDeg: number, motif?: NoteEv[]): NoteEv[] {
  const r = rng(seed);
  // denser moods / higher density pick from later (busier) templates
  const span = Math.max(1, Math.round(style.rhythms.length * (0.45 + density * 0.55)));
  const pool = style.rhythms.slice(0, span);
  const t0 = pick(r, pool);
  const t1 = pick(r, pool);
  const out: NoteEv[] = [];
  let deg = clampI(center + Math.round(r() * 4 - 2), style.lo, style.hi);
  for (let b = 0; b < bars; b++) {
    const last = b === bars - 1;
    // motif repetition: bar 2 echoes bar 0; final bar is a cadence (long last note)
    let tpl = b % 2 === 0 ? t0 : t1;
    if (last) tpl = tpl.slice(0, 8) + "x-------";
    if (motif && !last) {
      for (const n of motif.filter((m) => Math.floor(m.step / STEPS_PER_BAR) === b)) out.push({ ...n });
      if (out.length) deg = out[out.length - 1]!.deg;
      continue;
    }
    const onsets = [...tpl].map((c, i) => (c === "x" ? i : -1)).filter((i) => i >= 0);
    onsets.forEach((s, oi) => {
      const next = onsets[oi + 1] ?? STEPS_PER_BAR;
      const len = next - s;
      const isLast = last && oi === onsets.length - 1;
      if (isLast) deg = endDeg;
      else {
        const leap = r() < style.leap;
        const step = leap ? pick(r, [-3, 3, -4, 4, 5, -5]) : pick(r, [-2, -1, -1, 0, 1, 1, 2]);
        deg = clampI(deg + step, style.lo, style.hi);
        // strong beats lean on pillar notes (root and fifth)
        if (s % 8 === 0 && r() < 0.5) {
          const pc = ((deg % 5) + 5) % 5;
          if (pc !== 0 && pc !== 3) deg += pc < 3 ? (pc === 1 ? -1 : 1) : pc === 4 ? 1 : -1;
          deg = clampI(deg, style.lo, style.hi);
        }
      }
      const vel = s % 8 === 0 ? 1 : s % 4 === 0 ? 0.85 : 0.7;
      out.push({ step: b * STEPS_PER_BAR + s, len, deg, vel });
    });
  }
  return out;
}

/** The sounding lead degree at `step` (last onset at or before it). */
function soundingAt(notes: NoteEv[], step: number): number {
  let d = notes[0]?.deg ?? 0;
  for (const n of notes) {
    if (n.step <= step) d = n.deg;
    else break;
  }
  return d;
}

/** Fold a degree into [lo, hi] by octaves (5 degrees). */
const fold = (d: number, lo: number, hi: number) => {
  let x = d;
  while (x < lo) x += 5;
  while (x > hi) x -= 5;
  return x;
};

const ROLE_REGISTER: Record<string, [number, number]> = {
  skeleton: [-3, 3],
  counter: [3, 11],
  bass: [-12, -6],
  drone: [-8, -3],
  pad: [-3, 4],
};

/** Percussion pattern for one bar (16 chars, '.' = rest). */
function percBar(inst: PercInstrument, cycle: MoodStyle["cycle"], energy: number, r: () => number, fill: boolean, mood: Mood): string[] {
  const bar = (s: string) => [...s];
  switch (inst) {
    case "ching":
      if (cycle === "slow") return bar("....o.......c...");
      if (cycle === "medium") return bar("o...c...o...c...");
      return bar(fill ? "o.c.o.c.o.c.occc" : "o.c.o.c.o.c.o.c.");
    case "gong":
      return bar("G...............");
    case "klong_thon": {
      const pats =
        cycle === "slow"
          ? ["T.......t...t...", "T.......t.t.T..."]
          : cycle === "medium"
            ? ["t.t.T..t.tT.T...", "T..tt.T.t.t.T...", "t.T.t.T.t.ttT..."]
            : ["T.ttT.t.TtT.t.T.", "TtT.t.TtT.t.TtTt"];
      let p = pick(r, pats);
      if (energy > 0.7) p = p.replace(/\.(?=\.)/, "p");
      if (fill) p = p.slice(0, 8) + "tttpT.TT";
      return bar(p);
    }
    case "kompang": {
      // two interlocking parts folded into one line (k = pak slap, b = bung) + rebana bass on beat 1 / 3
      const a = mood === "raya" ? pick(r, ["b..k..k.b..k..k.", "b..k.kk.b..k.kk."]) : "b.k.b.k.b.k.b.k.";
      const b2 = pick(r, ["..k.k..k..k.k..k", ".k.k..k..k.k..k.", "..k..k.k..k..k.k"]);
      const out = bar(a);
      [...b2].forEach((c, i) => {
        if (c !== "." && out[i] === "." && r() < 0.55 + energy * 0.45) out[i] = c;
      });
      out[0] = "g";
      if (energy > 0.5) out[8] = out[8] === "." ? "g" : out[8]!;
      if (fill) [10, 11, 12, 13, 14, 15].forEach((i) => (out[i] = i % 2 ? "k" : "b"));
      return out;
    }
    default: {
      const pats =
        cycle === "slow"
          ? ["K.......S.......", "K.......S...h..."]
          : cycle === "medium"
            ? ["K.h.S.h.K.h.S.h.", "K.h.S.h.K.KhS.h."]
            : ["K.hKS.hhK.hKS.hO", "KhhhShhhKhKhShhO", "K.KhS.hhK.KhShSh"];
      let p = pick(r, pats);
      if (energy < 0.35) p = p.replace(/h/g, ".");
      if (fill) p = p.slice(0, 8) + "SSSSKSSS".slice(0, 4) + "SSSO";
      return bar(p);
    }
  }
}

const isPerc = (inst: string): inst is PercInstrument => (PERC as readonly string[]).includes(inst);

/** Compose the full score. Pure and deterministic. */
export function compose(p: MusicParams): Score {
  const style = MOOD_STYLE[p.mood];
  const stepSec = 60 / p.bpm / STEPS_PER_BEAT;
  const phraseBars = p.bars <= 4 ? 2 : 4;
  const nPhr = Math.max(1, Math.round(p.bars / phraseBars));
  const form = formOf(nPhr);
  const introSteps = p.introBars * STEPS_PER_BAR;
  const loopSteps = p.bars * STEPS_PER_BAR;
  const center = Math.round((style.lo + style.hi) / 2);

  // ---- lead melody: one generated phrase per distinct letter, variants re-end / re-roll the last bar ----
  const lead: NoteEv[] = [];
  const motifs = new Map<string, NoteEv[]>();
  form.forEach((label, i) => {
    const letter = label[0]!;
    const lastPhrase = i === form.length - 1;
    const endDeg = lastPhrase ? fold(0, style.lo, style.hi + 2) : label.length === 1 ? fold(3, style.lo, style.hi) : fold(i % 2 ? 1 : 3, style.lo, style.hi);
    const ctr = letter === "B" ? center + 2 : letter === "C" ? center - 1 : center;
    const base = motifs.get(letter);
    const notes = phrase(subSeed(p.seed, `lead:${label}:${i}`), style, phraseBars, p.density, ctr, endDeg, base);
    if (!base) motifs.set(letter, notes);
    for (const n of notes) lead.push({ ...n, step: n.step + introSteps + i * phraseBars * STEPS_PER_BAR });
  });
  // intro: a pickup that climbs to the first note in the last intro bar
  const intro: NoteEv[] = [];
  if (p.introBars > 0 && lead.length) {
    const target = lead[0]!.deg;
    const r = rng(subSeed(p.seed, "intro"));
    const start = introSteps - 8;
    for (let i = 0; i < 4; i++) intro.push({ step: start + i * 2, len: 2, deg: target - 4 + i + (r() < 0.3 ? 1 : 0), vel: 0.6 + i * 0.1 });
  }
  const leadAll = [...intro, ...lead];

  // skeleton degrees per beat over the loop (wraps so the last beat leads into the first)
  const beats = p.bars * BEATS_PER_BAR;
  const skelDeg = (beat: number) => soundingAt(lead, introSteps + (((beat % beats) + beats) % beats) * STEPS_PER_BEAT);

  const layers: LayerScore[] = p.layers.map((layer, index) => {
    const notes: NoteEv[] = [];
    const hits: HitEv[] = [];
    const oct = (layer.octave ?? 0) * 5;
    const r = rng(subSeed(p.seed, `layer:${index}:${layer.role}:${layer.instrument}`));
    if (layer.mute) return { index, layer, notes, hits };
    if (layer.role === "perc" || isPerc(layer.instrument)) {
      const inst = (isPerc(layer.instrument) ? layer.instrument : "chip_drums") as PercInstrument;
      const totalBars = p.introBars + p.bars;
      for (let b = 0; b < totalBars; b++) {
        const inLoop = b - p.introBars;
        if (inst === "gong" && (inLoop < 0 ? b !== 0 : inLoop % phraseBars !== 0)) continue;
        const fill = inLoop === p.bars - 1 || (inLoop >= 0 && inLoop % (phraseBars * 2) === phraseBars * 2 - 1 && p.energy > 0.6);
        const pat = percBar(inst, style.cycle, p.energy, r, fill, p.mood);
        pat.forEach((tok, s) => {
          if (tok === ".") return;
          const vel = (s % 8 === 0 ? 1 : s % 4 === 0 ? 0.82 : 0.66) * (0.7 + 0.3 * p.energy) * (0.94 + r() * 0.12);
          hits.push({ step: b * STEPS_PER_BAR + s, tok, vel: Math.min(1, vel) });
        });
      }
      return { index, layer, notes, hits };
    }
    switch (layer.role) {
      case "lead":
        leadAll.forEach((n, i) => {
          const prev = leadAll[i - 1];
          const glide = prev && prev.step + prev.len === n.step && prev.deg !== n.deg && r() < style.glide ? prev.deg + oct : undefined;
          notes.push({ ...n, deg: n.deg + oct, ...(glide !== undefined ? { from: glide } : {}) });
        });
        break;
      case "skeleton": {
        const [lo, hi] = ROLE_REGISTER.skeleton!;
        for (let beat = 0; beat < beats; beat += style.skel) {
          const d = fold(skelDeg(beat), lo, hi) + oct;
          const step = introSteps + beat * STEPS_PER_BEAT;
          notes.push({ step, len: style.skel * STEPS_PER_BEAT, deg: d, vel: beat % 4 === 0 ? 0.95 : 0.75 });
          // khong wong doubles in octaves on strong beats
          if (beat % 4 === 0) notes.push({ step, len: style.skel * STEPS_PER_BEAT, deg: d - 5, vel: 0.6 });
        }
        if (p.introBars) for (let beat = 0; beat < p.introBars * 4; beat += 2) notes.push({ step: beat * STEPS_PER_BEAT, len: 8, deg: fold(beat % 4 ? 3 : 0, lo, hi) + oct, vel: 0.7 });
        break;
      }
      case "counter": {
        const [lo, hi] = ROLE_REGISTER.counter!;
        const n = style.counter;
        const per = STEPS_PER_BEAT / n;
        for (let beat = 0; beat < beats; beat++) {
          const target = fold(skelDeg(beat + 1), lo, hi);
          const from = fold(skelDeg(beat), lo, hi);
          const shape = pick(r, ["run", "turn", "octave", "run", "rest"]);
          let seq: number[];
          if (shape === "run") {
            const dir = target >= from ? 1 : -1;
            seq = Array.from({ length: n }, (_, i) => target - dir * (n - 1 - i));
          } else if (shape === "turn") seq = Array.from({ length: n }, (_, i) => target + [1, 0, -1, 0][(i + 4 - n) % 4]!);
          else if (shape === "octave") seq = Array.from({ length: n }, (_, i) => (i % 2 ? target : target - 5));
          else seq = Array.from({ length: n }, (_, i) => (i === n - 1 ? target : Number.NaN));
          seq.forEach((d, i) => {
            if (Number.isNaN(d)) return;
            notes.push({ step: introSteps + beat * STEPS_PER_BEAT + i * per, len: per, deg: fold(d, lo - 2, hi + 2) + oct, vel: i === n - 1 ? 0.9 : 0.68 });
          });
        }
        break;
      }
      case "bass": {
        const [lo, hi] = ROLE_REGISTER.bass!;
        const totalBeats = p.introBars * 4 + beats;
        for (let gb = 0; gb < totalBeats; gb++) {
          const inIntro = gb < p.introBars * 4;
          const beat = gb - p.introBars * 4;
          const root = inIntro ? fold(0, lo, hi) : fold(skelDeg(beat - (beat % 2)), lo, hi);
          const step = gb * STEPS_PER_BEAT;
          if (style.bass === "roots") {
            if (gb % 2 === 0) notes.push({ step, len: 8, deg: root + oct, vel: gb % 4 === 0 ? 1 : 0.8 });
          } else if (style.bass === "octave") {
            notes.push({ step, len: 2, deg: root + oct, vel: 0.95 }, { step: step + 2, len: 2, deg: root + 5 + oct, vel: 0.7 });
          } else if (style.bass === "pulse") {
            for (let i = 0; i < 4; i += 2) notes.push({ step: step + i, len: 2, deg: root + oct, vel: i ? 0.75 : 1 });
          } else {
            const walk = [0, 3, 5, 2][gb % 4]!;
            notes.push({ step, len: 4, deg: fold(root + walk, lo, hi + 3) + oct, vel: gb % 2 ? 0.8 : 1 });
          }
        }
        break;
      }
      case "drone": {
        const [lo] = ROLE_REGISTER.drone!;
        const span = phraseBars * STEPS_PER_BAR;
        const total = introSteps + loopSteps;
        for (let s = 0; s < total; s += span) {
          const len = Math.min(span, total - s);
          notes.push({ step: s, len, deg: fold(0, lo, lo + 5) + oct, vel: 0.9 }, { step: s, len, deg: fold(3, lo, lo + 5) + oct, vel: 0.7 });
        }
        break;
      }
      case "pad": {
        const [lo, hi] = ROLE_REGISTER.pad!;
        for (let bar = 0; bar < p.bars; bar++) {
          const root = fold(skelDeg(bar * 4), lo, hi);
          const step = introSteps + bar * STEPS_PER_BAR;
          for (const add of [0, 2, 4]) notes.push({ step, len: STEPS_PER_BAR, deg: root + add + oct, vel: add ? 0.6 : 0.8 });
        }
        if (p.introBars) for (const add of [0, 2, 4]) notes.push({ step: 0, len: introSteps, deg: fold(0, lo, hi) + add + oct, vel: 0.6 });
        break;
      }
    }
    notes.sort((a, b) => a.step - b.step || a.deg - b.deg);
    return { index, layer, notes, hits };
  });

  return { stepSec, introSteps, loopSteps, totalSteps: introSteps + loopSteps, form, phraseBars, layers };
}
