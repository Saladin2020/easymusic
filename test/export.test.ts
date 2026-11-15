import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ffmpegPath } from "../src/lib/audio.js";
import { exportMusic } from "../src/lib/export.js";
import { listSongs } from "../src/lib/workspace.js";
import { readWavInfo } from "../src/shared/wav.js";
import { tempWorkspace } from "./helpers.js";

let root: string;
let cleanup: () => Promise<void>;
beforeAll(async () => ({ root, cleanup } = await tempWorkspace()));
afterAll(() => cleanup());

describe("workspace", () => {
  it("lists presets + the three sample songs", async () => {
    const { songs, broken } = await listSongs(root);
    expect(broken).toEqual([]);
    expect(songs.filter((s) => s.source === "workspace").map((s) => s.id).sort()).toEqual(["boss_thai7", "pasar_malam", "tadika_morning"]);
  });
});

describe("export", () => {
  it("audio: wav with loop chunk, ogg with LOOPSTART, waveform, manifest", async () => {
    const res = await exportMusic(root, { preset: "audio", ids: ["title_theme", "pasar_malam"] });
    const dir = res.dirs[0]!;
    const man = JSON.parse(readFileSync(path.join(dir, "easymusic.json"), "utf8"));
    const t = man.songs.find((s: { id: string }) => s.id === "title_theme");
    expect(t.loopStartSample).toBeGreaterThan(0);
    const info = readWavInfo(readFileSync(path.join(dir, t.wav)));
    expect(info.loop!.start).toBe(t.loopStartSample);
    expect(existsSync(path.join(dir, "waveforms", "title_theme.png"))).toBe(true);
    if (ffmpegPath()) {
      expect(res.ogg).toBe(true);
      const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream_tags:stream=channels,sample_rate", "-of", "json", path.join(dir, t.ogg)], { encoding: "utf8" });
      if (probe.status === 0) {
        const j = JSON.parse(probe.stdout);
        expect(j.streams[0].channels).toBe(2);
        expect(JSON.stringify(j)).toContain(`"${t.loopStartSample}"`);
      }
    }
  }, 60_000);

  it("godot: one stream per song, manifest, MusicPlayer autoload, test script", async () => {
    const res = await exportMusic(root, { preset: "godot", ids: ["village_day", "boss_thai7"] });
    const dir = res.dirs[0]!;
    const proj = readFileSync(path.join(dir, "project.godot"), "utf8");
    expect(proj).toMatch(/MusicPlayer="\*res:\/\/easymusic\/music_player.gd"/);
    const man = JSON.parse(readFileSync(path.join(dir, "easymusic", "music.json"), "utf8"));
    expect(man.songs.map((s: { id: string }) => s.id)).toEqual(["village_day", "boss_thai7"]);
    for (const s of man.songs) expect(existsSync(path.join(dir, s.file.replace("res://", "")))).toBe(true);
    if (res.ogg) expect(man.songs.every((s: { file: string }) => s.file.endsWith(".ogg"))).toBe(true);
    for (const f of ["easymusic/music_player.gd", "main.tscn", "main.gd", "test_music.gd"]) expect(existsSync(path.join(dir, f)), f).toBe(true);
  }, 60_000);

  it("web (alias pixi): player module, demo page, @pixi/sound bundle", async () => {
    const res = await exportMusic(root, { preset: "pixi", ids: ["raya_kompang"] });
    const dir = res.dirs[0]!;
    expect(path.basename(dir)).toBe("easymusic-web");
    const man = JSON.parse(readFileSync(path.join(dir, "easymusic.json"), "utf8"));
    expect(man.pixiSound.bundles[0].assets[0].alias).toBe("music_raya_kompang");
    expect(readFileSync(path.join(dir, "easymusic-web.js"), "utf8")).toMatch(/export async function loadMusic/);
    expect(readFileSync(path.join(dir, "index.html"), "utf8")).toMatch(/loadMusic\("easymusic.json"\)/);
  }, 60_000);

  it("json: params + score; out paths stay in the workspace", async () => {
    const res = await exportMusic(root, { preset: "json", ids: ["shop_theme"] });
    const j = JSON.parse(readFileSync(path.join(res.dirs[0]!, "songs", "shop_theme.json"), "utf8"));
    expect(j.score.layers.length).toBe(j.params.layers.length);
    await expect(exportMusic(root, { preset: "json", out: "../../escape" })).rejects.toThrow(/outside the workspace/);
    await expect(exportMusic(root, { preset: "all", out: "x" })).rejects.toThrow(/single preset/);
  });
});
