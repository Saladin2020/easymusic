# `easymusic/1` song format

A workspace song is `songs/<id>.easymusic.json`. Ids match `^[a-z0-9][a-z0-9_-]*$`.

```json
{
  "format": "easymusic/1",
  "th": "บอสระนาด เสียงไทยเจ็ดเสียง",
  "en": "Boss fight in Thai 7-tone tuning",
  "category": "battle",
  "tags": ["battle", "boss", "thai7"],
  "base": "battle_ranat",
  "set": { "tuning": "thai7", "mode": "la", "bpm": 160, "seed": 6602 }
}
```

| Field | Meaning |
| --- | --- |
| `format` | always `"easymusic/1"` |
| `th`, `en` | names shown in lists and the editor (optional; default to the base preset's) |
| `category` | `field`, `town`, `calm`, `night`, `festival`, `battle`, `menu` |
| `tags` | free strings used by `list --tag` and `export --tag` |
| `base` | a preset id; its params are the starting point |
| `params` | full params (replaces `base` params when both are given) |
| `set` | overrides applied after `base`/`params` (see paths below) |

## Params

| Key | Range | Notes |
| --- | --- | --- |
| `mood` | `village market temple night river festival songkran raya battle shop title shrine` | rhythm templates, melody register, density and the percussion cycle |
| `mode` | `do re mi sol la` | rotation of the anhemitonic pentatonic, counted from its own tonic: `do` 1 2 3 5 6 (bright), `re` 1 2 4 5 ♭7 (open), `mi` 1 ♭3 4 ♭6 ♭7 (dark), `sol` 1 2 4 5 6 (folk), `la` 1 ♭3 4 5 ♭7 (minor, sad / battle) |
| `key` | `C C# D Eb E F F# G Ab A Bb B` | tonic |
| `tuning` | `equal12` · `thai7` | `thai7` = 7 equal steps per octave (≈171.4 cents); a mode uses 5 of the 7 steps (`do`: 0 1 2 4 5) |
| `bpm` | 50–200 | |
| `bars` | 4, 8, 12, 16, 24, 32 | loop length in 4/4 bars |
| `introBars` | 0–4 | played once before the loop; the loop point sits after them |
| `seed` | uint32 | same seed → same file, byte for byte |
| `swing` | 0–0.5 | delays off-beat 8ths |
| `density` | 0–1 | how busy the melody is |
| `energy` | 0–1 | how hard and how often the percussion plays |
| `gain` | 0–1 | master level after normalisation (peak = 0.9 × gain) |
| `layers` | 1–8 | see below |

### Layers

```json
{ "role": "counter", "instrument": "ranat", "volume": 0.9, "octave": 0, "pan": -0.3, "mute": false, "name": "ranat runs" }
```

| Role | What the composer writes |
| --- | --- |
| `lead` | the melody: A A′ B A″ phrases, cadence on the tonic at the end of the loop |
| `skeleton` | khong wong style main notes on the beat, doubled in octaves |
| `counter` | heterophonic runs between skeleton notes (ranat / khim style) |
| `bass` | roots, walking, octaves or a pulse depending on mood |
| `drone` | tonic and 4th scale degree (the fifth in `do`) held per phrase |
| `pad` | three-note chords stacked in the mode on each bar's skeleton note |
| `perc` | the instrument's own pattern family (below) |

Tonal instruments: `ranat`, `khong_wong`, `saw`, `khim`, `pi`, `flute`, `chip_square`, `chip_pulse`,
`chip_triangle`, `synth_pad`, `synth_bass`. Percussion (`role: "perc"` only): `ching`, `klong_thon`, `kompang`,
`chip_drums`, `gong`. Every sound is synthesized from code; **there is no vocal or chant voice**.

| Percussion | Strokes |
| --- | --- |
| `ching` | `o` ching (open ring), `c` chap (closed); the cycle marks the metre |
| `klong_thon` | `T` thon (deep), `t` ting (high), `p` slap |
| `kompang` | `b` bung (open bass), `k` pak (slap), `g` rebana bass; two interlocking parts |
| `chip_drums` | `K` kick, `S` snare, `h` hat, `O` open hat |
| `gong` | `G` khong mong on phrase starts |

## `--set` paths

| Path | Effect |
| --- | --- |
| `bpm=110`, `mode=la`, `seed=7` | top-level param |
| `lead.instrument=pi` | first layer with that role |
| `2.volume=0.6` | layer index 2 |
| `*.octave=1` | every layer |

Values are parsed as JSON when possible (`true`, numbers), otherwise as strings.

## Content rules

The validator rejects layer names and titles that ask for the adhan, Quran recitation, chanting or vocals.
Easy Music is instrumental: it never synthesizes religious recitation. Keep the moods multicultural.

## Loops

The song is rendered onto a circular buffer `bars × 4 × 60 / bpm` seconds long (plus the intro): notes whose
release passes the loop end wrap round to the start, so the last sample flows into the first. Exports carry the
loop point as:

- WAV: a `smpl` chunk with one forward loop `[loopStart, loopEnd)` in samples
- OGG: Vorbis comments `LOOPSTART` and `LOOPLENGTH` (samples), the RPG Maker / many-engines convention
- manifests: `loopStart` / `loopEnd` in seconds plus `loopStartSample` / `loopEndSample`
