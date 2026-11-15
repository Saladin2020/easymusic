/** Scales, tuning and the seeded PRNG. */
import { KEYS, type Key, type ModeId, type Tuning } from "./types.js";

/** Deterministic PRNG (mulberry32, same as Easy SFX). Same seed → same numbers on every platform. */
export function rng(seed: number): () => number {
  let a = (seed >>> 0) ^ 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Derive an independent stream for a sub-task, so changing one layer never reshuffles another. */
export function subSeed(seed: number, salt: string): number {
  let h = (seed >>> 0) ^ 0x811c9dc5;
  for (let i = 0; i < salt.length; i++) {
    h ^= salt.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length) % xs.length]!;

/** Semitone offsets of each pentatonic rotation in 12-tone tuning. */
export const MODE_12: Record<ModeId, number[]> = {
  do: [0, 2, 4, 7, 9],
  re: [0, 2, 5, 7, 10],
  mi: [0, 3, 5, 8, 10],
  sol: [0, 2, 5, 7, 9],
  la: [0, 3, 5, 7, 10],
};

/** The same rotations as steps of Thai 7-tone equal temperament (5 of the 7 pitches; gaps 1-1-2-1-2). */
export const MODE_7: Record<ModeId, number[]> = {
  do: [0, 1, 2, 4, 5],
  re: [0, 1, 3, 4, 6],
  mi: [0, 2, 3, 5, 6],
  sol: [0, 1, 3, 4, 5],
  la: [0, 2, 3, 4, 6],
};

export const MODE_LABELS: Record<ModeId, { th: string; en: string }> = {
  do: { th: "1-2-3-5-6 สดใส", en: "bright (do: 1 2 3 5 6)" },
  re: { th: "1-2-4-5-♭7 ลอย ๆ", en: "open (re: 1 2 4 5 ♭7)" },
  mi: { th: "1-♭3-4-♭6-♭7 หม่น", en: "dark (mi: 1 ♭3 4 ♭6 ♭7)" },
  sol: { th: "1-2-4-5-6 พื้นบ้าน", en: "folk (sol: 1 2 4 5 6)" },
  la: { th: "1-♭3-4-5-♭7 เศร้า ลึกลับ", en: "minor (la: 1 ♭3 4 5 ♭7)" },
};

const KEY_SEMI: Record<Key, number> = Object.fromEntries(KEYS.map((k, i) => [k, i])) as Record<Key, number>;

/** MIDI note of the key root in octave 4 (C4 = 60). */
export const keyRootMidi = (key: Key) => 60 + KEY_SEMI[key];

export const midiToHz = (m: number) => 440 * 2 ** ((m - 69) / 12);

/**
 * Frequency of pentatonic degree `deg` (0 = key root in octave 4; 5 = one octave up; negative = below).
 * `cents` adds a bend (used for slides / scoops).
 */
export function degreeHz(deg: number, key: Key, mode: ModeId, tuning: Tuning, cents = 0): number {
  const oct = Math.floor(deg / 5);
  const d = ((deg % 5) + 5) % 5;
  const root = midiToHz(keyRootMidi(key));
  const c = tuning === "thai7" ? (MODE_7[mode][d]! * 1200) / 7 : MODE_12[mode][d]! * 100;
  return root * 2 ** (oct + (c + cents) / 1200);
}

/** Note name of a degree in 12-tone tuning (for the editor's piano roll). */
export function degreeName(deg: number, key: Key, mode: ModeId): string {
  const oct = Math.floor(deg / 5);
  const d = ((deg % 5) + 5) % 5;
  const midi = keyRootMidi(key) + MODE_12[mode][d]! + oct * 12;
  const names = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
  return `${names[midi % 12]}${Math.floor(midi / 12) - 1}`;
}
