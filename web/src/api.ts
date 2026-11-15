import type { Diagnostic, MusicParams, ResolvedSong } from "../../src/shared/types";

export interface SongListItem {
  id: string;
  th: string;
  en: string;
  category: string;
  tags: string[];
  source: "preset" | "workspace";
  bpm: number;
  seconds: number;
}

export interface WorkspaceSummary {
  root: string;
  config: { name: string; ogg: boolean };
  songs: SongListItem[];
  broken: Array<{ id: string; errors: Diagnostic[] }>;
}

async function json<T>(res: Response): Promise<T> {
  const body = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? res.statusText);
  return body;
}

export const fetchWorkspace = () => fetch("/api/workspace").then((r) => json<WorkspaceSummary>(r));
export const fetchSong = (id: string) => fetch(`/api/songs/${id}`).then((r) => json<{ song: ResolvedSong; doc: unknown; errors: Diagnostic[]; warnings: Diagnostic[] }>(r));
export const saveSong = (id: string, doc: unknown) =>
  fetch(`/api/songs/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ doc }) }).then((r) => json<{ ok: boolean; file: string; errors: Diagnostic[]; warnings: Diagnostic[] }>(r));
export const exportSongs = (ids: string[] | undefined, preset: string) =>
  fetch("/api/export", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids, preset }) }).then((r) => json<{ dirs: string[]; files: number; warnings: string[]; ogg: boolean }>(r));
export const downloadWav = async (params: MusicParams, id: string) => {
  const res = await fetch("/api/render", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ params, id }) });
  if (!res.ok) throw new Error(((await res.json()) as { error: string }).error);
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = `${id}.wav`;
  a.click();
  URL.revokeObjectURL(url);
};
