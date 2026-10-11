import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { API_BASE, getCatalogue, getHealth, type Health } from "./api";
import type { AnalysisResult, Catalogue } from "./contracts";
import { makeT, type Lang, type TFn } from "./i18n";
import bundledCatalogue from "./data/catalogue.json"; // copy of contracts/fixtures/catalogue.json in baywatch-core

export interface RecordedMeta {
  id: string;
  title: string;
  captured_at: string;
  captured_with: string;
  input: string;
  input_licence?: string;
  file: string;
  /** folder (relative to the site base) that evidence URIs in the result are relative to */
  base: string;
}

export interface LoadedResult {
  result: AnalysisResult;
  origin: "live" | "recorded";
  recorded?: RecordedMeta;
  inputLabel?: string;
  receivedAt: string;
}

export type ApiState = "unknown" | "ok" | "loading" | "offline" | "error" | "disabled" | "none";

interface Ctx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: TFn;
  loaded: LoadedResult | null;
  setLoaded: (r: LoadedResult | null) => void;
  catalogue: Catalogue;
  catalogueFromApi: boolean;
  health: Health | null;
  apiState: ApiState;
  refreshHealth: (warm?: boolean) => void;
}

const AppCtx = createContext<Ctx | null>(null);

function store<T>(kind: "local" | "session", key: string, value?: T): T | null {
  try {
    const s = kind === "local" ? window.localStorage : window.sessionStorage;
    if (value === undefined) {
      const raw = s.getItem(key);
      return raw ? (JSON.parse(raw) as T) : null;
    }
    if (value === null) s.removeItem(key);
    else s.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable (private mode, quota) — the app works without it */
  }
  return null;
}

function initialLang(): Lang {
  const saved = store<Lang>("local", "seen.lang");
  if (saved === "en" || saved === "ru" || saved === "uz") return saved;
  return "en";
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);
  const [loaded, setLoadedState] = useState<LoadedResult | null>(() => store<LoadedResult>("session", "seen.result"));
  const [catalogue, setCatalogue] = useState<Catalogue>(bundledCatalogue as Catalogue);
  const [catalogueFromApi, setCatalogueFromApi] = useState(false);
  const [health, setHealth] = useState<Health | null>(null);
  const [apiState, setApiState] = useState<ApiState>(API_BASE ? "unknown" : "none");

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    store("local", "seen.lang", l);
    document.documentElement.lang = l;
  }, []);
  const setLoaded = useCallback((r: LoadedResult | null) => {
    setLoadedState(r);
    store("session", "seen.result", r);
  }, []);

  const refreshHealth = useCallback((warm = false) => {
    if (!API_BASE) return;
    getHealth(warm)
      .then((h) => {
        setHealth(h);
        setApiState(h.disabled ? "disabled" : h.status === "ok" ? "ok" : h.status === "loading" ? "loading" : "error");
      })
      .catch(() => setApiState("offline"));
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
    refreshHealth(false); // never warm the GPU on page load (crawlers would keep it running)
    if (API_BASE)
      getCatalogue()
        .then((c) => {
          setCatalogue(c);
          setCatalogueFromApi(true);
        })
        .catch(() => setCatalogueFromApi(false));
    const id = setInterval(() => refreshHealth(false), 30000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const t = useMemo(() => makeT(lang), [lang]);
  const value = useMemo(
    () => ({ lang, setLang, t, loaded, setLoaded, catalogue, catalogueFromApi, health, apiState, refreshHealth }),
    [lang, setLang, t, loaded, setLoaded, catalogue, catalogueFromApi, health, apiState, refreshHealth],
  );
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

export function useApp(): Ctx {
  const c = useContext(AppCtx);
  if (!c) throw new Error("useApp outside AppProvider");
  return c;
}

/** Resolve an evidence/frame URI from a result: absolute URLs as-is; recorded runs relative to their folder;
 *  live results relative to the API base. */
export function resolveUri(uri: string | undefined | null, loaded: LoadedResult | null): string | undefined {
  if (!uri) return undefined;
  if (/^(https?:|data:|blob:)/.test(uri)) return uri;
  const rel = uri.replace(/^\/+/, "");
  if (loaded?.origin === "recorded" && loaded.recorded) return `${import.meta.env.BASE_URL}${loaded.recorded.base}${rel}`;
  return API_BASE ? `${API_BASE}/${rel}` : undefined;
}

export const asset = (p: string) => `${import.meta.env.BASE_URL}${p.replace(/^\/+/, "")}`;

export async function loadRecorded(meta: RecordedMeta): Promise<LoadedResult> {
  const r = await fetch(asset(meta.file));
  if (!r.ok) throw new Error(`recorded run not found (${r.status})`);
  const result = (await r.json()) as AnalysisResult;
  return { result, origin: "recorded", recorded: meta, inputLabel: meta.input, receivedAt: new Date().toISOString() };
}
