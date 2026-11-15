/** CLI smoke test: init a temp workspace, list, check, render, new and export through the real CLI. */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const ws = mkdtempSync(path.join(os.tmpdir(), "easymusic-cli-"));
const cli = (...args) => execFileSync("npx", ["tsx", "src/cli.ts", ...args, "--workspace", ws], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
let failed = false;
const ok = (cond, label) => {
  console.log(`${cond ? "ok  " : "FAIL"} ${label}`);
  if (!cond) failed = true;
};
const riff = (f) => existsSync(f) && readFileSync(f).toString("ascii", 0, 4) === "RIFF";
const oggS = (f) => existsSync(f) && readFileSync(f).toString("ascii", 0, 4) === "OggS";

cli("init");
ok(existsSync(path.join(ws, "songs", "pasar_malam.easymusic.json")), "init copies the sample workspace songs");
const listed = JSON.parse(cli("list", "--json"));
ok(listed.songs.length === 18 && listed.broken.length === 0, `list: ${listed.songs.length} songs, none broken`);
ok(/raya_kompang/.test(cli("list", "--tag", "raya")), "list --tag raya");
for (const p of listed.songs.filter((s) => s.source === "preset")) ok(/^ok/m.test(cli("check", p.id)), `check ${p.id}`);

const out = cli("render", "title_theme", "--out", path.join(ws, "r", "title.wav"), "--waveform", path.join(ws, "r", "title.png"));
ok(riff(path.join(ws, "r", "title.wav")) && /loop 4\.615–41\.538 s/.test(out), "render .wav with loop points (title intro)");
ok(existsSync(path.join(ws, "r", "title.png")), "render --waveform");
cli("render", "shop_theme", "--out", path.join(ws, "r", "shop.ogg"), "--seed", "7", "--set", "lead.instrument=chip_pulse", "--set", "bpm=120");
ok(oggS(path.join(ws, "r", "shop.ogg")), "render .ogg --seed --set");
cli("render", "raya_kompang", "--out", path.join(ws, "r", "raya.mp3"), "--loops", "2", "--fade", "2");
ok(existsSync(path.join(ws, "r", "raya.mp3")), "render .mp3 --loops 2 --fade 2");

cli("new", "slow_temple", "--from", "temple_calm", "--set", "bpm=58", "--set", "seed=5", "--th", "วัดยามเย็น");
ok(/ok/.test(cli("check", "slow_temple")), "new + check");
writeFileSync(path.join(ws, "songs", "broken.easymusic.json"), JSON.stringify({ format: "easymusic/1", base: "shop_theme", set: { bars: 5, "lead.instrument": "theremin" } }));
let errOut = "";
try {
  cli("check", "broken");
} catch (e) {
  errOut = String(e.stdout) + String(e.stderr);
}
ok(/params\.bars/.test(errOut) && /params\.layers\[0\]\.instrument/.test(errOut), "check reports JSON paths and exits 1");
writeFileSync(path.join(ws, "songs", "broken.easymusic.json"), "{}");

cli("export", "village_day", "slow_temple", "--preset", "all");
for (const f of ["exports/easymusic-godot/project.godot", "exports/easymusic-godot/easymusic/music.json", "exports/easymusic-godot/easymusic/music_player.gd", "exports/easymusic-web/easymusic-web.js", "exports/easymusic-web/index.html", "exports/easymusic-audio/music/village_day.wav", "exports/easymusic-audio/waveforms/slow_temple.png", "exports/easymusic-json/songs/slow_temple.json"]) {
  ok(existsSync(path.join(ws, f)), `export → ${f}`);
}

rmSync(ws, { recursive: true, force: true });
console.log(failed ? "CLI smoke FAILED" : "CLI smoke OK");
process.exit(failed ? 1 : 0);
