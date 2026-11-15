/**
 * Bake favicon / PWA icons from the Easy Suite 16×16 Easy Music icon on a teak tile.
 * Usage: npx tsx scripts/write-icons.mts
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { encodePng } from "../src/lib/png.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "web", "public");

const PAL: Record<string, [number, number, number, number]> = {
  s: [46, 32, 20, 255],
  o: [26, 18, 11, 255],
  a: [155, 209, 59, 255],
  d: [96, 129, 36, 255],
  l: [223, 255, 103, 255],
  c: [246, 231, 200, 255],
  k: [43, 29, 20, 255],
  s: [224, 168, 120, 255],
  h: [124, 86, 50, 255],
  m: [62, 83, 23, 255],
  w: [86, 160, 210, 255],
  r: [214, 72, 56, 255],
};
export const ART = [
  "ssssssssssssssss",
  "sssssaaaaaaaaass",
  "sssssaaaaaaaaass",
  "sssssasssssssass",
  "sssssasssssssass",
  "sssssasssssssass",
  "sssccasssssccass",
  "sscccasssscccass",
  "sssccssssssccsss",
  "ssssssssssssssss",
  "soooooooooooooos",
  "solodolodolodoos",
  "solodolodolodoos",
  "soooooooooooooos",
  "sshhsssssssshhss",
  "ssssssssssssssss",
];

function render(size: number): Buffer {
  const px = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) px.set(PAL[ART[Math.floor((y * 16) / size)]![Math.floor((x * 16) / size)]!] ?? PAL.s!, (y * size + x) * 4);
  return encodePng(size, size, px);
}

if (ART.some((r) => r.length !== 16)) throw new Error(`icon rows must be 16 wide: ${ART.map((r) => r.length).join(",")}`);
await mkdir(outDir, { recursive: true });
await mkdir(path.join(root, "docs", "assets"), { recursive: true });
for (const [name, size] of [["favicon-32.png", 32], ["icon-192.png", 192], ["icon-512.png", 512], ["apple-touch-icon.png", 180]] as const) await writeFile(path.join(outDir, name), render(size));
await writeFile(path.join(root, "docs", "assets", "icon-512.png"), render(512));
const rects: string[] = [];
ART.forEach((row, y) => [...row].forEach((ch, x) => rects.push(`<rect x="${x}" y="${y}" width="1" height="1" fill="rgb(${PAL[ch]!.slice(0, 3).join(",")})"/>`)));
await writeFile(path.join(outDir, "favicon.svg"), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges">${rects.join("")}</svg>\n`);
await writeFile(path.join(outDir, "site.webmanifest"), `${JSON.stringify({ name: "Easy Music", short_name: "Easy Music", icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }, { src: "/icon-512.png", sizes: "512x512", type: "image/png" }], theme_color: "#f4ae3d", background_color: "#140e0a", display: "standalone" }, null, 2)}\n`);
console.log("icons written");
