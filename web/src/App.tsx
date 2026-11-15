import { useEffect, useMemo, useRef, useState } from "react";
import { PERC_TOKENS, STEPS_PER_BAR } from "../../src/shared/compose";
import { INSTRUMENT_INFO } from "../../src/shared/instruments";
import { monoOf, renderSong, stats, type SongRender } from "../../src/shared/render";
import { BAR_CHOICES, validateParams } from "../../src/shared/songs";
import { MODE_LABELS, degreeName } from "../../src/shared/theory";
import { FORMAT, INSTRUMENTS, KEYS, MODES, MOODS, PERC, ROLES, TUNINGS, type Layer, type MusicParams, type ResolvedSong, type Role } from "../../src/shared/types";
import { drawWaveform, type Ctx2D } from "../../src/shared/waveform";
import { downloadWav, exportSongs, fetchSong, fetchWorkspace, saveSong, type WorkspaceSummary } from "./api";
import { playStereo, position, stopAll } from "./audio";

const EXPORTS = [
  { id: "godot", label: "Godot 4.3+", hint: "MusicPlayer autoload · OGG loops" },
  { id: "web", label: "Web / PixiJS", hint: "easymusic-web.js + demo" },
  { id: "audio", label: "WAV / OGG", hint: "+ waveforms + manifest" },
  { id: "all", label: "All", hint: "godot · web · audio · json" },
] as const;

const ROLE_COLORS: Record<Role, string> = { lead: "#f4ae3d", counter: "#8fc7e8", skeleton: "#e5806c", bass: "#a99be0", drone: "#79c48a", pad: "#79c48a", perc: "#cdb492" };

function Waveform({ r, title, sub, pos }: { r: SongRender | null; title: string; sub: string; pos: number | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const mono = useMemo(() => (r ? monoOf(r.left, r.right) : null), [r]);
  useEffect(() => {
    const c = ref.current;
    if (!c || !mono || !r) return;
    const g = c.getContext("2d")!;
    drawWaveform(g as unknown as Ctx2D, mono, { w: c.width, h: c.height, px: 3, sampleRate: r.sampleRate, title, subtitle: sub, beatSec: r.score.stepSec * STEPS_PER_BAR, loop: true, font: '"IBM Plex Sans Thai", "IBM Plex Sans", sans-serif' });
    if (r.loopStart > 0) {
      g.fillStyle = "#79c48a";
      g.fillRect(6 + Math.floor((r.loopStart / r.left.length) * (c.width - 12)), 60, 3, c.height - 66);
    }
  }, [mono, r, title, sub]);
  return (
    <div className="wave-wrap">
      <canvas ref={ref} className="wave-canvas" width={960} height={200} />
      {pos !== null && r && <span className="wave-head" style={{ left: `calc(6px + ${pos / r.seconds} * (100% - 12px))` }} />}
    </div>
  );
}

function PianoRoll({ r, p, pos }: { r: SongRender | null; p: MusicParams; pos: number | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c || !r) return;
    const g = c.getContext("2d")!;
    const { score } = r;
    g.fillStyle = "#140e0a";
    g.fillRect(0, 0, c.width, c.height);
    const total = score.totalSteps;
    const sx = c.width / total;
    const percRows = score.layers.filter((l) => l.hits.length).length;
    const percH = 10;
    const rollH = c.height - percRows * percH - 4;
    const all = score.layers.flatMap((l) => l.notes.map((n) => n.deg));
    const lo = Math.min(...all, 0) - 1;
    const hi = Math.max(...all, 10) + 1;
    const rowH = rollH / (hi - lo);
    for (let b = 0; b <= total; b += STEPS_PER_BAR) {
      g.fillStyle = b === score.introSteps ? "#79c48a" : (b - score.introSteps) % (score.phraseBars * STEPS_PER_BAR) === 0 ? "#523822" : "#2a1d13";
      g.fillRect(Math.floor(b * sx), 0, 1, c.height);
    }
    for (const l of score.layers) {
      g.fillStyle = ROLE_COLORS[l.layer.role];
      g.globalAlpha = l.layer.mute ? 0.15 : l.layer.role === "lead" ? 1 : 0.7;
      for (const n of l.notes) g.fillRect(Math.floor(n.step * sx), Math.floor(rollH - (n.deg - lo + 1) * rowH), Math.max(1, Math.floor(n.len * sx) - 1), Math.max(2, Math.floor(rowH) - 1));
    }
    g.globalAlpha = 1;
    let row = 0;
    for (const l of score.layers) {
      if (!l.hits.length) continue;
      const y = rollH + 4 + row * percH;
      g.fillStyle = "#1e150e";
      g.fillRect(0, y, c.width, percH - 2);
      const toks = Object.keys(PERC_TOKENS[l.layer.instrument as keyof typeof PERC_TOKENS] ?? {});
      for (const h of l.hits) {
        g.fillStyle = toks.indexOf(h.tok) === 0 ? "#f4ae3d" : toks.indexOf(h.tok) === 1 ? "#e5806c" : "#8fc7e8";
        g.globalAlpha = l.layer.mute ? 0.2 : 0.4 + h.vel * 0.6;
        g.fillRect(Math.floor(h.step * sx), y, Math.max(2, Math.floor(sx)), percH - 2);
      }
      g.globalAlpha = 1;
      row++;
    }
    g.fillStyle = "#97805f";
    g.font = "11px IBM Plex Mono, monospace";
    g.fillText(`${degreeName(hi - 1, p.key, p.mode)}`, 4, 12);
    g.fillText(`${degreeName(lo + 1, p.key, p.mode)}`, 4, rollH - 4);
  }, [r, p.key, p.mode]);
  return (
    <div className="wave-wrap">
      <canvas ref={ref} className="roll-canvas" width={960} height={240} />
      {pos !== null && r && <span className="wave-head" style={{ left: `${(pos / r.seconds) * 100}%` }} />}
    </div>
  );
}

export function App() {
  const [ws, setWs] = useState<WorkspaceSummary | null>(null);
  const [song, setSong] = useState<ResolvedSong | null>(null);
  const [params, setParams] = useState<MusicParams | null>(null);
  const [r, setR] = useState<SongRender | null>(null);
  const [rendering, setRendering] = useState(false);
  const [pos, setPos] = useState<number | null>(null);
  const [loop, setLoop] = useState(true);
  const [q, setQ] = useState("");
  const [saveId, setSaveId] = useState("");
  const [status, setStatus] = useState("");
  const [showJson, setShowJson] = useState(false);

  const refresh = () => fetchWorkspace().then(setWs).catch((e: Error) => setStatus(e.message));
  useEffect(() => {
    void refresh().then(() => open("village_day"));
    let raf = 0;
    const tick = () => {
      setPos(position());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const validation = useMemo(() => (params ? validateParams(params) : { errors: [], warnings: [] }), [params]);

  // render in the browser (same code as the CLI → identical samples), debounced
  useEffect(() => {
    if (!params || validation.errors.length) return;
    setRendering(true);
    const t = setTimeout(() => {
      const t0 = performance.now();
      const res = renderSong(params);
      setR(res);
      setRendering(false);
      setStatus(`rendered in ${Math.round(performance.now() - t0)} ms`);
    }, 250);
    return () => clearTimeout(t);
  }, [params, validation.errors.length]);

  async function open(id: string) {
    stopAll();
    try {
      const res = await fetchSong(id);
      setSong(res.song);
      setParams(res.song.params);
      setSaveId(res.song.source === "workspace" ? id : `my_${id}`);
      setStatus(`${id} loaded`);
    } catch (e) {
      setStatus((e as Error).message);
    }
  }

  const set = <K extends keyof MusicParams>(k: K, v: MusicParams[K]) => setParams((p) => (p ? { ...p, [k]: v } : p));
  const setLayer = (i: number, patch: Partial<Layer>) => setParams((p) => (p ? { ...p, layers: p.layers.map((l, j) => (j === i ? { ...l, ...patch } : l)) } : p));
  const play = (offset = 0) => r && playStereo(r.left, r.right, r.sampleRate, { loopStart: r.loopStart / r.sampleRate, loop, offset });

  async function save() {
    if (!params || !song) return;
    const doc = { format: FORMAT, th: song.th, en: song.en, category: song.category, tags: song.tags, params };
    const res = await saveSong(saveId, doc);
    setStatus(res.ok ? `saved ${res.file}` : `not saved: ${res.errors.map((e) => `${e.path}: ${e.message}`).join("; ")}`);
    if (res.ok) void refresh();
  }

  async function doExport(preset: string) {
    setStatus(`exporting ${preset}…`);
    try {
      const res = await exportSongs(undefined, preset);
      setStatus(`exported ${res.files} files → ${res.dirs.join(", ")}${res.ogg ? " (ogg)" : ""}${res.warnings.length ? ` · ${res.warnings.join("; ")}` : ""}`);
    } catch (e) {
      setStatus((e as Error).message);
    }
  }

  const groups = useMemo(() => {
    const m = new Map<string, WorkspaceSummary["songs"]>();
    for (const s of ws?.songs ?? []) {
      if (q && !`${s.id} ${s.th} ${s.en} ${s.tags.join(" ")}`.toLowerCase().includes(q.toLowerCase())) continue;
      const k = s.source === "workspace" ? "workspace" : s.category;
      m.set(k, [...(m.get(k) ?? []), s]);
    }
    return [...m.entries()];
  }, [ws, q]);

  const st = r ? stats(r.left, r.right, r.sampleRate) : null;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark" />
          <div>
            <h1 className="brand">
              Easy <span>Music</span>
            </h1>
            <p className="brand-th">เพลงวนลูปสไตล์ไทย · seeded Thai loop music for games</p>
          </div>
        </div>
        <div className="status">{status}</div>
      </header>
      <main className="layout">
        <aside className="panel list">
          <input className="search" placeholder="search songs…" value={q} onChange={(e) => setQ(e.target.value)} />
          {groups.map(([k, items]) => (
            <div key={k}>
              <h3>{k}</h3>
              {items.map((s) => (
                <button key={s.id} className={`item-btn ${song?.id === s.id ? "on" : ""}`} onClick={() => open(s.id)}>
                  <b>{s.id}</b>
                  <small>
                    {s.th} · {s.bpm} bpm · {s.seconds.toFixed(0)} s
                  </small>
                </button>
              ))}
            </div>
          ))}
        </aside>
        <section className="panel preview">
          <div className="toolbar">
            <button className="primary" disabled={!r || rendering} onClick={() => play(0)}>
              ▶ Play
            </button>
            <button disabled={!r} onClick={() => r && play(Math.max(r.loopStart / r.sampleRate, r.seconds - 3))} title="Start 3 s before the loop end to hear the seam">
              ⟲ Hear the seam
            </button>
            <button onClick={stopAll}>■ Stop</button>
            <label>
              <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} /> loop
            </label>
            <span className="mono small">{rendering ? "rendering…" : st ? `${st.seconds.toFixed(2)} s · peak ${st.peak} · rms ${st.rms} · form ${r!.score.form.join(" ")}` : ""}</span>
          </div>
          <Waveform r={r} pos={pos} title={song ? `${song.id} · ${song.th}` : ""} sub={params ? `${params.mode} in ${params.key} · ${params.tuning} · ${params.bpm} bpm · ${params.bars} bars${params.introBars ? ` + ${params.introBars} intro` : ""}` : ""} />
          {params && <PianoRoll r={r} p={params} pos={pos} />}
          <p className="hint">
            Lines: <span style={{ color: ROLE_COLORS.lead }}>lead</span> · <span style={{ color: ROLE_COLORS.skeleton }}>skeleton (khong wong)</span> · <span style={{ color: ROLE_COLORS.counter }}>counter (ranat / khim)</span> · <span style={{ color: ROLE_COLORS.bass }}>bass</span> · <span style={{ color: ROLE_COLORS.pad }}>drone / pad</span>; percussion rows below. Green bar = loop point. Instrumental only: no vocals, no adhan, no chant.
          </p>
          <div className="export-grid">
            {EXPORTS.map((x) => (
              <button key={x.id} onClick={() => doExport(x.id)}>
                {x.label}
                <small>{x.hint}</small>
              </button>
            ))}
          </div>
        </section>
        <aside className="panel params">
          {params && song && (
            <>
              <h2>
                {song.th} <small>{song.en}</small>
              </h2>
              <div className="top-fields">
                <Sel label="Mood" v={params.mood} opts={MOODS} on={(v) => set("mood", v)} />
                <Sel label="Mode" v={params.mode} opts={MODES} labels={Object.fromEntries(MODES.map((m) => [m, `${m} · ${MODE_LABELS[m].th}`]))} on={(v) => set("mode", v)} />
                <Sel label="Key" v={params.key} opts={KEYS} on={(v) => set("key", v)} />
                <Sel label="Tuning" v={params.tuning} opts={TUNINGS} labels={{ equal12: "12-tone (chip friendly)", thai7: "Thai 7-tone equal" }} on={(v) => set("tuning", v)} />
                <Num label="BPM" v={params.bpm} min={50} max={200} step={1} on={(v) => set("bpm", v)} />
                <Sel label="Bars" v={String(params.bars)} opts={BAR_CHOICES.map(String)} on={(v) => set("bars", Number(v))} />
                <Num label="Intro bars" v={params.introBars} min={0} max={4} step={1} on={(v) => set("introBars", v)} />
                <label className="field">
                  <span>Seed</span>
                  <input type="number" value={params.seed} onChange={(e) => set("seed", Math.max(0, Math.round(Number(e.target.value))))} />
                  <button onClick={() => set("seed", Math.floor(Math.random() * 100000))} title="New seed">
                    🎲
                  </button>
                </label>
                <Num label="Swing" v={params.swing} min={0} max={0.5} step={0.01} on={(v) => set("swing", v)} />
                <Num label="Density" v={params.density} min={0} max={1} step={0.05} on={(v) => set("density", v)} />
                <Num label="Energy" v={params.energy} min={0} max={1} step={0.05} on={(v) => set("energy", v)} />
                <Num label="Gain" v={params.gain} min={0} max={1} step={0.05} on={(v) => set("gain", v)} />
              </div>
              <h4>Layers</h4>
              {params.layers.map((l, i) => (
                <div className="layer-card" key={i} style={{ borderLeftColor: ROLE_COLORS[l.role] }}>
                  <div className="row">
                    <select value={l.role} onChange={(e) => setLayer(i, { role: e.target.value as Role })}>
                      {ROLES.map((x) => (
                        <option key={x}>{x}</option>
                      ))}
                    </select>
                    <select value={l.instrument} onChange={(e) => setLayer(i, { instrument: e.target.value as Layer["instrument"], ...((PERC as readonly string[]).includes(e.target.value) ? { role: "perc" as Role } : {}) })}>
                      {INSTRUMENTS.map((x) => (
                        <option key={x} value={x}>
                          {INSTRUMENT_INFO[x].th} · {x}
                        </option>
                      ))}
                    </select>
                    <label className="check">
                      <input type="checkbox" checked={!l.mute} onChange={(e) => setLayer(i, { mute: !e.target.checked })} /> on
                    </label>
                    <button className="x" onClick={() => setParams({ ...params, layers: params.layers.filter((_, j) => j !== i) })} title="Remove layer">
                      ✕
                    </button>
                  </div>
                  <Num label="Volume" v={l.volume} min={0} max={1.5} step={0.05} on={(v) => setLayer(i, { volume: v })} />
                  {l.role !== "perc" && <Num label="Octave" v={l.octave ?? 0} min={-3} max={3} step={1} on={(v) => setLayer(i, { octave: v })} />}
                  <Num label="Pan" v={l.pan ?? 0} min={-1} max={1} step={0.05} on={(v) => setLayer(i, { pan: v })} />
                </div>
              ))}
              {params.layers.length < 8 && (
                <button className="link" onClick={() => setParams({ ...params, layers: [...params.layers, { role: "counter", instrument: "khim", volume: 0.8 }] })}>
                  + add layer
                </button>
              )}
              <div className="diag">
                {validation.errors.map((d, i) => (
                  <p key={i} className="err">
                    {d.path}: {d.message}
                  </p>
                ))}
                {validation.warnings.map((d, i) => (
                  <p key={i} className="warn">
                    {d.path}: {d.message}
                  </p>
                ))}
              </div>
              <div className="save">
                <input value={saveId} onChange={(e) => setSaveId(e.target.value)} />
                <div className="row">
                  <button className="primary" disabled={!!validation.errors.length} onClick={save}>
                    Save to songs/
                  </button>
                  <button disabled={!!validation.errors.length} onClick={() => downloadWav(params, saveId).catch((e: Error) => setStatus(e.message))}>
                    Download .wav
                  </button>
                  <button onClick={() => setParams(song.params)}>Reset</button>
                </div>
              </div>
              <button className="link" onClick={() => setShowJson(!showJson)}>
                {showJson ? "hide" : "show"} JSON
              </button>
              {showJson && <pre className="json">{JSON.stringify({ format: FORMAT, params }, null, 2)}</pre>}
            </>
          )}
        </aside>
      </main>
    </div>
  );
}

function Sel<T extends string>({ label, v, opts, labels, on }: { label: string; v: T; opts: readonly T[]; labels?: Record<string, string>; on: (v: T) => void }) {
  return (
    <label className="field check-sel">
      <span>{label}</span>
      <select value={v} onChange={(e) => on(e.target.value as T)}>
        {opts.map((o) => (
          <option key={o} value={o}>
            {labels?.[o] ?? o}
          </option>
        ))}
      </select>
    </label>
  );
}

function Num({ label, v, min, max, step, on }: { label: string; v: number; min: number; max: number; step: number; on: (v: number) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={v} onChange={(e) => on(Number(e.target.value))} />
      <input type="number" min={min} max={max} step={step} value={v} onChange={(e) => on(Number(e.target.value))} />
    </label>
  );
}
