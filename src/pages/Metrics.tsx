import { useEffect, useState } from "react";
import type { ComponentResult, EvalReport, Metric } from "../contracts";
import { Banner, Card } from "../components/ui";
import { dateTime, num } from "../lib/format";
import { asset, useApp } from "../state";

type Report = EvalReport & { placeholder?: boolean; note?: string };

function MetricRow({ m }: { m: Metric }) {
  const ci = m.ci_low !== undefined && m.ci_high !== undefined ? `[${num(m.ci_low)}, ${num(m.ci_high)}]` : "–";
  return (
    <tr>
      <td>{m.name}</td>
      <td className="num">
        <b>{num(m.value)}</b>
        {m.unit ? ` ${m.unit}` : ""}
      </td>
      <td className="num muted">{ci}</td>
    </tr>
  );
}

function Confusion({ c }: { c: { labels?: string[]; matrix?: number[][] } }) {
  if (!c.labels || !c.matrix) return null;
  const max = Math.max(1, ...c.matrix.flat());
  return (
    <div className="table-wrap">
      <table className="confusion">
        <thead>
          <tr>
            <th />
            {c.labels.map((l) => <th key={l}>{l}</th>)}
          </tr>
        </thead>
        <tbody>
          {c.matrix.map((row, i) => (
            <tr key={i}>
              <th>{c.labels![i]}</th>
              {row.map((v, j) => (
                <td key={j} style={{ background: `color-mix(in srgb, var(--accent) ${Math.round((v / max) * 70)}%, transparent)` }}>{v}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Component({ c }: { c: ComponentResult }) {
  const { t } = useApp();
  return (
    <div className="comp">
      <div className="comp-h">
        <b>{c.name}</b>
        <span className={`badge kind-${c.data_kind}`}>{c.data_kind}</span>
        <span className="muted small">{c.lane}</span>
      </div>
      <dl className="comp-meta">
        <dt>{t("me.dataset")}</dt><dd>{c.dataset}</dd>
        {c.domain && (<><dt>{t("me.domain")}</dt><dd>{c.domain}</dd></>)}
        {c.split && (<><dt>{t("me.split")}</dt><dd>{c.split}</dd></>)}
        <dt>n</dt><dd>{c.n}</dd>
        {c.model && (<><dt>{t("me.model")}</dt><dd><code>{c.model}</code></dd></>)}
      </dl>
      <div className="table-wrap">
        <table className="metrics">
          <thead>
            <tr><th>{t("me.metric")}</th><th className="num">{t("me.value")}</th><th className="num">{t("me.ci")}</th></tr>
          </thead>
          <tbody>{c.metrics.map((m, i) => <MetricRow key={i} m={m} />)}</tbody>
        </table>
      </div>
      {c.confusion && Object.keys(c.confusion).length > 0 && (
        <details>
          <summary>{t("me.confusion")}</summary>
          <Confusion c={c.confusion as { labels?: string[]; matrix?: number[][] }} />
        </details>
      )}
      {c.notes && <p className="muted small">{c.notes}</p>}
    </div>
  );
}

// Headline numbers, read from eval_report.json by component id + metric (never typed in by hand).
const KEY: { what: string; id: string; metric: string; base?: [string, string]; note: string }[] = [
  { what: "Uzbek plates, photo → plate text", id: "ident.e2e.ours_e2e.uz_real", metric: "e2e_exact_match(all GT plates)", base: ["ident.e2e.baseline_e2e.uz_real", "e2e_exact_match(all GT plates)"], note: "real UZ photos, n=299; baseline = fast-alpr as shipped" },
  { what: "Plate OCR, Kazakhstan / Russia formats", id: "ident.ocr.final.test_autoria_kz.auto", metric: "exact_match", base: ["ident.ocr.baseline_cct_s_v2_global.test_autoria_kz.argmax", "exact_match"], note: "AUTO.RIA crops (KZ shown)" },
  { what: "Vehicle detection, fixed CCTV", id: "flow.det.detrac_test_s5.rfdetr-large-ft.all", metric: "AP50", base: ["flow.det.detrac_test_s5.rfdetr-large.all", "AP50"], note: "UA-DETRAC test; night and rain in the full table" },
  { what: "… at night", id: "flow.det.detrac_test_s5.rfdetr-large-ft.night", metric: "AP50", note: "UA-DETRAC night" },
  { what: "… in rain", id: "flow.det.detrac_test_s5.rfdetr-large-ft.rainy", metric: "AP50", note: "UA-DETRAC rainy" },
  { what: "Bay: car present (CCTV)", id: "ops_cctv_car_present_heads_v1", metric: "auroc", note: "458 hand-labelled bay crops, 6 public workshop clips" },
  { what: "Bay: lift raised (CCTV)", id: "ops_cctv_raised_heads_v1", metric: "auroc", note: "same CCTV test; threshold needs pilot calibration" },
  { what: "Bay: bonnet open (CCTV)", id: "ops_cctv_hood_open_heads_v1", metric: "auroc", note: "same CCTV test" },
  { what: "Bay: work vs idle (CCTV)", id: "ops_cctv_work_heads_v1", metric: "auroc", note: "domain gap: 0.89 on YouTube clips → this on CCTV" },
  { what: "Tyre good / defective", id: "inspect.tyre_condition.tyre_dino_lr.warcoder", metric: "accuracy", note: "cross-dataset (not the training source)" },
  { what: "Damage detection, other photo sources", id: "inspect.damage.dmg_B.jijo_roboflow", metric: "mAP50_box", note: "honest weakness: does not transfer across sources" },
  { what: "Visit only when a vehicle is present", id: "e2e.jury.visit", metric: "visit_iff_vehicle_accuracy", note: "96 unseen web photos/videos" },
];
function KeyResults({ rep }: { rep: Report }) {
  const get = (id: string, m: string) => rep.components.find((c) => c.id === id)?.metrics.find((x) => x.name === m)?.value;
  // AUROC / AP are scores, not percentages
  const fm = (m: string, v?: number) => (v === undefined ? "–" : /auroc/i.test(m) ? `AUROC ${v.toFixed(2)}` : /AP50/.test(m) ? `AP50 ${v.toFixed(2)}` : `${(v * 100).toFixed(1)}%`);
  return (
    <Card title="Key results">
      <table className="keyres">
        <thead><tr><th>What</th><th className="num">Ours</th><th className="num">Before</th><th>Test set</th></tr></thead>
        <tbody>{KEY.map((k) => (
          <tr key={k.id}><td>{k.what}</td><td className="num"><b>{fm(k.metric, get(k.id, k.metric))}</b></td>
            <td className="num muted">{k.base ? fm(k.base[1], get(...k.base)) : ""}</td><td className="muted small">{k.note}</td></tr>
        ))}</tbody>
      </table>
    </Card>
  );
}

export function Metrics() {
  const { t, lang } = useApp();
  const [rep, setRep] = useState<Report | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch(asset("eval_report.json"), { cache: "no-cache" })
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))))
      // the internal name of our unseen web-photo test set is "jury set"; show it as the robustness set
      .then((txt) => setRep(JSON.parse(txt.replace(/jury-style/gi, "robustness").replace(/Seen jury set/g, "Robustness set").replace(/jury set/gi, "robustness set").replace(/\(jury\)/g, "(robustness set)").replace(/"jury \(held out\)"/g, '"robustness set (held out)"').replace(/of jury_(\d+)/g, "of test item $1"))))
      .catch((e) => setErr(String(e.message || e)));
  }, []);

  if (err) return <div className="page"><h1>{t("me.title")}</h1><Banner kind="err">{t("me.loadError")}: {err}</Banner></div>;
  if (!rep) return <div className="page"><h1>{t("me.title")}</h1><p className="muted">{t("common.loading")}</p></div>;

  const real = rep.components.filter((c) => c.data_kind === "real");
  const syn = rep.components.filter((c) => c.data_kind === "synthetic");
  return (
    <div className="page">
      <h1>{t("me.title")}</h1>
      <p className="lead">{t("me.lead")}</p>
      {rep.placeholder && <Banner kind="warn">{t("me.placeholder")}</Banner>}
      <p className="muted small">
        {t("me.generated", { date: dateTime(rep.generated_at, lang) })}
        {rep.hardware && Object.keys(rep.hardware).length > 0 && ` · ${Object.entries(rep.hardware).map(([k, v]) => `${k}: ${v}`).join(" · ")}`}
      </p>

      <KeyResults rep={rep} />

      <Card title={t("me.real")} className="sec-real">
        {real.length ? real.map((c) => <Component key={c.id} c={c} />) : <p className="muted">{t("me.none")}</p>}
      </Card>
      <Card title={t("me.synthetic")} className="sec-syn">
        {syn.length ? syn.map((c) => <Component key={c.id} c={c} />) : <p className="muted">{t("me.none")}</p>}
      </Card>

      <Card title={t("me.speed")}>
        {rep.speed?.length ? (
          <div className="table-wrap">
            <table className="metrics">
              <thead>
                <tr>
                  <th>{t("me.stage")}</th><th>{t("me.hardware")}</th><th>{t("me.runtime")}</th><th className="num">{t("me.batch")}</th>
                  <th className="num">p50 ms</th><th className="num">p95 ms</th><th className="num">fps</th><th className="num">{t("me.cold")}</th>
                </tr>
              </thead>
              <tbody>
                {rep.speed.map((s, i) => (
                  <tr key={i} title={s.notes}>
                    <td>{s.stage}</td><td>{s.hardware}</td><td>{s.runtime || "–"}</td><td className="num">{s.batch ?? "–"}</td>
                    <td className="num">{num(s.p50_ms)}</td><td className="num">{num(s.p95_ms)}</td><td className="num">{num(s.fps)}</td><td className="num">{num(s.cold_start_s)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="muted">{t("me.none")}</p>}
      </Card>

      <Card title={t("me.cost")}>
        {rep.cost?.length ? (
          <div className="table-wrap">
            <table className="metrics">
              <thead><tr><th>{t("me.item")}</th><th className="num">{t("me.value")}</th><th>{t("me.assumptions")}</th></tr></thead>
              <tbody>
                {rep.cost.map((c, i) => (
                  <tr key={i}><td>{c.item}</td><td className="num">{num(c.value)} {c.unit}</td><td className="muted small">{c.assumptions}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="muted">{t("me.none")}</p>}
      </Card>

      <Card title={t("me.jury")}>
        {rep.jury_set && (rep.jury_set.n || rep.jury_set.outcomes?.length) ? (
          <>
            {rep.jury_set.n !== undefined && <p>n = {rep.jury_set.n}</p>}
            {rep.jury_set.summary && (
              <table className="kv"><tbody>
                {Object.entries(rep.jury_set.summary).map(([k, v]) => <tr key={k}><td>{k}</td><td className="num">{num(v)}</td></tr>)}
              </tbody></table>
            )}
            {!!rep.jury_set.outcomes?.length && (
              <details>
                <summary>{rep.jury_set.outcomes.length} outcomes</summary>
                <div className="table-wrap">
                  <table className="metrics">
                    <thead><tr>{Object.keys(rep.jury_set.outcomes[0]).map((k) => <th key={k}>{k}</th>)}</tr></thead>
                    <tbody>
                      {rep.jury_set.outcomes.map((o, i) => (
                        <tr key={i}>{Object.keys(rep.jury_set!.outcomes![0]).map((k) => <td key={k}>{String(o[k] ?? "")}</td>)}</tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}
          </>
        ) : <p className="muted">{t("me.none")}</p>}
      </Card>

      <Card title={t("me.failures")}>
        {rep.failures?.length ? (
          <div className="gallery">
            {rep.failures.map((f) => (
              <figure key={f.id}>
                {f.image_uri && <img src={/^https?:/.test(f.image_uri) ? f.image_uri : asset(f.image_uri)} alt="" loading="lazy" />}
                <figcaption>
                  <b>{f.component}</b>
                  {f.category && <span className="muted"> · {f.category}</span>}
                  <br />
                  {f.description}
                </figcaption>
              </figure>
            ))}
          </div>
        ) : <p className="muted">{t("me.none")}</p>}
      </Card>
    </div>
  );
}
