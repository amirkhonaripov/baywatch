/**
 * Floor engine: one function turns (simulated day + your car + sim time) into everything the console shows.
 *
 * Background traffic = sim/day.py output (public/day/floor.json): 4 simulated bays (1, 3, 5, 6), the same cars run
 * "without DNA" and "with DNA". Bay 2 is reserved for the car you drive in at the gate; Bay 4 is driven by real public
 * CCTV (tyre shop) analysed live. Everything time-based is in sim seconds since 08:00.
 */
export type Mode = "with" | "without";

export interface SchedCar {
  car: string; plate: string; vehicle: string; job?: string; lines?: string[];
  arrival_s: number; bay?: number; bay_start_s?: number; work_end_s?: number; parts_wait_s?: number; in_bay_wait_s?: number;
  bay_free_s?: number; ready_s?: number; notified_s?: number; pickup_s?: number;
  phantom_lines?: string[]; flagged_before_handover?: string[]; served: boolean;
}
export interface Run { with_dna: boolean; schedule: SchedCar[]; metrics: Record<string, number> }
export interface FloorData {
  note: string; assumptions: Record<string, unknown>;
  without: Run; with: Run;
  summary: { extra_cars_per_day: number; avg_bay_job_hours: number; revenue_formula: string };
}

export const DAY_START_S = 0; // 08:00
export const CLOCK0 = 2.5 * 3600; // console opens at 10:30, floor already busy
export const DAY_END_S = 9 * 3600; // 17:00
export const SPEED = 120; // sim seconds per real second (2 sim min / s)
export const BAYS = [1, 2, 3, 4, 5, 6] as const;
export const REAL_BAYS: Record<number, string> = { 2: "your car · real CCTV example", 4: "real CCTV (tyre shop)" };

export const clock = (s: number) => {
  const m = Math.floor(s / 60) + 8 * 60;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

// ---------------- your car ----------------
export type UStage = "gate" | "reception" | "to_bay" | "bay" | "inspect" | "wash" | "ready" | "handover" | "gone";
/** Your visit, in sim minutes after drive-in. */
export const U: [UStage, number][] = [
  ["gate", 0], ["reception", 3], ["to_bay", 10], ["bay", 12], ["inspect", 72], ["wash", 80], ["ready", 92], ["handover", 110], ["gone", 114],
];
export const U_BAY_MIN: [number, number] = [12, 72];
export function uStage(minAfter: number): UStage {
  let s: UStage = "gate";
  for (const [k, t] of U) if (minAfter >= t) s = k;
  return s;
}

export interface UserVisit {
  t0: number; // sim seconds when it drove in
  plate: string | null; // null = not readable
  vehicle: string; colour: string; model: string;
  lines: string[];
  verifications?: { code: string; status: string }[];
}

// ---------------- snapshot ----------------
export type BayStatus = "working" | "parts" | "blocked" | "free";
export interface BayView {
  bay: number; status: BayStatus; since: number; plate?: string; vehicle?: string; lifted: boolean; person: boolean;
  mine?: boolean; source: "sim" | "real" | "you";
}
export interface Alert {
  id: string; kind: "parts" | "blocked" | "notify" | "handover"; at: number; title: string; detail: string; camera: string; plate?: string;
  /** with AI monitoring: when the issue was cleared; without: undefined (nobody saw it) */
  resolvedAt?: number; resolution?: string; unseen?: boolean;
}
export interface VisitRow { plate: string; where: string; stage: string; eta?: string; flag?: string; mine?: boolean; source: "sim" | "you" }
export interface Snapshot {
  t: number;
  bays: BayView[];
  lot: number; washing: number; ready: number;
  kpi: { arrived: number; handed: number; busy: number; idleMin: number; told: number; readyNow: number; caught: number; slipped: number; recovered: number };
  alerts: Alert[];
  visits: VisitRow[];
}

const inside = (t: number, a?: number, b?: number) => a !== undefined && b !== undefined && t >= a && t < b;
const ov = (t: number, a?: number, b?: number) => (a === undefined || b === undefined ? 0 : Math.max(0, Math.min(t, b) - a));

/** Deterministic "is the car lifted" per car (different jobs). */
const liftedFor = (c: SchedCar) => !/express|wash/.test(c.job ?? "") && (c.car.charCodeAt(c.car.length - 1) % 3 !== 0);

export function snapshot(d: FloorData, mode: Mode, t: number, you: UserVisit | null, bay4Working: boolean): Snapshot {
  const run = mode === "with" ? d.with : d.without;
  const other = mode === "with" ? d.without : d.with;
  const bays: Record<number, BayView> = {};
  for (const b of BAYS) bays[b] = { bay: b, status: "free", since: 0, lifted: false, person: false, source: "sim" };
  bays[4] = { bay: 4, status: bay4Working ? "working" : "free", since: 0, lifted: false, person: bay4Working, source: "real", plate: "example", vehicle: "suv" };

  let lot = 0, washing = 0, ready = 0, arrived = 0, handed = 0, told = 0, readyNow = 0, caught = 0, slipped = 0, idle = 0;
  const visits: VisitRow[] = [];
  for (const c of run.schedule) {
    if (c.arrival_s > t) continue;
    arrived++;
    if (!c.served || c.bay_start_s === undefined) {
      lot++;
      visits.push({ plate: c.plate, where: "Waiting lot", stage: "waiting · no bay today", source: "sim" });
      continue;
    }
    const workEnd = c.work_end_s!;
    const waitEnd = workEnd + (c.in_bay_wait_s ?? 0);
    idle += ov(t, workEnd, waitEnd) + ov(t, waitEnd, c.bay_free_s);
    if (c.pickup_s! <= t) {
      handed++;
      if (c.notified_s! <= t) told++;
      caught += c.flagged_before_handover?.length ?? 0;
      slipped += (c.phantom_lines?.length ?? 0) - (c.flagged_before_handover?.length ?? 0);
      continue;
    }
    const b = bays[c.bay!];
    if (t < c.bay_start_s) {
      lot++;
      visits.push({ plate: c.plate, where: "Waiting lot", stage: "waiting for a bay", source: "sim" });
    } else if (inside(t, c.bay_start_s, workEnd)) {
      Object.assign(b, { status: "working", since: c.bay_start_s, plate: c.plate, vehicle: c.vehicle, lifted: liftedFor(c), person: true });
      visits.push({ plate: c.plate, where: `Bay ${c.bay}`, stage: "in work", eta: clock(c.ready_s!), source: "sim" });
    } else if (inside(t, workEnd, waitEnd)) {
      Object.assign(b, { status: "parts", since: workEnd, plate: c.plate, vehicle: c.vehicle, lifted: liftedFor(c), person: false });
      visits.push({ plate: c.plate, where: `Bay ${c.bay}`, stage: "waiting for parts", flag: "idle", source: "sim" });
    } else if (inside(t, waitEnd, c.bay_free_s)) {
      Object.assign(b, { status: "blocked", since: waitEnd, plate: c.plate, vehicle: c.vehicle, lifted: false, person: false });
      visits.push({ plate: c.plate, where: `Bay ${c.bay}`, stage: "work done, still in bay", flag: "blocked", source: "sim" });
    } else if (t < c.ready_s!) {
      washing++;
      visits.push({ plate: c.plate, where: "Wash / yard", stage: "wash", eta: clock(c.ready_s!), source: "sim" });
    } else {
      ready++;
      readyNow++;
      const isTold = t >= c.notified_s!;
      if (isTold) told++;
      visits.push({ plate: c.plate, where: "Ready zone", stage: isTold ? "ready · customer told" : "ready · customer NOT told", flag: isTold ? undefined : "untold", source: "sim" });
    }
  }

  // ---------- alert feed ----------
  const feed: Alert[] = [];
  const recent = (a: Alert) => a.at <= t && (a.resolvedAt === undefined || a.resolvedAt > t || t - a.resolvedAt < 40 * 60);
  for (const c of run.schedule) {
    if (!c.served || c.bay_start_s === undefined || c.arrival_s > t) continue;
    const workEnd = c.work_end_s!, waitEnd = workEnd + (c.in_bay_wait_s ?? 0);
    const mins = (a: number, b: number) => Math.max(1, Math.round((b - a) / 60));
    if (mode === "with") {
      if ((c.parts_wait_s ?? 0) > 0)
        feed.push({ id: `p${c.car}`, kind: "parts", at: workEnd + 300, camera: `b${c.bay}`, plate: c.plate,
          title: `Bay ${c.bay}: no work at the car for 5 min`, detail: "Waiting for parts? Move it to the lot and take the next car.",
          resolvedAt: waitEnd, resolution: `car moved out, bay freed ${mins(workEnd + 300, waitEnd)} min after the alert` });
      feed.push({ id: `b${c.car}`, kind: "blocked", at: waitEnd + 60, camera: `b${c.bay}`, plate: c.plate,
        title: `Bay ${c.bay}: work finished, car still in the bay`, detail: "Free the bay for the next car.",
        resolvedAt: c.bay_free_s, resolution: `bay freed in ${mins(waitEnd, c.bay_free_s!)} min` });
      feed.push({ id: `n${c.car}`, kind: "notify", at: c.ready_s!, camera: "ready", plate: c.plate,
        title: `${c.plate} is ready`, detail: "Customer messaged automatically.", resolvedAt: c.notified_s, resolution: "message sent" });
      const fl = c.flagged_before_handover ?? [];
      if (fl.length)
        feed.push({ id: `h${c.car}`, kind: "handover", at: c.ready_s!, camera: `b${c.bay}`, plate: c.plate,
          title: `${c.plate}: ${fl.length} paid line${fl.length > 1 ? "s" : ""} not observed`, detail: `${fl.map(pretty).join(", ")} — check before handover.`,
          resolvedAt: c.pickup_s! - 600, resolution: "checked with the customer before handover" });
    } else {
      // nobody is watching: issues still happen, but no alert is raised
      if ((c.parts_wait_s ?? 0) > 0 && inside(t, workEnd, waitEnd))
        feed.push({ id: `p${c.car}`, kind: "parts", at: workEnd, camera: `b${c.bay}`, plate: c.plate, unseen: true,
          title: `Bay ${c.bay}: no work for ${Math.round((t - workEnd) / 60)} min`, detail: "Car waiting for parts blocks the bay — nobody has noticed." });
      if (inside(t, waitEnd, c.bay_free_s))
        feed.push({ id: `b${c.car}`, kind: "blocked", at: waitEnd, camera: `b${c.bay}`, plate: c.plate, unseen: true,
          title: `Bay ${c.bay}: finished ${Math.round((t - waitEnd) / 60)} min ago`, detail: "Car still in the bay; next car waits in the lot." });
      if (inside(t, c.ready_s, c.notified_s))
        feed.push({ id: `n${c.car}`, kind: "notify", at: c.ready_s!, camera: "ready", plate: c.plate, unseen: true,
          title: `${c.plate} ready ${Math.round((t - c.ready_s!) / 60)} min — customer not told`, detail: "They will call, or wait." });
    }
  }
  // served-so-far in the other run, to show what DNA recovered up to now
  const handedOther = other.schedule.filter((c) => c.served && c.pickup_s! <= t).length;

  // your car
  if (you && t >= you.t0) {
    const m = (t - you.t0) / 60;
    const st = uStage(m);
    const p = you.plate ?? "plate not readable";
    if (st === "bay") {
      Object.assign(bays[2], { status: "working", since: you.t0 + U_BAY_MIN[0] * 60, plate: p, vehicle: you.model, lifted: false, person: true, mine: true, source: "you" });
    }
    if (st !== "gone") {
      arrived++;
      const where = { gate: "Gate", reception: "Reception", to_bay: "Driving to Bay 2", bay: "Bay 2", inspect: "Inspection lane", wash: "Wash", ready: "Ready zone", handover: "Handover", gone: "Left" }[st];
      const stage = st === "ready" ? (mode === "with" ? "ready · customer told" : "ready · customer NOT told") : st === "bay" ? "in work" : st.replace("_", " ");
      visits.unshift({ plate: p, where, stage, eta: clock(you.t0 + U[6][1] * 60), mine: true, source: "you" });
      const notObs = (you.verifications ?? []).filter((v) => v.status === "not_observed");
      if (mode === "with" && (st === "ready" || st === "handover") && notObs.length)
        feed.push({ id: "you-h", kind: "handover", at: you.t0 + U[6][1] * 60, title: `${p}: ${notObs.length} paid line${notObs.length > 1 ? "s" : ""} not observed`, detail: `${notObs.map((v) => pretty(v.code)).join(", ")} — check before handover.`, camera: "b2", plate: p });
    } else handed++;
  }

  const shown = feed.filter((a) => a.unseen || recent(a)).sort((a, b) => b.at - a.at);
  return {
    t, bays: BAYS.map((b) => bays[b]), lot, washing, ready,
    kpi: { arrived, handed, busy: BAYS.filter((b) => bays[b].status === "working").length, idleMin: Math.round(idle / 60), told, readyNow, caught, slipped, recovered: mode === "with" ? handed - handedOther : 0 },
    alerts: shown.slice(0, 7), visits,
  };
}

export const pretty = (code: string) => code.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

// ---------------- insights: what the manager should fix, from today's floor so far ----------------
export interface Insight { key: string; value: string; what: string; action: string; bad: boolean }

/** Day-so-far causes of lost bay time and waiting, each with the action a service manager can take. */
export function insights(d: FloorData, mode: Mode, t: number): Insight[] {
  const run = mode === "with" ? d.with : d.without;
  const on = mode === "with";
  let partsMin = 0, partsCars = 0, leftMin = 0, leftCars = 0, queueSum = 0, queueN = 0, readySum = 0, readyN = 0, lateTold = 0;
  let paid = 0, flagged = 0;
  const perHour: Record<number, number> = {};
  for (const c of run.schedule) {
    if (c.arrival_s > t) continue;
    perHour[Math.floor(c.arrival_s / 3600)] = (perHour[Math.floor(c.arrival_s / 3600)] ?? 0) + 1;
    if (!c.served || c.bay_start_s === undefined) continue;
    if (c.bay_start_s <= t) { queueSum += c.bay_start_s - c.arrival_s; queueN++; }
    const workEnd = c.work_end_s!, waitEnd = workEnd + (c.in_bay_wait_s ?? 0);
    const p = ov(t, workEnd, waitEnd);
    if ((c.parts_wait_s ?? 0) > 0 && p > 0) { partsMin += p / 60; partsCars++; }
    const l = ov(t, waitEnd, c.bay_free_s);
    if (l > 0) { leftMin += l / 60; leftCars++; }
    if (c.ready_s !== undefined && c.ready_s <= t) {
      const w = Math.min(t, c.notified_s ?? t) - c.ready_s;
      readySum += w; readyN++;
      if (w > 30 * 60) lateTold++;
    }
    if (c.pickup_s !== undefined && c.pickup_s <= t) {
      paid += c.phantom_lines?.length ?? 0;
      flagged += c.flagged_before_handover?.length ?? 0;
    }
  }
  const hm = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h ${Math.round(m % 60)} min` : `${Math.round(m)} min`);
  const peak = Object.entries(perHour).sort((a, b) => b[1] - a[1])[0];
  const peakTxt = peak ? `${String(8 + +peak[0]).padStart(2, "0")}:00–${String(9 + +peak[0]).padStart(2, "0")}:00` : "–";
  return [
    { key: "parts", value: hm(partsMin), bad: partsMin > 30,
      what: `bay time lost to ${partsCars} car${partsCars === 1 ? "" : "s"} waiting for parts`,
      action: on ? "Alert after 5 min: move the car to the lot, take the next one." : "Nobody notices. Check parts before the car goes into a bay." },
    { key: "left", value: hm(leftMin), bad: leftMin > 30,
      what: `finished cars left standing in a bay (${leftCars} car${leftCars === 1 ? "" : "s"})`,
      action: on ? "Alert 1 min after work ends: drive it out." : "The next car waits in the lot meanwhile." },
    { key: "queue", value: queueN ? hm(queueSum / queueN / 60) : "–", bad: queueN > 0 && queueSum / queueN > 30 * 60,
      what: `average wait for a free bay · busiest arrivals ${peakTxt}`,
      action: `Book fewer walk-ins for ${peakTxt}; move them to the afternoon.` },
    { key: "paid", value: on ? `${flagged} of ${paid}` : `0 of ${paid}`, bad: !on && paid > 0,
      what: "paid lines with no camera evidence, caught before handover",
      action: on ? "Ask the technician before the car is handed over." : "Found later by the customer, if ever." },
  ];
}
