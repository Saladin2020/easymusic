#!/usr/bin/env node
/**
 * Easy Music MCP server (stdio by default; optional Streamable HTTP).
 *
 *   npx tsx src/mcp/server.ts
 *   npx tsx src/mcp/server.ts --http --port 8859
 *
 * Env: EASYMUSIC_WORKSPACE  absolute path to the workspace (default: cwd)
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { z } from "zod";
import { checkRequest, resolveToken } from "../shared/requestGuard.js";
import { songSummary, withOverrides } from "../shared/songs.js";
import { INSTRUMENT_INFO } from "../shared/instruments.js";
import { PERC_TOKENS } from "../shared/compose.js";
import { PRESETS } from "../shared/presets.js";
import { MODE_LABELS } from "../shared/theory.js";
import { FORMAT, INSTRUMENTS, KEYS, MODES, MOODS, ROLES, TUNINGS } from "../shared/types.js";
import { render, stats, waveformPng, wavBytes } from "../lib/audio.js";
import { EXPORT_PRESETS, exportMusic } from "../lib/export.js";
import { dirs, listSongs, loadSong, readDocRaw, resolveWorkspace, saveSongDoc, workspaceSummary } from "../lib/workspace.js";

export const MCP_TOOL_NAMES = ["workspace_info", "list_songs", "get_song", "write_song", "render_song", "export_music"] as const;

const IdSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]*$/, "Use a-z, 0-9, _ or -");

function text(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}
function err(message: string) {
  return { isError: true as const, content: [{ type: "text" as const, text: message }] };
}
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const PARAMS_CHEATSHEET = `Song params: { mood ${MOODS.join("|")}, mode ${MODES.join("|")} (pentatonic rotations), key ${KEYS.join("|")}, tuning equal12|thai7 (Thai 7-tone equal temperament),
  bpm 50-200, bars 4|8|12|16|24|32 (loop length, 4/4), introBars 0-4 (played once; the loop point sits after them), seed uint32, swing 0-0.5, density 0-1 (melody), energy 0-1 (drums), gain 0-1,
  layers: [{ role ${ROLES.join("|")}, instrument, volume 0-1.5, octave? -3..3, pan? -1..1, mute? }] (1-8) }
Instruments: tonal ${INSTRUMENTS.filter((i) => INSTRUMENT_INFO[i].kind === "tonal").join(", ")}; percussion (role "perc") ${INSTRUMENTS.filter((i) => INSTRUMENT_INFO[i].kind === "perc").join(", ")}.
Roles: lead = melody; skeleton = khong wong main notes on the beat; counter = ranat/khim runs between them; bass; drone; pad; perc = ching-chap cycle, klong thon, kompang interlock, chip drums, gong.
Workspace file: { format "${FORMAT}", th?, en?, base? preset id, params? full params, set? { "bpm": 110, "mode": "la", "lead.instrument": "pi", "2.volume": 0.6, "*.octave": 0 } }
Content rules: instrumental only. Never synthesize the adhan, Quran recitation or any religious chanting; there is no vocal voice. Keep the multicultural mix (Thai, Malay, Chinese-Thai moods side by side).`;

function parseArgs(argv: string[]) {
  const out = { http: false, port: 8859, host: "127.0.0.1", workspace: process.env.EASYMUSIC_WORKSPACE ?? process.cwd() };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--http") out.http = true;
    else if (a === "--port") out.port = Number(argv[++i] ?? out.port);
    else if (a === "--host") out.host = argv[++i] ?? out.host;
    else if (a === "--workspace") out.workspace = argv[++i] ?? out.workspace;
  }
  return out;
}

export function createEasyMusicMcp(workspaceRoot: string): McpServer {
  const root = resolveWorkspace(workspaceRoot);
  const server = new McpServer({ name: "easymusic", version: "0.1.0" });

  server.registerTool(
    "workspace_info",
    { title: "Workspace info", description: "Summarize the Easy Music workspace: every song (built-in presets + workspace files), moods, modes, instruments, roles and the params format. Call this first.", inputSchema: {} },
    async () => {
      const s = await workspaceSummary(root);
      return text({ name: "easymusic", root: s.root, config: s.config, presets: s.presets, workspaceSongs: s.workspaceSongs, songs: s.songs, broken: s.broken, moods: MOODS, modes: MODE_LABELS, tunings: TUNINGS, instruments: INSTRUMENT_INFO, percTokens: PERC_TOKENS, exportPresets: EXPORT_PRESETS, paramsFormat: PARAMS_CHEATSHEET });
    },
  );

  server.registerTool(
    "list_songs",
    { title: "List songs", description: "List songs with mood, mode, key, bpm, bars, length and layers; filter by tag or category (field, town, calm, night, festival, battle, menu, raya, loy_krathong, songkran, chiptune, thai…).", inputSchema: { tag: z.string().optional() } },
    async ({ tag }) => {
      const { songs, broken } = await listSongs(root);
      return text({ songs: songs.filter((e) => !tag || e.tags.includes(tag) || e.category === tag).map(songSummary), broken });
    },
  );

  server.registerTool(
    "get_song",
    { title: "Get song", description: "Full resolved params of one song, plus the workspace file when it has one.", inputSchema: { id: IdSchema } },
    async ({ id }) => {
      try {
        const s = await loadSong(root, id);
        return text({ ...songSummary(s), params: s.params, doc: (await readDocRaw(root, id)) ?? null });
      } catch (e) {
        return err(msg(e));
      }
    },
  );

  server.registerTool(
    "write_song",
    {
      title: "Write song",
      description: `Create or replace songs/<id>.easymusic.json. Give a base preset plus "set" overrides, or full "params". Validates first: refuses on errors (JSON path + message). dryRun only validates.\n${PARAMS_CHEATSHEET}`,
      inputSchema: {
        id: IdSchema,
        base: z.string().optional().describe(`Preset id: ${PRESETS.map((p) => p.id).join(", ")}`),
        params: z.record(z.string(), z.unknown()).optional().describe("Full params (replaces the base params)"),
        set: z.record(z.string(), z.unknown()).optional().describe('Overrides, e.g. {"bpm": 110, "lead.instrument": "pi"}'),
        th: z.string().optional(),
        en: z.string().optional(),
        dryRun: z.boolean().optional(),
      },
    },
    async ({ id, base, params, set, th, en, dryRun }) => {
      try {
        const doc = { format: FORMAT, ...(th ? { th } : {}), ...(en ? { en } : {}), ...(base ? { base } : {}), ...(params ? { params } : {}), ...(set ? { set } : {}) };
        const res = await saveSongDoc(root, id, doc, { dryRun });
        return text({ saved: res.saved, file: res.file, errors: res.errors, warnings: res.warnings });
      } catch (e) {
        return err(msg(e));
      }
    },
  );

  server.registerTool(
    "render_song",
    {
      title: "Render song",
      description: "Render a song to exports/renders/<id>.wav (loop points in the smpl chunk) and return its waveform PNG plus timing (seconds, loop start/end, peak, RMS, form). Optional seed / set overrides apply only to this render.",
      inputSchema: { id: IdSchema, seed: z.number().int().min(0).optional(), set: z.record(z.string(), z.unknown()).optional() },
    },
    async ({ id, seed, set }) => {
      try {
        const sets: Array<[string, unknown]> = Object.entries(set ?? {});
        if (seed !== undefined) sets.push(["seed", seed]);
        const s = withOverrides(await loadSong(root, id), sets);
        const r = render(s);
        const out = path.join(dirs(root).exports, "renders", `${id}.wav`);
        await mkdir(path.dirname(out), { recursive: true });
        await writeFile(out, wavBytes(r));
        const png = waveformPng(s, r);
        const st = stats(r.left, r.right, r.sampleRate);
        return {
          content: [
            { type: "text" as const, text: JSON.stringify({ file: out, ...st, loopStartSec: +(r.loopStart / r.sampleRate).toFixed(4), loopStartSample: r.loopStart, loopEndSample: r.loopEnd, form: r.score.form }, null, 2) },
            { type: "image" as const, data: png.toString("base64"), mimeType: "image/png" },
          ],
        };
      } catch (e) {
        return err(msg(e));
      }
    },
  );

  server.registerTool(
    "export_music",
    { title: "Export music", description: "Export songs: godot (Godot 4.3+ project: .ogg/.wav with loop points, music.json, MusicPlayer autoload with cross-fades, demo + test), web (easymusic-web.js WebAudio loop player for PixiJS / any web game + demo; alias pixi), audio (.wav + .ogg + waveform PNGs + manifest), json (resolved params + score), or all.", inputSchema: { ids: z.array(IdSchema).optional(), tags: z.array(z.string()).optional(), preset: z.enum([...EXPORT_PRESETS, "pixi"]).optional(), out: z.string().optional().describe("Workspace-relative output folder (single preset)") } },
    async ({ ids, tags, preset, out }) => {
      try {
        const res = await exportMusic(root, { ids, tags, preset, out });
        return text({ dirs: res.dirs, songs: res.songs, files: res.files.length, ogg: res.ogg, warnings: res.warnings });
      } catch (e) {
        return err(msg(e));
      }
    },
  );

  return server;
}

async function startMcp(opts: ReturnType<typeof parseArgs>) {
  const workspace = resolveWorkspace(opts.workspace);
  if (opts.http) return startHttp(workspace, opts.host, opts.port);
  await createEasyMusicMcp(workspace).connect(new StdioServerTransport());
}

async function startHttp(workspace: string, host: string, port: number) {
  const { StreamableHTTPServerTransport } = await import("@modelcontextprotocol/sdk/server/streamableHttp.js");
  const sessions = new Map<string, InstanceType<typeof StreamableHTTPServerTransport>>();
  const token = resolveToken(host);
  if (token) console.error(`Non-loopback host: send "Authorization: Bearer <token>" — token printed once: ${token}`);
  const httpServer = createServer(async (req, res) => {
    const auth = req.headers.authorization;
    const denied = checkRequest(
      { bindHost: host, token },
      { method: req.method ?? "GET", host: req.headers.host, origin: req.headers.origin, token: auth?.startsWith("Bearer ") ? auth.slice(7) : (req.headers["x-easymusic-token"] as string | undefined) },
    );
    if (denied) {
      res.writeHead(denied.status, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: denied.error }));
      return;
    }
    const url = new URL(req.url ?? "/", `http://${host}:${port}`);
    if (url.pathname !== "/mcp") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ name: "easymusic", transport: "streamable-http", endpoint: `http://${host}:${port}/mcp`, workspace }));
      return;
    }
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    try {
      if (req.method === "POST") {
        let transport = sessionId ? sessions.get(sessionId) : undefined;
        if (!transport) {
          const mcp = createEasyMusicMcp(workspace);
          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => crypto.randomUUID(),
            onsessioninitialized: (id: string) => {
              sessions.set(id, transport!);
            },
          });
          transport.onclose = () => {
            const id = transport!.sessionId;
            if (id) sessions.delete(id);
          };
          await mcp.connect(transport);
        }
        await transport.handleRequest(req, res);
        return;
      }
      if (req.method === "GET" || req.method === "DELETE") {
        const transport = sessionId ? sessions.get(sessionId) : undefined;
        if (!transport) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid or missing mcp-session-id" }));
          return;
        }
        await transport.handleRequest(req, res);
        return;
      }
      res.writeHead(405).end();
    } catch (e) {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: msg(e) }));
      }
    }
  });
  httpServer.listen(port, host, () => {
    console.error(`Easy Music MCP (HTTP) http://${host}:${port}/mcp`);
    console.error(`Workspace ${workspace}`);
  });
}

function entryIndex(): number {
  return process.argv.findIndex((arg) => /(?:^|[/\\])mcp[/\\]server\.(?:ts|js|mjs)$/i.test(arg));
}

if (entryIndex() >= 0) {
  await startMcp(parseArgs(process.argv.slice(entryIndex() + 1)));
}
