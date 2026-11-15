# Credits

## Music and sounds (CC0 1.0)

* Every note is **composed and synthesized from code** at render time (`src/shared/compose.ts`,
  `src/shared/instruments.ts`, `src/shared/render.ts`): no recordings, no sample packs, no AI generation, no network
  calls. The synth approach (oscillators, state-variable filter, Karplus-Strong strings, noise drums) follows
  [Easy SFX](https://github.com/Saladin2020/easysfx). The 15 presets, the sample songs (`samples/songs/`) and every
  file you render or export from them are dedicated to the public domain (CC0 1.0): use them anywhere, no
  attribution required.
* Instruments are synthesized impressions of Thai, Malay and Chinese-Thai instruments (ranat, khong wong, saw, khim,
  pi, khlui, ching/chap, klong thon, kompang, gong); they are not recordings of real instruments or players.
* Content rules: instrumental only. Easy Music has no voice and never synthesizes the adhan, Quran recitation or any
  religious chanting.

## Fonts

* **Kanit** (SIL Open Font License 1.1, `assets/fonts/OFL.txt`) is bundled only to draw Thai titles in waveform
  PNGs. **Press Start 2P** (SIL OFL 1.1) appears only in the README art (`docs/brand`).

## Runtimes

* `easymusic-web.js` uses the browser's Web Audio API; PixiJS / `@pixi/sound` are not bundled.
* Godot exports target Godot 4.3+ (MIT); nothing from the engine is included.
* OGG / MP3 encoding calls your local `ffmpeg` (not bundled).
