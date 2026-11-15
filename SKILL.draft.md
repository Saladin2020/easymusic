---
name: easymusic-loops
description: >-
  Use when a game needs background music loops with a Thai / southern Thai flavour (village, fields, market, shop,
  temple or shrine ambience, night, river, Loy Krathong, Songkran, Hari Raya kompang, battles, title theme) as
  seamless WAV / OGG with loop points, a Godot 4.3+ MusicPlayer autoload or a web / PixiJS player; built from 15
  seeded presets of synthesized ranat, khong wong, saw, khim, pi and drums. Instrumental only; not for SFX or vocals.
---
# Easy Music loops

Easy Music **composes, synthesizes and exports** `easymusic/1` songs from seeded presets. It does not record,
sample or generate with AI. Read `/workspace/indie-studio/tools/EASYMUSIC.md` for paths, commands, MCP args and
engine details. Full format: `/workspace/indie-studio/tools/easymusic/docs/FORMAT.md`.

## When to use

- A game needs area themes, festival music, battle loops or a title theme that loop with no click.
- You need OGG/WAV with loop points, a Godot `MusicPlayer` that cross-fades, or `easymusic-web.js` for a web game.
- One-shot sounds (hits, coins, UI blips) belong to Easy SFX, not here.

## Setup

Install: `/workspace/indie-studio/tools/easymusic`. CLI: `node /workspace/indie-studio/tools/easymusic-cli.mjs`.
Game files go under `/workspace/indie-studio/projects/<Name>/`; init that folder once. Ports: editor 8858,
MCP HTTP 8859, Vite 5181. OGG/MP3 need `ffmpeg`.

## Steps

1. **Pick.** `list` (or `--tag festival`, `--tag raya`) and `show <id>`. Never invent preset, mood, mode or
   instrument ids.
2. **Tweak and listen.** Render a preview with `--seed` and `--set`, then look at the waveform:

   ```bash
   CLI="node /workspace/indie-studio/tools/easymusic-cli.mjs"
   OUT=/workspace/indie-studio/projects/<Name>
   $CLI init --workspace "$OUT"
   $CLI render village_day --workspace "$OUT" --seed 12 --set mode=sol --out "$OUT/preview.mp3" --loops 2 --fade 2 --waveform "$OUT/preview.png"
   ```

3. **Save** the variant: `$CLI new <id> --from <preset> --set k=v --en "…" --workspace "$OUT"`, then `check <id>`.
4. **Export** to a fresh folder (`--out` does not clear old files):
   `$CLI export <ids…> --preset godot --workspace "$OUT" --out "$OUT/exports/music-godot"` (or `web`, `audio`, `json`).
5. **Credit** every song (id, base preset, seed, export path, CC0) in `ASSET_MANIFEST.md`.
6. **Hand off:** Godot `MusicPlayer.play(id)`; web `loadMusic("easymusic.json")` then `play(id)` after a user gesture.

MCP: `workspace_info` → `write_song` (dryRun) → `write_song` → `render_song` → `export_music`.

## Content rules

- Instrumental only. Never synthesize, request or label anything as the adhan, Quran recitation, religious chanting
  or vocals (the validator rejects it; there is no voice).
- Keep the village multicultural: Raya kompang sits beside Loy Krathong, Songkran, temple and shrine moods; don't
  remove or replace another culture's music.
- `temple_calm` is calm ambience, not ritual music; don't present it as a chant or prayer.

## Quality checklist

- [ ] Every id came from `list`; `check` exits 0.
- [ ] A preview was rendered and the waveform looked at; the loop seam was heard (editor "Hear the seam" or two loops).
- [ ] Exports went to dedicated folders; each song is in `ASSET_MANIFEST.md`.
