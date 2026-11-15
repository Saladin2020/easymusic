import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { compose } from "../shared/compose.js";
import { songSummary } from "../shared/songs.js";
import { EXPORT_PRESETS, type ResolvedSong } from "../shared/types.js";
import { RUNTIME_DIR } from "./assets.js";
import { ffmpegPath, render, transcode, waveformPng, wavBytes } from "./audio.js";
import { dirs, listSongs, loadConfig, loadSong, resolveInside } from "./workspace.js";

export type ExportPreset = (typeof EXPORT_PRESETS)[number] | "pixi";
export { EXPORT_PRESETS };
export const VERSION = "0.1.0";

export interface ExportOptions {
  preset?: ExportPreset;
  ids?: string[];
  tags?: string[];
  out?: string;
  /** Force .ogg on/off (default: config.ogg && ffmpeg present). */
  ogg?: boolean;
  trustedPaths?: boolean;
}

export interface ExportResult {
  dirs: string[];
  files: string[];
  songs: string[];
  warnings: string[];
  ogg: boolean;
}

class Writer {
  files: string[] = [];
  constructor(readonly dir: string) {}
  async write(rel: string, body: string | Buffer) {
    const f = path.join(this.dir, rel);
    await mkdir(path.dirname(f), { recursive: true });
    await writeFile(f, body);
    this.files.push(f);
    return f;
  }
  async copy(src: string, rel: string) {
    const f = path.join(this.dir, rel);
    await mkdir(path.dirname(f), { recursive: true });
    await copyFile(src, f);
    this.files.push(f);
  }
}

export interface ManifestSong {
  id: string;
  th: string;
  en: string;
  category: string;
  tags: string[];
  bpm: number;
  bars: number;
  introBars: number;
  seconds: number;
  sampleRate: number;
  loopStart: number;
  loopStartSample: number;
  loopEndSample: number;
  wav: string;
  ogg?: string;
}

/** Render every song into `<prefix>/<id>.wav` (+ .ogg). Returns manifest entries (paths relative to the writer dir). */
async function writeSongs(w: Writer, songs: ResolvedSong[], prefix: string, ogg: boolean, keepWav = true): Promise<ManifestSong[]> {
  const out: ManifestSong[] = [];
  for (const s of songs) {
    const r = render(s);
    const wavRel = `${prefix}/${s.id}.wav`;
    const f = await w.write(wavRel, wavBytes(r));
    const entry: ManifestSong = {
      id: s.id, th: s.th, en: s.en, category: s.category, tags: s.tags,
      bpm: s.params.bpm, bars: s.params.bars, introBars: s.params.introBars,
      seconds: +r.seconds.toFixed(4), sampleRate: r.sampleRate,
      loopStart: +(r.loopStart / r.sampleRate).toFixed(6), loopStartSample: r.loopStart, loopEndSample: r.loopEnd,
      wav: wavRel,
    };
    if (ogg && transcode(f, f.replace(/\.wav$/, ".ogg"), { start: r.loopStart, end: r.loopEnd })) {
      entry.ogg = wavRel.replace(/\.wav$/, ".ogg");
      w.files.push(f.replace(/\.wav$/, ".ogg"));
      if (!keepWav) {
        await rm(f, { force: true });
        w.files.splice(w.files.indexOf(f), 1);
        entry.wav = "";
      }
    }
    out.push(entry);
  }
  return out;
}

const manifest = (songs: ManifestSong[], extra: Record<string, unknown> = {}) =>
  `${JSON.stringify({ format: "easymusic-manifest/1", generator: `easymusic ${VERSION}`, songs, ...extra }, null, 2)}\n`;

async function exportAudio(dir: string, songs: ResolvedSong[], ogg: boolean): Promise<string[]> {
  const w = new Writer(dir);
  const entries = await writeSongs(w, songs, "music", ogg);
  for (const s of songs) await w.write(`waveforms/${s.id}.png`, waveformPng(s, render(s)));
  await w.write("easymusic.json", manifest(entries));
  return w.files;
}

async function exportJson(dir: string, songs: ResolvedSong[]): Promise<string[]> {
  const w = new Writer(dir);
  for (const s of songs) {
    const sc = compose(s.params);
    await w.write(
      `songs/${s.id}.json`,
      `${JSON.stringify({ ...songSummary(s), params: s.params, score: { stepSec: sc.stepSec, introSteps: sc.introSteps, loopSteps: sc.loopSteps, form: sc.form, layers: sc.layers.map((l) => ({ role: l.layer.role, instrument: l.layer.instrument, notes: l.notes, hits: l.hits })) } }, null, 1)}\n`,
    );
  }
  return w.files;
}

async function exportWeb(dir: string, songs: ResolvedSong[], ogg: boolean): Promise<string[]> {
  const w = new Writer(dir);
  const entries = await writeSongs(w, songs, "music", ogg);
  // @pixi/sound users: a plain Assets bundle (note: @pixi/sound loops from 0, so intros replay; prefer easymusic-web.js)
  const pixiSound = { bundles: [{ name: "music", assets: entries.map((e) => ({ alias: `music_${e.id}`, src: [e.ogg, e.wav].filter(Boolean) })) }] };
  await w.write("easymusic.json", manifest(entries, { pixiSound }));
  await w.copy(path.join(RUNTIME_DIR, "web", "easymusic-web.js"), "easymusic-web.js");
  await w.write("index.html", webIndex());
  return w.files;
}

function webIndex(): string {
  return `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Easy Music · web player demo</title>
<link rel="icon" href="data:,">
<style>
  body { margin: 0; font-family: "IBM Plex Sans Thai", system-ui, sans-serif; background: #140e0a; color: #f7ebd3; padding: 1.2rem; }
  h1 { font-size: 1.3rem; margin: 0 0 .3rem; } h1 span { color: #f4ae3d; }
  p { color: #cdb492; margin: .2rem 0 1rem; }
  #songs { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: .5rem; }
  button { text-align: left; background: #2a1d13; color: inherit; border: 1px solid #523822; padding: .5rem .7rem; cursor: pointer; font: inherit; }
  button.on { border-color: #f4ae3d; background: #3a2819; } button small { display: block; color: #97805f; }
  #bar { height: 6px; background: #2a1d13; margin: 1rem 0; } #bar i { display: block; height: 100%; width: 0; background: #f4ae3d; }
  #stop { margin-top: .4rem; }
</style>
</head>
<body>
<h1>Easy <span>Music</span> · web player</h1>
<p>Click a song: it loops seamlessly from its loop point (intros play once) and cross-fades to the next. Works with or without PixiJS.</p>
<div id="songs"></div>
<div id="bar"><i></i></div>
<div id="now">-</div>
<button id="stop">Stop (fade)</button>
<script type="module">
  import { loadMusic } from "./easymusic-web.js";
  const music = await loadMusic("easymusic.json");
  const box = document.getElementById("songs");
  for (const id of music.ids) {
    const s = music.info(id);
    const b = document.createElement("button");
    b.dataset.id = id;
    b.innerHTML = \`<b>\${s.th}</b> <small>\${id} · \${s.bpm} bpm · \${s.seconds.toFixed(1)} s\${s.introBars ? " · intro" : ""}</small>\`;
    b.onclick = async () => { await music.play(id, { fade: 0.8 }); document.querySelectorAll("#songs button").forEach((x) => x.classList.toggle("on", x === b)); };
    box.appendChild(b);
  }
  document.getElementById("stop").onclick = () => music.stop({ fade: 1 });
  const bar = document.querySelector("#bar i"), now = document.getElementById("now");
  (function tick() { const p = music.position(); bar.style.width = p ? (100 * p.seconds / p.duration).toFixed(2) + "%" : "0"; now.textContent = p ? \`\${p.id} · \${p.seconds.toFixed(2)} s · loop \${p.loops}\` : "-"; requestAnimationFrame(tick); })();
  window.__music = music; window.__ready = true;
</script>
</body>
</html>
`;
}

async function exportGodot(dir: string, songs: ResolvedSong[], ogg: boolean): Promise<string[]> {
  const w = new Writer(dir);
  // Godot imports every .wav/.ogg it finds: keep only one file per song (.ogg when available)
  const entries = await writeSongs(w, songs, "easymusic/music", ogg, false);
  const res = (p: string) => `res://${p}`;
  await w.write(
    "easymusic/music.json",
    `${JSON.stringify({ format: "easymusic-godot/1", generator: `easymusic ${VERSION}`, songs: entries.map((e) => ({ id: e.id, th: e.th, en: e.en, file: res(e.ogg ?? e.wav), bpm: e.bpm, seconds: e.seconds, loop_start: e.loopStart, loop_start_sample: e.loopStartSample, loop_end_sample: e.loopEndSample, sample_rate: e.sampleRate, intro_bars: e.introBars })) }, null, 2)}\n`,
  );
  await w.copy(path.join(RUNTIME_DIR, "godot", "music_player.gd"), "easymusic/music_player.gd");
  await w.write(
    "project.godot",
    `; Engine configuration file. Generated by Easy Music.
config_version=5

[application]

config/name="Easy Music demo"
run/main_scene="res://main.tscn"
config/features=PackedStringArray("4.3")

[autoload]

MusicPlayer="*res://easymusic/music_player.gd"

[display]

window/size/viewport_width=960
window/size/viewport_height=540
`,
  );
  await w.write("main.gd", GODOT_MAIN);
  await w.write(
    "main.tscn",
    `[gd_scene load_steps=2 format=3]

[ext_resource type="Script" path="res://main.gd" id="1"]

[node name="Main" type="Control"]
layout_mode = 3
anchors_preset = 15
anchor_right = 1.0
anchor_bottom = 1.0
script = ExtResource("1")
`,
  );
  await w.write("test_music.gd", GODOT_TEST);
  await w.write(
    "README.txt",
    `Easy Music Godot 4.3+ export

  easymusic/music/*.ogg|wav   one file per song (.ogg when ffmpeg was available at export time)
  easymusic/music.json        manifest: file, bpm, seconds, loop_start (s), loop_start_sample, loop_end_sample
  easymusic/music_player.gd   autoload "MusicPlayer" (already registered in project.godot)

  MusicPlayer.play("village_day")      # cross-fades from the current song
  MusicPlayer.play("title_theme", 0.0) # no fade; the intro plays once, then loops from loop_start
  MusicPlayer.stop(1.5)

Loops: .ogg → AudioStreamOggVorbis.loop + loop_offset; .wav → AudioStreamWAV LOOP_FORWARD with loop_begin/loop_end
(set by MusicPlayer at load; the WAV smpl chunk carries the same points).

Copy easymusic/ into your project and add music_player.gd as an autoload named MusicPlayer.
Headless check: godot --headless --editor --quit --path .   then   godot --headless --path . --script res://test_music.gd
`,
  );
  return w.files;
}

const GODOT_MAIN = `extends Control
## Easy Music demo: one button per song. Generated by Easy Music.

func _ready() -> void:
	var box := VBoxContainer.new()
	box.position = Vector2(24, 24)
	add_child(box)
	var title := Label.new()
	title.text = "Easy Music · click a song (loops, cross-fades)"
	box.add_child(title)
	for id in MusicPlayer.ids():
		var b := Button.new()
		var s: Dictionary = MusicPlayer.songs[id]
		b.text = "%s  (%s · %d bpm)" % [s.get("th", id), id, int(s.get("bpm", 0))]
		b.pressed.connect(func(): MusicPlayer.play(id))
		box.add_child(b)
	var stop := Button.new()
	stop.text = "Stop"
	stop.pressed.connect(func(): MusicPlayer.stop())
	box.add_child(stop)
`;

const GODOT_TEST = `extends SceneTree
## Headless check for an Easy Music export: every stream loads, has the right length and loop settings,
## and MusicPlayer plays one. Prints "M| <id> <class> <len> loop=<bool> offset=<s> ok" per song, then OK.

var player: Node
var frames := 0
var failed := false

func _initialize() -> void:
	var Player = load("res://easymusic/music_player.gd")
	player = Player.new()
	if not player.load_manifest("res://easymusic/music.json"):
		print("FAIL manifest")
		quit(1)
		return
	for id in player.ids():
		var s: Dictionary = player.songs[id]
		var st: AudioStream = player.stream_of(id)
		if st == null:
			print("FAIL load ", id)
			failed = true
			continue
		var looped := false
		var offset := 0.0
		if st is AudioStreamOggVorbis:
			looped = st.loop
			offset = st.loop_offset
		elif st is AudioStreamWAV:
			looped = st.loop_mode == AudioStreamWAV.LOOP_FORWARD
			offset = float(st.loop_begin) / float(st.mix_rate)
		var ok := looped and absf(st.get_length() - float(s["seconds"])) < 0.06 and absf(offset - float(s["loop_start"])) < 0.002
		print("M| ", id, " ", st.get_class(), " ", snappedf(st.get_length(), 0.01), " loop=", looped, " offset=", snappedf(offset, 0.001), " ok" if ok else " BAD")
		if not ok:
			failed = true
	root.add_child.call_deferred(player)

func _process(_delta: float) -> bool:
	frames += 1
	if frames == 3:
		player.play(player.ids()[0], 0.0)
	if frames == 30:
		var playing: bool = player.is_playing()
		print("P| ", player.current, " playing=", playing)
		if not playing or failed:
			print("FAIL")
			quit(1)
		else:
			print("OK")
			quit(0)
	return false
`;

export async function selectSongs(root: string, ids?: string[], tags?: string[]): Promise<{ songs: ResolvedSong[]; warnings: string[] }> {
  const warnings: string[] = [];
  let songs: ResolvedSong[];
  if (ids?.length) songs = await Promise.all(ids.map((id) => loadSong(root, id)));
  else {
    const all = await listSongs(root);
    songs = all.songs;
    for (const b of all.broken) warnings.push(`skipped ${b.id}: ${b.errors[0]?.path}: ${b.errors[0]?.message}`);
  }
  if (tags?.length) songs = songs.filter((s) => tags.some((t) => s.tags.includes(t) || s.category === t));
  if (!songs.length) throw new Error("No songs selected");
  return { songs, warnings };
}

export async function exportMusic(root: string, opts: ExportOptions = {}): Promise<ExportResult> {
  const preset = opts.preset === "pixi" ? "web" : (opts.preset ?? "all");
  if (!(EXPORT_PRESETS as readonly string[]).includes(preset)) throw new Error(`Unknown export preset ${preset} (${EXPORT_PRESETS.join(", ")})`);
  const { songs, warnings } = await selectSongs(root, opts.ids, opts.tags);
  const cfg = await loadConfig(root);
  const wantOgg = opts.ogg ?? cfg.ogg;
  const hasFf = !!ffmpegPath();
  const ogg = wantOgg && hasFf;
  if (wantOgg && !hasFf) warnings.push("ffmpeg not found: exported .wav only (loops via the WAV smpl chunk / manifest)");
  const kinds = preset === "all" ? (["godot", "web", "audio", "json"] as const) : [preset];
  if (opts.out && kinds.length > 1) throw new Error("--out needs a single preset (godot | web | audio | json)");
  const res: ExportResult = { dirs: [], files: [], songs: songs.map((s) => s.id), warnings, ogg };
  for (const k of kinds) {
    const rel = opts.out ?? path.join(path.relative(root, dirs(root).exports), `easymusic-${k}`);
    const dir = opts.trustedPaths ? path.resolve(root, rel) : resolveInside(root, rel);
    const files = k === "godot" ? await exportGodot(dir, songs, ogg) : k === "web" ? await exportWeb(dir, songs, ogg) : k === "audio" ? await exportAudio(dir, songs, ogg) : await exportJson(dir, songs);
    res.dirs.push(dir);
    res.files.push(...files);
  }
  return res;
}
