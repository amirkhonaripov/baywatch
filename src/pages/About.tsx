import { useEffect, useState } from "react";
import { API_BASE } from "../api";
import type { Source } from "../contracts";
import { Banner, Card, SourceBadge } from "../components/ui";
import { asset, useApp } from "../state";

interface SourceRow {
  name: string;
  url?: string;
  licence: string;
  used_for: string;
  lane?: string;
  faces_plates?: string;
}
interface DataSources {
  generated_at?: string;
  placeholder?: boolean;
  note?: string;
  datasets: SourceRow[];
  models?: SourceRow[];
}
interface Sample {
  id: string;
  file: string;
  title: { en: string };
  credit: string;
  licence: string;
  source_url?: string;
}

function SourceTable({ rows }: { rows: SourceRow[] }) {
  const { t } = useApp();
  return (
    <div className="table-wrap">
      <table className="metrics">
        <thead>
          <tr><th>{t("ab.name")}</th><th>{t("ab.licence")}</th><th>{t("ab.usedFor")}</th><th>{t("ab.facesPlates")}</th></tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td>{r.url ? <a href={r.url} target="_blank" rel="noreferrer">{r.name}</a> : r.name}{r.lane && <span className="muted small"> · {r.lane}</span>}</td>
              <td>{r.licence}</td>
              <td>{r.used_for}</td>
              <td>{r.faces_plates || "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function About() {
  const { t, health } = useApp();
  const [ds, setDs] = useState<DataSources | null>(null);
  const [samples, setSamples] = useState<Sample[]>([]);
  useEffect(() => {
    fetch(asset("data_sources.json"), { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).then(setDs).catch(() => setDs(null));
    fetch(asset("samples/index.json")).then((r) => (r.ok ? r.json() : [])).then(setSamples).catch(() => setSamples([]));
  }, []);
  const sources: Source[] = ["observed_real", "observed_synthetic", "simulated"];

  return (
    <div className="page">
      <h1>{t("ab.title")}</h1>
      <p className="lead">{t("ab.lead")}</p>

      <Card title={t("ab.honesty")}>
        <ul className="legend">
          {sources.map((s) => <li key={s}><SourceBadge source={s} /></li>)}
        </ul>
        <ul className="bullets">
          <li>{t("ab.h1")}</li>
          <li>{t("ab.h2")}</li>
          <li>{t("ab.h3")}</li>
          <li>{t("ab.h4")}</li>
        </ul>
      </Card>

      <Card title={t("ab.privacy")}>
        <ul className="bullets">
          <li>{t("ab.p1")}</li>
          <li>{t("ab.p2")}</li>
        </ul>
      </Card>

      <Card title={t("ab.data")}>
        {(!ds || ds.placeholder) && <Banner kind="warn">{t("ab.dataPlaceholder")}</Banner>}
        {ds?.datasets?.length ? <SourceTable rows={ds.datasets} /> : null}
        {ds?.models?.length ? (<><h3>{t("ab.models")}</h3><SourceTable rows={ds.models} /></>) : null}
        <h3>{t("ab.samples")}</h3>
        <SourceTable rows={samples.map((s) => ({ name: s.title.en, url: s.source_url, licence: s.licence, used_for: `demo sample (${s.credit})` }))} />
      </Card>

      <Card title={t("ab.api")}>
        <p><code>{API_BASE || "–"}</code></p>
        {health?.model_versions && (
          <table className="kv"><tbody>
            {Object.entries(health.model_versions).map(([k, v]) => <tr key={k}><td><code>{k}</code></td><td><code>{v}</code></td></tr>)}
          </tbody></table>
        )}
        <p className="muted small">build {import.meta.env.MODE} · contracts v0.1.0</p>
      </Card>
    </div>
  );
}
