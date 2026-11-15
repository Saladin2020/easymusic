/**
 * Optional Godot check: GODOT=/path/to/godot npx vitest run test/godot.test.ts
 * Exports songs, imports the project headless, then test_music.gd loads every stream (class, length, loop + offset)
 * and plays one through the MusicPlayer autoload.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { exportMusic } from "../src/lib/export.js";
import { tempWorkspace } from "./helpers.js";

const GODOT = process.env.GODOT;
const ARGS = (process.env.GODOT_ARGS ?? "").split(" ").filter(Boolean);
let root: string;
let cleanup: () => Promise<void>;
beforeAll(async () => {
  if (GODOT) ({ root, cleanup } = await tempWorkspace());
});
afterAll(() => cleanup?.());

describe.skipIf(!GODOT)("Godot export", () => {
  it("streams load with loop points and MusicPlayer plays", async () => {
    const out = path.join(root, "exports", "godot");
    const ids = ["village_day", "title_theme", "raya_kompang", "boss_thai7"];
    await exportMusic(root, { preset: "godot", out, ids });
    for (let i = 0; i < 2; i++) spawnSync(GODOT!, [...ARGS, "--headless", "--editor", "--quit", "--path", out], { encoding: "utf8", timeout: 180_000 });
    const run = spawnSync(GODOT!, [...ARGS, "--headless", "--path", out, "--script", "res://test_music.gd"], { encoding: "utf8", timeout: 120_000 });
    expect(run.stdout).toMatch(/^OK$/m);
    expect(run.stdout.match(/^M\| .* ok$/gm)?.length).toBe(ids.length);
    expect(run.stdout).toMatch(/^M\| title_theme AudioStreamOggVorbis .* loop=true offset=4\.615 ok$/m);
    const main = spawnSync(GODOT!, [...ARGS, "--headless", "--path", out, "--quit-after", "60"], { encoding: "utf8", timeout: 120_000 });
    expect(main.stderr + main.stdout).not.toMatch(/SCRIPT ERROR|Parse Error/);
  }, 600_000);
});
