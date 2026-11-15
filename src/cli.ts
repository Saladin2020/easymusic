#!/usr/bin/env node
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { serve } from "@hono/node-server";
import { Command } from "commander";
import open from "open";
import { createApp, defaultWebRoot } from "./server/app.js";
import { resolveToken } from "./shared/requestGuard.js";
import { parseSet, resolveDoc, songSummary, validateParams, withOverrides } from "./shared/songs.js";
import { PRESETS, presetById } from "./shared/presets.js";
import { MODE_LABELS } from "./shared/theory.js";
import { FORMAT, INSTRUMENTS, MODES, MOODS, ROLES, TUNINGS } from "./shared/types.js";
import { render, stats, waveformPng, writeAudio } from "./lib/audio.js";
import { EXPORT_PRESETS, exportMusic, type ExportPreset } from "./lib/export.js";
import { assertSafeId, dirs, docPath, initWorkspace, listSongs, loadConfig, loadSong, resolveWorkspace, workspaceSummary } from "./lib/workspace.js";

const program = new Command();

function workspaceOf(cli?: string): string {
  const v = cli?.trim() || process.env.EASYMUSIC_HOME?.trim() || process.env.EASYMUSIC_WORKSPACE?.trim() || process.cwd();
  return resolveWorkspace(v);
}

const fail = (e: unknown) => {
  console.error(`error: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
};

const collect = (v: string, prev: string[]) => [...prev, v];
const list = (v?: string) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : undefined);

program.name("easymusic").description("Seeded, seamlessly looping Thai game music → WAV / OGG with loop points, Godot 4.3+ and web / PixiJS").version("0.1.0");

program
  .command("init")
  .description("Create songs/ exports/ with three sample workspace songs")
  .option("--force", "Overwrite samples and config")
  .option("--workspace <path>", "Workspace directory")
  .action(async (o: { force?: boolean; workspace?: string }) => {
    const root = await initWorkspace(workspaceOf(o.workspace), { force: o.force });
    console.log(`Initialized Easy Music workspace at ${root}`);
    console.log(`  songs/     <id>.easymusic.json (base preset + overrides, or full params) — ${PRESETS.length} built-in presets need no file`);
    console.log("  exports/   Godot / web / audio / JSON exports");
  });

program
  .command("info")
  .description("Workspace summary")
  .option("--workspace <path>")
  .option("--json")
  .action(async (o: { workspace?: string; json?: boolean }) => {
    const s = await workspaceSummary(workspaceOf(o.workspace));
    if (o.json) return console.log(JSON.stringify(s, null, 2));
    console.log(`Easy Music workspace ${s.root}`);
    console.log(`  ${s.presets} presets + ${s.workspaceSongs} workspace songs · ogg ${s.config.ogg ? "on" : "off"}${s.broken.length ? ` · ${s.broken.length} broken: ${s.broken.map((b) => b.id).join(", ")}` : ""}`);
    console.log(`  moods: ${MOODS.join(", ")}`);
    console.log(`  modes: ${MODES.map((m) => `${m} (${MODE_LABELS[m].en})`).join(", ")} · tunings: ${TUNINGS.join(", ")}`);
    console.log(`  roles: ${ROLES.join(", ")}`);
    console.log(`  instruments: ${INSTRUMENTS.join(", ")} · export: ${EXPORT_PRESETS.join(", ")}`);
  });

program
  .command("list")
  .description("List presets and workspace songs")
  .option("--tag <tag>", "Only songs with this tag or category")
  .option("--workspace <path>")
  .option("--json")
  .action(async (o: { tag?: string; workspace?: string; json?: boolean }) => {
    try {
      const { songs, broken } = await listSongs(workspaceOf(o.workspace));
      const sel = songs.filter((e) => !o.tag || e.tags.includes(o.tag) || e.category === o.tag).map(songSummary);
      if (o.json) return console.log(JSON.stringify({ songs: sel, broken }, null, 2));
      for (const s of sel) console.log(`${s.id.padEnd(20)} ${String(s.bpm).padStart(3)}bpm ${String(s.bars).padStart(2)}bars ${`${s.mode}/${s.key}`.padEnd(7)} ${s.seconds.toFixed(1).padStart(5)}s ${s.source === "workspace" ? "ws " : "   "} ${s.th} · ${s.en}`);
      for (const b of broken) console.log(`${b.id.padEnd(20)} BROKEN ${b.errors[0]?.path}: ${b.errors[0]?.message}`);
    } catch (e) {
      fail(e);
    }
  });

program
  .command("show")
  .description("Print a song's resolved params (JSON)")
  .argument("<id>")
  .option("--workspace <path>")
  .action(async (id: string, o: { workspace?: string }) => {
    try {
      const s = await loadSong(workspaceOf(o.workspace), id);
      console.log(JSON.stringify({ ...songSummary(s), params: s.params }, null, 2));
    } catch (e) {
      fail(e);
    }
  });

program
  .command("check")
  .description("Validate a workspace song (id or .easymusic.json path). Exit code 1 on errors")
  .argument("<song>")
  .option("--workspace <path>")
  .option("--json")
  .action(async (arg: string, o: { workspace?: string; json?: boolean }) => {
    try {
      const root = workspaceOf(o.workspace);
      let errors;
      let warnings;
      if (!arg.endsWith(".json") && !existsSync(docPath(root, arg)) && presetById(arg)) ({ errors, warnings } = validateParams(presetById(arg)!.params));
      else {
        const file = arg.endsWith(".json") ? arg : docPath(root, arg);
        const id = path.basename(file).replace(/\.easymusic\.json$|\.json$/, "");
        ({ errors, warnings } = resolveDoc(id, JSON.parse(await readFile(file, "utf8"))));
      }
      if (o.json) console.log(JSON.stringify({ errors, warnings }, null, 2));
      else {
        for (const d of [...errors, ...warnings]) console.error(`${d.severity}: ${d.path}: ${d.message}`);
        if (!errors.length) console.log(`ok  ${warnings.length} warnings`);
      }
      if (errors.length) process.exit(1);
    } catch (e) {
      fail(e);
    }
  });

program
  .command("render")
  .description("Render a song to .wav (loop points in a smpl chunk), .ogg (LOOPSTART/LOOPLENGTH) or .mp3")
  .argument("<id>")
  .requiredOption("--out <file>", ".wav | .ogg | .mp3")
  .option("--loops <n>", "Unroll: intro + n loops in one linear file (previews)")
  .option("--fade <sec>", "Fade-out at the end of an unrolled preview")
  .option("--seed <n>", "Override the seed")
  .option("--set <key=value>", "Override: bpm=110, mode=la, lead.instrument=pi, 2.volume=0.6, *.octave=1 (repeatable)", collect, [])
  .option("--waveform <png>", "Also write a waveform PNG")
  .option("--workspace <path>")
  .action(async (id: string, o: { out: string; loops?: string; fade?: string; seed?: string; set: string[]; waveform?: string; workspace?: string }) => {
    try {
      const root = workspaceOf(o.workspace);
      const sets = o.set.map(parseSet);
      if (o.seed !== undefined) sets.push(["seed", Number(o.seed)]);
      const s = withOverrides(await loadSong(root, id), sets);
      const r = render(s);
      const res = await writeAudio(r, o.out, { loops: o.loops ? Number(o.loops) : undefined, fade: o.fade ? Number(o.fade) : undefined });
      const st = stats(r.left, r.right, r.sampleRate);
      console.log(`wrote ${res.file}`);
      console.log(`  ${st.seconds.toFixed(2)} s · loop ${(r.loopStart / r.sampleRate).toFixed(3)}–${(r.loopEnd / r.sampleRate).toFixed(3)} s (samples ${r.loopStart}–${r.loopEnd}) · peak ${st.peak} · rms ${st.rms} · form ${r.score.form.join(" ")}`);
      if (o.waveform) {
        await mkdir(path.dirname(path.resolve(o.waveform)), { recursive: true });
        await writeFile(o.waveform, waveformPng(s, r));
        console.log(`wrote ${o.waveform}`);
      }
    } catch (e) {
      fail(e);
    }
  });

program
  .command("waveform")
  .description("Write a waveform PNG of a song")
  .argument("<id>")
  .requiredOption("--out <png>")
  .option("--workspace <path>")
  .action(async (id: string, o: { out: string; workspace?: string }) => {
    try {
      const s = await loadSong(workspaceOf(o.workspace), id);
      await mkdir(path.dirname(path.resolve(o.out)), { recursive: true });
      await writeFile(o.out, waveformPng(s, render(s)));
      console.log(`wrote ${o.out}`);
    } catch (e) {
      fail(e);
    }
  });

program
  .command("new")
  .description("Create songs/<id>.easymusic.json from a preset plus overrides")
  .argument("<id>")
  .requiredOption("--from <preset>", "Built-in preset to start from")
  .option("--set <key=value>", "Override (repeatable)", collect, [])
  .option("--th <text>")
  .option("--en <text>")
  .option("--force", "Overwrite an existing file")
  .option("--workspace <path>")
  .action(async (id: string, o: { from: string; set: string[]; th?: string; en?: string; force?: boolean; workspace?: string }) => {
    try {
      const root = workspaceOf(o.workspace);
      assertSafeId(id, "song id");
      if (!presetById(o.from)) throw new Error(`Unknown preset ${o.from} (try: easymusic list)`);
      const file = docPath(root, id);
      if (existsSync(file) && !o.force) throw new Error(`${file} exists (use --force)`);
      const doc = { format: FORMAT, ...(o.th ? { th: o.th } : {}), ...(o.en ? { en: o.en } : {}), base: o.from, set: Object.fromEntries(o.set.map(parseSet)) };
      const r = resolveDoc(id, doc);
      if (r.errors.length) throw new Error(r.errors.map((d) => `${d.path}: ${d.message}`).join("\n"));
      await mkdir(dirs(root).songs, { recursive: true });
      await writeFile(file, `${JSON.stringify(doc, null, 2)}\n`);
      console.log(`wrote ${file}`);
      r.warnings.forEach((w) => console.log(`  warning: ${w.path}: ${w.message}`));
    } catch (e) {
      fail(e);
    }
  });

program
  .command("export")
  .description("Export songs: godot | web (alias pixi) | audio | json | all")
  .argument("[ids...]", "Song ids (default: all)")
  .option("--preset <preset>", EXPORT_PRESETS.join(" | "), "all")
  .option("--tag <tags>", "Only these tags / categories (comma-separated)")
  .option("--out <dir>", "Output folder (single preset; default exports/easymusic-<preset>)")
  .option("--no-ogg", "Write .wav only")
  .option("--workspace <path>")
  .option("--json")
  .action(async (ids: string[], o: { preset: string; tag?: string; out?: string; ogg: boolean; workspace?: string; json?: boolean }) => {
    try {
      const root = workspaceOf(o.workspace);
      const res = await exportMusic(root, { ids, preset: o.preset as ExportPreset, tags: list(o.tag), out: o.out, ogg: o.ogg === false ? false : undefined, trustedPaths: true });
      if (o.json) return console.log(JSON.stringify(res, null, 2));
      for (const d of res.dirs) console.log(`exported ${d}`);
      console.log(`  ${res.songs.length} songs · ${res.files.length} files · ogg ${res.ogg ? "yes" : "no"}`);
      res.warnings.forEach((w) => console.log(`  warning: ${w}`));
    } catch (e) {
      fail(e);
    }
  });

program
  .command("serve")
  .description("Web editor + API (default http://127.0.0.1:8858)")
  .option("--port <port>", "Port", "8858")
  .option("--host <host>", "Interface (non-loopback requires the printed token)", "127.0.0.1")
  .option("--dev", "API only; use the Vite UI on :5181")
  .option("--open", "Open the browser")
  .option("--workspace <path>")
  .action(async (o: { port: string; host: string; dev?: boolean; open?: boolean; workspace?: string }) => {
    const root = workspaceOf(o.workspace);
    if (!existsSync(dirs(root).songs)) await initWorkspace(root);
    await loadConfig(root);
    const token = resolveToken(o.host);
    const app = createApp({ workspaceRoot: root, webRoot: defaultWebRoot(), dev: o.dev, host: o.host, token });
    const port = Number(o.port);
    serve({ fetch: app.fetch, port, hostname: o.host }, () => {
      const url = `http://${o.host === "0.0.0.0" ? "127.0.0.1" : o.host}:${port}/`;
      console.log(`Easy Music ${o.dev ? "API (dev)" : "editor"} → ${url}`);
      console.log(`Workspace ${root}`);
      if (token) console.log(`Token (needed off-loopback): ${url}?token=${token}`);
      if (o.dev) console.log("Run the UI with: npx vite --config web/vite.config.ts");
      if (o.open) void open(o.dev ? "http://127.0.0.1:5181" : url);
    });
  });

program.parseAsync(process.argv).catch(fail);
