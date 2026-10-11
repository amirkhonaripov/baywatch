import { useSyncExternalStore } from "react";
import { analyzeFrames, analyzeImage } from "../api";
import type { AnalysisResult } from "../contracts";
import { prepareImage } from "../lib/image";
import { asset } from "../state";
import type { CamId } from "./Floor3D";

/** Every camera source the console can show, and the live analysis of each (real API calls, logged). */

export type SrcKind = "you" | "real_cctv" | "real_photo" | "sim";
export interface Source {
  id: string;
  label: string;
  kind: SrcKind;
  files: { file: string; t: number }[]; // one file = photo; many = clip (sampled frames)
  credit?: string;
  licence?: string;
  note?: string;
}
export interface CamDef { id: CamId; name: string; group: "Entrance" | "Workshop" | "Quality" | "Exit"; sources: Source[]; simulated?: boolean }

export const YOUR_LINES = ["coolant_check", "chassis_diagnostics", "cabin_filter"];
export const YOUR_WORK_ORDER = { id: "WO-DEMO-0001", lines: YOUR_LINES };

export const ARRIVALS: Source[] = [
  { id: "uz_van", label: "Van · Uzbek plate", kind: "real_photo", files: [{ file: "arrivals/uz_van.jpg", t: 0 }], credit: "Roboflow Universe · Uzbek_Plates (held-out split)", licence: "CC BY 4.0" },
  { id: "rain", label: "Night · rain", kind: "real_photo", files: [{ file: "arrivals/rain.jpg", t: 0 }], credit: "Mateus S. Figueiredo · Wikimedia Commons", licence: "CC BY-SA 4.0" },
  { id: "ducati", label: "Motorcycle", kind: "real_photo", files: [{ file: "arrivals/ducati.jpg", t: 0 }], credit: "Dennis Bratland · Wikimedia Commons", licence: "CC BY-SA 4.0" },
  { id: "mustang", label: "US plate", kind: "real_photo", files: [{ file: "arrivals/mustang.jpg", t: 0 }], credit: "Phillip Pessar · Wikimedia Commons", licence: "CC BY 2.0" },
];

interface ManifestItem { file: string; clip?: string; episode?: string; t_s: number; title?: string; licence?: string; url?: string }
let manifest: Record<string, ManifestItem[]> | null = null;
export async function loadManifest(): Promise<Record<string, ManifestItem[]>> {
  if (!manifest) manifest = (await (await fetch(asset("stages/manifest.json"))).json()).stages;
  return manifest!;
}
const pickEven = <T,>(a: T[], n: number): T[] => (a.length <= n ? a : Array.from({ length: n }, (_, i) => a[Math.round((i * (a.length - 1)) / (n - 1))]));
const SKIP: Record<string, [number, number]> = { "-OJPETY9Bis": [3, 0], e4O3X9gli1s: [2, 2] };

function clipSource(m: Record<string, ManifestItem[]>, clip: string, label: string): Source {
  const all = (m.bay_real ?? []).filter((f) => f.clip === clip);
  const [a, b] = SKIP[clip] ?? [0, 0];
  const frames = pickEven(all.slice(a, all.length - b), 12);
  return { id: clip, label, kind: "real_cctv", files: frames.map((f) => ({ file: f.file, t: f.t_s })), credit: frames[0]?.title, licence: "CC BY", note: "timelapse: ~30 s between frames (approx.)" };
}
const photo = (m: Record<string, ManifestItem[]>, stage: string, i: number, label: string): Source => {
  const f = (m[stage] ?? [])[i];
  return { id: `${stage}_${i}`, label, kind: "real_photo", files: f ? [{ file: f.file, t: 0 }] : [], credit: f?.title, licence: f?.licence };
};

// held-out test images: never used to train any model (our unseen robustness set and CarDD's own test split)
const held = (name: string, label: string, credit: string, licence?: string): Source =>
  ({ id: name, label, kind: "real_photo", files: [{ file: `stages/heldout/${name}.jpg`, t: 0 }], credit: `${credit} · held-out test image`, licence });

export async function buildCams(): Promise<CamDef[]> {
  const m = await loadManifest();
  const sim = (n: number): CamDef => ({ id: `b${n}` as CamId, name: `Bay ${n}`, group: "Workshop", simulated: true, sources: [{ id: "sim", label: "Simulated view", kind: "sim", files: [] }] });
  return [
    { id: "gate", name: "Gate", group: "Entrance", sources: ARRIVALS },
    sim(1),
    { id: "b2", name: "Bay 2", group: "Workshop", sources: [clipSource(m, "-OJPETY9Bis", "Lift bay CCTV")] },
    sim(3),
    { id: "b4", name: "Bay 4", group: "Workshop", sources: [clipSource(m, "e4O3X9gli1s", "Tyre shop CCTV")] },
    sim(5), sim(6),
    { id: "inspect", name: "Inspection", group: "Quality", sources: [
      held("inspect_front", "Front damage", "CarDD test split · USTC"), held("inspect_crash", "Crash damage", "CarDD test split · USTC"),
      held("inspect_tyre", "Tyre close-up", "TyreNet test split")] },
    { id: "wash", name: "Wash", group: "Quality", sources: [
      held("wash_selfservice", "Self-service bay", "Sebastiaan Broekhoven · Wikimedia Commons", "CC BY-SA 4.0"), held("wash_entrance", "Wash entrance", "Dmitrijs Purgalvis · Wikimedia Commons", "CC BY 3.0")] },
    { id: "ready", name: "Ready lot", group: "Exit", sources: [photo(m, "ready", 0, "Lot camera")] },
  ];
}

// ---------------- live analysis store ----------------
export interface Run {
  phase: "busy" | "done" | "error";
  step?: string; // what the busy run is doing right now
  result?: AnalysisResult;
  error?: string;
  frames?: { url: string; t: number }[];
  startedAt?: number; finishedAt?: number; roundtripMs?: number;
  calls: number;
  recordedAt?: string; // set when the result is a recorded API output (public/precomputed), not a live call
}
const store: Record<string, Run> = {};
const listeners = new Set<() => void>();
let snap: Record<string, Run> = {};
const emit = () => { snap = { ...store }; listeners.forEach((l) => l()); };
export function useRuns(): Record<string, Run> {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => snap);
}
export const runKey = (cam: CamId, src: string) => `${cam}:${src}`;

async function blobOf(file: string): Promise<Blob> {
  const r = await fetch(asset(file));
  if (!r.ok) throw new Error(`missing ${file}`);
  return r.blob();
}

/** Run (or re-run with force) the live models on a camera source. Upload = a user File for the gate. */
export interface Prepared { upload?: Blob; uploadFrames?: { blob: Blob; t: number }[] }
export async function analyze(cam: CamId, src: Source, opts: { force?: boolean; workOrder?: boolean; prepare?: (step: (s: string) => void) => Promise<Prepared> } & Prepared = {}): Promise<Run | undefined> {
  const k = runKey(cam, src.id);
  const prev = store[k];
  if (!opts.force && prev && (prev.phase === "busy" || prev.phase === "done")) return prev;
  if (src.kind === "sim") return undefined;
  // built-in samples: show the recorded output of our API instantly; "Run again" (force) makes a live call
  if (!opts.force && !opts.upload && !opts.uploadFrames && !opts.prepare && src.kind !== "you") {
    try {
      const r = await fetch(asset(`precomputed/${cam}__${src.id}.json`));
      if (r.ok) {
        const rec = await r.json();
        store[k] = { phase: "done", result: rec.result, frames: src.files.map((f) => ({ url: asset(f.file), t: f.t })),
                     finishedAt: Date.parse(rec.recorded_at), roundtripMs: rec.roundtrip_ms, calls: prev?.calls ?? 0, recordedAt: rec.recorded_at };
        emit();
        return store[k];
      }
    } catch { /* no recording: fall through to a live call */ }
  }
  const calls = (prev?.calls ?? 0) + 1;
  const step = (txt: string) => { store[k] = { ...store[k], step: txt }; emit(); };
  store[k] = { ...prev, phase: "busy", step: opts.prepare ? "reading your file…" : "running on GPU…", error: undefined, calls, startedAt: Date.now() };
  emit();
  let t0 = performance.now();
  try {
    if (opts.prepare) {
      Object.assign(opts, await opts.prepare(step));
      // show the user's own frames while the GPU works
      const preview = opts.uploadFrames?.map((f) => ({ url: URL.createObjectURL(f.blob), t: f.t })) ?? (opts.upload ? [{ url: URL.createObjectURL(opts.upload), t: 0 }] : undefined);
      store[k] = { ...store[k], frames: preview };
      step(opts.uploadFrames ? `running on GPU · ${opts.uploadFrames.length} frames…` : "running on GPU…");
      t0 = performance.now();
    }
    let result: AnalysisResult;
    let frames: { url: string; t: number }[];
    if (opts.uploadFrames?.length) {
      frames = opts.uploadFrames.map((f) => ({ url: URL.createObjectURL(f.blob), t: f.t }));
      result = await analyzeFrames(opts.uploadFrames, { simulate: false, workOrder: opts.workOrder ? YOUR_WORK_ORDER : null }, () => {});
    } else if (opts.upload) {
      const prep = await prepareImage(opts.upload);
      frames = [{ url: URL.createObjectURL(prep.blob), t: 0 }];
      result = await analyzeImage(prep.blob, { simulate: false }, () => {});
    } else if (src.files.length === 1) {
      const b = await blobOf(src.files[0].file);
      frames = [{ url: URL.createObjectURL(b), t: 0 }];
      result = await analyzeImage(b, { simulate: false }, () => {});
    } else {
      const blobs = await Promise.all(src.files.map((f) => blobOf(f.file)));
      frames = blobs.map((b, i) => ({ url: URL.createObjectURL(b), t: src.files[i].t }));
      result = await analyzeFrames(blobs.map((b, i) => ({ blob: b, t: src.files[i].t })), { simulate: false, workOrder: opts.workOrder ? YOUR_WORK_ORDER : null }, () => {});
    }
    store[k] = { phase: "done", result, frames, startedAt: store[k].startedAt, finishedAt: Date.now(), roundtripMs: performance.now() - t0, calls };
  } catch (e) {
    store[k] = { ...store[k], phase: "error", error: e instanceof Error ? e.message : String(e), calls };
  }
  emit();
  return store[k];
}

/** Warm the GPU and pre-run every real camera (except the gate, which runs when a car drives in). */
export async function warmAll(cams: CamDef[]): Promise<void> {
  for (const c of cams) {
    if (c.id === "gate" || c.simulated) continue;
    for (const s of c.sources) void analyze(c.id, s, { workOrder: c.id === "b2" });
  }
}
