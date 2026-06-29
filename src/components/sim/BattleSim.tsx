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
import { OrbitControls, useGLTF, Billboard, Environment } from "@react-three/drei";
import * as THREE from "three";
import { Water } from "three/addons/objects/Water.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import { playSound } from "@/lib/sfx";
import {
  formation,
  visualFor,
  fireSoundFor,
  MODEL_FILES,
  type Domain,
  type Placement,
  type SimUnit,
  type Side,
} from "@/lib/battlescene";

const modelUrl = (file: string) => `/assets/sim/models/${file}.glb`;

const ATTACKER_COLOR = "#3a6ea5"; // blue
const DEFENDER_COLOR = "#c0392b"; // red

/** Deterministic per-unit seed (so bob/flicker vary without impure Math.random). */
function seedFrom(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return (h % 1000) / 100; // 0..10
}

/** Gentle procedural wave height so ships and the ocean surface agree. */
function waveHeight(x: number, z: number, t: number): number {
  // calmer swell — gentle bob, not choppy seas
  return (
    Math.sin(x * 0.16 + t * 0.7) * 0.18 +
    Math.cos(z * 0.2 + t * 0.55) * 0.15
  );
}

/**
 * Height of the rolling land at a world (x, z). MUST match the displacement the
 * `Ground` mesh applies to its plane (after the plane's -90° X rotation, the
 * plane's local y maps to world -z), so units and foliage sit ON the terrain
 * instead of floating above its dips.
 */
function terrainHeight(x: number, z: number): number {
  // Long, sweeping rolling hills: low frequencies = long wavelengths, a second
  // broad wave layered in, and a gentle ramp out from the (flat) centre so the
  // hills roll on into the distance instead of stopping short.
  const edge = Math.min(1, (Math.abs(x) + Math.abs(z)) / 110);
  return (
    (Math.sin(x * 0.022) * Math.cos(z * 0.02) * 8 +
      Math.sin(x * 0.011 + z * 0.009) * 4.5) *
    edge
  );
}

// ───────────────────────────── Battlefield ──────────────────────────────────

/** Sun direction shared by the sky dome, water reflection and key light. */
function useSunDirection() {
  return useMemo(() => {
    const elevation = 30; // higher sun → bluer sky, less hazy white horizon
    const azimuth = 165;
    const phi = THREE.MathUtils.degToRad(90 - elevation);
    const theta = THREE.MathUtils.degToRad(azimuth);
    return new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
  }, []);
}

/**
 * Real overcast sky + image-based lighting from a single equirect HDR
 * (Poly Haven, CC0). It's the skybox for both battles, drives realistic
 * reflections (the ocean and metal hulls reflect the actual cloudy sky), and —
 * by replacing the procedural sky + volumetric clouds + room-environment PMREM —
 * is also markedly cheaper on a weak GPU.
 */
function SkyEnvironment() {
  return (
    <Environment
      files="/assets/sim/sky-overcast.hdr"
      background
      environmentIntensity={0.9}
    />
  );
}

/**
 * Realistic ocean using three's Water shader (reflections + animated normals).
 * Note: this re-renders the scene into a reflection target each frame, which is
 * the heaviest thing in the sim — the reflection target is kept modest (256) to
 * soften that cost on weak GPUs while keeping the reflective look.
 */
function Ocean({ sun }: { sun: THREE.Vector3 }) {
  const normals = useLoader(THREE.TextureLoader, "/assets/sim/waternormals.jpg");
  const water = useMemo(() => {
    const n = normals.clone();
    n.wrapS = n.wrapT = THREE.RepeatWrapping;
    n.needsUpdate = true;
    const w = new Water(new THREE.PlaneGeometry(4000, 4000), {
      textureWidth: 256,
      textureHeight: 256,
      waterNormals: n,
      sunDirection: sun.clone().normalize(),
      sunColor: 0x6f767e, // dimmer overcast glint — less mirror-like
      waterColor: 0x1d4459, // lifted from near-black to a readable steely blue
      // Low distortion + large, slow waves: the reflected cloudy sky was
      // shimmering/flickering on a choppy, fast surface. This keeps it glassy.
      distortionScale: 0.8,
      fog: false,
    });
    // larger, smoother swells (lower tiling) → far less high-frequency flicker
    (w.material as THREE.ShaderMaterial).uniforms.size.value = 1.2;
    // tone down the overall sky reflection a touch (1 = full mirror)
    (w.material as THREE.ShaderMaterial).uniforms.alpha.value = 0.82;
    w.rotation.x = -Math.PI / 2;
    return w;
  }, [normals, sun]);

  const ref = useRef<Water>(null);
  useFrame((_, dt) => {
    // crawl the surface so the reflection drifts gently instead of flickering
    const w = ref.current;
    if (w) (w.material as THREE.ShaderMaterial).uniforms.time.value += dt * 0.15;
  });

  return <primitive ref={ref} object={water} />;
}

/** Realistic grass terrain: tiled grass texture over gently rolling hills. */
function Ground() {
  const grass = useLoader(THREE.TextureLoader, "/assets/sim/ground-grass.jpg");
  const tex = useMemo(() => {
    const t = grass.clone();
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(50, 50); // seamless dead-grass tile — no visible seams
    t.anisotropy = 16; // keep the texture crisp at the grazing camera angle
    t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  }, [grass]);
  const geo = useMemo(() => {
    const g = new THREE.PlaneGeometry(800, 800, 130, 130); // finer grid: less faceting so units don't float over the bigger hills
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      // The plane's local y becomes world -z after the -90° X rotation, so feed
      // (x, -y) to terrainHeight to keep mesh and grounding perfectly in sync.
      pos.setZ(i, terrainHeight(x, -y));
    }
    g.computeVertexNormals();
    return g;
  }, []);
  return (
    <mesh geometry={geo} rotation-x={-Math.PI / 2} receiveShadow>
      {/* light, subtle warm tint over the seamless dead-grass — not heavy brown */}
      <meshStandardMaterial map={tex} roughness={1} color="#c4b793" />
    </mesh>
  );
}

// ─────────────────────────────── Foliage ─────────────────────────────────────

/** Foliage model basenames scattered across the land battlefield. */
const FOLIAGE_FILES = ["tree1", "tree2", "bush"] as const;

/** mulberry32 PRNG — deterministic scatter without impure Math.random at render. */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface FoliageInstance {
  file: string;
  x: number;
  z: number;
  yaw: number;
  target: number; // desired largest dimension in world units
}

/**
 * One scattered foliage model: cloned per instance, auto-scaled so its largest
 * dimension is `target`, grounded to y=0, double-sided, and lightly dimmed to
 * match the grim field. Dead trees are OPAQUE geometry; the bush ships BLEND
 * leaf cards which we turn into clean alpha-tested cutouts (write depth, no
 * sort artifacts), dropping its billboard-LOD card so it doesn't render as flat
 * crossed planes over the real mesh. All material edits are absolute sets, so
 * they're idempotent and safe on the materials shared across clones.
 */
function FoliagePiece({ file, x, z, yaw, target }: FoliageInstance) {
  const { scene } = useGLTF(modelUrl(file));
  const obj = useMemo(() => {
    const c = cloneSkinned(scene);
    c.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(c);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const largest = Math.max(size.x, size.y, size.z) || 1;
    const s = target / largest;
    c.position.set(
      c.position.x - center.x,
      c.position.y - box.min.y,
      c.position.z - center.z,
    );
    c.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      // Drop the billboard-LOD card — a flat crossed-plane stand-in that
      // overlaps the real geometry up close.
      if (mats.some((mat) => /billboard/i.test((mat as THREE.Material).name))) {
        m.visible = false;
        return;
      }
      // Foliage does NOT cast shadows: it's backdrop, and adding ~dozens of
      // alpha-tested casters to the shadow pass is what pushes a weak iGPU over
      // the edge (the battle canvas loses its context and goes black/white).
      m.castShadow = false;
      m.receiveShadow = true;
      m.frustumCulled = false; // small bounds were getting culled when far/high
      for (const mat of mats) {
        const sm = mat as THREE.MeshStandardMaterial;
        // BLEND/MASK leaf cards → alpha-tested cutout: keeps the cut-out
        // silhouette, writes depth, no sorting. A LOW threshold (0.25) is key —
        // with a 0.5 cutoff the mipmapped leaf alpha averages below the test at
        // distance/high angles and the whole bush vanishes.
        if (sm.transparent || sm.alphaTest > 0) {
          sm.alphaTest = 0.25;
          sm.transparent = false;
          sm.depthWrite = true;
        }
        sm.side = THREE.DoubleSide; // foliage is modelled one-sided
        if (sm.color) sm.color.setScalar(0.82); // idempotent dim
      }
    });
    const g = new THREE.Group();
    g.add(c);
    g.scale.setScalar(s);
    return g;
  }, [scene, target]);

  return <primitive object={obj} position={[x, terrainHeight(x, z), z]} rotation-y={yaw} />;
}

/**
 * Scatter trees and bushes across the land battlefield with a deterministic
 * seeded RNG. Keeps the centre clear so foliage never overlaps the armies, and
 * mixes the two tree models with the bush (~60/40 tree/bush) at varied scale.
 */
function Foliage() {
  const items = useMemo<FoliageInstance[]>(() => {
    const rng = mulberry32(0x5eedface);
    const out: FoliageInstance[] = [];
    const FIELD = 105; // spread over the longer hills, still framing the action
    const CLEAR_X = 28; // keep the formation box clear of foliage
    const CLEAR_Z = 24;
    let guard = 0;
    // A dense treeline + plenty of bushes. Foliage casts no shadows (see
    // FoliagePiece), so the extra instances stay affordable on a weak GPU.
    while (out.length < 40 && guard < 1200) {
      guard++;
      const x = (rng() * 2 - 1) * FIELD;
      const z = (rng() * 2 - 1) * FIELD;
      const yaw = rng() * Math.PI * 2;
      const kind = rng();
      const jitter = 0.9 + rng() * 0.7; // 0.9..1.6
      if (Math.abs(x) < CLEAR_X && Math.abs(z) < CLEAR_Z) continue;
      const isBush = kind > 0.45; // ~55% bushes
      const file = isBush ? "bush" : rng() > 0.5 ? "tree1" : "tree2";
      const base = isBush ? 5 : 17; // bigger so they read; trees tower over units
      out.push({ file, x, z, yaw, target: base * jitter });
    }
    return out;
  }, []);

  return (
    <group>
      {items.map((it, i) => (
        <FoliagePiece key={i} file={it.file} x={it.x} z={it.z} yaw={it.yaw} target={it.target} />
      ))}
    </group>
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
  // No dynamic light here on purpose: adding a pointLight per destroyed unit
  // forces Three.js to recompile every material (a visible freeze when several
  // units die at once). A bright emissive flame + smoke reads fine without it.
  const flame = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const f = 0.6 + Math.sin(t * 22) * 0.2 + Math.sin(t * 37.3) * 0.12;
    if (flame.current) flame.current.scale.setScalar(0.8 + f * 0.5);
  });
  return (
    <group>
      <mesh ref={flame} position={[0, 1.1, 0]}>
        <coneGeometry args={[0.5, 1.8, 8]} />
        <meshBasicMaterial color="#ff8a1e" transparent opacity={0.95} toneMapped={false} />
      </mesh>
      {[0, 1, 2].map((i) => (
        <mesh key={i} position={[0, 2 + i * 0.9, 0]}>
          <sphereGeometry args={[0.5 + i * 0.25, 8, 8]} />
          <meshBasicMaterial color="#2e2e2e" transparent opacity={0.4 - i * 0.1} />
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
  yaw = 0,
  autoOrient = true,
  doubleSide = false,
  dim,
  onHeight,
}: {
  file: string;
  target: number;
  color?: string;
  yaw?: number;
  autoOrient?: boolean;
  doubleSide?: boolean;
  dim?: number;
  onHeight?: (h: number) => void;
}) {
  const { scene, animations } = useGLTF(modelUrl(file));
  const { obj, height } = useMemo(() => {
    const c = cloneSkinned(scene);
    c.updateMatrixWorld(true);
    let box = new THREE.Box3().setFromObject(c);
    let size = box.getSize(new THREE.Vector3());
    // Orient the model's long horizontal axis onto Z (the facing/attack axis).
    // Skipped for models like aircraft whose widest axis is the wingspan.
    if (autoOrient && size.x > size.z) {
      c.rotation.y += Math.PI / 2;
    }
    // Manual facing correction so the model points at the enemy.
    c.rotation.y += yaw;
    c.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(c);
    size = box.getSize(new THREE.Vector3());
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
        // Force opaque: several models ship BLEND materials (e.g. the soldier
        // body) which, double-sided, render washed-out/see-through. These war
        // units don't need transparency.
        sm.transparent = false;
        sm.opacity = 1;
        sm.depthWrite = true;
        if (doubleSide) sm.side = THREE.DoubleSide;
        if (tint) {
          // matte the override so env lighting doesn't turn it chrome
          sm.color = tint;
          sm.metalness = 0.15;
          sm.roughness = 0.85;
        } else if (dim != null && sm.color) {
          // darken textured model uniformly (idempotent — safe on shared mats)
          sm.color.setScalar(dim);
        }
      }
    });
    const g = new THREE.Group();
    g.add(c);
    g.scale.setScalar(s);
    return { obj: g, height: size.y * s };
  }, [scene, target, color, yaw, autoOrient, doubleSide, dim]);

  useEffect(() => {
    onHeight?.(height);
  }, [height, onHeight]);

  // Play any baked-in skeletal animation (e.g. the soldier's Mixamo idle). The
  // mixer targets this instance's cloned skeleton, so each unit animates on its
  // own. No-op for static models (ships, tanks) that ship no clips.
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  useEffect(() => {
    if (!animations.length) {
      mixerRef.current = null;
      return;
    }
    const mixer = new THREE.AnimationMixer(obj);
    mixer.clipAction(animations[0]).reset().play();
    mixerRef.current = mixer;
    return () => {
      mixer.stopAllAction();
      mixer.uncacheRoot(obj);
      mixerRef.current = null;
    };
  }, [animations, obj]);
  useFrame((_, dt) => mixerRef.current?.update(dt));

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
  health,
}: {
  side: Side;
  y: number;
  width: number;
  destroyed: boolean;
  health: number;
}) {
  const fill = useRef<THREE.Mesh>(null);
  const root = useRef<THREE.Group>(null);
  const hp = useRef(health);
  const W = width;
  const H = Math.max(0.18, width * 0.16);
  const color = side === "attacker" ? ATTACKER_COLOR : DEFENDER_COLOR;

  useFrame((_, dt) => {
    const target = destroyed ? 0 : health;
    // ease toward the engine's true health so multi-hit units (battleship) drain
    hp.current += (target - hp.current) * Math.min(1, dt * 6);
    if (Math.abs(target - hp.current) < 0.005) hp.current = target;
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
  health,
}: {
  placement: Placement;
  domain: Domain;
  destroyed: boolean;
  health: number;
}) {
  const group = useRef<THREE.Group>(null);
  const vis = visualFor(placement.unit.type);
  const color = placement.unit.side === "attacker" ? ATTACKER_COLOR : DEFENDER_COLOR;
  const sinkRef = useRef(0);
  const bobSeed = seedFrom(placement.unit.id);
  const [modelH, setModelH] = useState<number | null>(null);

  const fallbackTop = vis.air ? 3 : (vis.target ?? vis.size) * 0.5;
  const barY = (modelH ?? fallbackTop) + (vis.air ? 1.1 : 0.7);
  const barW = Math.min(3.2, Math.max(1.0, (vis.target ?? vis.size) * 0.3));

  useFrame(({ clock }, dt) => {
    const g = group.current;
    if (!g) return;
    const t = clock.elapsedTime;
    let y = 0;
    if (domain === "sea" && !vis.air) {
      // Mostly roll/pitch for the "rocking" read; keep the VERTICAL heave tiny
      // so the hull never lifts off the flat water surface (which left a gap).
      y = waveHeight(placement.x, placement.z, t) * 0.25;
      g.rotation.z = Math.sin(t * 0.45 + bobSeed) * 0.05; // roll
      g.rotation.x = Math.cos(t * 0.35 + bobSeed) * 0.035; // pitch
    } else if (!vis.air) {
      // Land unit: sit on the rolling terrain so it doesn't float over the dips.
      y = terrainHeight(placement.x, placement.z);
    }
    if (vis.air) {
      y = 6 + Math.sin(t * 1.5 + bobSeed) * 0.3;
    }
    y += vis.yOffset ?? 0; // e.g. sit the submarine lower in the water
    if (destroyed) {
      // slow sink/fall so the death reads (not an instant disappear)
      sinkRef.current = Math.min(sinkRef.current + dt * 0.17, 1);
      const s = sinkRef.current;
      if (domain === "sea" && !vis.air) {
        y -= s * 3; // sink beneath the waves
        g.rotation.z += s * 0.6;
      } else if (vis.air) {
        // plane descends straight into the ground (no tumble)
        y = 6 - s * 9;
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
          yaw={vis.yaw}
          autoOrient={vis.autoOrient}
          doubleSide={vis.doubleSide}
          dim={vis.dim}
          onHeight={setModelH}
        />
      ) : (
        <UnitMesh shape={vis.shape} color={destroyed ? "#555" : color} />
      )}
      <HealthBar side={placement.unit.side} y={barY} width={barW} destroyed={destroyed} health={health} />
      {destroyed && <Burning />}
    </group>
  );
}

// ─────────────────────────────── Volley ─────────────────────────────────────

interface Beam {
  key: string;
  from: THREE.Vector3;
  to: THREE.Vector3;
  delay: number; // seconds after the volley starts before this shot fires
}

const BEAM_STAGGER = 0.09; // gap between successive shots
const BEAM_LIFE = 0.4; // how long each shot stays visible

/** Self-animating tracer + muzzle flash; appears at `beam.delay` after start. */
function BeamMesh({ beam, startRef }: { beam: Beam; startRef: React.RefObject<number> }) {
  const grp = useRef<THREE.Group>(null);
  const beamMat = useRef<THREE.MeshBasicMaterial>(null);
  const flash = useRef<THREE.Mesh>(null);
  const flashMat = useRef<THREE.MeshBasicMaterial>(null);
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

  useFrame(({ clock }) => {
    const age = clock.elapsedTime - (startRef.current ?? 0) - beam.delay;
    const o = age < 0 ? 0 : Math.max(0, 1 - age / BEAM_LIFE);
    if (grp.current) grp.current.visible = o > 0.02;
    if (beamMat.current) beamMat.current.opacity = o;
    if (flashMat.current) flashMat.current.opacity = o;
    if (flash.current) flash.current.scale.setScalar(0.12 + o * 0.5);
  });

  return (
    <group ref={grp} visible={false}>
      <mesh position={pos} quaternion={quat}>
        <cylinderGeometry args={[0.05, 0.05, len, 6]} />
        <meshBasicMaterial ref={beamMat} color="#ffd24a" transparent opacity={0} toneMapped={false} />
      </mesh>
      <mesh ref={flash} position={beam.from}>
        <sphereGeometry args={[1, 8, 8]} />
        <meshBasicMaterial ref={flashMat} color="#fff2b0" transparent opacity={0} toneMapped={false} />
      </mesh>
    </group>
  );
}

function Volley({
  placements,
  destroyedIds,
  salvo,
  domain,
  firingIds,
  playSounds,
}: {
  placements: Placement[];
  destroyedIds: Set<string>;
  salvo: number;
  domain: Domain;
  firingIds: string[];
  playSounds: boolean;
}) {
  const [beams, setBeams] = useState<Beam[]>([]);
  const startRef = useRef(0);
  const durRef = useRef(0);
  const lastSalvo = useRef(0);

  const posOf = useMemo(() => {
    const m = new Map<string, THREE.Vector3>();
    for (const p of placements) {
      const air = visualFor(p.unit.type).air;
      m.set(p.unit.id, new THREE.Vector3(p.x, air ? 6 : domain === "sea" ? 0.6 : 0.8, p.z));
    }
    return m;
  }, [placements, domain]);

  // Edge-trigger a volley when `salvo` changes; shots are staggered so they
  // ripple across the line instead of all firing at once.
  useFrame(({ clock }) => {
    if (salvo !== lastSalvo.current) {
      lastSalvo.current = salvo;
      const firing = new Set(firingIds);
      const live = placements.filter((p) => !destroyedIds.has(p.unit.id));
      const att = live.filter((p) => p.unit.side === "attacker");
      const def = live.filter((p) => p.unit.side === "defender");
      const shooters = live.filter((p) => firing.has(p.unit.id));
      const next: Beam[] = [];
      let i = 0;
      for (const s of shooters) {
        const enemies = s.unit.side === "attacker" ? def : att;
        if (!enemies.length) continue;
        const target = enemies[Math.floor(Math.random() * enemies.length)];
        const a = posOf.get(s.unit.id);
        const b = posOf.get(target.unit.id);
        if (a && b) {
          next.push({ key: `${s.unit.id}-${salvo}`, from: a, to: b, delay: i * BEAM_STAGGER });
          i++;
        }
      }
      if (playSounds) {
        const sounds = new Set(shooters.map((p) => fireSoundFor(p.unit.type)));
        sounds.forEach((s) => playSound(s));
      }
      startRef.current = clock.elapsedTime;
      durRef.current = Math.max(0, i - 1) * BEAM_STAGGER + BEAM_LIFE + 0.1;
      setBeams(next);
      return;
    }
    if (beams.length && clock.elapsedTime - startRef.current > durRef.current) {
      setBeams([]);
    }
  });

  return (
    <>
      {beams.map((b) => (
        <BeamMesh key={b.key} beam={b} startRef={startRef} />
      ))}
    </>
  );
}

/** Cinematic opening: sweep across the field, then settle into the battle view. */
function IntroCamera({ settle, onDone }: { settle: [number, number, number]; onDone: () => void }) {
  const camera = useThree((s) => s.camera);
  const start = useMemo(
    () => new THREE.Vector3(-settle[0] * 0.55, settle[1] * 1.7 + 14, settle[2] * 1.2 + 26),
    [settle],
  );
  const settleVec = useMemo(() => new THREE.Vector3(...settle), [settle]);
  const t0 = useRef<number | null>(null);
  const fired = useRef(false);
  const DUR = 4.5;
  useFrame(({ clock }) => {
    if (t0.current === null) t0.current = clock.elapsedTime;
    const raw = Math.min(1, (clock.elapsedTime - t0.current) / DUR);
    const e = raw < 0.5 ? 2 * raw * raw : 1 - Math.pow(-2 * raw + 2, 2) / 2; // easeInOut
    camera.position.lerpVectors(start, settleVec, e);
    camera.lookAt(0, (1 - e) * 6, 0);
    if (raw >= 1 && !fired.current) {
      fired.current = true;
      onDone();
    }
  });
  return null;
}

/** WASD panning that rides on top of OrbitControls (moves camera + target). */
function WasdControls({ controlsRef }: { controlsRef: React.RefObject<{ object: THREE.Camera; target: THREE.Vector3; update: () => void } | null> }) {
  const keys = useRef<Record<string, boolean>>({});
  useEffect(() => {
    const handle = (down: boolean) => (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === "w" || k === "a" || k === "s" || k === "d") keys.current[k] = down;
    };
    const dn = handle(true);
    const up = handle(false);
    window.addEventListener("keydown", dn);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", dn);
      window.removeEventListener("keyup", up);
    };
  }, []);

  useFrame((_, dt) => {
    const c = controlsRef.current;
    if (!c) return;
    const fwd = new THREE.Vector3();
    c.object.getWorldDirection(fwd);
    fwd.y = 0;
    if (fwd.lengthSq() === 0) return;
    fwd.normalize();
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), fwd).normalize();
    const move = new THREE.Vector3();
    if (keys.current.w) move.add(fwd);
    if (keys.current.s) move.sub(fwd);
    if (keys.current.a) move.add(right);
    if (keys.current.d) move.sub(right);
    if (move.lengthSq() === 0) return;
    move.normalize().multiplyScalar(45 * dt);
    c.object.position.add(move);
    c.target.add(move);
    c.update();
  });
  return null;
}

// ─────────────────────────────── Scene ──────────────────────────────────────

export interface BattleSimProps {
  units: SimUnit[];
  domain: Domain;
  destroyedIds: string[];
  /** increment to trigger a firing volley */
  salvo: number;
  /** unit ids that fire this volley (scored a hit) */
  firingIds: string[];
  /** per-unit health 0..1 by id (drives the bars; omit = full health) */
  healthById?: Record<string, number>;
  /** play fire SFX from inside the scene (false when the host plays them) */
  playSounds?: boolean;
  /** team names for the cinematic intro title card */
  attackerName?: string;
  defenderName?: string;
  className?: string;
}

function Scene({
  units,
  domain,
  destroyedIds,
  salvo,
  firingIds,
  healthById,
  playSounds = true,
  camPos,
}: Omit<BattleSimProps, "className"> & { camPos: [number, number, number] }) {
  const placements = useMemo(() => {
    const att = formation(units.filter((u) => u.side === "attacker"), "attacker");
    const def = formation(units.filter((u) => u.side === "defender"), "defender");
    return [...att, ...def];
  }, [units]);
  const destroyed = useMemo(() => new Set(destroyedIds), [destroyedIds]);
  const sun = useSunDirection();
  const controlsRef = useRef<{ object: THREE.Camera; target: THREE.Vector3; update: () => void } | null>(null);
  const [introDone, setIntroDone] = useState(false);

  return (
    <>
      <Suspense fallback={null}>
        <SkyEnvironment />
      </Suspense>
      {/* Softer, overcast lighting */}
      <hemisphereLight args={["#c4cdd6", domain === "sea" ? "#1a2e3c" : "#2e3624", 0.7]} />
      <directionalLight
        position={[sun.x * 120, sun.y * 120, sun.z * 120]}
        intensity={1.5}
        color="#eef0f2"
        castShadow
        shadow-mapSize={[512, 512]}
        shadow-camera-left={-60}
        shadow-camera-right={60}
        shadow-camera-top={60}
        shadow-camera-bottom={-60}
      />
      <ambientLight intensity={0.5} />

      <Suspense fallback={null}>
        {domain === "sea" ? (
          <Ocean sun={sun} />
        ) : (
          <>
            <Ground />
            <Foliage />
          </>
        )}

        {placements.map((p) => (
          <Unit
            key={p.unit.id}
            placement={p}
            domain={domain}
            destroyed={destroyed.has(p.unit.id)}
            health={healthById?.[p.unit.id] ?? 1}
          />
        ))}
      </Suspense>

      <Volley placements={placements} destroyedIds={destroyed} salvo={salvo} domain={domain} firingIds={firingIds} playSounds={playSounds} />

      {!introDone && <IntroCamera settle={camPos} onDone={() => setIntroDone(true)} />}
      {introDone && (
        <>
          <OrbitControls
            // @ts-expect-error drei forwards the controls instance to the ref
            ref={controlsRef}
            makeDefault
            enablePan
            maxPolarAngle={Math.PI / 2.08}
            minDistance={6}
            maxDistance={260}
            target={[0, 0, 0]}
          />
          <WasdControls controlsRef={controlsRef} />
        </>
      )}
    </>
  );
}

// Warm the glTF cache so models pop in fast on first battle.
for (const f of MODEL_FILES) useGLTF.preload(modelUrl(f));
for (const f of FOLIAGE_FILES) useGLTF.preload(modelUrl(f));

export default function BattleSim({ units, domain, destroyedIds, salvo, firingIds, healthById, playSounds, attackerName, defenderName, className }: BattleSimProps) {
  // Broadside view: elevated enough to frame the units, low enough that the
  // overcast sky still shows above the horizon. Sea is bigger → further back.
  // Naval view sits higher and looks down at a steeper angle over the fleet.
  const camPos: [number, number, number] = domain === "sea" ? [44, 44, 48] : [24, 16, 18];
  // If the GPU drops the context (driver reset under load on weak hardware) we
  // first try to recover automatically by remounting the canvas a couple of
  // times — this transparently fixes the common cold-start failure on the first
  // battle (shaders/env/models all upload at once and spike a weak GPU; the
  // remount succeeds because everything is already parsed and warm). Only after
  // the auto-retries are exhausted do we show a manual retry overlay.
  const [contextLost, setContextLost] = useState(false);
  const [canvasKey, setCanvasKey] = useState(0);
  const autoRetries = useRef(0);
  return (
    <div className={className} style={{ width: "100%", height: "100%", position: "relative" }}>
      <Canvas
        key={canvasKey}
        shadows
        camera={{ position: camPos, fov: 50 }}
        // Cap the pixel ratio: integrated GPUs (e.g. AMD Radeon iGPUs) can't
        // afford 1.5–2× of this fill-rate-heavy scene and trip the Windows GPU
        // watchdog (TDR), which resets the driver and flashes the canvas black
        // on a cycle. 1.25 stays crisp while roughly halving the pixel work.
        dpr={[1, 1.25]}
        performance={{ min: 0.5 }}
        gl={{
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 0.5,
          powerPreference: "high-performance",
        }}
        onCreated={({ gl }) => {
          const canvas = gl.domElement;
          // preventDefault lets the browser attempt to restore the context
          // rather than leaving a permanently black surface.
          canvas.addEventListener(
            "webglcontextlost",
            (e) => {
              e.preventDefault();
              if (autoRetries.current < 2) {
                autoRetries.current += 1;
                // Remount the canvas after a beat to let the GPU settle; this
                // recovers the cold-start failure without the user lifting a
                // finger. Bounded so a truly underpowered GPU still lands on the
                // manual overlay instead of looping.
                window.setTimeout(() => setCanvasKey((k) => k + 1), 500);
              } else {
                setContextLost(true);
              }
            },
            false,
          );
          canvas.addEventListener(
            "webglcontextrestored",
            () => setContextLost(false),
            false,
          );
        }}
      >
        {/* Key the scene graph (not the Canvas) on domain: switching Sea↔Land
            rebuilds the lightweight scene and replays the intro WITHOUT tearing
            down and recreating the WebGL context. Re-keying the Canvas leaked a
            fresh context per toggle until the browser's context cap was hit and
            the surface went black mid fly-in. */}
        <Scene
          key={domain}
          units={units}
          domain={domain}
          destroyedIds={destroyedIds}
          salvo={salvo}
          firingIds={firingIds}
          healthById={healthById}
          playSounds={playSounds}
          camPos={camPos}
        />
      </Canvas>

      {/* Cinematic title card during the opening pan */}
      {(attackerName || defenderName) && (
        <div className="battle-intro-card" aria-hidden>
          <div className="flex items-center gap-4 sm:gap-8 text-center">
            <span className="text-2xl sm:text-4xl font-extrabold" style={{ color: ATTACKER_COLOR }}>
              {attackerName ?? "Attacker"}
            </span>
            <span className="text-lg sm:text-2xl font-semibold" style={{ color: "#cdd4db" }}>
              vs
            </span>
            <span className="text-2xl sm:text-4xl font-extrabold" style={{ color: DEFENDER_COLOR }}>
              {defenderName ?? "Defender"}
            </span>
          </div>
        </div>
      )}

      {/* Graceful fallback if the GPU dropped the 3D context and didn't restore */}
      {contextLost && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center px-6"
          style={{ background: "rgba(10,13,17,0.9)" }}
        >
          <div className="text-sm" style={{ color: "#cdd4db" }}>
            The 3D view was interrupted by the graphics driver.
          </div>
          <button
            className="btn btn-primary"
            onClick={() => {
              autoRetries.current = 0;
              setContextLost(false);
              setCanvasKey((k) => k + 1); // remount the canvas → fresh context
            }}
          >
            ↺ Reload 3D view
          </button>
        </div>
      )}
    </div>
  );
}
