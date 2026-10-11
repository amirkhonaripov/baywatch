import type { Lang } from "../i18n";

export const pct = (v: number | undefined | null, digits = 0) =>
  v === undefined || v === null || Number.isNaN(v) ? "–" : `${(v * 100).toFixed(digits)}%`;

export function num(v: number | undefined | null, digits = 3): string {
  if (v === undefined || v === null || Number.isNaN(v)) return "–";
  if (Number.isInteger(v)) return String(v);
  const a = Math.abs(v);
  return a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : v.toFixed(digits);
}

export const ms = (v: number | undefined | null) => (v === undefined || v === null ? "–" : v >= 100 ? v.toFixed(0) : v.toFixed(1));

const LOCALE: Record<Lang, string> = { en: "en-GB", ru: "ru-RU", uz: "uz-Latn-UZ" };

export function clock(iso: string | undefined, lang: Lang): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  try {
    return d.toLocaleTimeString(LOCALE[lang], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return d.toISOString().slice(11, 19);
  }
}

export function dateTime(iso: string | undefined, lang: Lang): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  try {
    return d.toLocaleString(LOCALE[lang], { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return d.toISOString().slice(0, 16).replace("T", " ");
  }
}

export const secs = (v: number | undefined) => (v === undefined ? "" : `${v.toFixed(1)} s`);

export function downloadJson(name: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
