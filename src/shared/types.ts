/** Easy Music shared types: the `easymusic/1` song format. Pure data, usable in Node and the browser. */

export const FORMAT = "easymusic/1";
export const SAMPLE_RATE = 44100;
export const BEATS_PER_BAR = 4;
/** Generator grid: 4 steps per beat (16th notes). */
export const STEPS_PER_BEAT = 4;

/** Five rotations of the anhemitonic pentatonic (the five-note scale of Thai melodies). */
export const MODES = ["do", "re", "mi", "sol", "la"] as const;
export type ModeId = (typeof MODES)[number];

/** `equal12` = Western 12-tone tuning (chiptune friendly); `thai7` = Thai 7-tone equal temperament (~171 cents a step). */
export const TUNINGS = ["equal12", "thai7"] as const;
export type Tuning = (typeof TUNINGS)[number];

export const KEYS = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"] as const;
export type Key = (typeof KEYS)[number];

/** Moods steer rhythm templates, melody range, density and the percussion cycle. */
export const MOODS = ["village", "market", "temple", "night", "river", "festival", "songkran", "raya", "battle", "shop", "title", "shrine"] as const;
export type Mood = (typeof MOODS)[number];

/** What a layer plays. */
export const ROLES = ["lead", "counter", "skeleton", "bass", "drone", "pad", "perc"] as const;
export type Role = (typeof ROLES)[number];

/** Tonal instruments (all synthesized from code; there is no vocal or chant voice). */
export const TONAL = ["ranat", "khong_wong", "saw", "khim", "pi", "chip_square", "chip_pulse", "chip_triangle", "synth_pad", "synth_bass", "flute"] as const;
export type TonalInstrument = (typeof TONAL)[number];

/** Percussion sets (each plays its own pattern family). */
export const PERC = ["ching", "klong_thon", "kompang", "chip_drums", "gong"] as const;
export type PercInstrument = (typeof PERC)[number];

export const INSTRUMENTS = [...TONAL, ...PERC] as const;
export type InstrumentId = (typeof INSTRUMENTS)[number];

export interface Layer {
  role: Role;
  instrument: InstrumentId;
  /** 0..1.5 */
  volume: number;
  /** Octave shift −3..3 relative to the role's default register. */
  octave?: number;
  /** -1 (left) .. 1 (right); exports are stereo. */
  pan?: number;
  mute?: boolean;
  /** Optional label shown in the editor. */
  name?: string;
}

export interface MusicParams {
  mood: Mood;
  mode: ModeId;
  key: Key;
  tuning: Tuning;
  /** Beats per minute 50..200. */
  bpm: number;
  /** Loop length in 4/4 bars (4, 8, 12, 16, 24 or 32). */
  bars: number;
  /** Bars played once before the loop starts (0..4); the loop point sits after them. */
  introBars: number;
  /** uint32 seed: same seed, same song, byte for byte. */
  seed: number;
  /** 0 (straight) .. 0.5 (heavy shuffle) on off-beat 8ths. */
  swing: number;
  /** 0..1: how busy the melody is. */
  density: number;
  /** 0..1: how hard the percussion plays. */
  energy: number;
  /** Master gain 0..1 (after normalisation). */
  gain: number;
  layers: Layer[];
}

export const CATEGORIES = ["field", "town", "calm", "night", "festival", "battle", "menu"] as const;
export type Category = (typeof CATEGORIES)[number];

/** A built-in preset. */
export interface Preset {
  id: string;
  th: string;
  en: string;
  category: Category;
  tags: string[];
  params: MusicParams;
}

/** Workspace file `songs/<id>.easymusic.json`. */
export interface SongDoc {
  format: typeof FORMAT;
  th?: string;
  en?: string;
  category?: Category;
  tags?: string[];
  base?: string;
  params?: MusicParams;
  set?: Record<string, unknown>;
}

export interface ResolvedSong {
  id: string;
  th: string;
  en: string;
  category: Category;
  tags: string[];
  source: "preset" | "workspace";
  params: MusicParams;
}

export interface Diagnostic {
  path: string;
  message: string;
  severity: "error" | "warning";
}

export const EXPORT_PRESETS = ["godot", "web", "audio", "json", "all"] as const;
