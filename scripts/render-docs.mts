/** Render README images: a waveform contact sheet of all presets + three single waveforms. Usage: tsx scripts/render-docs.mts [outDir] */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { render, waveformPng, waveformSheet } from "../src/lib/audio.js";
import { allPresetSongs, presetSong } from "../src/shared/songs.js";

const out = process.argv[2] ?? "docs/assets";
mkdirSync(out, { recursive: true });
const items = allPresetSongs().map((song) => ({ song, r: render(song) }));
writeFileSync(path.join(out, "waveforms.png"), waveformSheet(items, { width: 1200, rowHeight: 104 }));
for (const id of ["village_day", "raya_kompang", "title_theme"]) {
  const song = presetSong(id)!;
  writeFileSync(path.join(out, `wave-${id}.png`), waveformPng(song, render(song), { width: 900, height: 150 }));
}
console.log(`wrote ${out}/waveforms.png + 3 single waveforms`);
