/** Web Audio playback of rendered stereo buffers, looping from the song's loop point. */
let ctx: AudioContext | null = null;
let current: { src: AudioBufferSourceNode; started: number; offset: number; seconds: number; loopStart: number } | null = null;

export function audioCtx(): AudioContext {
  ctx ??= new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

export function playStereo(left: Float32Array, right: Float32Array, sampleRate: number, opts: { loopStart: number; loop: boolean; offset?: number }) {
  const ac = audioCtx();
  stopAll();
  const buf = ac.createBuffer(2, Math.max(1, left.length), sampleRate);
  buf.copyToChannel(left as Float32Array<ArrayBuffer>, 0);
  buf.copyToChannel(right as Float32Array<ArrayBuffer>, 1);
  const src = ac.createBufferSource();
  src.buffer = buf;
  src.loop = opts.loop;
  src.loopStart = opts.loopStart;
  src.loopEnd = buf.duration;
  src.connect(ac.destination);
  const offset = Math.max(0, Math.min(buf.duration - 0.01, opts.offset ?? 0));
  src.start(0, offset);
  const entry = { src, started: ac.currentTime, offset, seconds: buf.duration, loopStart: opts.loopStart };
  current = entry;
  src.onended = () => {
    if (current === entry) current = null;
  };
}

export function stopAll() {
  if (current) {
    try {
      current.src.stop();
    } catch {
      /* already stopped */
    }
    current = null;
  }
}

/** Playback position in seconds within the file (wrapping into the loop), or null. */
export function position(): number | null {
  if (!current || !ctx) return null;
  const t = current.offset + ctx.currentTime - current.started;
  if (t < current.seconds || !current.src.loop) return Math.min(t, current.seconds);
  const loopLen = current.seconds - current.loopStart;
  return current.loopStart + ((t - current.seconds) % loopLen);
}
