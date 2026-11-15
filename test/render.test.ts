import { describe, expect, it } from "vitest";
import goldenJson from "./golden.json" with { type: "json" };
import { writeFileSync } from "node:fs";
import { compose } from "../src/shared/compose.js";
import { PRESETS, presetById } from "../src/shared/presets.js";
import { renderSong, stats, unroll } from "../src/shared/render.js";
import { timing } from "../src/shared/songs.js";
import { degreeHz, MODE_7 } from "../src/shared/theory.js";
import { encodeWav, fnv1a, readWavInfo } from "../src/shared/wav.js";

const golden = goldenJson as Record<string, string>;

describe("theory", () => {
  it("pentatonic degrees, octaves and Thai 7-tone tuning", () => {
    expect(degreeHz(0, "A", "do", "equal12")).toBeCloseTo(440, 6);
    expect(degreeHz(5, "A", "do", "equal12")).toBeCloseTo(880, 6);
    expect(degreeHz(-5, "A", "la", "thai7")).toBeCloseTo(220, 6);
    expect(degreeHz(3, "A", "do", "equal12")).toBeCloseTo(440 * 2 ** (7 / 12), 6);
    // Thai 7-TET: every scale step is 1200/7 cents
    const step = 1200 * Math.log2(degreeHz(1, "C", "do", "thai7") / degreeHz(0, "C", "do", "thai7"));
    expect(step).toBeCloseTo(1200 / 7, 6);
    for (const m of Object.values(MODE_7)) expect(m.length).toBe(5);
  });
});

describe("composer", () => {
  it("is deterministic, follows the form and cadences on the tonic", () => {
    const p = presetById("village_day")!.params;
    const a = compose(p);
    expect(JSON.stringify(compose(p))).toBe(JSON.stringify(a));
    expect(a.form).toEqual(["A", "A'", "B", "A''"]);
    const lead = a.layers.find((l) => l.layer.role === "lead")!.notes;
    expect(((lead.at(-1)!.deg % 5) + 5) % 5).toBe(0);
    // A' repeats A except its last bar
    const bar = 16;
    const A = lead.filter((n) => n.step < 3 * bar).map((n) => [n.step, n.deg]);
    const A2 = lead.filter((n) => n.step >= 4 * bar && n.step < 7 * bar).map((n) => [n.step - 4 * bar, n.deg]);
    expect(A2).toEqual(A);
    const ching = a.layers.find((l) => l.layer.instrument === "ching")!.hits;
    expect(ching.every((h) => h.tok === "o" || h.tok === "c")).toBe(true);
  });

  it("a different seed gives a different melody", () => {
    const p = presetById("market_bustle")!.params;
    const a = compose(p).layers[0]!.notes.map((n) => n.deg).join();
    const b = compose({ ...p, seed: p.seed + 1 }).layers[0]!.notes.map((n) => n.deg).join();
    expect(a).not.toBe(b);
  });
});

describe("render", () => {
  it("every preset renders to the golden hash (byte-exact WAV)", () => {
    const got: Record<string, string> = {};
    for (const p of PRESETS) {
      const r = renderSong(p.params);
      const wav = encodeWav(r.left, r.right, r.sampleRate, { start: r.loopStart, end: r.loopEnd });
      got[p.id] = fnv1a(wav);
      const s = stats(r.left, r.right);
      expect(s.peak, p.id).toBeGreaterThan(0.5);
      expect(s.peak, p.id).toBeLessThanOrEqual(0.9001);
      expect(s.rms, p.id).toBeGreaterThan(0.08);
      const t = timing(p.params);
      expect([r.loopStart, r.loopEnd]).toEqual([t.loopStart, t.loopEnd]);
    }
    if (process.env.UPDATE_GOLDEN) writeFileSync(new URL("./golden.json", import.meta.url), `${JSON.stringify(got, null, 2)}\n`);
    else expect(got).toEqual(golden);
  }, 120_000);

  it("loops seamlessly: the loop end flows into the loop start like any other sample", () => {
    for (const id of ["temple_calm", "battle_chip", "title_theme", "raya_kompang"]) {
      const r = renderSong(presetById(id)!.params);
      const u = unroll(r, 2);
      const seam = r.loopEnd;
      let maxDelta = 0;
      for (let i = r.loopStart + 1; i < r.loopEnd; i++) maxDelta = Math.max(maxDelta, Math.abs(r.left[i]! - r.left[i - 1]!));
      expect(Math.abs(u.left[seam]! - u.left[seam - 1]!), id).toBeLessThanOrEqual(maxDelta);
      // the second pass of the loop is identical to the first
      expect(u.left[seam + 1000]).toBe(r.left[r.loopStart + 1000]);
    }
  }, 60_000);

  it("title_theme has an intro: loop point after 2 bars", () => {
    const r = renderSong(presetById("title_theme")!.params);
    expect(r.loopStart / r.sampleRate).toBeCloseTo((2 * 4 * 60) / 104, 3);
  });

  it("WAV round trip: stereo 16-bit with a smpl loop chunk", () => {
    const r = renderSong({ ...presetById("shop_theme")!.params, bars: 4, introBars: 1 }, { sampleRate: 22050 });
    const info = readWavInfo(encodeWav(r.left, r.right, r.sampleRate, { start: r.loopStart, end: r.loopEnd }));
    expect(info.channels).toBe(2);
    expect(info.sampleRate).toBe(22050);
    expect(info.samples).toBe(r.left.length);
    expect(info.loop).toEqual({ start: r.loopStart, end: r.loopEnd - 1 });
  });
});
