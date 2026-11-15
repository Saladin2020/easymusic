# Easy Music MCP server

```bash
npm run mcp                         # stdio
npm run mcp:http                    # http://127.0.0.1:8859/mcp (Streamable HTTP)
node dist/mcp/server.js --workspace /path/to/game --http --port 8859
```

Client config (stdio):

```json
{ "mcpServers": { "easymusic": { "command": "node", "args": ["/path/to/easymusic/dist/mcp/server.js", "--workspace", "/path/to/game"] } } }
```

| Tool | Args | Returns |
| --- | --- | --- |
| `workspace_info` | none | songs, moods, modes, instruments, percussion strokes, export presets and a params cheat sheet (call first) |
| `list_songs` | `tag?` | song summaries (mood, mode, key, bpm, bars, seconds, layers) |
| `get_song` | `id` | resolved params and the workspace file |
| `write_song` | `id`, `base?`, `params?`, `set?`, `th?`, `en?`, `dryRun?` | validation errors / warnings (JSON paths); saves `songs/<id>.easymusic.json` unless `dryRun` |
| `render_song` | `id`, `seed?`, `set?` | writes `exports/renders/<id>.wav`; returns timing, loop points and a waveform PNG image |
| `export_music` | `ids?`, `tags?`, `preset?` (`godot`, `web`, `pixi`, `audio`, `json`, `all`), `out?` | export folders, songs, file count, whether OGG was written |

Suggested flow: `workspace_info` → `write_song` (dryRun) → `write_song` → `render_song` (look at the waveform,
listen to the WAV) → `export_music`.

Security: binds to `127.0.0.1`; other hosts need the startup bearer token (or `EASYMUSIC_TOKEN`). Paths stay
inside the workspace plus `EASYMUSIC_ALLOWED_DIRS`.

Content rules (also in the cheat sheet): instrumental only; never synthesize the adhan, Quran recitation or any
religious chanting; keep the multicultural mix.
