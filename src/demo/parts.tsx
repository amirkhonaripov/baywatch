import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { AnalysisResult, CatalogueItem, Detection, LineStatus } from "../contracts";
import { SOURCE_LABEL, type SourceKind } from "./data";

export function SrcPill({ kind, className = "" }: { kind: SourceKind; className?: string }) {
  return (
    <span className={`src src-${kind} ${className}`}>
      <i aria-hidden />
      {SOURCE_LABEL[kind]}
    </span>
  );
}

export function Legend({ compact = false }: { compact?: boolean }) {
  const items: [SourceKind, string][] = [
    ["user", "Your input"],
    ["real", "Real public footage (different car)"],
    ["synth", "Synthetic render"],
    ["sim", "Simulated"],
  ];
  return (
    <ul className={`legend ${compact ? "compact" : ""}`} aria-label="Source legend">
      {items.map(([k, l]) => (
        <li key={k} className={`lg-${k}`}>
          <i aria-hidden />
          {l}
        </li>
      ))}
    </ul>
  );
}

// ---------- camera view ----------
export interface Box {
  key: string;
  bbox: [number, number, number, number];
  kind: "veh" | "plate" | "person" | "damage";
  label?: string;
}
const VEH = ["car", "truck", "bus", "motorcycle"];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export const partName = (p?: string) => (p ? cap(p.replace(/_/g, " ")) : "");

/** Detections -> drawable boxes with labels (whole-frame classifier labels such as tyre:* are not boxes). */
export function toBoxes(dets: Detection[], opts: { minConf?: number; plateMin?: number; damageMin?: number; labels?: boolean; max?: number } = {}): Box[] {
  const { minConf = 0.5, plateMin = 0.3, damageMin = 0.45, labels = true, max = 40 } = opts;
  const out: Box[] = [];
  dets.forEach((d, i) => {
    if (d.cls.startsWith("tyre:")) return;
    const [x1, y1, x2, y2] = d.bbox;
    if (x2 - x1 > 0.995 && y2 - y1 > 0.995) return;
    if (d.cls === "plate") {
      if (d.confidence < plateMin) return;
      out.push({ key: `p${i}`, bbox: d.bbox, kind: "plate", label: labels ? d.text || "plate" : undefined });
    } else if (d.cls.startsWith("damage:")) {
      if (d.confidence < damageMin) return;
      out.push({ key: `d${i}`, bbox: d.bbox, kind: "damage", label: labels ? `${d.cls.split(":")[1]} · ${partName(d.part)}` : undefined });
    } else if (d.cls === "person") {
      if (d.confidence >= minConf) out.push({ key: `h${i}`, bbox: d.bbox, kind: "person", label: labels ? "person" : undefined });
    } else if (VEH.includes(d.cls)) {
      if (d.confidence >= minConf) out.push({ key: `v${i}`, bbox: d.bbox, kind: "veh", label: labels ? d.cls : undefined });
    }
  });
  return out.slice(0, max);
}

export interface Zoom {
  x: number; // 0..1 transform origin
  y: number;
  s: number;
}

export function CameraView({ id, title, kind, url, boxes, live, scan, scanLoop = false, zoom, overlay, children, note, paused, dim = false, bare = false, liveLabel }: {
  id?: string;
  title: string;
  kind: SourceKind;
  url?: string;
  boxes: Box[];
  live: boolean;
  scan: boolean;
  scanLoop?: boolean;
  zoom?: Zoom | null;
  overlay?: ReactNode;
  children?: ReactNode;
  note?: ReactNode;
  paused?: boolean;
  dim?: boolean;
  bare?: boolean;
  liveLabel?: string;
}) {
  const [ar, setAr] = useState(1.6);
  const zs: CSSProperties = zoom ? { transform: `translate(${(0.5 - zoom.x) * 100}%, ${(0.5 - zoom.y) * 100}%) scale(${zoom.s})`, transformOrigin: `${zoom.x * 100}% ${zoom.y * 100}%` } : {};
  return (
    <div className={`cam ${live ? "live" : "standby"} ${paused ? "paused" : ""} ${bare ? "bare" : ""}`} id={id}>
      <div className="cam-bar">
        <span className="livedot"><i aria-hidden />{live ? liveLabel ?? "LIVE" : "STANDBY"}</span>
        <b>{title}</b>
      </div>
      <div className={`cam-stage ${dim ? "dim" : ""}`}>
        {url ? (
          <div className="cam-img" style={{ ...zs, ["--ar" as string]: ar }}>
            <img src={url} alt="" draggable={false} onLoad={(e) => {
              const im = e.currentTarget;
              if (im.naturalWidth && im.naturalHeight) setAr(im.naturalWidth / im.naturalHeight);
            }} />
            {boxes.map((b, i) => (
              <div
                key={b.key}
                className={`bx2 bx2-${b.kind}`}
                style={{
                  left: `${b.bbox[0] * 100}%`,
                  top: `${b.bbox[1] * 100}%`,
                  width: `${Math.max(0.6, (b.bbox[2] - b.bbox[0]) * 100)}%`,
                  height: `${Math.max(0.6, (b.bbox[3] - b.bbox[1]) * 100)}%`,
                  animationDelay: `${Math.min(i, 14) * 110}ms`,
                }}
              >
                {b.label && <span>{b.label}</span>}
              </div>
            ))}
            {scan && (
              <>
                <div className="scangrid" aria-hidden />
                <div className={`sweep ${scanLoop ? "loop" : ""}`} aria-hidden />
              </>
            )}
          </div>
        ) : (
          <div className="cam-empty">Camera standby</div>
        )}
        <SrcPill kind={kind} className="cam-src" />
        {overlay}
        {children}
      </div>
      {note && <p className="cam-note">{note}</p>}
    </div>
  );
}

// ---------- visit record ----------
export interface RecRow {
  id: string;
  group: string;
  label: string;
  value: ReactNode;
  src: string;
}

export function VisitRecord({ rows, plate, id }: { rows: RecRow[]; plate?: string; id?: string }) {
  const end = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const n = rows.length;
  useEffect(() => {
    const b = body.current;
    if (b) b.scrollTo({ top: b.scrollHeight, behavior: "smooth" });
  }, [n]);
  const groups: string[] = [];
  rows.forEach((r) => {
    if (!groups.includes(r.group)) groups.push(r.group);
  });
  return (
    <section className="card rec" id={id} aria-label="Visit record">
      <header className="rec-h">
        <h2>Visit record</h2>
        {plate ? <span className="rec-plate">{plate}</span> : <span className="muted small">fills up as the car moves</span>}
      </header>
      <div className="rec-body" ref={body}>
        {n === 0 && <p className="rec-empty">Plate, bay states, findings and work-order evidence land here, one stage at a time.</p>}
        {groups.map((g) => (
          <div key={g} className="rec-grp">
            <h3>{g}</h3>
            {rows.filter((r) => r.group === g).map((r) => (
              <div key={r.id} className="rec-row">
                <span className="rec-l">{r.label}</span>
                <span className="rec-v">{r.value}</span>
                <span className="rec-s">{r.src}</span>
              </div>
            ))}
          </div>
        ))}
        <div ref={end} />
      </div>
    </section>
  );
}

// ---------- phone + manager ----------
export interface Msg {
  id: string;
  text: string;
  sub: string;
  sim: boolean;
}

export function Phone({ msgs }: { msgs: Msg[] }) {
  const last = msgs.slice(-3);
  return (
    <section className="card mini phone-mini" aria-label="Customer phone">
      <header className="cam-h">
        <h2>Customer phone</h2>
        <span className="tag-demo">simulated</span>
      </header>
      <div className="pm-body">
        {!last.length && <p className="muted small">Status messages to the customer appear here.</p>}
        {last.map((m) => (
          <div key={m.id} className={`pmsg ${m.sim ? "sim" : ""}`}>
            <b>{m.text}</b>
            <small>{m.sub}</small>
          </div>
        ))}
      </div>
    </section>
  );
}

export interface BayRow {
  name: string;
  state: string;
  cls: "work" | "idle" | "empty" | "mine";
  note?: string;
}

export function Manager({ bays, alerts, counters }: { bays: BayRow[]; alerts: { title: string }[]; counters: { k: string; v: number }[] }) {
  return (
    <section className="card mini mgr" aria-label="Service manager">
      <header className="cam-h">
        <h2>Service manager</h2>
        <span className="tag-demo">simulated</span>
      </header>
      <ul className="bboard">
        {bays.map((r) => (
          <li key={r.name} className={r.cls}>
            <b>{r.name}</b>
            <span>{r.state}</span>
            {r.note && <small>{r.note}</small>}
          </li>
        ))}
      </ul>
      <div className="counters">
        {counters.map((c) => (
          <div key={c.k}><b>{c.v}</b><span>{c.k}</span></div>
        ))}
      </div>
      {alerts.length > 0 && (
        <div className="alert" role="alert">
          <b>Before handover</b>
          {alerts.map((a) => (
            <p key={a.title}>{a.title}: not observed. Check before handover.</p>
          ))}
        </div>
      )}
    </section>
  );
}

// ---------- work order ----------
const ICON: Record<LineStatus, ReactNode> = {
  evidence_found: (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden><circle cx="12" cy="12" r="10" fill="currentColor" /><path d="M7 12.5l3.3 3.2L17 9" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
  ),
  not_observed: (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M8 12h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
  ),
  not_camera_verifiable: (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="3 3" /><path d="M12 8v5M12 16v.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
  ),
};
export const STATUS_TXT: Record<LineStatus, string> = {
  evidence_found: "Evidence found",
  not_observed: "Not observed",
  not_camera_verifiable: "Not camera-verifiable",
};

export interface LineRow {
  code: string;
  title: string;
  status: LineStatus;
  note?: string;
  thumb?: { url: string; kind: SourceKind; t?: number; boxes?: Box[] };
}

export function WorkOrderCard({ id, title, rows, basis }: { id: string; title: string; rows: LineRow[]; basis: string }) {
  return (
    <section className="card wo" id="wo-card">
      <header className="wo-h">
        <h2>Work order · {title}</h2>
        <span className="muted small">{id} · demo booking data</span>
      </header>
      <ul>
        {rows.map((r, i) => (
          <li key={r.code} className={`wo-line wst-${r.status}`} style={{ animationDelay: `${i * 450}ms` }}>
            <span className="wo-ic">{ICON[r.status]}</span>
            <span className="wo-t">
              <b>{r.title}</b>
              <small className="wo-st">{STATUS_TXT[r.status]}</small>
              {r.note && <small className="wo-note">{r.note}</small>}
            </span>
            {r.thumb && (
              <span className="wo-thumb">
                <img src={r.thumb.url} alt="Evidence frame" />
                <SrcPill kind={r.thumb.kind} className="cam-src" />
                {r.thumb.t !== undefined && <em>clip {Math.floor(r.thumb.t / 60)}:{String(Math.round(r.thumb.t % 60)).padStart(2, "0")}</em>}
              </span>
            )}
          </li>
        ))}
      </ul>
      <p className="muted small wo-basis">{basis}</p>
    </section>
  );
}

export function titleOf(items: CatalogueItem[], code: string): string {
  return items.find((i) => i.code === code)?.title_en || code.replace(/_/g, " ");
}

function Kv({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="kv">
      <dt>{k}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function HowDrawer({ results, bookingNote, bayLabel }: { results: { label: string; r: AnalysisResult | null; ms?: number }[]; bookingNote: string; bayLabel: string }) {
  const route = (r: AnalysisResult | null) =>
    r ? (
      <>
        scene <b>{r.route.scene}</b> ({Math.round(r.route.confidence * 100)}%) · ran {r.route.ran.join(", ")}
        {r.route.skipped.length > 0 && <> · skipped {r.route.skipped.map((s) => s.module).join(", ")}</>}
        {r.timings_ms?.server_total !== undefined && <> · {Math.round(r.timings_ms.server_total)} ms on the GPU</>}
      </>
    ) : (
      "not run yet"
    );
  const versions: Record<string, string> = {};
  results.forEach((x) => Object.assign(versions, x.r?.model_versions || {}));
  return (
    <details className="how">
      <summary>How this was computed</summary>
      <dl>
        {results.map((x) => (
          <Kv key={x.label} k={x.label}>{route(x.r)}</Kv>
        ))}
        <Kv k="Bay footage">{bayLabel}</Kv>
        <Kv k="3D scene">Illustration of the camera results; it is not footage. Grey cars and staff are simulated background.</Kv>
        <Kv k="Booking, VIN">{bookingNote}</Kv>
        <Kv k="Models">
          {Object.keys(versions).length ? <ul>{Object.entries(versions).map(([k, v]) => <li key={k}><code>{k}</code> {v}</li>)}</ul> : "–"}
        </Kv>
      </dl>
    </details>
  );
}
