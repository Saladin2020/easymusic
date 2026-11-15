import { describe, expect, it } from "vitest";
import { PRESETS } from "../src/shared/presets.js";
import { applySet, parseSet, resolveDoc, songSummary, validateParams, withOverrides, presetSong } from "../src/shared/songs.js";
import { INSTRUMENT_INFO } from "../src/shared/instruments.js";
import { INSTRUMENTS, MOODS, type MusicParams } from "../src/shared/types.js";

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

describe("presets", () => {
  it("ships 15 valid presets with unique ids covering the suite's moods", () => {
    expect(PRESETS.length).toBe(15);
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(15);
    for (const p of PRESETS) expect(validateParams(p.params), p.id).toEqual({ errors: [], warnings: [] });
    const tags = PRESETS.flatMap((p) => p.tags);
    for (const t of ["raya", "loy_krathong", "songkran", "temple", "shrine", "market", "battle", "shop", "title", "night", "village"]) expect(tags, t).toContain(t);
    expect(PRESETS.some((p) => p.params.tuning === "thai7")).toBe(true);
    expect(PRESETS.some((p) => p.params.introBars > 0)).toBe(true);
  });

  it("every instrument is described and the Thai set is complete", () => {
    for (const i of INSTRUMENTS) expect(INSTRUMENT_INFO[i]).toBeTruthy();
    for (const i of ["ranat", "khong_wong", "saw", "khim", "pi", "ching", "klong_thon", "kompang"]) expect(INSTRUMENTS).toContain(i);
    expect(MOODS).toEqual(expect.arrayContaining(["village", "market", "temple", "night", "festival", "songkran", "raya", "battle", "shop", "title"]));
  });
});

describe("validation", () => {
  it("reports JSON paths", () => {
    const p = clone(PRESETS[0]!.params) as unknown as Record<string, unknown>;
    p.bpm = 900;
    p.bars = 7;
    p.mode = "lydian";
    (p.layers as Array<Record<string, unknown>>)[0]!.instrument = "theremin";
    (p.layers as Array<Record<string, unknown>>)[4]!.role = "lead";
    const { errors } = validateParams(p);
    const paths = errors.map((e) => e.path);
    expect(paths).toEqual(expect.arrayContaining(["params.bpm", "params.bars", "params.mode", "params.layers[0].instrument", "params.layers[4].role"]));
  });

  it("refuses vocal / adhan / chant names (instrumental only)", () => {
    const p = clone(PRESETS[0]!.params);
    p.layers[0]!.name = "adhan";
    expect(validateParams(p).errors[0]!.path).toBe("params.layers[0].name");
    const r = resolveDoc("x", { format: "easymusic/1", base: "village_day", en: "Quran recitation loop" });
    expect(r.errors[0]!.path).toBe("en");
    expect(resolveDoc("y", { format: "easymusic/1", base: "village_day", en: "Village voice" }).errors.length).toBe(1);
  });

  it("warns when there is no lead", () => {
    const p = clone(PRESETS[0]!.params);
    p.layers = p.layers.filter((l) => l.role !== "lead");
    expect(validateParams(p).warnings[0]!.message).toMatch(/no lead/);
  });
});

describe("--set overrides", () => {
  it("top level, index, role and *", () => {
    const p = clone(PRESETS[0]!.params) as MusicParams;
    applySet(p, "bpm", 120);
    applySet(p, "1.volume", 0.3);
    applySet(p, "lead.instrument", "pi");
    applySet(p, "*.pan", 0);
    expect(p.bpm).toBe(120);
    expect(p.layers[1]!.volume).toBe(0.3);
    expect(p.layers.find((l) => l.role === "lead")!.instrument).toBe("pi");
    expect(p.layers.every((l) => l.pan === 0)).toBe(true);
    expect(() => applySet(p, "tempo", 1)).toThrow(/unknown field/);
    expect(() => applySet(p, "9.volume", 1)).toThrow(/no layer 9/);
    expect(parseSet("mode=la")).toEqual(["mode", "la"]);
    expect(parseSet("bpm=110")).toEqual(["bpm", 110]);
  });

  it("resolves a doc and summarises timing", () => {
    const r = resolveDoc("night_boat", { format: "easymusic/1", base: "river_boat", set: { mode: "la", seed: 9, introBars: 1 } });
    expect(r.errors).toEqual([]);
    const s = songSummary(r.song!);
    expect(s.mode).toBe("la");
    expect(s.loopStartSec).toBeCloseTo((4 * 60) / 92, 3);
    expect(() => withOverrides(presetSong("village_day")!, [["bars", 5]])).toThrow(/bars/);
  });
});
