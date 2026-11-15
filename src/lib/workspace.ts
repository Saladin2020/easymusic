import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { SAFE_ID, allPresetSongs, presetSong, resolveDoc, songSummary } from "../shared/songs.js";
import { PRESETS } from "../shared/presets.js";
import type { Diagnostic, ResolvedSong } from "../shared/types.js";
import { EXPORT_PRESETS } from "../shared/types.js";
import { pkgRoot } from "./assets.js";

export const CONFIG_NAME = "easymusic.config.json";
export const DOC_EXT = ".easymusic.json";

export interface EasyMusicConfig {
  name: string;
  /** Also write .ogg (Vorbis) next to every .wav when ffmpeg is available. */
  ogg: boolean;
}

export const DEFAULT_CONFIG: EasyMusicConfig = { name: "Easy Music Workspace", ogg: true };

export function assertSafeId(id: unknown, label = "id"): string {
  if (typeof id !== "string" || !SAFE_ID.test(id)) throw new Error(`Invalid ${label} ${JSON.stringify(id)} (use a-z, 0-9, _ or -)`);
  return id;
}

export function resolveWorkspace(dir = process.cwd()): string {
  return path.resolve(dir);
}

export const dirs = (root: string) => ({
  songs: path.join(root, "songs"),
  exports: path.join(root, "exports"),
});

/** Writes outside the workspace must be inside one of these (env, `:`-separated). */
export function allowedRoots(root: string): string[] {
  const extra = (process.env.EASYMUSIC_ALLOWED_DIRS ?? "").split(path.delimiter).map((s) => s.trim()).filter(Boolean).map((p) => path.resolve(p));
  return [path.resolve(root), ...extra];
}

export function resolveInside(root: string, p: string): string {
  const abs = path.resolve(root, p);
  const ok = allowedRoots(root).some((r) => abs === r || abs.startsWith(r + path.sep));
  if (!ok) throw new Error(`Path ${p} is outside the workspace (allow it with EASYMUSIC_ALLOWED_DIRS)`);
  return abs;
}

export async function initWorkspace(dir = process.cwd(), opts: { force?: boolean } = {}): Promise<string> {
  const root = resolveWorkspace(dir);
  const d = dirs(root);
  for (const p of Object.values(d)) await mkdir(p, { recursive: true });
  const cfg = path.join(root, CONFIG_NAME);
  if (!existsSync(cfg) || opts.force) await writeFile(cfg, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`);
  const src = path.join(pkgRoot, "samples", "songs");
  for (const f of await readdir(src)) {
    const dest = path.join(d.songs, f);
    if (!existsSync(dest) || opts.force) await copyFile(path.join(src, f), dest);
  }
  return root;
}

export async function loadConfig(root: string): Promise<EasyMusicConfig> {
  const f = path.join(root, CONFIG_NAME);
  if (!existsSync(f)) return DEFAULT_CONFIG;
  return { ...DEFAULT_CONFIG, ...(JSON.parse(await readFile(f, "utf8")) as Partial<EasyMusicConfig>) };
}

export function docPath(root: string, id: string): string {
  return path.join(dirs(root).songs, `${assertSafeId(id, "song id")}${DOC_EXT}`);
}

export async function readDocRaw(root: string, id: string): Promise<unknown | undefined> {
  const f = docPath(root, id);
  if (!existsSync(f)) return undefined;
  return JSON.parse(await readFile(f, "utf8"));
}

export interface BrokenDoc {
  id: string;
  file: string;
  errors: Diagnostic[];
}

/** Built-in presets + workspace songs (a workspace file with a preset's id replaces it). */
export async function listSongs(root: string): Promise<{ songs: ResolvedSong[]; broken: BrokenDoc[] }> {
  const byId = new Map(allPresetSongs().map((e) => [e.id, e]));
  const broken: BrokenDoc[] = [];
  const d = dirs(root).songs;
  if (existsSync(d)) {
    for (const f of (await readdir(d)).sort()) {
      if (!f.endsWith(DOC_EXT)) continue;
      const id = f.slice(0, -DOC_EXT.length);
      if (!SAFE_ID.test(id)) continue;
      const file = path.join(d, f);
      let raw: unknown;
      try {
        raw = JSON.parse(await readFile(file, "utf8"));
      } catch (e) {
        broken.push({ id, file, errors: [{ path: "", message: `invalid JSON: ${(e as Error).message}`, severity: "error" }] });
        continue;
      }
      const r = resolveDoc(id, raw);
      if (r.song) byId.set(id, r.song);
      else broken.push({ id, file, errors: r.errors });
    }
  }
  return { songs: [...byId.values()], broken };
}

export async function loadSong(root: string, id: string): Promise<ResolvedSong> {
  assertSafeId(id, "song id");
  const raw = await readDocRaw(root, id);
  if (raw === undefined) {
    const p = presetSong(id);
    if (!p) throw new Error(`Song "${id}" not found (presets: ${PRESETS.length}; try: easymusic list)`);
    return p;
  }
  const r = resolveDoc(id, raw);
  if (!r.song) throw new Error(`Song "${id}" has ${r.errors.length} error(s):\n${r.errors.slice(0, 6).map((e) => `  ${e.path}: ${e.message}`).join("\n")}`);
  return r.song;
}

export async function saveSongDoc(root: string, id: string, raw: unknown, opts: { dryRun?: boolean } = {}) {
  const file = docPath(root, id);
  const r = resolveDoc(id, raw);
  if (opts.dryRun || r.errors.length) return { file, saved: false, errors: r.errors, warnings: r.warnings };
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(raw, null, 2)}\n`);
  return { file, saved: true, errors: r.errors, warnings: r.warnings };
}

export async function workspaceSummary(root: string) {
  const { songs, broken } = await listSongs(root);
  return {
    root,
    config: await loadConfig(root),
    ...dirs(root),
    songs: songs.map(songSummary),
    broken,
    presets: PRESETS.length,
    workspaceSongs: songs.filter((e) => e.source === "workspace").length,
    exportPresets: EXPORT_PRESETS,
  };
}
