import type { AnalysisResult, BayState, Detection, Event, FrameResult } from "../contracts";
import { asset } from "../state";

// ---------- demo booking list (simulated dealer-system lookup; NOT real customer data) ----------
export interface Booking {
  plate: string; // normalised: A-Z0-9 only
  title: string;
  customer: string;
  vehicle: string;
  vin: string;
  lines: string[];
  workOrderId: string;
}

export const DEMO_BOOKINGS: Booking[] = [
  {
    plate: "40B472RA",
    title: "30,000 km service",
    customer: "Demo customer A.",
    vehicle: "Demo vehicle",
    vin: "DEMO1TASHKENT0001",
    lines: ["coolant_check", "chassis_diagnostics", "cabin_filter"],
    workOrderId: "WO-DEMO-0001",
  },
  {
    plate: "01A123BC",
    title: "10,000 km service",
    customer: "Demo customer B.",
    vehicle: "Demo vehicle",
    vin: "DEMO1TASHKENT0002",
    lines: ["oil_filter_change", "brake_pads", "air_filter"],
    workOrderId: "WO-DEMO-0002",
  },
  {
    plate: "10X777XA",
    title: "Brake and tyre check",
    customer: "Demo customer C.",
    vehicle: "Demo vehicle",
    vin: "DEMO1TASHKENT0003",
    lines: ["tyre_rotation", "brake_fluid", "wiper_blades"],
    workOrderId: "WO-DEMO-0003",
  },
];

export const normPlate = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

function edit(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

export interface Match {
  booking: Booking;
  distance: number;
}
/** Plate -> booking with up to 2 characters of OCR tolerance. null when nothing in the demo list is close. */
export function lookupBooking(plateText: string | undefined): Match | null {
  if (!plateText) return null;
  const p = normPlate(plateText);
  if (p.length < 5) return null;
  let best: Match | null = null;
  for (const b of DEMO_BOOKINGS) {
    const distance = edit(p, b.plate);
    if (distance <= 2 && (!best || distance < best.distance)) best = { booking: b, distance };
  }
  return best;
}

// ---------- plate / vehicle helpers ----------
export interface PlateInfo {
  status: "read" | "unreadable" | "none";
  text?: string;
  confidence?: number;
  bbox?: [number, number, number, number];
}

const VEH = ["car", "truck", "bus", "motorcycle"];
const area = (d: Detection) => (d.bbox[2] - d.bbox[0]) * (d.bbox[3] - d.bbox[1]);

/** Frame to show for the gate: the one with the most confident plate, else the largest vehicle, else the first. */
export function gateFrameIndex(r: AnalysisResult): number {
  let bi = 0;
  let bs = -1;
  r.frames.forEach((f, i) => {
    const pl = Math.max(0, ...f.detections.filter((d) => d.cls === "plate").map((d) => d.confidence));
    const ve = Math.max(0, ...f.detections.filter((d) => VEH.includes(d.cls)).map(area));
    const sc = pl * 10 + ve;
    if (sc > bs) {
      bs = sc;
      bi = i;
    }
  });
  return bi;
}
export function vehicleBox(r: AnalysisResult, fi: number): [number, number, number, number] | null {
  const v = (r.frames[fi]?.detections || []).filter((d) => VEH.includes(d.cls)).sort((a, b) => area(b) - area(a))[0];
  return v ? v.bbox : null;
}
export function vehicleKind(r: AnalysisResult, fi: number): string {
  const t = r.visit?.vehicle?.vehicle_type;
  if (t && t !== "unknown") return t;
  return (r.frames[fi]?.detections || []).find((d) => VEH.includes(d.cls))?.cls || "vehicle";
}

export function plateInfo(r: AnalysisResult): PlateInfo {
  const veh = r.visit?.vehicle;
  const det: Detection | undefined = r.frames.flatMap((f) => f.detections).filter((d) => d.cls === "plate").sort((a, b) => b.confidence - a.confidence)[0];
  const text = (veh?.plate_text || det?.text || "").trim();
  const conf = veh?.plate_confidence ?? det?.confidence;
  if (!det && !text) return { status: "none" };
  const foreign = veh?.plate_format === "foreign";
  const bad = !text || (conf !== undefined && conf < 0.6) || (veh?.plate_format_valid === false && !foreign);
  return { status: bad ? "unreadable" : "read", text: text || undefined, confidence: conf, bbox: det?.bbox };
}

export function hasVehicle(r: AnalysisResult): boolean {
  if (r.visit?.vehicle) return true;
  return r.frames.some((f) => f.detections.some((d) => VEH.includes(d.cls)));
}

// ---------- colour estimate ----------
export interface Colour {
  hex: string;
  name: string;
}
function nameOf(r: number, g: number, b: number): string {
  const mx = Math.max(r, g, b) / 255;
  const mn = Math.min(r, g, b) / 255;
  const l = (mx + mn) / 2;
  const d = mx - mn;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (l > 0.86) return "white";
  if (l < 0.14) return "black";
  if (s < 0.16) return l > 0.55 ? "silver" : "grey";
  const rr = r / 255, gg = g / 255, bb = b / 255;
  let h = 0;
  if (mx === rr) h = ((gg - bb) / d) % 6;
  else if (mx === gg) h = (bb - rr) / d + 2;
  else h = (rr - gg) / d + 4;
  h = (h * 60 + 360) % 360;
  if (h < 15 || h >= 345) return "red";
  if (h < 45) return l < 0.4 ? "brown" : "orange";
  if (h < 70) return "yellow";
  if (h < 160) return "green";
  if (h < 200) return "teal";
  if (h < 260) return "blue";
  return "purple";
}
/** Median colour of the lower-middle part of the vehicle box (avoids the windscreen and the background). */
export function dominantColour(url: string, box: [number, number, number, number]): Promise<Colour | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const [x1, y1, x2, y2] = box;
        const w = x2 - x1;
        const h = y2 - y1;
        const sx = (x1 + w * 0.2) * img.naturalWidth;
        const sy = (y1 + h * 0.45) * img.naturalHeight;
        const sw = Math.max(4, w * 0.6 * img.naturalWidth);
        const sh = Math.max(4, h * 0.35 * img.naturalHeight);
        const c = document.createElement("canvas");
        c.width = 48;
        c.height = 24;
        const ctx = c.getContext("2d", { willReadFrequently: true });
        if (!ctx) return resolve(null);
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, 48, 24);
        const d = ctx.getImageData(0, 0, 48, 24).data;
        const ch: number[][] = [[], [], []];
        for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) ch[k].push(d[i + k]);
        const med = ch.map((a) => a.sort((p, q) => p - q)[a.length >> 1]);
        const hex = "#" + med.map((v) => v.toString(16).padStart(2, "0")).join("");
        resolve({ hex, name: nameOf(med[0], med[1], med[2]) });
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

export function skipReason(r: AnalysisResult): string {
  const s = r.route.skipped.find((x) => /vehicle|plate|no /i.test(x.reason + x.module)) || r.route.skipped[0];
  if (r.route.scene === "unknown") return "The scene was not recognised as a service-centre scene.";
  return s ? `${s.module.replace(/_/g, " ")}: ${s.reason}` : "No car, truck or bus was detected in the photo.";
}

export function modelFor(r: AnalysisResult | null): string {
  const t = r?.visit?.vehicle?.vehicle_type;
  const cls = r?.frames[0]?.detections.find((d) => ["car", "truck", "bus", "motorcycle"].includes(d.cls))?.cls;
  const k = t && t !== "unknown" ? t : cls;
  if (k === "truck" || k === "bus") return "suv";
  if (k === "motorcycle") return "hatchback-sports";
  return "sedan";
}

// ---------- bay states ----------
export const BAY_CHIPS: { key: string; label: string; states: BayState[] }[] = [
  { key: "car", label: "Car in bay", states: ["car_present"] },
  { key: "raised", label: "Lift raised", states: ["raised"] },
  { key: "wheel", label: "Wheel off", states: ["wheel_off"] },
  { key: "hood", label: "Bonnet open", states: ["hood_open"] },
  { key: "mech", label: "Mechanic working", states: ["person_at_car", "work"] },
];
export const THRESH = 0.5;

export const chipProb = (f: FrameResult | undefined, states: BayState[]): number =>
  f?.states ? Math.max(...states.map((s) => f.states?.[s] ?? 0)) : 0;

export interface SceneFlags {
  car: boolean;
  raised: boolean;
  wheelOff: boolean;
  hoodOpen: boolean;
  mechanic: boolean;
}
export const flagsFor = (f: FrameResult | undefined): SceneFlags => ({
  car: chipProb(f, ["car_present"]) >= THRESH,
  raised: chipProb(f, ["raised"]) >= THRESH,
  wheelOff: chipProb(f, ["wheel_off"]) >= THRESH,
  hoodOpen: chipProb(f, ["hood_open"]) >= THRESH,
  mechanic: chipProb(f, ["person_at_car", "work"]) >= THRESH,
});

/** Index of the frame with the highest probability for this chip (null when never >= threshold). */
export function bestFrame(frames: FrameResult[], states: BayState[]): number | null {
  let bi: number | null = null;
  let bp = THRESH - 1e-9;
  frames.forEach((f, i) => {
    const p = chipProb(f, states);
    if (p > bp) {
      bp = p;
      bi = i;
    }
  });
  return bi;
}

// ---------- stage footage ----------
export type SourceKind = "user" | "sample" | "real" | "synth" | "sim" | "dataset" | "lot";
export const SOURCE_LABEL: Record<SourceKind, string> = {
  user: "Your input",
  sample: "Your input (sample photo)",
  real: "Example footage — different car (public CCTV)",
  synth: "Synthetic render",
  sim: "Simulated",
  dataset: "Real photo (public dataset) — different car",
  lot: "Real parking camera (public dataset)",
};

export interface BayFrame {
  url: string;
  t: number; // timestamp sent to the API
  blob?: Blob;
  file?: string;
}
export interface Footage {
  kind: "real" | "synth" | "user";
  title: string;
  frames: BayFrame[];
  note?: string;
}

interface ManifestFrame {
  file: string;
  clip?: string;
  episode?: string;
  title?: string;
  t_s: number;
}
let manifestP: Promise<Record<string, ManifestFrame[]>> | null = null;
export function loadManifest() {
  manifestP ??= fetch(asset("stages/manifest.json"))
    .then((r) => {
      if (!r.ok) throw new Error(`stage manifest not found (${r.status})`);
      return r.json();
    })
    .then((j) => j.stages as Record<string, ManifestFrame[]>);
  return manifestP;
}

export const API_MAX_SECONDS = 3600;

/** First clip/episode of a stage, with the frames' blobs. Timestamps come from the manifest; if they exceed the API's
 *  60 s limit (the synthetic episodes span 18 min) they are scaled down and `note` says so. */
export async function loadStage(kind: "real" | "synth"): Promise<Footage> {
  const m = await loadManifest();
  const all = m[kind === "real" ? "bay_real" : "bay_synth"] || [];
  const first = all[0]?.clip || all[0]?.episode;
  const frames = all.filter((f) => (f.clip || f.episode) === first);
  if (!frames.length) throw new Error("no footage listed for this stage");
  const tmax = Math.max(...frames.map((f) => f.t_s));
  const k = tmax > API_MAX_SECONDS ? API_MAX_SECONDS / tmax : 1;
  const out: BayFrame[] = [];
  for (const f of frames) {
    const r = await fetch(asset(f.file));
    if (!r.ok) throw new Error(`footage frame missing: ${f.file}`);
    const blob = await r.blob();
    out.push({ blob, url: URL.createObjectURL(blob), t: Math.round(f.t_s * k * 1000) / 1000, file: f.file });
  }
  return {
    kind,
    title: frames[0].title || (kind === "real" ? "Real CCTV (public)" : "Blender render"),
    frames: out,
    note: k < 1 ? `Footage spans ${Math.round(tmax)} s; timestamps were scaled to ${API_MAX_SECONDS} s to fit the API limit.` : undefined,
  };
}

// ---------- simulated tail (wash, ready, handover) ----------
export type SimStep = "wash" | "ready" | "handover";
export const SIM_STEPS: SimStep[] = ["wash", "ready", "handover"];

export function simSource(r: AnalysisResult | null): { from: "engine" | "script"; events: Event[] } {
  const ev = (r?.simulated_continuation?.events || []).filter((e) => e.source === "simulated");
  const has =
    ev.some((e) => e.zone?.kind === "wash") && ev.some((e) => e.type === "ready") && ev.some((e) => e.type === "handed_over");
  return has ? { from: "engine", events: ev } : { from: "script", events: [] };
}
