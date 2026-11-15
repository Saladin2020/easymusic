import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { DEV_UI_ORIGINS, checkRequest } from "../shared/requestGuard.js";
import { songSummary, validateParams } from "../shared/songs.js";
import { INSTRUMENT_INFO } from "../shared/instruments.js";
import { MODE_LABELS } from "../shared/theory.js";
import { INSTRUMENTS, KEYS, MODES, MOODS, ROLES, TUNINGS, type MusicParams, type ResolvedSong } from "../shared/types.js";
import { render, waveformPng, wavBytes } from "../lib/audio.js";
import { exportMusic, type ExportPreset } from "../lib/export.js";
import { assertSafeId, listSongs, loadSong, readDocRaw, saveSongDoc, workspaceSummary } from "../lib/workspace.js";

export interface CreateAppOptions {
  workspaceRoot: string;
  webRoot?: string;
  dev?: boolean;
  host?: string;
  token?: string;
}

const TOKEN_COOKIE = "easymusic_token";
const fail = (e: unknown) => (e instanceof Error ? e.message : String(e));

function tokenPage(): string {
  return `<!doctype html><meta charset="utf-8"><title>Easy Music</title>
<body style="font-family:system-ui;background:#1a1410;color:#f3e7d3;padding:2rem">
<h1>Easy Music token required</h1>
<p>Paste the token printed in the terminal that started Easy Music.</p>
<form method="get"><input name="token" autocomplete="off" style="width:22rem"> <button>Open</button></form>
</body>`;
}

const bytes = (buf: Buffer) => new Uint8Array(buf);

export function createApp(options: CreateAppOptions): Hono {
  const app = new Hono();
  const { workspaceRoot: root, webRoot, dev, host = "127.0.0.1", token } = options;
  const guard = { bindHost: host, token, extraOrigins: dev ? DEV_UI_ORIGINS : [] };

  app.use("*", async (c, next) => {
    const queryToken = c.req.query("token");
    const provided = c.req.header("x-easymusic-token") ?? queryToken ?? getCookie(c, TOKEN_COOKIE);
    const denied = checkRequest(guard, { method: c.req.method, host: c.req.header("host"), origin: c.req.header("origin"), token: provided });
    if (denied) {
      if (denied.status === 401 && c.req.method === "GET" && !c.req.path.startsWith("/api/")) return c.html(tokenPage(), 401);
      return c.json({ error: denied.error }, denied.status);
    }
    if (token && queryToken) setCookie(c, TOKEN_COOKIE, queryToken, { httpOnly: true, sameSite: "Strict", path: "/", maxAge: 60 * 60 * 24 * 365 });
    await next();
  });

  app.get("/api/health", (c) => c.json({ ok: true, workspaceRoot: root }));
  app.get("/api/workspace", async (c) => c.json({ ...(await workspaceSummary(root)), moods: MOODS, modes: MODES, modeLabels: MODE_LABELS, keys: KEYS, tunings: TUNINGS, roles: ROLES, instruments: INSTRUMENTS, instrumentInfo: INSTRUMENT_INFO }));
  app.get("/api/songs", async (c) => {
    const { songs, broken } = await listSongs(root);
    return c.json({ songs: songs.map(songSummary), broken });
  });

  app.get("/api/songs/:id", async (c) => {
    try {
      const id = assertSafeId(c.req.param("id"), "song id");
      const s = await loadSong(root, id);
      return c.json({ id, song: s, doc: (await readDocRaw(root, id)) ?? null, ...validateParams(s.params) });
    } catch (e) {
      return c.json({ error: fail(e) }, 404);
    }
  });

  app.post("/api/songs/:id", async (c) => {
    try {
      const body = (await c.req.json()) as { doc: unknown };
      const res = await saveSongDoc(root, c.req.param("id"), body.doc);
      return c.json({ ok: res.saved, file: res.file, errors: res.errors, warnings: res.warnings });
    } catch (e) {
      return c.json({ error: fail(e) }, 400);
    }
  });

  app.post("/api/validate", async (c) => {
    const body = (await c.req.json()) as { params: unknown };
    return c.json(validateParams(body.params));
  });

  const songFrom = async (body: { id?: string; params?: MusicParams }): Promise<ResolvedSong> => {
    if (body.params) {
      const v = validateParams(body.params);
      if (v.errors.length) throw new Error(v.errors.map((d) => `${d.path}: ${d.message}`).join("; "));
      return { id: body.id ?? "preview", th: "", en: "", category: "field", tags: [], source: "workspace", params: body.params };
    }
    return loadSong(root, assertSafeId(body.id, "song id"));
  };

  /** WAV of a saved song or unsaved params (the editor also renders in the browser; this is for downloads). */
  app.post("/api/render", async (c) => {
    try {
      const body = (await c.req.json()) as { id?: string; params?: MusicParams; loops?: number };
      const r = render(await songFrom(body));
      return c.body(bytes(wavBytes(r, { loops: body.loops })), 200, { "Content-Type": "audio/wav" });
    } catch (e) {
      return c.json({ error: fail(e) }, 400);
    }
  });

  app.post("/api/waveform", async (c) => {
    try {
      const body = (await c.req.json()) as { id?: string; params?: MusicParams };
      const s = await songFrom(body);
      return c.body(bytes(waveformPng(s, render(s))), 200, { "Content-Type": "image/png" });
    } catch (e) {
      return c.json({ error: fail(e) }, 400);
    }
  });

  app.post("/api/export", async (c) => {
    try {
      const body = (await c.req.json()) as { ids?: string[]; preset?: ExportPreset; out?: string };
      const res = await exportMusic(root, { ids: body.ids?.map((i) => assertSafeId(i, "song id")), preset: body.preset, out: body.out });
      return c.json({ ok: true, ...res, files: res.files.length });
    } catch (e) {
      return c.json({ error: fail(e) }, 400);
    }
  });

  if (!dev && webRoot) {
    app.use("/*", serveStatic({ root: webRoot }));
    app.get("*", async (c) => {
      try {
        return c.html((await readFile(path.join(webRoot, "index.html"))).toString("utf8"));
      } catch {
        return c.text("Web UI not built yet. Run npm run build:web or start with --dev.", 503);
      }
    });
  } else if (dev) {
    app.get("/", (c) =>
      c.html(`<!doctype html><meta charset="utf-8"><title>Easy Music (dev)</title>
<body style="font-family:system-ui;background:#1a1410;color:#f3e7d3;padding:2rem">
<h1>Easy Music API is running</h1><p>Workspace: <code>${root}</code></p>
<p>Open the Vite UI at <a href="http://127.0.0.1:5181" style="color:#f0c36a">http://127.0.0.1:5181</a></p></body>`),
    );
  }
  return app;
}

export function defaultWebRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [path.resolve(here, "../web/dist"), path.resolve(here, "../../web/dist")];
  return candidates.find((p) => existsSync(path.join(p, "index.html"))) ?? candidates[1]!;
}
