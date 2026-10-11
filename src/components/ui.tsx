import type { ReactNode } from "react";
import type { LineStatus, Source } from "../contracts";
import { useApp } from "../state";
import { pct } from "../lib/format";

export function Card({ title, children, className = "", right }: { title?: ReactNode; children: ReactNode; className?: string; right?: ReactNode }) {
  return (
    <section className={`card ${className}`}>
      {(title || right) && (
        <header className="card-h">
          {title && <h2>{title}</h2>}
          {right}
        </header>
      )}
      {children}
    </section>
  );
}

export function SourceBadge({ source }: { source: Source | undefined }) {
  const { t } = useApp();
  if (!source) return null;
  return <span className={`badge src-${source}`}>{t(`src.${source}`)}</span>;
}

export function Conf({ value, label = true }: { value: number | undefined | null; label?: boolean }) {
  const { t } = useApp();
  if (value === undefined || value === null) return null;
  const lvl = value >= 0.8 ? "hi" : value >= 0.5 ? "mid" : "lo";
  return (
    <span className={`conf conf-${lvl}`} title={t("res.conf")}>
      {label ? `${t("res.conf")} ` : ""}
      {pct(value)}
    </span>
  );
}

export function StatusChip({ status }: { status: LineStatus }) {
  const { t } = useApp();
  const icon = status === "evidence_found" ? "●" : status === "not_observed" ? "○" : "–";
  return (
    <span className={`chip st-${status}`}>
      <span aria-hidden>{icon}</span> {t(`status.${status}`)}
    </span>
  );
}

export function ModelTag({ model, version }: { model?: string; version?: string }) {
  if (!model) return null;
  return (
    <code className="model">
      {model}
      {version ? `@${version}` : ""}
    </code>
  );
}

export function Banner({ kind, children }: { kind: "info" | "warn" | "rec" | "err"; children: ReactNode }) {
  return <div className={`banner banner-${kind}`}>{children}</div>;
}

export function Progress({ value }: { value?: number }) {
  return (
    <div className={`progress ${value === undefined ? "indet" : ""}`} role="progressbar" aria-valuenow={value !== undefined ? Math.round(value * 100) : undefined}>
      <div style={{ width: value !== undefined ? `${Math.max(2, Math.min(100, value * 100))}%` : undefined }} />
    </div>
  );
}
