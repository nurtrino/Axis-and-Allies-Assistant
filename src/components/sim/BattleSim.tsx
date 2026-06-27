"use client";

/**
 * 3D battle simulator scene (React Three Fiber). Renders a generated
 * battlefield (ocean or terrain), spawns both sides' units in opposing
 * formations, fires beams on each volley, and burns/sinks destroyed units.
 *
 * Placeholder geometry stands in for real models for now — swap `<UnitMesh>`
 * shapes for glTF without touching the formation / firing / destruction loop.
 */
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useLoader, useThree } from "@react-three/fiber";
import { OrbitControls, useGLTF, Billboard } from "@react-three/drei";
import * as THREE from "three";
import { Water } from "three/addons/objects/Water.js";
import { Sky } from "three/addons/objects/Sky.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import {
  formation,
  visualFor,
  MODEL_FILES,
  type Domain,
  type Placement,
  type SimUnit,
  type Side,
} from "@/lib/battlescene";

const modelUrl = (file: string) => `/assets/sim/models/${file}.glb`;

const ATTACKER_COLOR = "#c0392b";
const DEFENDER_COLOR = "#3a6ea5";

/** Deterministic per-unit seed (so bob/flicker vary without impure Math.random). */
function seedFrom(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return (h % 1000) / 100; // 0..10
}

/** Gentle procedural wave height so ships and the ocean surface agree. */
function waveHeight(x: number, z: number, t: number): number {
  return (
    Math.sin(x * 0.18 + t * 0.9) * 0.35 +
    Math.cos(z * 0.22 + t * 0.7) * 0.3
  );
}

// ───────────────────────────── Battlefield ──────────────────────────────────

/** Sun direction shared by the sky dome, water reflection and key light. */
function useSunDirection() {
  return useMemo(() => {
    const elevation = 18; // degrees above the horizon — warm, low light
    const azimuth = 165;
    const phi = THREE.MathUtils.degToRad(90 - elevation);
    const theta = THREE.MathUtils.degToRad(azimuth);
    return new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
  }, []);
}

/**
 * Image-based lighting from a neutral room environment (procedural, no asset).
 * Without this, the models' metallic materials have nothing to reflect and
 * render near-black — this is what makes the ships/tanks read properly.
 */
function SceneEnvironment() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    // eslint-disable-next-line react-hooks/immutability
    scene.environment = env;
    return () => {
      scene.environment = null;
      env.dispose();
      pmrem.dispose();
    };
  }, [gl, scene]);
  return null;
}

/** Procedural atmospheric sky (no texture needed). */
function SkyDome({ sun }: { sun: THREE.Vector3 }) {
  const sky = useMemo(() => {
    const s = new Sky();
    s.scale.setScalar(15000);
    const u = s.material.uniforms;
    u.turbidity.value = 8;
    u.rayleigh.value = 1.8;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.85;
    u.sunPosition.value.copy(sun);
    return s;
  }, [sun]);
  return <primitive object={sky} />;
}

/** Realistic ocean using three's Water shader (reflections + animated normals). */
function Ocean({ sun }: { sun: THREE.Vector3 }) {
  const normals = useLoader(THREE.TextureLoader, "/assets/sim/waternormals.jpg");
  const water = useMemo(() => {
    const n = normals.clone();
    n.wrapS = n.wrapT = THREE.RepeatWrapping;
    n.needsUpdate = true;
    const w = new Water(new THREE.PlaneGeometry(4000, 4000), {
      textureWidth: 512,
      textureHeight: 512,
      waterNormals: n,
      sunDirection: sun.clone().normalize(),
      sunColor: 0xffffff,
      waterColor: 0x183a55,
      distortionScale: 2.6,
      fog: false,
    });
    // smaller, finer wave pattern (scale the normal map tiling up)
    (w.material as THREE.ShaderMaterial).uniforms.size.value = 2.5;
    w.rotation.x = -Math.PI / 2;
    return w;
  }, [normals, sun]);

  const ref = useRef<Water>(null);
  useFrame((_, dt) => {
    const w = ref.current;
    if (w) (w.material as THREE.ShaderMaterial).uniforms.time.value += dt * 0.6;
  });

  return <primitive ref={ref} object={water} />;
}

/** Realistic grass terrain: tiled grass texture over gently rolling hills. */
function Ground() {
  const grass = useLoader(THREE.TextureLoader, "/assets/sim/grass.jpg");
  const tex = useMemo(() => {
    const t = grass.clone();
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(60, 60);
    t.anisotropy = 8;
    t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  }, [grass]);
  const geo = useMemo(() => {
    const g = new THREE.PlaneGeometry(800, 800, 80, 80);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      // rolling hills, flattened where the units stand near the centre
      const edge = Math.min(1, (Math.abs(x) + Math.abs(y)) / 140);
      pos.setZ(i, Math.sin(x * 0.05) * Math.cos(y * 0.045) * 5 * edge);
    }
    g.computeVertexNormals();
    return g;
  }, []);
  return (
    <mesh geometry={geo} rotation-x={-Math.PI / 2} receiveShadow>
      <meshStandardMaterial map={tex} roughness={1} />
    </mesh>
  );
}

// ─────────────────────────────── Units ──────────────────────────────────────

/** Placeholder silhouette per unit shape, drawn in the side's color. */
function UnitMesh({ shape, color }: { shape: string; color: string }) {
  const mat = <meshStandardMaterial color={color} metalness={0.3} roughness={0.6} />;
  switch (shape) {
    case "warship": {
      const len = 5;
      const beam = len * 0.26;
      return (
        <group>
          {/* hull */}
          <mesh position={[0, 0.25, 0]} castShadow>
            <boxGeometry args={[beam, 0.6, len]} />
            {mat}
          </mesh>
          {/* bow taper */}
          <mesh position={[0, 0.25, len / 2]} castShadow>
            <coneGeometry args={[beam / 2, len * 0.35, 4]} />
            {mat}
          </mesh>
          {/* superstructure */}
          <mesh position={[0, 0.78, -len * 0.06]} castShadow>
            <boxGeometry args={[beam * 0.6, 0.95, len * 0.28]} />
            {mat}
          </mesh>
          {/* funnel + mast */}
          <mesh position={[0, 1.2, -len * 0.16]} castShadow>
            <cylinderGeometry args={[0.14, 0.16, 0.7, 10]} />
            {mat}
          </mesh>
          <mesh position={[0, 1.5, 0.05]} castShadow>
            <cylinderGeometry args={[0.04, 0.04, 1.4, 6]} />
            {mat}
          </mesh>
          {/* fore + aft gun turrets */}
          <mesh position={[0, 0.6, len * 0.28]} castShadow>
            <cylinderGeometry args={[0.22, 0.26, 0.3, 10]} />
            {mat}
          </mesh>
          <mesh position={[0, 0.6, -len * 0.34]} castShadow>
            <cylinderGeometry args={[0.22, 0.26, 0.3, 10]} />
            {mat}
          </mesh>
        </group>
      );
    }
    case "carrier": {
      const len = 7;
      const beam = len * 0.22;
      return (
        <group>
          {/* hull */}
          <mesh position={[0, 0.3, 0]} castShadow>
            <boxGeometry args={[beam, 0.7, len]} />
            {mat}
          </mesh>
          <mesh position={[0, 0.3, len / 2]} castShadow>
            <coneGeometry args={[beam / 2, len * 0.25, 4]} />
            {mat}
          </mesh>
          {/* flat flight deck (wider than the hull) */}
          <mesh position={[0, 0.75, 0]} castShadow receiveShadow>
            <boxGeometry args={[beam * 1.8, 0.12, len * 0.96]} />
            <meshStandardMaterial color="#2b2b2b" metalness={0.2} roughness={0.85} />
          </mesh>
          {/* starboard island tower */}
          <mesh position={[beam * 0.75, 1.2, -len * 0.12]} castShadow>
            <boxGeometry args={[beam * 0.35, 0.9, len * 0.16]} />
            {mat}
          </mesh>
          <mesh position={[beam * 0.75, 1.9, -len * 0.12]} castShadow>
            <cylinderGeometry args={[0.04, 0.04, 0.8, 6]} />
            {mat}
          </mesh>
        </group>
      );
    }
    case "sub":
      return (
        <group rotation-z={Math.PI / 2}>
          <mesh castShadow>
            <capsuleGeometry args={[0.5, 2.2, 6, 12]} />
            {mat}
          </mesh>
        </group>
      );
    case "tank":
      return (
        <group>
          <mesh position={[0, 0.35, 0]} castShadow>
            <boxGeometry args={[1.2, 0.5, 1.8]} />
            {mat}
          </mesh>
          <mesh position={[0, 0.75, 0]} castShadow>
            <boxGeometry args={[0.8, 0.4, 0.9]} />
            {mat}
          </mesh>
          <mesh position={[0, 0.8, 0.9]} castShadow>
            <cylinderGeometry args={[0.08, 0.08, 1, 8]} rotation-x={Math.PI / 2} />
            {mat}
          </mesh>
        </group>
      );
    case "artillery":
      return (
        <group>
          <mesh position={[0, 0.3, 0]} castShadow>
            <boxGeometry args={[0.7, 0.4, 0.9]} />
            {mat}
          </mesh>
          <mesh position={[0, 0.5, 0.8]} rotation-x={Math.PI / 2.4} castShadow>
            <cylinderGeometry args={[0.07, 0.07, 1.4, 8]} />
            {mat}
          </mesh>
        </group>
      );
    case "plane":
      return (
        <group rotation-x={-0.05}>
          <mesh castShadow>
            <capsuleGeometry args={[0.22, 1.4, 6, 10]} rotation-x={Math.PI / 2} />
            {mat}
          </mesh>
          <mesh castShadow>
            <boxGeometry args={[2.4, 0.08, 0.5]} />
            {mat}
          </mesh>
          <mesh position={[0, 0.1, -0.8]} castShadow>
            <boxGeometry args={[0.9, 0.06, 0.35]} />
            {mat}
          </mesh>
        </group>
      );
    case "structure":
      return (
        <mesh position={[0, 1, 0]} castShadow>
          <boxGeometry args={[2.5, 2, 2.5]} />
          {mat}
        </mesh>
      );
    default: // infantry
      return (
        <group>
          <mesh position={[0, 0.5, 0]} castShadow>
            <capsuleGeometry args={[0.25, 0.6, 6, 10]} />
            {mat}
          </mesh>
        </group>
      );
  }
}

function Burning() {
  const ref = useRef<THREE.PointLight>(null);
  const flame = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    // layered sines fake a flicker without an impure RNG
    const f = 0.6 + Math.sin(t * 22) * 0.2 + Math.sin(t * 37.3) * 0.12;
    if (ref.current) ref.current.intensity = 6 * f;
    if (flame.current) flame.current.scale.setScalar(0.8 + f * 0.5);
  });
  return (
    <group>
      <pointLight ref={ref} color="#ff7a18" distance={14} position={[0, 1.5, 0]} />
      <mesh ref={flame} position={[0, 1.1, 0]}>
        <coneGeometry args={[0.5, 1.6, 8]} />
        <meshBasicMaterial color="#ff8a1e" transparent opacity={0.85} />
      </mesh>
      {[0, 1, 2].map((i) => (
        <mesh key={i} position={[0, 2 + i * 0.9, 0]}>
          <sphereGeometry args={[0.5 + i * 0.25, 8, 8]} />
          <meshBasicMaterial color="#3a3a3a" transparent opacity={0.35 - i * 0.08} />
        </mesh>
      ))}
    </group>
  );
}

/**
 * Loads a glTF model, clones it per instance, and auto-scales + grounds it so
 * its longest horizontal dimension is `target` world units and its base sits at
 * y=0 — robust to whatever scale/origin the source model shipped with.
 */
function ModelUnit({
  file,
  target,
  color,
  onHeight,
}: {
  file: string;
  target: number;
  color?: string;
  onHeight?: (h: number) => void;
}) {
  const { scene } = useGLTF(modelUrl(file));
  const { obj, height } = useMemo(() => {
    const c = cloneSkinned(scene);
    c.updateMatrixWorld(true);
    let box = new THREE.Box3().setFromObject(c);
    let size = box.getSize(new THREE.Vector3());
    // Orient the model's long horizontal axis along Z (the facing/attack axis)
    // so units point head-on across the battlefield instead of broadside.
    if (size.x > size.z) {
      c.rotation.y = Math.PI / 2;
      c.updateMatrixWorld(true);
      box = new THREE.Box3().setFromObject(c);
      size = box.getSize(new THREE.Vector3());
    }
    const center = box.getCenter(new THREE.Vector3());
    // Scale by the LARGEST overall dimension so tall/thin models (a standing
    // soldier) aren't blown up by their tiny footprint.
    const largest = Math.max(size.x, size.y, size.z) || 1;
    const s = target / largest;
    c.position.set(
      c.position.x - center.x,
      c.position.y - box.min.y,
      c.position.z - center.z,
    );
    const tint = color ? new THREE.Color(color) : null;
    c.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      m.receiveShadow = true;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) {
        const sm = mat as THREE.MeshStandardMaterial;
        sm.side = THREE.DoubleSide; // show thin one-sided surfaces (carrier deck)
        if (tint) sm.color = tint;
      }
    });
    const g = new THREE.Group();
    g.add(c);
    g.scale.setScalar(s);
    return { obj: g, height: size.y * s };
  }, [scene, target, color]);

  useEffect(() => {
    onHeight?.(height);
  }, [height, onHeight]);

  return <primitive object={obj} />;
}

/**
 * Sleek health bar that floats above a unit and billboards toward the camera.
 * Colored by side (attacker red / defender blue) over a dark backing; drains
 * to empty when the unit is destroyed.
 */
function HealthBar({
  side,
  y,
  width,
  destroyed,
}: {
  side: Side;
  y: number;
  width: number;
  destroyed: boolean;
}) {
  const fill = useRef<THREE.Mesh>(null);
  const root = useRef<THREE.Group>(null);
  const hp = useRef(1);
  const W = width;
  const H = Math.max(0.18, width * 0.16);
  const color = side === "attacker" ? ATTACKER_COLOR : DEFENDER_COLOR;

  useFrame((_, dt) => {
    if (destroyed) hp.current = Math.max(0, hp.current - dt * 1.1);
    const m = fill.current;
    if (m) {
      m.scale.x = Math.max(0.0001, hp.current);
      m.position.x = -(W / 2) * (1 - hp.current);
    }
    if (root.current) root.current.visible = hp.current > 0.02;
  });

  return (
    <Billboard position={[0, y, 0]}>
      <group ref={root}>
        <mesh position={[0, 0, -0.02]}>
          <planeGeometry args={[W + 0.18, H + 0.18]} />
          <meshBasicMaterial color="#0a0d11" transparent opacity={0.8} />
        </mesh>
        <mesh position={[0, 0, -0.01]}>
          <planeGeometry args={[W, H]} />
          <meshBasicMaterial color="#1b212a" />
        </mesh>
        <mesh ref={fill}>
          <planeGeometry args={[W, H]} />
          <meshBasicMaterial color={color} toneMapped={false} />
        </mesh>
      </group>
    </Billboard>
  );
}

function Unit({
  placement,
  domain,
  destroyed,
}: {
  placement: Placement;
  domain: Domain;
  destroyed: boolean;
}) {
  const group = useRef<THREE.Group>(null);
  const vis = visualFor(placement.unit.type);
  const color = placement.unit.side === "attacker" ? ATTACKER_COLOR : DEFENDER_COLOR;
  const sinkRef = useRef(0);
  const bobSeed = seedFrom(placement.unit.id);
  const [modelH, setModelH] = useState<number | null>(null);

  const fallbackTop = vis.air ? 1.6 : (vis.target ?? vis.size) * 0.5;
  const barY = (vis.air ? 0 : (modelH ?? fallbackTop)) + (vis.air ? 1.4 : 0.8);
  const barW = Math.min(4.5, Math.max(1.8, (vis.target ?? vis.size) * 0.42));

  useFrame(({ clock }, dt) => {
    const g = group.current;
    if (!g) return;
    const t = clock.elapsedTime;
    let y = 0;
    if (domain === "sea" && !vis.air) {
      y = waveHeight(placement.x, placement.z, t) + 0.05;
      g.rotation.z = Math.sin(t * 0.8 + bobSeed) * 0.04;
      g.rotation.x = Math.cos(t * 0.6 + bobSeed) * 0.03;
    }
    if (vis.air) {
      y = 6 + Math.sin(t * 1.5 + bobSeed) * 0.3;
    }
    if (destroyed) {
      sinkRef.current = Math.min(sinkRef.current + dt * 0.5, 1);
      const s = sinkRef.current;
      if (domain === "sea" && !vis.air) {
        y -= s * 3; // sink beneath the waves
        g.rotation.z += s * 0.6;
      } else if (vis.air) {
        y -= s * 8; // plane falls
        g.rotation.x += s * 1.2;
      } else {
        g.scale.setScalar(Math.max(0.001, 1 - s)); // wreck collapses
      }
    }
    g.position.set(placement.x, y, placement.z);
  });

  return (
    <group ref={group} rotation-y={placement.rotationY} position={[placement.x, 0, placement.z]}>
      {vis.model ? (
        <ModelUnit
          file={vis.model}
          target={vis.target ?? vis.size}
          color={vis.color}
          onHeight={setModelH}
        />
      ) : (
        <UnitMesh shape={vis.shape} color={destroyed ? "#555" : color} />
      )}
      <HealthBar side={placement.unit.side} y={barY} width={barW} destroyed={destroyed} />
      {destroyed && <Burning />}
    </group>
  );
}

// ─────────────────────────────── Volley ─────────────────────────────────────

interface Beam {
  key: string;
  from: THREE.Vector3;
  to: THREE.Vector3;
}

function BeamMesh({ beam, opacity }: { beam: Beam; opacity: number }) {
  const { pos, quat, len } = useMemo(() => {
    const dir = new THREE.Vector3().subVectors(beam.to, beam.from);
    const length = dir.length();
    const mid = new THREE.Vector3().addVectors(beam.from, beam.to).multiplyScalar(0.5);
    const q = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      dir.clone().normalize(),
    );
    return { pos: mid, quat: q, len: length };
  }, [beam]);

  return (
    <group>
      <mesh position={pos} quaternion={quat}>
        <cylinderGeometry args={[0.05, 0.05, len, 6]} />
        <meshBasicMaterial color="#ffd24a" transparent opacity={opacity} />
      </mesh>
      {/* muzzle flash at the shooter */}
      <mesh position={beam.from}>
        <sphereGeometry args={[0.4 * opacity + 0.1, 8, 8]} />
        <meshBasicMaterial color="#fff2b0" transparent opacity={opacity} />
      </mesh>
    </group>
  );
}

function Volley({
  placements,
  destroyedIds,
  salvo,
  domain,
}: {
  placements: Placement[];
  destroyedIds: Set<string>;
  salvo: number;
  domain: Domain;
}) {
  const [beams, setBeams] = useState<Beam[]>([]);
  const age = useRef(0);
  const lastSalvo = useRef(0);
  const [opacity, setOpacity] = useState(0);

  const posOf = useMemo(() => {
    const m = new Map<string, THREE.Vector3>();
    for (const p of placements) {
      const air = visualFor(p.unit.type).air;
      m.set(p.unit.id, new THREE.Vector3(p.x, air ? 6 : domain === "sea" ? 0.6 : 0.8, p.z));
    }
    return m;
  }, [placements, domain]);

  // Edge-trigger a volley when `salvo` changes (done in the frame loop so we
  // never setState during an effect/render); then fade the beams out.
  useFrame((_, dt) => {
    if (salvo !== lastSalvo.current) {
      lastSalvo.current = salvo;
      const live = placements.filter((p) => !destroyedIds.has(p.unit.id));
      const att = live.filter((p) => p.unit.side === "attacker");
      const def = live.filter((p) => p.unit.side === "defender");
      const next: Beam[] = [];
      const fire = (from: Placement[], to: Placement[], tag: Side) => {
        if (!to.length) return;
        for (const s of from) {
          const target = to[Math.floor(Math.random() * to.length)];
          const a = posOf.get(s.unit.id);
          const b = posOf.get(target.unit.id);
          if (a && b) next.push({ key: `${tag}-${s.unit.id}-${salvo}`, from: a, to: b });
        }
      };
      fire(att, def, "attacker");
      fire(def, att, "defender");
      age.current = 0;
      setBeams(next);
      setOpacity(next.length ? 1 : 0);
      return;
    }
    if (!beams.length) return;
    age.current += dt;
    const life = 0.55;
    setOpacity(Math.max(0, 1 - age.current / life));
    if (age.current > life) setBeams([]);
  });

  return (
    <>
      {beams.map((b) => (
        <BeamMesh key={b.key} beam={b} opacity={opacity} />
      ))}
    </>
  );
}

// ─────────────────────────────── Scene ──────────────────────────────────────

export interface BattleSimProps {
  units: SimUnit[];
  domain: Domain;
  destroyedIds: string[];
  /** increment to trigger a firing volley */
  salvo: number;
  className?: string;
}

function Scene({ units, domain, destroyedIds, salvo }: Omit<BattleSimProps, "className">) {
  const placements = useMemo(() => {
    const att = formation(units.filter((u) => u.side === "attacker"), "attacker");
    const def = formation(units.filter((u) => u.side === "defender"), "defender");
    return [...att, ...def];
  }, [units]);
  const destroyed = useMemo(() => new Set(destroyedIds), [destroyedIds]);
  const sun = useSunDirection();

  return (
    <>
      <SceneEnvironment />
      <SkyDome sun={sun} />
      <hemisphereLight args={["#cfe2ff", domain === "sea" ? "#13334a" : "#33401f", 0.5]} />
      <directionalLight
        position={[sun.x * 120, sun.y * 120, sun.z * 120]}
        intensity={2.4}
        color="#fff4e0"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-60}
        shadow-camera-right={60}
        shadow-camera-top={60}
        shadow-camera-bottom={-60}
      />
      <ambientLight intensity={0.3} />

      <Suspense fallback={null}>
        {domain === "sea" ? <Ocean sun={sun} /> : <Ground />}

        {placements.map((p) => (
          <Unit
            key={p.unit.id}
            placement={p}
            domain={domain}
            destroyed={destroyed.has(p.unit.id)}
          />
        ))}
      </Suspense>

      <Volley placements={placements} destroyedIds={destroyed} salvo={salvo} domain={domain} />

      <OrbitControls
        enablePan
        maxPolarAngle={Math.PI / 2.08}
        minDistance={6}
        maxDistance={220}
        target={[0, 0, 0]}
      />
    </>
  );
}

// Warm the glTF cache so models pop in fast on first battle.
for (const f of MODEL_FILES) useGLTF.preload(modelUrl(f));

export default function BattleSim({ units, domain, destroyedIds, salvo, className }: BattleSimProps) {
  return (
    <div className={className} style={{ width: "100%", height: "100%" }}>
      <Canvas
        shadows
        camera={{ position: [0, 34, 135], fov: 50 }}
        dpr={[1, 2]}
        gl={{ toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 0.55 }}
      >
        <Scene units={units} domain={domain} destroyedIds={destroyedIds} salvo={salvo} />
      </Canvas>
    </div>
  );
}
