import type { AnalysisResult, Catalogue, JobStatus, WorkOrder, Zone } from "./contracts";

const DEV_DEFAULT = "http://localhost:8008";

/** API base URL (no trailing slash). VITE_API_BASE at build time; localhost:8008 in dev; ?api=... overrides. */
export const API_BASE: string = (() => {
  try {
    const q = new URLSearchParams(window.location.search).get("api");
    if (q && /^https?:\/\//.test(q)) return q.replace(/\/+$/, "");
  } catch {
    /* ignore */
  }
  const env = (import.meta.env.VITE_API_BASE as string | undefined) || (import.meta.env.DEV ? DEV_DEFAULT : "");
  return env.replace(/\/+$/, "");
})();

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export interface Health {
  status: "ok" | "loading" | "error" | string;
  backend?: string;
  model_versions?: Record<string, string>;
  gpu?: Record<string, unknown> | string | null;
  disabled?: boolean;
  limits?: Record<string, number>;
  error?: string | null;
}

export interface AnalyzeOptions {
  zones?: Zone[];
  workOrder?: WorkOrder | null;
  simulate?: boolean;
}

export type Phase = "uploading" | "waiting" | "warming" | "queued" | "running";
export interface ProgressInfo {
  phase: Phase;
  fraction?: number; // 0..1
}

const COLD_AFTER_MS = 5000;

function apiUrl(path: string): string {
  if (!API_BASE) throw new ApiError("No API configured for this build (VITE_API_BASE). Use the recorded backup run.", 0);
  return `${API_BASE}/${path.replace(/^\/+/, "")}`;
}

function detail(body: string, status: number): string {
  try {
    const j = JSON.parse(body);
    if (typeof j.detail === "string") return j.detail;
    if (Array.isArray(j.detail)) return j.detail.map((d: { msg?: string }) => d.msg).join("; ");
  } catch {
    /* not JSON */
  }
  return body ? body.slice(0, 200) : `HTTP ${status}`;
}

export async function getJson<T>(path: string, timeoutMs = 15000): Promise<T> {
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(apiUrl(path), { signal: ctl.signal });
    const text = await r.text();
    if (!r.ok) throw new ApiError(detail(text, r.status), r.status);
    return JSON.parse(text) as T;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError((e as Error).name === "AbortError" ? "request timed out" : "network error: API unreachable", 0);
  } finally {
    clearTimeout(to);
  }
}

export const getHealth = (warm = false) => getJson<Health>(warm ? "health?warm=1" : "health", 10000);
export const getCatalogue = () => getJson<Catalogue>("catalogue");

/** multipart POST with upload progress (XHR: fetch has no upload progress). */
function postForm<T>(path: string, form: FormData, onProgress: (p: ProgressInfo) => void, timeoutMs: number,
  signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    let url: string;
    try {
      url = apiUrl(path);
    } catch (e) {
      reject(e);
      return;
    }
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.timeout = timeoutMs;
    let coldTimer: ReturnType<typeof setTimeout> | undefined;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress({ phase: "uploading", fraction: e.loaded / e.total });
    };
    xhr.upload.onload = () => {
      onProgress({ phase: "waiting" });
      coldTimer = setTimeout(() => onProgress({ phase: "warming" }), COLD_AFTER_MS);
    };
    const done = () => coldTimer && clearTimeout(coldTimer);
    xhr.onload = () => {
      done();
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as T);
        } catch {
          reject(new ApiError("invalid JSON from API", xhr.status));
        }
      } else reject(new ApiError(detail(xhr.responseText, xhr.status), xhr.status));
    };
    xhr.onerror = () => {
      done();
      reject(new ApiError("network error: API unreachable (check connection, or use the recorded backup run)", 0));
    };
    xhr.ontimeout = () => {
      done();
      reject(new ApiError("the API did not answer in time", 0));
    };
    signal?.addEventListener("abort", () => {
      done();
      xhr.abort();
      reject(new DOMException("cancelled", "AbortError"));
    });
    onProgress({ phase: "uploading", fraction: 0 });
    xhr.send(form);
  });
}

function addOptions(form: FormData, o: AnalyzeOptions) {
  if (o.zones && o.zones.length) form.append("zones", JSON.stringify(o.zones));
  if (o.workOrder && o.workOrder.lines.length) form.append("work_order", JSON.stringify(o.workOrder));
  form.append("simulate", o.simulate ? "true" : "false");
}

export function analyzeImage(blob: Blob, o: AnalyzeOptions, onProgress: (p: ProgressInfo) => void,
  signal?: AbortSignal): Promise<AnalysisResult> {
  const form = new FormData();
  form.append("file", blob, "photo.jpg");
  addOptions(form, o);
  return postForm<AnalysisResult>("analyze/image", form, onProgress, 240000, signal);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function analyzeFrames(frames: { blob: Blob; t: number }[], o: AnalyzeOptions,
  onProgress: (p: ProgressInfo) => void, signal?: AbortSignal): Promise<AnalysisResult> {
  const form = new FormData();
  frames.forEach((f, i) => form.append("files", f.blob, `f${String(i).padStart(3, "0")}.jpg`));
  form.append("timestamps", JSON.stringify(frames.map((f) => f.t)));
  addOptions(form, o);
  const job = await postForm<JobStatus>("analyze/frames", form, onProgress, 120000, signal);
  const started = Date.now();
  let misses = 0;
  for (;;) {
    if (signal?.aborted) throw new DOMException("cancelled", "AbortError");
    await sleep(1000);
    let st: JobStatus;
    try {
      st = await getJson<JobStatus>(`jobs/${job.job_id}`, 15000);
      misses = 0;
    } catch (e) {
      if (++misses >= 5) throw e;
      continue;
    }
    if (st.status === "done" && st.result) return st.result;
    if (st.status === "error") throw new ApiError(st.error || "analysis failed", 500);
    const waited = Date.now() - started;
    if (st.status === "queued") onProgress({ phase: waited > COLD_AFTER_MS ? "warming" : "queued" });
    else onProgress({ phase: "running", fraction: st.progress ?? undefined });
    if (waited > 6 * 60 * 1000) throw new ApiError("job took longer than 6 minutes", 0);
  }
}
