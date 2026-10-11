// In-browser video sampling: the video file never leaves the device; only JPEG frames + timestamps are uploaded.
// Limits mirror serve/core.py: 2 fps, long side <= 720 px, <= 60 s, <= 120 frames.

export const SAMPLE_FPS = 2;
export const MAX_LONG_SIDE = 720;
export const MAX_SECONDS = 60;
export const MAX_FRAMES = 120;
export const JPEG_QUALITY = 0.82;

/** Timestamps (s) to sample: 0, 1/fps, ... strictly before min(duration, maxSeconds); at least [0]. */
export function sampleTimes(duration: number, fps = SAMPLE_FPS, maxSeconds = MAX_SECONDS, maxFrames = MAX_FRAMES): number[] {
  if (!Number.isFinite(duration) || duration <= 0) return [0];
  const end = Math.min(duration, maxSeconds);
  const out: number[] = [];
  for (let i = 0; out.length < maxFrames; i++) {
    const t = Math.round((i / fps) * 1000) / 1000;
    if (i > 0 && t >= end - 1e-6) break;
    out.push(t);
  }
  return out;
}

/** n timestamps spread evenly over [0, min(duration, MAX_SECONDS)), for long timelapse/CCTV clips. */
export function spreadTimes(duration: number, n: number): number[] {
  if (!Number.isFinite(duration) || duration <= 0 || n <= 1) return [0];
  const end = Math.min(duration, MAX_SECONDS);
  return Array.from({ length: n }, (_, i) => Math.round(((i + 0.5) * end / n) * 1000) / 1000);
}

/** Scale (w, h) so the long side is <= maxLong, keeping aspect; never upscales; even integers. */
export function targetSize(w: number, h: number, maxLong = MAX_LONG_SIDE): [number, number] {
  if (!(w > 0 && h > 0)) return [0, 0];
  const s = Math.min(1, maxLong / Math.max(w, h));
  const even = (v: number) => Math.max(2, 2 * Math.round((v * s) / 2));
  return s === 1 ? [Math.round(w), Math.round(h)] : [even(w), even(h)];
}

/** Make timestamps non-decreasing and millisecond-rounded (seek results can jitter slightly). */
export function monotonic(ts: number[]): number[] {
  const out: number[] = [];
  let prev = 0;
  for (const t of ts) {
    const v = Math.max(prev, Math.round(Math.max(0, t) * 1000) / 1000);
    out.push(v);
    prev = v;
  }
  return out;
}

export interface SampledFrame {
  blob: Blob;
  t: number;
}

export interface SampledVideo {
  frames: SampledFrame[];
  duration: number;
  truncated: boolean;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
  firstFrameUrl: string;
}

function once(el: HTMLMediaElement, ev: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => {
      cleanup();
      reject(new Error(`video: timed out waiting for ${ev}`));
    }, timeoutMs);
    const ok = () => {
      cleanup();
      resolve();
    };
    const bad = () => {
      cleanup();
      reject(new Error(`video could not be decoded by this browser (${el.error?.message || "unsupported format"})`));
    };
    const cleanup = () => {
      clearTimeout(to);
      el.removeEventListener(ev, ok);
      el.removeEventListener("error", bad);
    };
    el.addEventListener(ev, ok, { once: true });
    el.addEventListener("error", bad, { once: true });
  });
}

type RVFCVideo = HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };

/** Seek and resolve once the frame at `t` is decoded and presented (seeked + requestVideoFrameCallback when
 *  available). Always performs a real seek: drawing right after load/play can otherwise paint a black frame. */
async function seek(video: HTMLVideoElement, t: number): Promise<void> {
  const v = video as RVFCVideo;
  const target = Math.abs(video.currentTime - t) < 1e-3 ? t + 1e-3 : t;
  const presented =
    typeof v.requestVideoFrameCallback === "function"
      ? new Promise<void>((r) => {
          const to = setTimeout(r, 250);
          v.requestVideoFrameCallback!(() => {
            clearTimeout(to);
            r();
          });
        })
      : Promise.resolve();
  const seeked = once(video, "seeked", 10000);
  video.currentTime = target;
  await seeked;
  await presented;
}

/** Mean brightness (0..255) of a small downsample of the canvas: guards against a not-yet-painted frame. */
function meanLevel(ctx: CanvasRenderingContext2D, w: number, h: number): number {
  const sx = Math.max(1, Math.floor(w / 16));
  const sy = Math.max(1, Math.floor(h / 16));
  const d = ctx.getImageData(0, 0, w, h).data;
  let s = 0;
  let n = 0;
  for (let y = 0; y < h; y += sy)
    for (let x = 0; x < w; x += sx) {
      const i = (y * w + x) * 4;
      s += d[i] + d[i + 1] + d[i + 2];
      n += 3;
    }
  return n ? s / n : 0;
}

function toBlob(canvas: HTMLCanvasElement, quality = JPEG_QUALITY): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("could not encode JPEG"))), "image/jpeg", quality),
  );
}

/**
 * Sample a local video file at 2 fps (<= 60 s, long side <= 720 px).
 * Rotation: iPhone videos carry a rotation matrix; current Safari, Chrome and Firefox report videoWidth/videoHeight
 * AFTER applying it and drawImage() paints the rotated frame, so we size the canvas from videoWidth/videoHeight and
 * never rotate manually (doing so would double-rotate).
 */
export async function sampleVideo(
  file: Blob,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
  spread?: number, // if set: this many frames spread evenly over the clip (instead of 2 fps from the start)
): Promise<SampledVideo> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.setAttribute("muted", "");
  video.setAttribute("playsinline", "");
  video.playsInline = true;
  video.preload = "auto";
  try {
    const meta = once(video, "loadedmetadata", 20000);
    video.src = url;
    video.load();
    await meta;
    let duration = video.duration;
    if (!Number.isFinite(duration)) {
      // MediaRecorder/webm files can report Infinity until we seek past the end.
      await seek(video, 1e7);
      duration = video.currentTime;
    }
    // iOS Safari paints nothing to canvas until the element has played once.
    try {
      await video.play();
      video.pause();
    } catch {
      /* autoplay refused: seeking still works on desktop browsers */
    }
    const sw = video.videoWidth;
    const sh = video.videoHeight;
    if (!sw || !sh) throw new Error("video has no picture track");
    const [w, h] = targetSize(sw, sh);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("canvas 2D not available");
    const times = spread ? spreadTimes(duration, spread) : sampleTimes(duration);
    const frames: SampledFrame[] = [];
    const actual: number[] = [];
    for (let i = 0; i < times.length; i++) {
      if (signal?.aborted) throw new DOMException("cancelled", "AbortError");
      await seek(video, times[i]);
      ctx.drawImage(video, 0, 0, w, h);
      // First frame only: if nothing was painted yet (all black), give the decoder a moment and redraw.
      for (let k = 0; i === 0 && k < 4 && meanLevel(ctx, w, h) < 1; k++) {
        await new Promise((r) => setTimeout(r, 120));
        ctx.drawImage(video, 0, 0, w, h);
      }
      frames.push({ blob: await toBlob(canvas), t: 0 });
      // Report the requested time unless the browser landed clearly elsewhere (seek snaps to the frame at t).
      actual.push(Math.abs(video.currentTime - times[i]) < 0.02 ? times[i] : video.currentTime);
      onProgress?.(i + 1, times.length);
    }
    monotonic(actual).forEach((t, i) => (frames[i].t = t));
    return {
      frames,
      duration,
      truncated: duration > MAX_SECONDS,
      width: w,
      height: h,
      sourceWidth: sw,
      sourceHeight: sh,
      firstFrameUrl: URL.createObjectURL(frames[0].blob),
    };
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}
