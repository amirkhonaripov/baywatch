import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html, Line, useGLTF } from "@react-three/drei";
import { useMemo, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import { asset } from "../state";
import { U, uStage, type BayView, type UserVisit } from "./engine";

export type CamId = "gate" | "b1" | "b2" | "b3" | "b4" | "b5" | "b6" | "inspect" | "wash" | "ready";

export const P: Record<string, [number, number]> = {
  gate: [-11.6, 0],
  b1: [-5, -4.4], b2: [-1.5, -4.4], b3: [2, -4.4],
  b4: [-5, 4.4], b5: [-1.5, 4.4], b6: [2, 4.4],
  inspect: [7.2, -4.4], wash: [7.2, 4.4], ready: [11.6, 4.4], lot: [11.6, -4.4],
};
const SCALE = 1.2;
const LIFT_H = 0.95;

function paint(root: THREE.Object3D, colorOf: (name: string) => string, opacity = 1) {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const name = `${o.name} ${o.parent?.name ?? ""}`;
    m.material = new THREE.MeshStandardMaterial({ color: colorOf(name), roughness: 0.55, metalness: 0.1, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 });
  });
}


function BayCar({ v, at }: { v: BayView; at?: [number, number] }) {
  const model = v.mine ? "sedan" : ["sedan", "suv", "hatchback-sports", "taxi"].includes(v.vehicle ?? "") ? v.vehicle! : "sedan";
  const g = useGLTF(asset(`models/${model}.glb`));
  const tone = v.status === "parts" ? "#fbbf24" : v.status === "blocked" ? "#f87171" : "#9aa5b4";
  const s = useMemo(() => {
    const c = g.scene.clone(true);
    paint(c, (n) => (/wheel/.test(n) ? "#475569" : tone));
    return c;
  }, [g, tone, v.source]);
  const h = useRef(0);
  const ref = useRef<THREE.Group>(null!);
  useFrame((_, dt) => {
    h.current += ((v.lifted ? LIFT_H : 0) - h.current) * Math.min(1, 4 * dt);
    ref.current.position.y = h.current;
  });
  const [x, z] = at ?? P[`b${v.bay}`];
  return (
    <group position={[x, 0, z]} rotation={[0, z < 0 ? Math.PI : 0, 0]}>
      <group ref={ref} scale={SCALE}><primitive object={s} /></group>
    </group>
  );
}

function Person({ x, z, yaw, tone = "#64748b" }: { x: number; z: number; yaw: number; tone?: string }) {
  const g = useGLTF(asset("models/character-male-a.glb"));
  const s = useMemo(() => {
    const c = g.scene.clone(true);
    paint(c, (n) => (/head/.test(n) ? "#e8b98f" : tone));
    return c;
  }, [g, tone]);
  return <primitive object={s} position={[x, 0, z]} rotation={[0, yaw, 0]} scale={2} />;
}

function LiftRig({ x, z, raised }: { x: number; z: number; raised: boolean }) {
  const arm = useRef<THREE.Group>(null!);
  const h = useRef(0);
  useFrame((_, dt) => {
    h.current += ((raised ? LIFT_H : 0) - h.current) * Math.min(1, 4 * dt);
    arm.current.position.y = h.current;
  });
  return (
    <group position={[x, 0, z]}>
      {[-1.45, 1.45].map((pz) => (
        <mesh key={pz} position={[0, 1.1, pz]}><boxGeometry args={[0.26, 2.2, 0.26]} /><meshStandardMaterial color="#64748b" /></mesh>
      ))}
      <group ref={arm}>
        {[-1.45, 1.45].map((pz) => (
          <mesh key={pz} position={[0, 0.12, pz * 0.78]}><boxGeometry args={[2.3, 0.1, 0.2]} /><meshStandardMaterial color="#f59e0b" /></mesh>
        ))}
      </group>
    </group>
  );
}

// ---------- your car: route through the floor, driven by sim time ----------
const ROUTE: { m: number; x: number; z: number }[] = [
  { m: 0, x: -15.5, z: 0 }, { m: 2, x: -11.6, z: 0 }, { m: 10, x: -11.6, z: 0 }, { m: 11.2, x: -1.5, z: 0 }, { m: 12, x: -1.5, z: -4.4 },
  { m: 72, x: -1.5, z: -4.4 }, { m: 73, x: -1.5, z: 0 }, { m: 74.5, x: 7.2, z: 0 }, { m: 75.5, x: 7.2, z: -4.4 },
  { m: 80, x: 7.2, z: -4.4 }, { m: 81, x: 7.2, z: 0 }, { m: 82, x: 7.2, z: 4.4 }, { m: 92, x: 7.2, z: 4.4 },
  { m: 93, x: 7.2, z: 0 }, { m: 94, x: 11.6, z: 0 }, { m: 95, x: 11.6, z: 4.4 }, { m: 110, x: 11.6, z: 4.4 },
  { m: 111, x: 11.6, z: 0 }, { m: 114, x: 19, z: 0 },
];
const smooth = (f: number) => f * f * (3 - 2 * f);
function routeAt(m: number) {
  if (m <= ROUTE[0].m) return { x: ROUTE[0].x, z: ROUTE[0].z, yaw: Math.PI / 2 };
  for (let i = 1; i < ROUTE.length; i++) {
    const a = ROUTE[i - 1], b = ROUTE[i];
    if (m <= b.m) {
      const f = smooth((m - a.m) / Math.max(1e-6, b.m - a.m));
      const dx = b.x - a.x, dz = b.z - a.z;
      return { x: a.x + dx * f, z: a.z + dz * f, yaw: Math.abs(dx) + Math.abs(dz) > 1e-6 ? Math.atan2(dx, dz) : NaN };
    }
  }
  const l = ROUTE[ROUTE.length - 1];
  return { x: l.x, z: l.z, yaw: Math.PI / 2 };
}

function YourCar({ tRef, you, flags }: { tRef: MutableRefObject<number>; you: UserVisit; flags: { lifted: boolean; person: boolean } }) {
  const g = useGLTF(asset(`models/${you.model}.glb`));
  const s = useMemo(() => {
    const c = g.scene.clone(true);
    paint(c, (n) => (/wheel/.test(n) ? "#1f2937" : you.colour));
    return c;
  }, [g, you.colour]);
  const root = useRef<THREE.Group>(null!);
  const lift = useRef<THREE.Group>(null!);
  const h = useRef(0);
  useFrame((_, dt) => {
    const m = (tRef.current - you.t0) / 60;
    const p = routeAt(m);
    root.current.visible = m >= 0 && m < U[U.length - 1][1];
    root.current.position.set(p.x, 0, p.z);
    if (!Number.isNaN(p.yaw)) {
      let d = p.yaw - root.current.rotation.y;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      root.current.rotation.y += d * Math.min(1, 8 * dt);
    }
    const inBay = uStage(m) === "bay";
    h.current += ((inBay && flags.lifted ? LIFT_H : 0) - h.current) * Math.min(1, 4 * dt);
    lift.current.position.y = h.current;
  });
  return (
    <group ref={root}>
      <group ref={lift} scale={SCALE}><primitive object={s} /></group>
      <Html position={[0, 2.6, 0]} center distanceFactor={13} zIndexRange={[20, 10]}>
        <span className="fl-plate">{you.plate ?? "plate not readable"}</span>
      </Html>
    </group>
  );
}

// ---------- zones, cameras ----------
const ZONES: { id: string; label: string; w: number; d: number; cam?: CamId }[] = [
  { id: "gate", label: "Gate", w: 3.6, d: 3.2, cam: "gate" },
  { id: "b1", label: "Bay 1", w: 3.2, d: 4, cam: "b1" }, { id: "b2", label: "Bay 2", w: 3.2, d: 4, cam: "b2" }, { id: "b3", label: "Bay 3", w: 3.2, d: 4, cam: "b3" },
  { id: "b4", label: "Bay 4", w: 3.2, d: 4, cam: "b4" }, { id: "b5", label: "Bay 5", w: 3.2, d: 4, cam: "b5" }, { id: "b6", label: "Bay 6", w: 3.2, d: 4, cam: "b6" },
  { id: "inspect", label: "Inspection", w: 3.4, d: 4, cam: "inspect" }, { id: "wash", label: "Wash", w: 3.4, d: 4, cam: "wash" },
  { id: "ready", label: "Ready", w: 3.4, d: 4, cam: "ready" }, { id: "lot", label: "Waiting lot", w: 3.4, d: 4 },
];
const ZONE_COLOR: Record<string, string> = { working: "#14b8a6", parts: "#f59e0b", blocked: "#ef4444", free: "#cbd5e1" };

function Zones({ bays, selected, onSelect }: { bays: BayView[]; selected: CamId; onSelect: (c: CamId) => void }) {
  return (
    <>
      {ZONES.map((z) => {
        const [x, zz] = P[z.id];
        const bay = z.id.startsWith("b") ? bays.find((b) => `b${b.bay}` === z.id) : undefined;
        const col = bay ? ZONE_COLOR[bay.status] : "#cbd5e1";
        const sel = z.cam === selected;
        const pts: [number, number, number][] = [[x - z.w / 2, 0.03, zz - z.d / 2], [x + z.w / 2, 0.03, zz - z.d / 2], [x + z.w / 2, 0.03, zz + z.d / 2], [x - z.w / 2, 0.03, zz + z.d / 2], [x - z.w / 2, 0.03, zz - z.d / 2]];
        return (
          <group key={z.id}>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.02, zz]} onClick={(e) => { e.stopPropagation(); if (z.cam) onSelect(z.cam); }}>
              <planeGeometry args={[z.w, z.d]} />
              <meshStandardMaterial color={col} transparent opacity={bay ? (bay.status === "free" ? 0.06 : 0.3) : 0.22} />
            </mesh>
            <Line points={pts} color={sel ? "#0f766e" : "#94a3b8"} lineWidth={sel ? 3 : 1.2} />
            <Html position={[x, 0.05, zz + (zz > 0 ? -2.35 : 2.35)]} center distanceFactor={10} zIndexRange={[5, 0]}>
              <span className={`fl-zone ${sel ? "on" : ""}`} onClick={() => z.cam && onSelect(z.cam)}>{z.label}</span>
            </Html>
          </group>
        );
      })}
    </>
  );
}

const MOUNTS: Record<CamId, [number, number, number]> = {
  gate: [-9.2, 2.6, 2.6], b1: [-5, 2.9, -6.75], b2: [-1.5, 2.9, -6.75], b3: [2, 2.9, -6.75], b4: [-5, 3.0, 1.3], b5: [-1.5, 3.0, 1.3], b6: [2, 3.0, 1.3],
  inspect: [9.6, 3, -7.3], wash: [9.6, 3, 7.3], ready: [13.8, 3, 7.3],
};
function Cameras({ selected, real, onSelect }: { selected: CamId; real: Set<CamId>; onSelect: (c: CamId) => void }) {
  return (
    <>
      {(Object.keys(MOUNTS) as CamId[]).map((k) => {
        const [x, y, z] = MOUNTS[k];
        const sel = k === selected;
        return (
          <group key={k} onClick={(e) => { e.stopPropagation(); onSelect(k); }}>
            {!k.startsWith("b") && <mesh position={[x, y / 2, z]}><cylinderGeometry args={[0.05, 0.05, y, 8]} /><meshStandardMaterial color="#94a3b8" /></mesh>}
            <mesh position={[x, y, z]}>
              <boxGeometry args={[0.36, 0.28, 0.36]} />
              <meshStandardMaterial color={sel ? "#0f766e" : real.has(k) ? "#1f2937" : "#94a3b8"} emissive={sel ? "#14b8a6" : "#000"} emissiveIntensity={sel ? 0.8 : 0} />
            </mesh>
          </group>
        );
      })}
    </>
  );
}

function Rig({ selected, follow }: { selected: CamId; follow: [number, number] | null }) {
  const size = useThree((s) => s.size);
  const look = useRef(new THREE.Vector3(0.5, 0, 0));
  const pos = useRef(new THREE.Vector3(0.5, 22, 15));
  const first = useRef(true);
  useFrame(({ camera }, dt) => {
    const cam = camera as THREE.PerspectiveCamera;
    const aspect = size.width / Math.max(1, size.height);
    const tv = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
    // keep the whole floor in view (gate x=-11.6 … ready lot x=11.6, z ±7), drifting only slightly towards the selected zone
    const fit = Math.max(13.8 / (tv * aspect), 7.4 / tv);
    const [fx, fz] = follow ?? P[selected] ?? [0, 0];
    const tgt = new THREE.Vector3(1 + fx * 0.08, 0, 1.2 + fz * 0.08);
    const dir = new THREE.Vector3(0, 0.78, 0.62).normalize();
    const p = tgt.clone().add(dir.multiplyScalar(fit * 0.86));
    const k = first.current ? 1 : Math.min(1, 2.2 * dt); // snap on the first frame, ease afterwards
    first.current = false;
    look.current.lerp(tgt, k);
    pos.current.lerp(p, k);
    cam.position.copy(pos.current);
    cam.lookAt(look.current);
  });
  return null;
}

function Building() {
  // Enclosed workshop for the six bays (x -7.2..4.2, z -7..7); gate, inspection, wash and lots stay outside.
  const X0 = -7.2, X1 = 4.2, Z0 = -7, Z1 = 7, W = X1 - X0, CX = (X0 + X1) / 2;
  const wall = "#d6dde6", trim = "#14b8a6";
  return (
    <group>
      {/* outside ground + driveway */}
      <mesh position={[0.5, 0.003, 0]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[44, 3]} /><meshStandardMaterial color="#b9c2cd" /></mesh>
      <Line points={[[-21, 0.02, 0], [X0 - 0.2, 0.02, 0]]} color="#ffffff" lineWidth={2} dashed dashSize={0.5} gapSize={0.4} />
      {/* workshop floor (epoxy) */}
      <mesh position={[CX, 0.006, 0]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[W, Z1 - Z0]} /><meshStandardMaterial color="#8f9aa7" roughness={0.35} metalness={0.15} /></mesh>
      {/* back wall + front parapet (low, so the camera sees in) */}
      <mesh position={[CX, 1.6, Z0]}><boxGeometry args={[W, 3.2, 0.2]} /><meshStandardMaterial color={wall} /></mesh>
      <mesh position={[CX, 3.1, Z0 + 0.12]}><boxGeometry args={[W, 0.16, 0.06]} /><meshStandardMaterial color={trim} /></mesh>
      <mesh position={[CX, 0.25, Z1]}><boxGeometry args={[W, 0.5, 0.2]} /><meshStandardMaterial color={wall} /></mesh>
      {/* side walls with the drive-through door */}
      {[X0, X1].map((x) => (
        <group key={x}>
          <mesh position={[x, 1.6, (Z0 - 1.5) / 2]}><boxGeometry args={[0.2, 3.2, -1.5 - Z0]} /><meshStandardMaterial color={wall} /></mesh>
          <mesh position={[x, 1.6, (Z1 + 1.5) / 2]}><boxGeometry args={[0.2, 3.2, Z1 - 1.5]} /><meshStandardMaterial color={wall} transparent opacity={0.55} /></mesh>
          <mesh position={[x, 2.9, 0]}><boxGeometry args={[0.24, 0.6, 3]} /><meshStandardMaterial color={trim} /></mesh>
        </group>
      ))}
      {/* tool cabinets along the back wall, tyre stacks by the side walls */}
      {[-6.6, -3.25, 0.25, 3.6].map((x) => (
        <mesh key={x} position={[x, 0.55, Z0 + 0.45]}><boxGeometry args={[0.9, 1.1, 0.5]} /><meshStandardMaterial color="#dc2626" /></mesh>
      ))}
      {[[-6.7, 5.6], [-6.7, 6.3], [3.7, 5.8], [3.7, -5.9]].map(([x, z], i) => (
        <group key={i} position={[x, 0, z]}>
          {[0, 1, 2, 3].map((k) => (
            <mesh key={k} position={[0, 0.13 + k * 0.24, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.28, 0.11, 8, 18]} /><meshStandardMaterial color="#1f2937" /></mesh>
          ))}
        </group>
      ))}
      {/* bay markings */}
      {[[-5, -4.4], [-1.5, -4.4], [2, -4.4], [-5, 4.4], [-1.5, 4.4], [2, 4.4]].map(([x, z], i) => (
        <Line key={i} points={[[x - 1.55, 0.02, z - 2], [x + 1.55, 0.02, z - 2], [x + 1.55, 0.02, z + 2], [x - 1.55, 0.02, z + 2], [x - 1.55, 0.02, z - 2]]} color="#facc15" lineWidth={2} />
      ))}
      {/* inspection canopy and wash gantry (outside) */}
      {[-1.8, 1.8].map((o) => (<mesh key={`i${o}`} position={[P.inspect[0] + o, 1.1, P.inspect[1] - 1.6]}><boxGeometry args={[0.14, 2.2, 0.14]} /><meshStandardMaterial color="#94a3b8" /></mesh>))}
      <mesh position={[P.inspect[0], 2.25, P.inspect[1] - 1.6]}><boxGeometry args={[3.9, 0.12, 0.3]} /><meshStandardMaterial color={trim} /></mesh>
      {[-1.8, 1.8].map((o) => (<mesh key={`w${o}`} position={[P.wash[0] + o, 1.2, P.wash[1] - 0.2]}><boxGeometry args={[0.14, 2.4, 0.14]} /><meshStandardMaterial color="#60a5fa" /></mesh>))}
      <mesh position={[P.wash[0], 2.4, P.wash[1] - 0.2]}><boxGeometry args={[3.9, 0.14, 0.2]} /><meshStandardMaterial color="#60a5fa" /></mesh>
    </group>
  );
}

export interface FloorProps {
  tRef: MutableRefObject<number>;
  bays: BayView[];
  lotCount: number;
  you: UserVisit | null;
  youFlags: { lifted: boolean; person: boolean };
  selected: CamId;
  onSelect: (c: CamId) => void;
  real: Set<CamId>;
  follow: [number, number] | null;
}

export default function Floor3D(p: FloorProps) {
  const lot = Math.min(p.lotCount, 3);
  return (
    <Canvas camera={{ position: [0.5, 22, 15], fov: 38, near: 0.1, far: 200 }} dpr={[1, 2]} gl={{ antialias: true }}>
      <color attach="background" args={["#e9eef3"]} />
      <fog attach="fog" args={["#e9eef3", 40, 80]} />
      <ambientLight intensity={1.1} />
      <directionalLight position={[6, 12, 8]} intensity={1.6} />
      <mesh rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[140, 90]} /><meshStandardMaterial color="#dfe5ec" /></mesh>
      <Building />
      <Zones bays={p.bays} selected={p.selected} onSelect={p.onSelect} />
      <Cameras selected={p.selected} real={p.real} onSelect={p.onSelect} />
      {p.bays.map((b) => {
        const [x, z] = P[`b${b.bay}`];
        const lifted = b.mine ? p.youFlags.lifted : b.lifted;
        return (
          <group key={b.bay}>
            <LiftRig x={x} z={z} raised={lifted && b.status !== "free"} />
            {b.status !== "free" && !b.mine && <BayCar v={b} />}
            {(b.mine ? p.youFlags.person : b.person) && b.status !== "free" && <Person x={x + 1.9} z={z - 0.3} yaw={-Math.PI / 2} tone={b.mine ? "#0f766e" : "#64748b"} />}
          </group>
        );
      })}
      {Array.from({ length: lot }, (_, i) => (
        <BayCar key={`lot${i}`} at={[P.lot[0] + (i - 1) * 3.2, P.lot[1]]} v={{ bay: 0, status: "working", since: 0, lifted: false, person: false, source: "sim", vehicle: ["suv", "taxi", "hatchback-sports"][i] }} />
      ))}
      {p.you && <YourCar tRef={p.tRef} you={p.you} flags={p.youFlags} />}
      <Rig selected={p.selected} follow={p.follow} />
    </Canvas>
  );
}

["sedan", "suv", "hatchback-sports", "taxi", "character-male-a"].forEach((m) => useGLTF.preload(asset(`models/${m}.glb`)));
