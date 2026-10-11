import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import "../demo/demo.css";
import "../console/console.css";
import type { AnalysisResult, BayState } from "../contracts";
import { CameraView, toBoxes } from "../demo/parts";
import { BAY_CHIPS, THRESH, chipProb, dominantColour, lookupBooking, modelFor, plateInfo, vehicleBox } from "../demo/data";
import { analyze, buildCams, loadManifest, runKey, useRuns, warmAll, YOUR_LINES, type CamDef, type Prepared, type Run, type Source } from "../console/cams";
import { sampleVideo } from "../lib/sampler";
import { CLOCK0, DAY_END_S, SPEED, U, U_BAY_MIN, clock, insights, pretty, snapshot, uStage, type FloorData, type Mode, type UserVisit } from "../console/engine";
import type { CamId } from "../console/Floor3D";
import { asset, useApp } from "../state";

const Floor3D = lazy(() => import("../console/Floor3D"));
const REAL: Set<CamId> = new Set(["gate", "b2", "b4", "inspect", "wash", "ready"]);
const CAM_FOR_STAGE: Record<string, CamId> = { gate: "gate", reception: "gate", to_bay: "b2", bay: "b2", inspect: "inspect", wash: "wash", ready: "ready", handover: "ready" };
const STATUS_TXT: Record<string, string> = { working: "working", parts: "waiting for parts", blocked: "done · blocking bay", free: "free" };
const LINE_TXT: Record<string, string> = { evidence_found: "Evidence found", not_observed: "Not observed", not_camera_verifiable: "Not camera-verifiable" };

function useFloor() {
  const [d, setD] = useState<FloorData | null>(null);
  useEffect(() => { fetch(asset("day/floor.json")).then((r) => r.json()).then(setD).catch(() => setD(null)); }, []);
  return d;
}

/** Frame index of a clip for the current moment: your car's progress in Bay 2, otherwise a loop over sim time. */
function clipIdx(n: number, t: number, you: UserVisit | null, cam: CamId, pool?: number[]): number {
  if (!n) return 0;
  if (cam === "b2" && you) {
    const m = (t - you.t0) / 60;
    // while the tracked car is in the bay, step through the frames where the model sees a car
    const idx = pool?.length ? pool : Array.from({ length: n }, (_, i) => i);
    if (m >= U_BAY_MIN[0] && m < U_BAY_MIN[1]) return idx[Math.min(idx.length - 1, Math.floor(((m - U_BAY_MIN[0]) / (U_BAY_MIN[1] - U_BAY_MIN[0])) * idx.length))];
  }
  return Math.floor(((t / 60) % 30) / 30 * n) % n;
}

function AiLog({ run, onRerun }: { run?: Run; onRerun: () => void }) {
  if (!run) return null;
  const r = run.result;
  const mv = r?.model_versions ?? {};
  const server = r?.timings_ms?.server_total ?? r?.timings_ms?.total;
  return (
    <div className="ailog">
      <div className="ailog-head">
        <b>AI log</b>
        {run.phase === "busy" && <span className="spin">{run.step ?? "running on GPU…"}</span>}
        {run.phase === "error" && <span className="err">{run.error}</span>}
        <button className="btn xs" onClick={onRerun} disabled={run.phase === "busy"}>Run again</button>
      </div>
      {run.phase === "done" && r && (
        <dl>
          {run.recordedAt
            ? <><dt>Output</dt><dd>recorded from our API on {new Date(run.recordedAt).toLocaleString()} · {r.frames.length} frame{r.frames.length > 1 ? "s" : ""} · “Run again” calls the GPU live</dd></>
            : <><dt>Called</dt><dd>{new Date(run.finishedAt ?? Date.now()).toLocaleTimeString()} · live call #{run.calls} · {r.frames.length} frame{r.frames.length > 1 ? "s" : ""}</dd></>}
          <dt>Time</dt><dd>{server ? `${Math.round(server)} ms on server` : "–"} · {Math.round(run.roundtripMs ?? 0)} ms round trip</dd>
          {r.route && <><dt>Router</dt><dd>scene <b>{r.route.scene}</b> {Math.round(r.route.confidence * 100)}% · ran {r.route.ran.join(", ") || "–"}</dd></>}
          {!!r.route?.skipped?.length && <><dt>Skipped</dt><dd>{r.route.skipped.map((k) => `${k.module} (${k.reason})`).join(" · ")}</dd></>}
          <dt>Models</dt><dd>{Object.entries(mv).map(([k, v]) => `${k} ${v}`).join(" · ")}</dd>
        </dl>
      )}
    </div>
  );
}

const WASH_CHIPS: { key: string; label: string; states: BayState[] }[] = [
  { key: "car", label: "Car present", states: ["car_present"] },
  { key: "wash", label: "Washing", states: ["washing"] },
  { key: "person", label: "Person at car", states: ["person_at_car"] },
];
// the tracked visit as clickable events: each jumps the clock to that moment and opens the camera that saw it
const VISIT_EVENTS: { m: number; cam: CamId; label: string; what: string }[] = [
  { m: 0.5, cam: "gate", label: "Arrives", what: "vehicle + plate read, booking matched" },
  { m: 3.5, cam: "gate", label: "Checked in", what: "customer messaged automatically" },
  { m: 14, cam: "b2", label: "Bay 2 · work starts", what: "bay states: car, lift, mechanic" },
  { m: 45, cam: "b2", label: "Work in progress", what: "work-order lines matched to camera evidence" },
  { m: 73, cam: "inspect", label: "Inspection", what: "damage → part, tyre condition" },
  { m: 81, cam: "wash", label: "Wash", what: "wash scene + washing state" },
  { m: 93, cam: "ready", label: "Ready", what: "customer told the car is ready" },
  { m: 111, cam: "ready", label: "Handover", what: "paid lines not observed are flagged" },
];
const UPLOAD_FRAMES = 16; // a clip upload is read as 16 frames spread over its length (≤ ~25 s on a warm GPU)

export function Console() {
  const { health } = useApp();
  const data = useFloor();
  const [cams, setCams] = useState<CamDef[]>([]);
  const runs = useRuns();
  const [mode, setMode] = useState<Mode>("with");
  const tRef = useRef(CLOCK0);
  const [t, setT] = useState(CLOCK0);
  const [playing, setPlaying] = useState(true);
  const [sel, setSel] = useState<CamId>("gate");
  const [srcIdx, setSrcIdx] = useState<Record<string, number>>({});
  const [you, setYou] = useState<UserVisit | null>(null);
  const [gateRunKey, setGateRunKey] = useState<string | null>(null);
  const lastGate = useRef<{ src: Source; blob?: Blob; frames?: { blob: Blob; t: number }[] } | null>(null);
  const [money, setMoney] = useState(false);
  const [camUpload, setCamUpload] = useState<Partial<Record<CamId, string>>>({});
  const [synth, setSynth] = useState<Record<string, string[]>>({});
  const upRef = useRef<HTMLInputElement>(null);
  const [rate, setRate] = useState(20);
  const manualAt = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { buildCams().then((c) => { setCams(c); void warmAll(c); }); }, []);
  // Blender renders of our bay (synthetic) for the simulated bay cameras
  useEffect(() => {
    loadManifest().then((m) => {
      const by: Record<string, string[]> = {};
      for (const f of m.bay_synth ?? []) (by[f.episode ?? "x"] ||= []).push(f.file);
      setSynth(by);
    });
  }, []);

  // clock
  useEffect(() => {
    if (!playing) return;
    let raf = 0, last = performance.now(), acc = 0;
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      tRef.current = Math.min(DAY_END_S, tRef.current + dt * SPEED);
      acc += dt;
      if (acc > 0.2) { acc = 0; setT(tRef.current); }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const camOf = (id: CamId) => cams.find((c) => c.id === id);
  const srcOf = (c?: CamDef): Source | undefined => (c ? c.sources[Math.min(srcIdx[c.id] ?? 0, c.sources.length - 1)] : undefined);
  const runOf = (id: CamId): Run | undefined => {
    if (id === "gate") return gateRunKey ? runs[gateRunKey] : undefined;
    if (camUpload[id]) return runs[camUpload[id]!];
    const c = camOf(id);
    const s = srcOf(c);
    return s ? runs[runKey(id, s.id)] : undefined;
  };

  // bay-2 analysis gives your work-order evidence and the lift/bonnet/mechanic states in 3D
  const b2 = runOf("b2");
  const b4 = runOf("b4");
  const b2Frames = b2?.result?.frames ?? [];
  const verifs = b2?.result?.visit?.verifications ?? [];
  useEffect(() => {
    if (you && verifs.length && !you.verifications) setYou({ ...you, verifications: verifs.map((v) => ({ code: v.line_code, status: v.status })) });
  }, [you, verifs]);

  const uMin = you ? (t - you.t0) / 60 : -1;
  const ust = you ? uStage(uMin) : null;
  const b2Car = useMemo(() => b2Frames.flatMap((f, i) => (chipProb(f, ["car_present"]) >= THRESH ? [i] : [])), [b2Frames]);
  const yourFrame = b2Frames[clipIdx(b2Frames.length, t, you, "b2", b2Car)];
  const youFlags = { lifted: chipProb(yourFrame, ["raised"]) >= THRESH, person: chipProb(yourFrame, ["person_at_car", "work"]) >= THRESH };
  const b4Frames = b4?.result?.frames ?? [];
  const b4f = b4Frames[clipIdx(b4Frames.length, t, null, "b4")];
  const bay4Working = !!b4f && (chipProb(b4f, ["car_present"]) >= THRESH || chipProb(b4f, ["person_at_car", "work"]) >= THRESH);

  const snap = useMemo(() => (data ? snapshot(data, mode, t, you, bay4Working) : null), [data, mode, t, you, bay4Working]);

  // auto-follow your car's camera (unless the manager clicked something in the last 12 s)
  useEffect(() => {
    if (!ust || ust === "gone") return;
    const c = CAM_FOR_STAGE[ust];
    if (c && c !== sel && performance.now() - manualAt.current > 12000) setSel(c);
  }, [ust]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = useCallback((c: CamId) => { manualAt.current = performance.now(); setSel(c); }, []);
  const jump = (ts: number, c: CamId) => { tRef.current = ts; setT(ts); setPlaying(false); manualAt.current = performance.now(); setSel(c); };

  // ---------- drive a car in ----------
  const driveIn = useCallback(async (src: Source, upload?: Blob, uploadFrames?: { blob: Blob; t: number }[], prepare?: (step?: (s: string) => void) => Promise<Prepared>, live = false) => {
    setSel("gate");
    manualAt.current = 0;
    lastGate.current = { src, blob: upload, frames: uploadFrames };
    const gsrc = upload || uploadFrames || prepare ? { ...src, id: `upload_${Date.now()}` } : src;
    setGateRunKey(runKey("gate", gsrc.id));
    const prep = prepare && (async (step?: (s: string) => void) => { const x = await prepare(step); lastGate.current = { src, blob: x.upload, frames: x.uploadFrames }; return x; });
    const r = await analyze("gate", gsrc, { force: live || !!(upload || uploadFrames || prep), upload, uploadFrames, prepare: prep });
    const res = r?.result;
    if (!res) return;
    const vi = res.frames.findIndex((f) => f.detections.some((d) => ["car", "truck", "bus", "motorcycle"].includes(d.cls)));
    if (vi < 0) { setYou(null); return; }
    const pi = plateInfo(res);
    const box = vehicleBox(res, vi);
    const col = box && r?.frames?.[vi] ? await dominantColour(r.frames[vi].url, box) : null;
    const booking = lookupBooking(pi.status === "read" ? pi.text : undefined);
    setYou({
      t0: tRef.current + 60, plate: pi.status === "read" ? pi.text ?? null : null,
      vehicle: res.visit?.vehicle?.vehicle_type ?? "car", colour: col?.hex ?? "#0f766e", model: modelFor(res),
      lines: booking?.booking.lines ?? YOUR_LINES,
      verifications: verifs.length ? verifs.map((v) => ({ code: v.line_code, status: v.status })) : undefined,
    });
  }, [verifs]);

  // videos are sampled in the browser (2 fps, ≤720p); the card switches to the upload at once and shows each step
  const prepOf = (f: File) => async (step?: (s: string) => void): Promise<Prepared> =>
    f.type.startsWith("video/") ? { uploadFrames: (await sampleVideo(f, (d, n) => step?.(`reading your video · frame ${d}/${n}`), undefined, UPLOAD_FRAMES)).frames } : { upload: f };
  const driveInFile = (f: File) => driveIn({ id: "upload", label: "Your upload", kind: "you", files: [] }, undefined, undefined, prepOf(f));
  const uploadToCam = async (cam: CamId, f: File) => {
    if (cam === "gate") return driveInFile(f);
    const src: Source = { id: `upload_${Date.now()}`, label: "Your upload", kind: "you", files: [] };
    setCamUpload((u) => ({ ...u, [cam]: runKey(cam, src.id) }));
    if (cam === "b2" && you) setYou({ ...you, verifications: undefined });
    await analyze(cam, src, { force: true, prepare: prepOf(f), workOrder: cam === "b2" });
  };

  // dev only: lets the test browser feed demo_inputs files without a file picker
  if (import.meta.env.DEV) (window as unknown as { __bwUpload?: typeof uploadToCam }).__bwUpload = uploadToCam;

  if (!data || !snap) return <div className="con-loading">Loading the service floor…</div>;

  const selCam = camOf(sel);
  const selSrc = srcOf(selCam);
  const selRun = runOf(sel);
  const selBay = sel.startsWith("b") ? snap.bays.find((b) => `b${b.bay}` === sel) : undefined;
  const gateRes: AnalysisResult | undefined = runOf("gate")?.result;
  const pinfo = gateRes ? plateInfo(gateRes) : null;
  const k = snap.kpi;
  const perCar = data.summary.avg_bay_job_hours * rate;

  // camera content
  const frames = selRun?.frames ?? [];
  const fi = sel === "gate" ? 0 : clipIdx(frames.length, t, you, sel, sel === "b2" ? b2Car : undefined);
  const fr = selRun?.result?.frames[fi];
  const boxes = fr ? toBoxes(fr.detections, { minConf: 0.4 }) : [];
  const isClip = (selSrc?.files.length ?? 0) > 1 || (frames.length > 1 && !!camUpload[sel]);
  const gateRun = runOf("gate");
  const gateFi = gateRes ? Math.max(0, gateRes.frames.findIndex((f) => f.detections.some((d) => d.cls === "plate" && d.text)) ) : 0;
  const gateBoxes = gateRes?.frames[gateFi] ? toBoxes(gateRes.frames[gateFi].detections, { minConf: 0.4 }) : [];
  const EP: Record<string, number> = { b1: 0, b3: 1, b5: 0, b6: 1 };
  const synthUrl = (c: CamId): string | undefined => {
    const eps = Object.keys(synth).sort();
    if (!eps.length) return undefined;
    const files = synth[eps[(EP[c] ?? 0) % eps.length]];
    const off = c === "b5" || c === "b6" ? Math.floor(files.length / 2) : 0;
    const usable = files.slice(4);
    return asset(usable[(Math.floor(t / 240) + off) % usable.length]);
  };
  void gateRun;

  return (
    <div className="con">
      {/* top bar */}
      <div className="con-top">
        <div>
          <b>Royal Motors · service centre</b>
          <span className="muted"> · BayWatch service floor</span>
        </div>
        <div className="con-clock">
          <button className="btn xs" onClick={() => setPlaying((p) => !p)}>{playing ? "Pause" : "Play"}</button>
          <span className="clk">{clock(t)}</span>
          <input type="range" min={CLOCK0} max={DAY_END_S} step={60} value={t} onChange={(e) => { tRef.current = +e.target.value; setT(+e.target.value); }} aria-label="Time of day" />
          <span className="badge sim" title="Other customers' cars are simulated by our scenario engine; cameras marked Live AI run our models on real footage.">background traffic simulated</span>
        </div>
        <div className="cseg" role="group" aria-label="Compare">
          <span className="cseg-l">AI monitoring</span>
          <button className={mode === "without" ? "on off" : ""} onClick={() => setMode("without")}>Off</button>
          <button className={mode === "with" ? "on" : ""} onClick={() => setMode("with")}>On</button>
        </div>
      </div>

      {/* KPIs */}
      <div className="ckpis">
        <div className="ckpi"><span>Cars today</span><b>{k.arrived}</b><em>{k.handed} handed over</em></div>
        <div className="ckpi"><span>Bays working</span><b>{k.busy} / 6</b><em>{snap.lot} waiting in lot</em></div>
        <div className={`ckpi ${k.idleMin > 120 ? "warn" : ""}`}><span>Blocked / idle bay time</span><b>{Math.floor(k.idleMin / 60)} h {k.idleMin % 60} min</b><em>{mode === "with" ? "alerts move cars out" : "nobody notices"}</em></div>
        <div className={`ckpi ${mode === "without" && snap.visits.some((v) => v.flag === "untold") ? "warn" : ""}`}><span>Customers told “ready”</span><b>{k.told}</b><em>{snap.visits.filter((v) => v.flag === "untold").length} ready now, not told</em></div>
        <div className={`ckpi ${mode === "without" && k.slipped ? "bad" : ""}`}><span>Missed paid work</span><b>{mode === "with" ? `${k.caught} caught` : `${k.slipped} slipped`}</b><em>before handover</em></div>
        <button className={`ckpi money ${mode === "with" ? "good" : ""}`} onClick={() => setMoney((m) => !m)}>
          <span>Recovered today</span><b>{mode === "with" ? `+${k.recovered} cars` : "—"}</b><em>{mode === "with" ? `≈ +$${Math.round(k.recovered * perCar)} · details` : "turn AI monitoring on"}</em>
        </button>
      </div>
      {money && (
        <div className="moneypop">
          <p><b>Simulation, not a measurement.</b> {data.note}</p>
          <label>Labour rate <input type="range" min={5} max={60} value={rate} onChange={(e) => setRate(+e.target.value)} /> <b>${rate}/h</b> <span className="muted">(replace with the dealer's rate)</span></label>
          <p>Full simulated day: <b>+{data.summary.extra_cars_per_day} cars/day</b> × {data.summary.avg_bay_job_hours} billed h × ${rate} × 26 days ≈ <b>+${Math.round(data.summary.extra_cars_per_day * perCar * 26).toLocaleString()} / month</b> for these 4 simulated bays.</p>
          <details><summary>Assumptions</summary><ul>{Object.entries(data.assumptions).map(([a, v]) => <li key={a}><code>{a}</code>: {JSON.stringify(v)}</li>)}</ul></details>
        </div>
      )}

      <div className="cinsights">
        <h4>What to fix today <span className="muted small">— from the floor so far (simulated background traffic)</span></h4>
        <div className="cins-row">
          {insights(data, mode, t).map((i) => (
            <div key={i.key} className={`cins ${i.bad ? "bad" : ""}`}>
              <b>{i.value}</b>
              <span>{i.what}</span>
              <em>{i.action}</em>
            </div>
          ))}
        </div>
      </div>

      <div className="cevents">
        <b>Events</b>
        {!you ? (
          <>
            <span className="muted small">Drive a car in at the gate to follow one visit end to end.</span>
            <button className="btn xs" onClick={() => { const v = cams.find((c) => c.id === "gate")?.sources[0]; if (v) void driveIn(v); }}>Start with the sample van</button>
          </>
        ) : VISIT_EVENTS.map((e) => {
          const ts = you.t0 + e.m * 60;
          const state = uMin >= e.m ? (VISIT_EVENTS.filter((x) => uMin >= x.m).pop() === e ? "cur" : "done") : "";
          return (
            <button key={e.label} className={state} title={e.what} onClick={() => jump(ts, e.cam)}>
              <i>{clock(ts)}</i>{e.label}
            </button>
          );
        })}
      </div>

      <div className="con-main">
        {/* cameras */}
        <aside className="camlist" aria-label="Cameras">
          {["Entrance", "Workshop", "Quality", "Exit"].map((g) => (
            <div key={g} className="camgroup">
              <h4>{g}</h4>
              {cams.filter((c) => c.group === g).map((c) => {
                const bay = c.id.startsWith("b") ? snap.bays.find((b) => `b${b.bay}` === c.id) : undefined;
                const rr = runOf(c.id);
                return (
                  <button key={c.id} className={`camrow ${sel === c.id ? "on" : ""}`} onClick={() => pick(c.id)}>
                    <i className={`cst cst-${bay?.status ?? (rr?.phase === "done" ? "ok" : "free")}`} aria-hidden />
                    <span className="nm">{c.name}{bay?.mine ? " · tracked visit" : ""}</span>
                    <span className={`ctag ${c.simulated ? "sim" : "ai"}`}>{c.simulated ? "Simulated" : "Live AI"}</span>
                  </button>
                );
              })}
              {g === "Entrance" && (
                <div className="arrivals">
                  <p>Cars at the gate</p>
                  <div className="arr-grid">
                    {cams.find((c) => c.id === "gate")?.sources.map((s) => (
                      <button key={s.id} className="arr" onClick={() => driveIn(s)} title={`${s.label} · ${s.credit} · ${s.licence}`}>
                        <img src={asset(s.files[0].file)} alt="" />
                        <span>{s.label}</span>
                      </button>
                    ))}
                  </div>
                  <button className="btn xs wide" onClick={() => fileRef.current?.click()}>Upload a car (photo or video)</button>
                  <input ref={fileRef} type="file" accept="image/*,video/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void driveInFile(f); e.target.value = ""; }} />
                </div>
              )}
            </div>
          ))}
        </aside>

        {/* 3D floor */}
        <section className="cfloor">
          <Suspense fallback={<div className="con-loading">Loading 3D floor…</div>}>
            <Floor3D tRef={tRef} bays={snap.bays} lotCount={snap.lot} you={you} youFlags={youFlags} selected={sel} onSelect={pick} real={REAL} follow={null} />
          </Suspense>
          <div className="cfloor-legend"><i className="cst cst-working" />working <i className="cst cst-parts" />waiting for parts <i className="cst cst-blocked" />done, blocking bay <i className="cst cst-free" />free · grey cars = simulated traffic</div>
        </section>

        {/* selected camera + alerts */}
        <aside className="cright">
          <div className="camcard">
            {selCam?.simulated && !camUpload[sel] ? (
              <CameraView
                title={`${selCam.name} camera`}
                kind="synth"
                url={synthUrl(sel)}
                boxes={[]}
                live
                liveLabel="SIM"
                scan={false}
                note={<>Synthetic render of our bay (Blender) · illustration only, no AI on renders · bay state: <b>{selBay ? STATUS_TXT[selBay.status] : "—"}</b>{selBay?.plate && selBay.plate !== "example" ? ` · ${selBay.plate} since ${clock(selBay.since)}` : ""}</>}
              />
            ) : (
              <>
                <CameraView
                  title={`${selCam?.name ?? ""} camera`}
                  kind={camUpload[sel] || (sel === "gate" && gateRunKey?.includes("upload")) ? "user" : sel === "gate" ? "sample" : sel === "ready" ? "lot" : isClip ? "real" : "dataset"}
                  url={sel === "gate" ? runOf("gate")?.frames?.[gateFi]?.url : frames[fi]?.url}
                  boxes={sel === "gate" ? gateBoxes : boxes}
                  live={selRun?.phase === "done"}
                  scan={selRun?.phase === "busy"}
                  scanLoop
                  note={camUpload[sel] || (sel === "gate" && gateRunKey?.includes("upload")) ? "Your upload · analysed live" : sel === "gate" && !gateRes ? "Pick a car at the gate, or upload a photo or video." : sel === "gate" && lastGate.current ? `${lastGate.current.src.credit ?? ""}${lastGate.current.src.licence ? ` · ${lastGate.current.src.licence}` : ""}` : selSrc ? `${selSrc.credit ?? ""}${selSrc.licence ? ` · ${selSrc.licence}` : ""}${isClip && frames.length ? ` · frame ${fi + 1}/${frames.length}` : ""}${sel !== "gate" ? " · example footage, not the tracked car" : ""}` : undefined}
                />
                {sel === "gate" && pinfo && (
                  <div className={`platecard ${pinfo.status}`}>
                    <span>Plate</span>
                    <b>{pinfo.status === "read" ? pinfo.text : pinfo.status === "unreadable" ? "found — not readable" : "none visible"}</b>
                    {pinfo.status === "read" && <em>{Math.round((pinfo.confidence ?? 0) * 100)}%</em>}
                    {you && <i>{lookupBooking(you.plate ?? undefined) ? "booking found · 30,000 km service (demo data)" : "no booking · walk-in"}</i>}
                  </div>
                )}
                {sel === "wash" && fr?.states && (
                  <div className="cchips">
                    {WASH_CHIPS.map((c) => {
                      const p = chipProb(fr, c.states);
                      return <span key={c.key} className={p >= THRESH ? "on" : ""}>{c.label} {Math.round(p * 100)}%</span>;
                    })}
                  </div>
                )}
                {(sel.startsWith("b")) && fr && (
                  <div className="cchips">
                    {BAY_CHIPS.map((c) => {
                      const p = chipProb(fr, c.states);
                      return <span key={c.key} className={p >= THRESH ? "on" : ""}>{c.label} {Math.round(p * 100)}%</span>;
                    })}
                  </div>
                )}
                {selCam && selCam.sources.length > 1 && sel !== "gate" && !camUpload[sel] && (
                  <div className="csrcs">{selCam.sources.map((s, i) => (
                    <button key={s.id} className={(srcIdx[sel] ?? 0) === i ? "on" : ""} onClick={() => { setSrcIdx({ ...srcIdx, [sel]: i }); void analyze(sel, s); }}>{s.label}</button>
                  ))}</div>
                )}
                <AiLog run={selRun} onRerun={() => {
                  if (sel === "gate") { if (lastGate.current) void driveIn(lastGate.current.src, lastGate.current.blob, lastGate.current.frames, undefined, true); }
                  else if (!camUpload[sel] && selSrc) void analyze(sel, selSrc, { force: true, workOrder: sel === "b2" });
                }} />
              </>
            )}
            <div className="camup">
              <button className="btn xs" onClick={() => upRef.current?.click()}>Upload footage to {selCam?.name ?? "this camera"} (photo or video)</button>
              {camUpload[sel] && <button className="btn xs" onClick={() => setCamUpload((u) => { const n = { ...u }; delete n[sel]; return n; })}>Back to example footage</button>}
              <input ref={upRef} type="file" accept="image/*,video/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadToCam(sel, f); e.target.value = ""; }} />
            </div>
          </div>

          <div className="calerts">
            <h4>{mode === "with" ? "Alerts" : "Problems happening now"} {mode === "without" && <span className="muted small">— AI monitoring off: no one is alerted</span>}</h4>
            {snap.alerts.length === 0 ? <p className="muted small">All clear right now.</p> : (
              <ul>{snap.alerts.map((a) => {
                const open = a.unseen || a.resolvedAt === undefined || a.resolvedAt > t;
                return (
                  <li key={a.id} className={`cal cal-${a.kind} ${open ? "open" : "done"} ${a.unseen ? "unseen" : ""}`}>
                    <div>
                      <b>{a.title}</b>
                      <span>{open ? a.detail : `✓ ${a.resolution}`}</span>
                      <small>{clock(a.at)}{a.unseen ? " · not alerted" : open ? " · open" : ""}</small>
                    </div>
                    <button className="btn xs" onClick={() => pick(a.camera as CamId)}>Show</button>
                  </li>
                );
              })}</ul>
            )}
          </div>
        </aside>
      </div>

      {/* bottom: visits + your visit */}
      <div className="con-bottom">
        <div className="cvisits">
          <h4>Visits now</h4>
          <table>
            <thead><tr><th>Plate</th><th>Where</th><th>Status</th><th>Ready ETA</th></tr></thead>
            <tbody>{snap.visits.slice(0, 9).map((v, i) => (
              <tr key={i} className={`${v.mine ? "mine" : ""} ${v.flag ?? ""}`}><td>{v.plate}</td><td>{v.where}</td><td>{v.stage}</td><td>{v.eta ?? "–"}</td></tr>
            ))}</tbody>
          </table>
        </div>
        <div className="yourvisit">
          <h4>Tracked visit {you?.plate ? <code>{you.plate}</code> : you ? <code>plate not readable</code> : null}</h4>
          {!you ? <p className="muted">Pick a car at the gate (left) or upload a photo or video. Our models read it live and the visit starts.</p> : (
            <>
              <ol className="ustages">{U.slice(0, -1).map(([s]) => (
                <li key={s} className={ust === s ? "cur" : U.findIndex(([x]) => x === s) < U.findIndex(([x]) => x === ust) ? "done" : ""}>{s.replace("_", " ")}</li>
              ))}</ol>
              {mode === "with" ? (
                <div className="cmsgs">
                  <b>Customer messages (preview: what would be sent; not connected to a messenger in this demo)</b>
                  {uMin >= 3 && <p>Your car is checked in · {clock(you.t0 + 180)}</p>}
                  {uMin >= 12 && <p>Your car is in Bay 2 · {clock(you.t0 + 720)}</p>}
                  {uMin >= 92 && <p>Your car is ready for pickup · {clock(you.t0 + 92 * 60)}</p>}
                </div>
              ) : (
                <div className="cmsgs off"><b>Customer messages</b><p>None — AI monitoring is off. The customer calls the desk to ask.</p></div>
              )}
              <div className="cwo">
                <b>Work order · evidence from the Bay 2 camera</b>
                {mode === "without" ? <p className="muted small">AI monitoring is off: the work order is billed as written, nothing is checked.</p>
                  : (you.verifications ?? []).length === 0 ? <p className="muted small">Waiting for the bay analysis…</p> : you.verifications!.map((v) => (
                  <p key={v.code} className={`cln cln-${v.status}`}><i aria-hidden />{pretty(v.code)} — {LINE_TXT[v.status] ?? v.status}</p>
                ))}
                <p className="muted small">Bay 2 footage is real public CCTV of a different car; the statuses are the live model output on it.</p>
              </div>
            </>
          )}
        </div>
      </div>
      {health && <p className="muted small con-foot">GPU: {(health.gpu as { name?: string } | undefined)?.name ?? "–"} · cameras marked Live AI call the models when selected; “Run again” repeats the call.</p>}
    </div>
  );
}
