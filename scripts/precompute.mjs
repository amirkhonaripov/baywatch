// Record the real API output for every built-in camera sample, so the live demo shows them instantly.
//   node scripts/precompute.mjs http://localhost:8008        (any BayWatch API)
// Writes public/precomputed/<camera>__<source>.json. The site marks these as "recorded output" with the date;
// "Run again" on a camera always makes a live call. Uploads are never pre-recorded.
// The source list mirrors src/console/cams.ts (buildCams); keep the two in sync.
import { readFile, writeFile, mkdir } from "node:fs/promises";

const API = (process.argv[2] || "http://localhost:8008").replace(/\/$/, "");
const PUB = new URL("../public/", import.meta.url);
const WORK_ORDER = { id: "WO-DEMO-0001", lines: ["coolant_check", "chassis_diagnostics", "cabin_filter"] };
const manifest = JSON.parse(await readFile(new URL("stages/manifest.json", PUB))).stages;

const pickEven = (a, n) => (a.length <= n ? a : Array.from({ length: n }, (_, i) => a[Math.round((i * (a.length - 1)) / (n - 1))]));
const SKIP = { "-OJPETY9Bis": [3, 0], e4O3X9gli1s: [2, 2] };
const clip = (id) => {
  const all = manifest.bay_real.filter((f) => f.clip === id);
  const [a, b] = SKIP[id] ?? [0, 0];
  return pickEven(all.slice(a, all.length - b), 12).map((f) => ({ file: f.file, t: f.t_s }));
};
const one = (file) => [{ file, t: 0 }];
const SOURCES = [
  ["gate", "uz_van", one("arrivals/uz_van.jpg")], ["gate", "rain", one("arrivals/rain.jpg")],
  ["gate", "ducati", one("arrivals/ducati.jpg")], ["gate", "mustang", one("arrivals/mustang.jpg")],
  ["b2", "-OJPETY9Bis", clip("-OJPETY9Bis"), WORK_ORDER], ["b4", "e4O3X9gli1s", clip("e4O3X9gli1s")],
  ["inspect", "inspect_front", one("stages/heldout/inspect_front.jpg")], ["inspect", "inspect_crash", one("stages/heldout/inspect_crash.jpg")],
  ["inspect", "inspect_tyre", one("stages/heldout/inspect_tyre.jpg")],
  ["wash", "wash_selfservice", one("stages/heldout/wash_selfservice.jpg")], ["wash", "wash_entrance", one("stages/heldout/wash_entrance.jpg")],
  ["ready", "ready_0", one(manifest.ready[0].file)],
];

const blob = async (f) => new Blob([await readFile(new URL(f, PUB))], { type: "image/jpeg" });
async function run(files, workOrder) {
  const form = new FormData();
  form.append("simulate", "false");
  if (workOrder) form.append("work_order", JSON.stringify(workOrder));
  if (files.length === 1) {
    form.append("file", await blob(files[0].file), "photo.jpg");
    const r = await fetch(`${API}/analyze/image`, { method: "POST", body: form });
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
    return r.json();
  }
  for (const [i, f] of files.entries()) form.append("files", await blob(f.file), `f${String(i).padStart(3, "0")}.jpg`);
  form.append("timestamps", JSON.stringify(files.map((f) => f.t)));
  const job = await (await fetch(`${API}/analyze/frames`, { method: "POST", body: form })).json();
  for (;;) {
    await new Promise((r) => setTimeout(r, 1000));
    const st = await (await fetch(`${API}/jobs/${job.job_id}`)).json();
    if (st.status === "done") return st.result;
    if (st.status === "error") throw new Error(st.error);
  }
}

await mkdir(new URL("precomputed/", PUB), { recursive: true });
for (const [cam, id, files, wo] of SOURCES) {
  const t0 = Date.now();
  const result = await run(files, wo);
  const out = { camera: cam, source: id, recorded_at: new Date().toISOString(), api: API, roundtrip_ms: Date.now() - t0, result };
  await writeFile(new URL(`precomputed/${cam}__${id}.json`, PUB), JSON.stringify(out));
  console.log(`${cam}/${id}: ${files.length} frame(s), ${out.roundtrip_ms} ms, scene ${result.route?.scene}`);
}
