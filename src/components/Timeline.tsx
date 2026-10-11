import type { Event } from "../contracts";
import { tk } from "../i18n";
import { clock } from "../lib/format";
import { resolveUri, useApp } from "../state";
import { Conf, ModelTag, SourceBadge } from "./ui";

export function eventTitle(ev: Event, t: ReturnType<typeof useApp>["t"]): string {
  const base = tk(t, "ev", ev.type);
  const what = ev.state ? tk(t, "state", ev.state) : ev.operation || "";
  return what ? `${base}: ${what}` : base;
}

function relTime(ev: Event, t0: number): string {
  const d = (new Date(ev.t).getTime() - t0) / 1000;
  if (!Number.isFinite(d)) return "";
  if (Math.abs(d) < 120) return `+${d.toFixed(1)} s`;
  return `+${Math.round(d / 60)} min`;
}

export function Timeline({ events, onEvidence }: { events: Event[]; onEvidence?: (ev: Event) => void }) {
  const { t, lang, loaded } = useApp();
  if (!events.length) return <p className="muted">{t("res.noEvents")}</p>;
  const sorted = [...events].sort((a, b) => new Date(a.t).getTime() - new Date(b.t).getTime());
  const t0 = new Date(sorted[0].t).getTime();
  return (
    <ol className="timeline">
      {sorted.map((ev) => {
        const sim = ev.source === "simulated";
        const thumb = resolveUri(ev.evidence?.frame_uri, loaded);
        const zone = ev.zone ? ev.zone.label || tk(t, "zone", ev.zone.kind) : "";
        const text = typeof ev.payload?.text === "string" ? (ev.payload.text as string) : "";
        return (
          <li key={ev.event_id} className={`tl-item ${sim ? "tl-sim" : ""}`}>
            <div className="tl-time">
              <b>{ev.evidence?.video_time_s !== undefined ? `${ev.evidence.video_time_s.toFixed(1)} s` : relTime(ev, t0)}</b>
              <span className="muted small">{clock(ev.t, lang)}</span>
            </div>
            <div className="tl-dot" aria-hidden />
            <div className="tl-body">
              <div className="tl-title">
                {sim && <span className="sim-tag">{t("src.simulated")}</span>}
                {eventTitle(ev, t)}
                {text && <span className="plate-text">{text}</span>}
              </div>
              <div className="tl-meta">
                <SourceBadge source={ev.source} />
                {zone && <span className="muted small">{zone}</span>}
                {ev.evidence && <Conf value={ev.evidence.confidence} />}
                {ev.evidence && <ModelTag model={ev.evidence.model} version={ev.evidence.model_version} />}
              </div>
            </div>
            {thumb && !sim ? (
              <button className="tl-thumb" onClick={() => onEvidence?.(ev)} title={t("res.evidence")}>
                <img src={thumb} alt={t("res.evidence")} loading="lazy" />
              </button>
            ) : (
              <span />
            )}
          </li>
        );
      })}
    </ol>
  );
}
