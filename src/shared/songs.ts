/** Validation, `--set` overrides and preset/workspace resolution. Pure, shared by every surface. */
import { PRESETS, presetById } from "./presets.js";
import { CATEGORIES, FORMAT, INSTRUMENTS, KEYS, MODES, MOODS, PERC, ROLES, TUNINGS, type Diagnostic, type MusicParams, type ResolvedSong, type SongDoc } from "./types.js";

export const SAFE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
export const TOP_KEYS = ["mood", "mode", "key", "tuning", "bpm", "bars", "introBars", "seed", "swing", "density", "energy", "gain"] as const;
export const BAR_CHOICES = [4, 8, 12, 16, 24, 32];
/** Words that must never name a layer or song: Easy Music has no vocal, adhan or chant voice. */
const FORBIDDEN = /\b(adhan|azan|athan|quran|qur'an|recitation|tilawah|chant|chanting|vocal|voice|sing|singer)\b/i;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export function validateParams(raw: unknown, base = "params"): { errors: Diagnostic[]; warnings: Diagnostic[] } {
  const errors: Diagnostic[] = [];
  const warnings: Diagnostic[] = [];
  const e = (path: string, message: string) => errors.push({ path, message, severity: "error" });
  const w = (path: string, message: string) => warnings.push({ path, message, severity: "warning" });
  if (!isObj(raw)) return { errors: [{ path: base, message: "must be an object", severity: "error" }], warnings };
  const num = (o: Obj, k: string, path: string, min: number, max: number, opts: { int?: boolean; optional?: boolean } = {}) => {
    const v = o[k];
    if (v === undefined) {
      if (!opts.optional) e(`${path}.${k}`, "is required");
      return;
    }
    if (typeof v !== "number" || !Number.isFinite(v)) return e(`${path}.${k}`, "must be a number");
    if (opts.int && !Number.isInteger(v)) return e(`${path}.${k}`, "must be an integer");
    if (v < min || v > max) e(`${path}.${k}`, `must be between ${min} and ${max}`);
  };
  const oneOf = (o: Obj, k: string, path: string, list: readonly string[]) => {
    if (!list.includes(o[k] as string)) e(`${path}.${k}`, `unknown ${k} ${JSON.stringify(o[k])} (${list.join(", ")})`);
  };
  oneOf(raw, "mood", base, MOODS);
  oneOf(raw, "mode", base, MODES);
  oneOf(raw, "key", base, KEYS);
  oneOf(raw, "tuning", base, TUNINGS);
  num(raw, "bpm", base, 50, 200);
  num(raw, "bars", base, 4, 32, { int: true });
  if (typeof raw.bars === "number" && !BAR_CHOICES.includes(raw.bars)) e(`${base}.bars`, `must be one of ${BAR_CHOICES.join(", ")}`);
  num(raw, "introBars", base, 0, 4, { int: true });
  num(raw, "seed", base, 0, 4294967295, { int: true });
  num(raw, "swing", base, 0, 0.5);
  num(raw, "density", base, 0, 1);
  num(raw, "energy", base, 0, 1);
  num(raw, "gain", base, 0, 1);
  if (!Array.isArray(raw.layers) || raw.layers.length < 1 || raw.layers.length > 8) {
    e(`${base}.layers`, "must be 1-8 layers");
    return { errors, warnings };
  }
  raw.layers.forEach((l: unknown, i: number) => {
    const p = `${base}.layers[${i}]`;
    if (!isObj(l)) return e(p, "must be an object");
    oneOf(l, "role", p, ROLES);
    oneOf(l, "instrument", p, INSTRUMENTS);
    num(l, "volume", p, 0, 1.5);
    num(l, "octave", p, -3, 3, { int: true, optional: true });
    num(l, "pan", p, -1, 1, { optional: true });
    if (l.mute !== undefined && typeof l.mute !== "boolean") e(`${p}.mute`, "must be true or false");
    if (l.name !== undefined && (typeof l.name !== "string" || FORBIDDEN.test(l.name))) e(`${p}.name`, "must be a plain label (Easy Music has no vocal, adhan or chant voice)");
    const perc = (PERC as readonly string[]).includes(l.instrument as string);
    if (perc && l.role !== "perc") e(`${p}.role`, `${String(l.instrument)} is percussion: use role "perc"`);
    if (!perc && l.role === "perc" && (INSTRUMENTS as readonly string[]).includes(l.instrument as string)) e(`${p}.instrument`, `role "perc" needs a percussion set (${PERC.join(", ")})`);
  });
  const roles = (raw.layers as Obj[]).filter(isObj).map((l) => l.role);
  if (!roles.includes("lead")) w(`${base}.layers`, "no lead layer: the song will have no melody");
  const secs = typeof raw.bpm === "number" && typeof raw.bars === "number" ? ((raw.bars + Number(raw.introBars ?? 0)) * 4 * 60) / raw.bpm : 0;
  if (secs > 120) w(`${base}.bars`, `${secs.toFixed(0)} s is a long loop; fine, but slower to render`);
  return { errors, warnings };
}

/** Parse a CLI `key=value`; values are JSON when they parse, else strings. */
export function parseSet(arg: string): [string, unknown] {
  const i = arg.indexOf("=");
  if (i <= 0) throw new Error(`--set expects key=value, got ${JSON.stringify(arg)}`);
  const k = arg.slice(0, i).trim();
  const raw = arg.slice(i + 1).trim();
  let v: unknown = raw;
  try {
    v = JSON.parse(raw);
  } catch {
    /* plain string */
  }
  return [k, v];
}

/**
 * Apply one override. `bpm`, `seed`, `mode` … → top level; `2.instrument` → layer 2;
 * `lead.instrument` → every layer with that role; `*.volume` → every layer.
 */
export function applySet(p: MusicParams, key: string, value: unknown): void {
  const parts = key.split(".");
  if (parts.length === 1) {
    if (!(TOP_KEYS as readonly string[]).includes(parts[0]!)) throw new Error(`--set ${key}: unknown field (top level: ${TOP_KEYS.join(", ")}; layers: <n>.field, <role>.field, *.field)`);
    (p as unknown as Obj)[parts[0]!] = value;
    return;
  }
  const [sel, field] = [parts[0]!, parts.slice(1).join(".")];
  let targets: Obj[];
  if (/^\d+$/.test(sel)) {
    const l = p.layers[Number(sel)];
    if (!l) throw new Error(`--set ${key}: no layer ${sel} (have 0-${p.layers.length - 1})`);
    targets = [l as unknown as Obj];
  } else if (sel === "*") targets = p.layers as unknown as Obj[];
  else if ((ROLES as readonly string[]).includes(sel)) {
    targets = (p.layers as unknown as Obj[]).filter((l) => l.role === sel);
    if (!targets.length) throw new Error(`--set ${key}: no ${sel} layer`);
  } else throw new Error(`--set ${key}: "${sel}" is not a layer index, role (${ROLES.join(", ")}) or *`);
  for (const t of targets) t[field] = value;
}

export function validateDoc(raw: unknown): { errors: Diagnostic[]; warnings: Diagnostic[] } {
  const errors: Diagnostic[] = [];
  if (!isObj(raw)) return { errors: [{ path: "", message: "song file must be a JSON object", severity: "error" }], warnings: [] };
  if (raw.format !== FORMAT) errors.push({ path: "format", message: `must be "${FORMAT}"`, severity: "error" });
  if (raw.base !== undefined && !presetById(String(raw.base))) errors.push({ path: "base", message: `unknown preset ${JSON.stringify(raw.base)} (try: easymusic list)`, severity: "error" });
  if (raw.base === undefined && raw.params === undefined) errors.push({ path: "params", message: "needs params or a base preset", severity: "error" });
  if (raw.category !== undefined && !(CATEGORIES as readonly string[]).includes(raw.category as string)) errors.push({ path: "category", message: `one of ${CATEGORIES.join(", ")}`, severity: "error" });
  if (raw.set !== undefined && !isObj(raw.set)) errors.push({ path: "set", message: "must be an object of key → value", severity: "error" });
  for (const k of ["th", "en"] as const) if (typeof raw[k] === "string" && FORBIDDEN.test(raw[k] as string)) errors.push({ path: k, message: "Easy Music makes instrumental loops only: no adhan, Quran recitation, chant or vocals", severity: "error" });
  return { errors, warnings: [] };
}

/** Resolve a workspace doc (base preset → params → set) and validate the result. */
export function resolveDoc(id: string, raw: unknown): { song?: ResolvedSong; errors: Diagnostic[]; warnings: Diagnostic[] } {
  const v = validateDoc(raw);
  if (v.errors.length) return v;
  const doc = raw as SongDoc;
  const base = doc.base ? presetById(doc.base) : undefined;
  const params = clone((doc.params ?? base?.params) as MusicParams);
  const errors: Diagnostic[] = [];
  for (const [k, val] of Object.entries(doc.set ?? {})) {
    try {
      applySet(params, k, val);
    } catch (e) {
      errors.push({ path: `set.${k}`, message: (e as Error).message, severity: "error" });
    }
  }
  const pv = validateParams(params);
  errors.push(...pv.errors);
  if (errors.length) return { errors, warnings: pv.warnings };
  return {
    song: { id, th: doc.th ?? base?.th ?? id, en: doc.en ?? base?.en ?? id, category: doc.category ?? base?.category ?? "field", tags: doc.tags ?? base?.tags ?? [], source: "workspace", params },
    errors: [],
    warnings: pv.warnings,
  };
}

export function presetSong(id: string): ResolvedSong | undefined {
  const p = presetById(id);
  return p && { id: p.id, th: p.th, en: p.en, category: p.category, tags: p.tags, source: "preset", params: clone(p.params) };
}

export function allPresetSongs(): ResolvedSong[] {
  return PRESETS.map((p) => presetSong(p.id)!);
}

export function withOverrides(s: ResolvedSong, sets: Array<[string, unknown]>): ResolvedSong {
  const params = clone(s.params);
  for (const [k, v] of sets) applySet(params, k, v);
  const pv = validateParams(params);
  if (pv.errors.length) throw new Error(pv.errors.map((d) => `${d.path}: ${d.message}`).join("\n"));
  return { ...s, params };
}

/** Loop timing without rendering. */
export function timing(p: MusicParams, sampleRate = 44100) {
  const stepSec = 60 / p.bpm / 4;
  const introSteps = p.introBars * 16;
  const totalSteps = introSteps + p.bars * 16;
  const loopStart = Math.round(introSteps * stepSec * sampleRate);
  const loopEnd = Math.round(totalSteps * stepSec * sampleRate);
  return { seconds: loopEnd / sampleRate, loopStartSec: loopStart / sampleRate, loopStart, loopEnd, beatSec: 60 / p.bpm };
}

export function songSummary(s: ResolvedSong) {
  const p = s.params;
  const t = timing(p);
  return {
    id: s.id, th: s.th, en: s.en, category: s.category, tags: s.tags, source: s.source,
    mood: p.mood, mode: p.mode, key: p.key, tuning: p.tuning, bpm: p.bpm, bars: p.bars, introBars: p.introBars, seed: p.seed,
    seconds: +t.seconds.toFixed(3), loopStartSec: +t.loopStartSec.toFixed(3),
    layers: p.layers.map((l) => `${l.role}:${l.instrument}${l.mute ? " (muted)" : ""}`),
  };
}
