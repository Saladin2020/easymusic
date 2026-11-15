import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { access } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MCP_TOOL_NAMES, createEasyMusicMcp } from "../src/mcp/server.js";
import { createApp } from "../src/server/app.js";
import { tempWorkspace } from "./helpers.js";

let root: string;
let cleanup: () => Promise<void>;
let client: Client;
beforeAll(async () => {
  ({ root, cleanup } = await tempWorkspace());
  const server = createEasyMusicMcp(root);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  client = new Client({ name: "test", version: "0.0.1" });
  await client.connect(b);
});
afterAll(async () => {
  await client.close();
  await cleanup();
});

const body = (res: unknown) => JSON.parse(((res as { content: Array<{ text: string }> }).content[0]!).text);

describe("MCP server", () => {
  it("lists the six tools", async () => {
    const tools = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(tools).toEqual([...MCP_TOOL_NAMES].sort());
  });

  it("writes a song, renders and exports end to end", async () => {
    const info = body(await client.callTool({ name: "workspace_info", arguments: {} }));
    expect(info.presets).toBe(15);
    expect(info.paramsFormat).toMatch(/Never synthesize the adhan/);
    expect(info.songs.map((e: { id: string }) => e.id)).toContain("pasar_malam");

    const bad = body(await client.callTool({ name: "write_song", arguments: { id: "bad", base: "night_village", set: { "lead.instrument": "theremin" } } }));
    expect(bad.saved).toBe(false);
    expect(bad.errors[0].path).toBe("params.layers[0].instrument");

    const good = body(await client.callTool({ name: "write_song", arguments: { id: "short_shop", base: "shop_theme", th: "ร้านสั้น", set: { bars: 4, seed: 3 } } }));
    expect(good.saved).toBe(true);
    const got = body(await client.callTool({ name: "get_song", arguments: { id: "short_shop" } }));
    expect(got.source).toBe("workspace");
    expect(got.params.bars).toBe(4);

    const r = await client.callTool({ name: "render_song", arguments: { id: "short_shop" } });
    const content = r.content as Array<{ type: string; mimeType?: string; text?: string }>;
    expect(content.some((c) => c.type === "image" && c.mimeType === "image/png")).toBe(true);
    const meta = JSON.parse(content[0]!.text!);
    expect(meta.seconds).toBeCloseTo((4 * 4 * 60) / 112, 2);
    await access(meta.file);

    const tagged = body(await client.callTool({ name: "list_songs", arguments: { tag: "raya" } }));
    expect(tagged.songs.map((e: { id: string }) => e.id)).toEqual(expect.arrayContaining(["raya_kompang", "raya_open_house"]));

    const exported = body(await client.callTool({ name: "export_music", arguments: { preset: "json", ids: ["short_shop"] } }));
    for (const d of exported.dirs) await access(d);
    const escape = await client.callTool({ name: "export_music", arguments: { preset: "json", out: "../../outside" } });
    expect((escape as { isError?: boolean }).isError).toBe(true);
  }, 60_000);
});

describe("HTTP API", () => {
  it("serves songs and WAV renders; blocks cross-origin writes and rebinding", async () => {
    const app = createApp({ workspaceRoot: root, webRoot: "/nonexistent" });
    const h = { host: "127.0.0.1:8858" };
    expect((await app.request("/api/health", { headers: h })).status).toBe(200);
    const list = (await (await app.request("/api/songs", { headers: h })).json()) as { songs: unknown[] };
    expect(list.songs.length).toBeGreaterThanOrEqual(18);
    const one = (await (await app.request("/api/songs/shop_theme", { headers: h })).json()) as { song: { params: { bpm: number; bars: number } }; errors: unknown[] };
    expect(one.song.params.bpm).toBe(112);
    expect(one.errors).toEqual([]);
    const wav = await app.request("/api/render", { method: "POST", headers: { ...h, "content-type": "application/json" }, body: JSON.stringify({ params: { ...one.song.params, bars: 4 } }) });
    expect(wav.headers.get("content-type")).toBe("audio/wav");
    const save = await app.request("/api/songs/my_shop", { method: "POST", headers: { ...h, "content-type": "application/json" }, body: JSON.stringify({ doc: { format: "easymusic/1", base: "shop_theme", set: { seed: 4 } } }) });
    expect(((await save.json()) as { ok: boolean }).ok).toBe(true);
    expect((await app.request("/api/songs/..%2F..%2Fetc", { headers: h })).status).toBe(404);
    const cross = await app.request("/api/songs/x", { method: "POST", headers: { ...h, origin: "https://evil.example", "content-type": "application/json" }, body: "{}" });
    expect(cross.status).toBe(403);
    const rebinding = await app.request("/api/songs", { headers: { host: "evil.example:8858" } });
    expect(rebinding.status).toBe(403);
  });
});
