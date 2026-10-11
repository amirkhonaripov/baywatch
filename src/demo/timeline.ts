import type { SceneFlags } from "./data";

export type Stage = "gate" | "bay" | "inspect" | "wash" | "ready" | "handover";
export const STAGE_ORDER: Stage[] = ["gate", "bay", "inspect", "wash", "ready", "handover"];
export const STAGE_LABEL: Record<Stage, string> = {
  gate: "Gate",
  bay: "Bay",
  inspect: "Inspection",
  wash: "Wash",
  ready: "Ready",
  handover: "Handover",
};
export const T_END = 66; // the whole visit is compressed into ~66 s of demo time
export const WINDOWS: Record<Stage, [number, number]> = {
  gate: [0, 11],
  bay: [11, 36],
  inspect: [36, 45],
  wash: [45, 52],
  ready: [52, 58],
  handover: [58, 66],
};
export const stageAt = (t: number): Stage => {
  for (const s of STAGE_ORDER) if (t < WINDOWS[s][1]) return s;
  return "handover";
};

/** The clock holds here while the stage's analysis is not ready yet (no scripted result is ever shown instead). */
export const HOLD: Record<Stage, number> = { gate: 3.4, bay: 13.0, inspect: 36.3, wash: 45.6, ready: 52.6, handover: 58 };

/** Camera-view schedule per stage (global demo time). */
export const CAM = {
  gate: { on: 3.0, scan: [3.4, 5.6], boxes: 5.6, zoom: [6.4, 8.8], type: [7.0, 8.6], chips: 8.9, booking: 9.2, off: 10.2 },
  bay: { on: 13.6, scan: [14.0, 15.4], play: [15.4, 33], off: 34 },
  inspect: { on: 36.5, scan: [36.8, 38.4], boxes: 38.4, record: 41, off: 43.8 },
  wash: { on: 46.2, scan: [46.4, 47.8], boxes: 47.8, record: 49, off: 50.6 },
  ready: { on: 53.2, scan: [53.4, 54.8], boxes: 54.8, record: 56.4, off: 57.6 },
} as const;
export const MOUNTED: Record<Exclude<Stage, "handover">, [number, number]> = {
  gate: [2.6, 10.2],
  bay: [13.2, 34],
  inspect: [36.2, 43.8],
  wash: [46.0, 50.6],
  ready: [53.0, 57.6],
};

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
export const smooth = (f: number) => f * f * (3 - 2 * f);
export const lerp = (a: number, b: number, f: number) => a + (b - a) * f;

/** 0..1 progress of the bay footage playback. */
export const bayU = (t: number) => clamp01((t - CAM.bay.play[0]) / (CAM.bay.play[1] - CAM.bay.play[0]));

/** Scripted bay sequence used for the SIMULATED 3D bay (no model involved). */
export function scenario(u: number): SceneFlags {
  const within = (a: number, b: number) => u >= a && u <= b;
  return {
    car: true,
    mechanic: within(0.06, 0.94),
    raised: within(0.14, 0.86),
    wheelOff: within(0.3, 0.5),
    hoodOpen: within(0.56, 0.74),
  };
}

// ---------- layout (world units, x to the right, z towards the viewer) ----------
export const POS = {
  gate: [-11.6, 0],
  b1: [-5, -4.4], b2: [-1.5, -4.4], b3: [2, -4.4],
  b4: [-5, 4.4], b5: [-1.5, 4.4], b6: [2, 4.4],
  inspect: [7.2, -4.4],
  wash: [7.2, 4.4],
  ready: [11.6, 4.4],
  lot: [11.6, -4.4],
} as const;
export const MY_BAY = "b5" as const;
export const MY_BAY_NO = 5;

type K = [number, number, number];
const KEYS: K[] = [
  [0, -15.5, 0],
  [2.6, -11.6, 0],
  [10, -11.6, 0],
  [12.6, -1.5, 0],
  [14, -1.5, 4.4],
  [35, -1.5, 4.4],
  [36.4, -1.5, 0],
  [38.4, 7.2, 0],
  [39.6, 7.2, -4.4],
  [44, 7.2, -4.4],
  [45, 7.2, 0],
  [46.2, 7.2, 4.4],
  [50.4, 7.2, 4.4],
  [51.2, 7.2, 0],
  [52.4, 11.6, 0],
  [53.2, 11.6, 4.4],
  [59, 11.6, 4.4],
  [60, 11.6, 0],
  [63.5, 17, 0],
  [66, 17, 0],
];
const YAW: number[] = (() => {
  let last = Math.PI / 2;
  return KEYS.map((k, i) => {
    if (i > 0) {
      const dx = k[1] - KEYS[i - 1][1];
      const dz = k[2] - KEYS[i - 1][2];
      if (Math.abs(dx) + Math.abs(dz) > 1e-6) last = Math.atan2(dx, dz);
    }
    return last;
  });
})();

export function poseAt(t: number): { x: number; z: number; yaw: number } {
  if (t <= KEYS[0][0]) return { x: KEYS[0][1], z: KEYS[0][2], yaw: YAW[1] };
  for (let i = 1; i < KEYS.length; i++) {
    if (t <= KEYS[i][0]) {
      const a = KEYS[i - 1];
      const b = KEYS[i];
      const f = smooth(clamp01((t - a[0]) / (b[0] - a[0])));
      return { x: a[1] + (b[1] - a[1]) * f, z: a[2] + (b[2] - a[2]) * f, yaw: YAW[i] };
    }
  }
  const l = KEYS[KEYS.length - 1];
  return { x: l[1], z: l[2], yaw: YAW[YAW.length - 1] };
}

// ---------- cinematic camera ----------
export type CamMode = "overview" | "gate" | "bay" | "inspect" | "wash" | "ready";
export interface CamPose {
  p: [number, number, number];
  l: [number, number, number];
}
/** CCTV mount poses: where the camera "flies to" for each stage. */
export const MOUNT: Record<Exclude<CamMode, "overview">, CamPose> = {
  gate: { p: [-8.4, 2.9, 4.4], l: [-11.9, 0.7, 0] },
  bay: { p: [1.7, 4.6, 9.4], l: [-1.5, 0.7, 4.4] },
  inspect: { p: [10.6, 3.8, 0.9], l: [7.2, 0.6, -4.4] },
  wash: { p: [4.6, 4.6, 9.4], l: [7.2, 0.6, 4.4] },
  ready: { p: [12.4, 5.6, 9.8], l: [11.6, 0.2, 3.4] },
};
const CAM_KEYS: [number, CamMode][] = [
  [0, "overview"],
  [0.7, "overview"],
  [2.6, "gate"],
  [10.2, "gate"],
  [13.2, "bay"],
  [34.0, "bay"],
  [36.2, "inspect"],
  [43.8, "inspect"],
  [46.0, "wash"],
  [50.6, "wash"],
  [53.0, "ready"],
  [57.6, "ready"],
  [61, "overview"],
  [66, "overview"],
];
export function camBlend(t: number): { a: CamMode; b: CamMode; f: number } {
  if (t <= CAM_KEYS[0][0]) return { a: CAM_KEYS[0][1], b: CAM_KEYS[0][1], f: 0 };
  for (let i = 1; i < CAM_KEYS.length; i++) {
    if (t <= CAM_KEYS[i][0]) {
      const [t0, a] = CAM_KEYS[i - 1];
      const [t1, b] = CAM_KEYS[i];
      return { a, b, f: a === b ? 0 : smooth(clamp01((t - t0) / (t1 - t0))) };
    }
  }
  const l = CAM_KEYS[CAM_KEYS.length - 1][1];
  return { a: l, b: l, f: 0 };
}
/** Which CCTV the camera is currently locked on (null while flying / in overview). */
export function mountedAt(t: number): Exclude<Stage, "handover"> | null {
  for (const k of Object.keys(MOUNTED) as Exclude<Stage, "handover">[]) {
    if (t >= MOUNTED[k][0] && t <= MOUNTED[k][1]) return k;
  }
  return null;
}

export const fmtT = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
