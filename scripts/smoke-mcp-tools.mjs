/** MCP smoke test: start the server over stdio and over HTTP like a client would and call tools. */
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const ws = mkdtempSync(path.join(os.tmpdir(), "easymusic-smoke-"));
execFileSync("npx", ["tsx", "src/cli.ts", "init", "--workspace", ws], { stdio: "ignore" });
const fail = (m) => {
  console.error("FAIL", m);
  process.exitCode = 1;
};
const body = (r) => JSON.parse(r.content?.[0]?.text ?? "{}");

async function exercise(client, label) {
  const tools = (await client.listTools()).tools.map((t) => t.name);
  console.log(`[${label}] tools (${tools.length}):`, tools.join(", "));
  if (tools.length !== 6) fail(`${label}: expected 6 tools`);
  const info = body(await client.callTool({ name: "workspace_info", arguments: {} }));
  if (info.presets !== 15 || !info.songs?.length) fail(`${label}: workspace_info`);
  console.log(`[${label}] presets=${info.presets} workspace=${info.workspaceSongs} moods=${info.moods?.length}`);
  const raya = body(await client.callTool({ name: "list_songs", arguments: { tag: "raya" } }));
  console.log(`[${label}] tag raya:`, raya.songs?.map((e) => e.id).join(", "));
  if (!raya.songs?.some((e) => e.id === "raya_kompang")) fail(`${label}: list_songs tag`);
  const got = body(await client.callTool({ name: "get_song", arguments: { id: "temple_calm" } }));
  console.log(`[${label}] temple_calm tuning=${got.params?.tuning} layers=${got.params?.layers?.length}`);
  if (got.params?.tuning !== "thai7") fail(`${label}: get_song`);
  const bad = body(await client.callTool({ name: "write_song", arguments: { id: "smoke_bad", base: "shop_theme", set: { "lead.name": "adhan" }, dryRun: true } }));
  console.log(`[${label}] dry-run error:`, bad.errors?.[0] && `${bad.errors[0].path}: ${bad.errors[0].message}`);
  if (!bad.errors?.length) fail(`${label}: write_song validation`);
  const good = body(await client.callTool({ name: "write_song", arguments: { id: `smoke_${label}`, base: "battle_chip", set: { bars: 4, seed: 99 } } }));
  if (!good.saved) fail(`${label}: write_song save`);
  const r = await client.callTool({ name: "render_song", arguments: { id: `smoke_${label}` } });
  const img = r.content?.find((c) => c.type === "image");
  const meta = JSON.parse(r.content?.[0]?.text ?? "{}");
  console.log(`[${label}] render: ${meta.seconds}s loop ${meta.loopStartSample}-${meta.loopEndSample}, waveform bytes:`, img ? Buffer.from(img.data, "base64").length : 0);
  if (!img || !meta.seconds) fail(`${label}: render_song`);
}

// stdio
{
  const client = new Client({ name: "smoke", version: "0.0.1" });
  await client.connect(new StdioClientTransport({ command: "npx", args: ["tsx", "src/mcp/server.ts", "--workspace", ws], cwd: process.cwd(), env: { ...process.env }, stderr: "ignore" }));
  await exercise(client, "stdio");
  const exp = body(await client.callTool({ name: "export_music", arguments: { preset: "web", ids: ["shop_theme"] } }));
  console.log("[stdio] export web:", exp.dirs?.map((d) => path.relative(ws, d)).join(", "), "songs", exp.songs?.length, "files", exp.files, "ogg", exp.ogg);
  if (!exp.files) fail("stdio: export_music");
  await client.close();
}

// HTTP (Streamable HTTP on a spare port)
{
  const port = 18859 + Math.floor(Math.random() * 500);
  const proc = spawn("npx", ["tsx", "src/mcp/server.ts", "--http", "--port", String(port), "--workspace", ws], { stdio: ["ignore", "ignore", "pipe"] });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("MCP HTTP did not start")), 20000);
    proc.stderr.on("data", (d) => {
      if (/listening|http:\/\//i.test(String(d))) {
        clearTimeout(t);
        resolve();
      }
    });
  });
  const client = new Client({ name: "smoke-http", version: "0.0.1" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
  await exercise(client, "http");
  await client.close();
  proc.kill();
}

rmSync(ws, { recursive: true, force: true });
console.log(process.exitCode ? "MCP smoke FAILED" : "MCP smoke OK");
process.exit(process.exitCode ?? 0);
