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
 * A dense dead forest: lots of cloned trees plus scattered bushes, placed with a
 * deterministic seeded RNG and biased outward so the forest thickens toward the
 * horizon while the centre stays clear for the armies.
 *
 * Cloning (not GPU instancing) on purpose: the tree models are mesh-quantized,
 * and instancing their compressed geometry shatters it. The trees are low-poly,
 * so ~150 clones are a few hundred cheap draw calls — fine on any real GPU.
 */
function Foliage() {
  const items = useMemo<FoliageInstance[]>(() => {
    const rng = mulberry32(0x5eedface);
    const out: FoliageInstance[] = [];
    const FIELD = 140;
    const CLEAR_X = 22; // keep the firing lanes clear, but let trees flank close
    const CLEAR_Z = 20;
    let guard = 0;
    // Even fill of the whole field outside the clear box, so the forest wraps
    // the battlefield — flanks and back — instead of clustering in the corners.
    while (out.length < 165 && guard < 6000) {
      guard++;
      const x = (rng() * 2 - 1) * FIELD;
      const z = (rng() * 2 - 1) * FIELD;
      if (Math.abs(x) < CLEAR_X && Math.abs(z) < CLEAR_Z) continue;
      const yaw = rng() * Math.PI * 2;
      const kind = rng();
      const jitter = 0.8 + rng() * 0.9; // 0.8..1.7 → varied heights
      const isBush = kind > 0.9; // ~10% bushes → mostly trees
      const file = isBush ? "bush" : rng() > 0.5 ? "tree1" : "tree2";
      const base = isBush ? 5 : 15;
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

// Shared GLSL: cheap value-noise FBM used by both the flame and smoke shaders.
const FIRE_NOISE_GLSL = `
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * vnoise(p); p = p * 2.0 + 11.0; a *= 0.5; }
  return v;
}
`;

const FIRE_VERT_GLSL = `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

// Additive flame: a hot, tapering tongue carved out of rising turbulence, with a
// deep-red → orange → yellow → white-hot colour ramp.
const FLAME_FRAG_GLSL = `
precision highp float;
varying vec2 vUv;
uniform float uTime;
uniform float uSeed;
${FIRE_NOISE_GLSL}
void main(){
  vec2 uv = vUv;
  float x = uv.x * 2.0 - 1.0;
  float t = uTime + uSeed;
  float n = fbm(vec2(uv.x * 3.0 + uSeed, uv.y * 3.5 - t * 2.2));
  float width = mix(0.85, 0.08, pow(uv.y, 0.8));        // narrows as it rises
  float horiz = smoothstep(width, 0.0, abs(x));
  float vert = smoothstep(1.05, 0.0, uv.y) * smoothstep(0.0, 0.07, uv.y);
  float fire = horiz * vert * (n * 1.7);
  fire = smoothstep(0.22, 0.95, fire);
  vec3 col = vec3(0.7, 0.06, 0.0);
  col = mix(col, vec3(1.0, 0.42, 0.0), smoothstep(0.15, 0.5, fire));
  col = mix(col, vec3(1.0, 0.85, 0.25), smoothstep(0.5, 0.8, fire));
  col = mix(col, vec3(1.0, 1.0, 0.9), smoothstep(0.82, 1.0, fire));
  gl_FragColor = vec4(col, fire); // additive: contributes col * fire
}
`;

// Alpha-blended smoke: a darker, slower plume that widens and fades as it rises
// above the flame.
const SMOKE_FRAG_GLSL = `
precision highp float;
varying vec2 vUv;
uniform float uTime;
uniform float uSeed;
${FIRE_NOISE_GLSL}
void main(){
  vec2 uv = vUv;
  float x = uv.x * 2.0 - 1.0;
  float t = uTime + uSeed;
  float n = fbm(vec2(uv.x * 2.0 + uSeed, uv.y * 2.0 - t * 0.6));
  float width = mix(0.3, 1.0, uv.y);                    // widens as it rises
  float horiz = smoothstep(width, 0.0, abs(x));
  float vert = smoothstep(0.1, 0.45, uv.y) * smoothstep(1.0, 0.5, uv.y);
  float smoke = horiz * vert * n * 1.7;
  smoke = smoothstep(0.2, 0.85, smoke);
  gl_FragColor = vec4(vec3(0.05, 0.05, 0.06), smoke * 0.5);
}
`;

function Burning({ scale = 1 }: { scale?: number }) {
  // Procedural shader flame + smoke — no texture. Both materials share identical
  // shader source per type, so Three compiles each program once and reuses it;
  // many wrecks dying at once won't trigger recompiles (which would stutter). No
  // dynamic light on purpose — a per-unit pointLight forces a full material
  // recompile, and the additive flame reads as hot without one.
  const seed = useMemo(() => Math.random() * 100, []);
  const flameMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
        uniforms: { uTime: { value: 0 }, uSeed: { value: seed } },
        vertexShader: FIRE_VERT_GLSL,
        fragmentShader: FLAME_FRAG_GLSL,
      }),
    [seed],
  );
  const smokeMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        toneMapped: false,
        uniforms: { uTime: { value: 0 }, uSeed: { value: seed } },
        vertexShader: FIRE_VERT_GLSL,
        fragmentShader: SMOKE_FRAG_GLSL,
      }),
    [seed],
  );
  useEffect(
    () => () => {
      flameMat.dispose();
      smokeMat.dispose();
    },
    [flameMat, smokeMat],
  );
  useFrame(({ clock }) => {
    flameMat.uniforms.uTime.value = clock.elapsedTime;
    smokeMat.uniforms.uTime.value = clock.elapsedTime;
  });
  return (
    <Billboard>
      <mesh position={[0, 2.5 * scale, 0]} scale={[2.5 * scale, 4.8 * scale, 1]} material={smokeMat}>
        <planeGeometry args={[1, 1]} />
      </mesh>
      <mesh position={[0, 1.45 * scale, 0]} scale={[2.7 * scale, 3.2 * scale, 1]} material={flameMat}>
        <planeGeometry args={[1, 1]} />
      </mesh>
    </Billboard>
  );
}

// Explosion flipbook (Unity Labs "Explosion00", CC0): a clean 5×5 grid of 25
// realistic 400px frames (2000×2000, straight alpha) — repacked from the source
// image sequence. High-res so it stays crisp engulfing a tank.
const EXPL_COLS = 5;
const EXPL_ROWS = 5;
const EXPL_FRAMES = EXPL_COLS * EXPL_ROWS;
const EXPL_FPS = 30;

/**
 * Real explosion animation: a camera-facing billboard playing through the
 * explosion sprite sheet once, then calling `onComplete` so the caller can swap
 * it for a lingering fire. Each instance clones the texture so its frame offset
 * animates independently.
 */
function SpriteExplosion({
  scale = 1,
  lift = 0.18,
  onComplete,
}: {
  scale?: number;
  lift?: number;
  onComplete?: () => void;
}) {
  const sheet = useLoader(THREE.TextureLoader, "/assets/sim/explosion.png");
  const tex = useMemo(() => {
    const t = sheet.clone();
    t.colorSpace = THREE.SRGBColorSpace;
    t.repeat.set(1 / EXPL_COLS, 1 / EXPL_ROWS);
    t.needsUpdate = true;
    return t;
  }, [sheet]);
  const grp = useRef<THREE.Group>(null);
  const t0 = useRef<number | null>(null);
  const frameRef = useRef(-1);
  const doneRef = useRef(false);
  useFrame(({ clock }) => {
    if (t0.current === null) t0.current = clock.elapsedTime;
    const frame = Math.floor((clock.elapsedTime - t0.current) * EXPL_FPS);
    if (frame >= EXPL_FRAMES) {
      if (!doneRef.current) {
        doneRef.current = true;
        if (grp.current) grp.current.visible = false;
        onComplete?.();
      }
      return;
    }
    if (frame !== frameRef.current) {
      frameRef.current = frame;
      const col = frame % EXPL_COLS;
      const row = Math.floor(frame / EXPL_COLS);
      // sheet rows run top→bottom; three's UV origin is bottom-left, so flip v.
      tex.offset.set(col / EXPL_COLS, 1 - (row + 1) / EXPL_ROWS);
    }
  });
  return (
    <group ref={grp}>
      {/* The fireball sits at the frame centre. For ground units lift the
          billboard centre to ≈⅕ of its size so the blast lands on the tank's
          body; pass lift=0 to centre it directly on an airborne unit. */}
      <Billboard position={[0, scale * lift, 0]}>
        <mesh scale={scale}>
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial map={tex} transparent depthWrite={false} toneMapped={false} />
        </mesh>
      </Billboard>
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
  destroyed = false,
  fireToken = 0,
  onHeight,
}: {
  file: string;
  target: number;
  color?: string;
  yaw?: number;
  autoOrient?: boolean;
  doubleSide?: boolean;
  dim?: number;
  destroyed?: boolean;
  fireToken?: number;
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

  // Play baked-in skeletal animation (the soldier's Mixamo idle / fire / death).
  // The mixer targets this instance's cloned skeleton so each unit animates on
  // its own. No-op for static models (ships, tanks) that ship no clips.
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const actionsRef = useRef<{
    idle?: THREE.AnimationAction;
    fire?: THREE.AnimationAction;
    death?: THREE.AnimationAction;
  }>({});
  const dyingRef = useRef(false);
  useEffect(() => {
    if (!animations.length) {
      mixerRef.current = null;
      return;
    }
    const mixer = new THREE.AnimationMixer(obj);
    const find = (n: string) => animations.find((a) => a.name === n);
    const idle = mixer.clipAction(find("idle") ?? animations[0]);
    idle.play();
    const fireClip = find("fire");
    const fire = fireClip ? mixer.clipAction(fireClip) : undefined;
    if (fire) fire.setLoop(THREE.LoopOnce, 1);
    const deathClip = find("death");
    const death = deathClip ? mixer.clipAction(deathClip) : undefined;
    if (death) {
      death.setLoop(THREE.LoopOnce, 1);
      death.clampWhenFinished = true; // hold the final (collapsed) pose
    }
    actionsRef.current = { idle, fire, death };
    mixerRef.current = mixer;
    // When the one-shot fire clip finishes, ease back to idle (unless dead).
    const onFinished = (e: { action: THREE.AnimationAction }) => {
      if (e.action === fire && !dyingRef.current) {
        fire?.fadeOut(0.15);
        idle.reset().fadeIn(0.15).play();
      }
    };
    mixer.addEventListener("finished", onFinished as never);
    return () => {
      mixer.removeEventListener("finished", onFinished as never);
      mixer.stopAllAction();
      mixer.uncacheRoot(obj);
      mixerRef.current = null;
      actionsRef.current = {};
    };
  }, [animations, obj]);

  // Cross-fade idle → death once on kill (and back to idle on a fresh battle).
  useEffect(() => {
    const { idle, fire, death } = actionsRef.current;
    if (!death) return;
    if (destroyed && !dyingRef.current) {
      dyingRef.current = true;
      idle?.fadeOut(0.15);
      fire?.fadeOut(0.1);
      death.reset().fadeIn(0.15).play();
    } else if (!destroyed && dyingRef.current) {
      dyingRef.current = false;
      death.fadeOut(0.15);
      idle?.reset().fadeIn(0.2).play();
    }
  }, [destroyed]);

  // Fire the rifle once when this unit scores a hit (fireToken increments).
  const lastFireRef = useRef(0);
  useEffect(() => {
    const { idle, fire } = actionsRef.current;
    if (!fire || !fireToken || fireToken === lastFireRef.current || dyingRef.current) return;
    lastFireRef.current = fireToken;
    idle?.fadeOut(0.08);
    fire.reset().fadeIn(0.08).play();
  }, [fireToken]);

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
  salvo,
  firing,
}: {
  placement: Placement;
  domain: Domain;
  destroyed: boolean;
  health: number;
  salvo: number;
  firing: boolean;
}) {
  const group = useRef<THREE.Group>(null);
  const modelWrap = useRef<THREE.Group>(null);
  const vis = visualFor(placement.unit.type);
  const color = placement.unit.side === "attacker" ? ATTACKER_COLOR : DEFENDER_COLOR;
  const sinkRef = useRef(0);
  const t0Ref = useRef<number | null>(null); // spawn time, for the plane fly-in
  const bobSeed = seedFrom(placement.unit.id);
  const [modelH, setModelH] = useState<number | null>(null);
  const [crashed, setCrashed] = useState(false); // plane hit the ground
  const [exploded, setExploded] = useState(false); // explosion finished → fire pile
  const [fireToken, setFireToken] = useState(0); // bumps when this unit fires

  // Reset death state when a unit comes back to life (battle reset).
  useEffect(() => {
    if (!destroyed) {
      sinkRef.current = 0;
      setCrashed(false);
      setExploded(false);
    }
  }, [destroyed]);

  // Each volley this unit scores a hit in, trigger its fire animation.
  const lastSalvoRef = useRef(salvo);
  useEffect(() => {
    if (salvo !== lastSalvoRef.current) {
      lastSalvoRef.current = salvo;
      if (firing && !destroyed) setFireToken((n) => n + 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [salvo]);

  const fallbackTop = vis.air ? 3 : (vis.target ?? vis.size) * 0.5;
  const barY = (modelH ?? fallbackTop) + (vis.air ? 1.1 : 0.7);
  const barW = Math.min(3.2, Math.max(1.0, (vis.target ?? vis.size) * 0.3));

  useFrame(({ clock }, dt) => {
    const g = group.current;
    if (!g) return;
    const t = clock.elapsedTime;
    if (t0Ref.current === null) t0Ref.current = t;
    const age = t - t0Ref.current;
    let x = placement.x;
    let z = placement.z;
    let y = 0;

    if (vis.air) {
      const hoverY = 6 + Math.sin(t * 1.5 + bobSeed) * 0.3;
      if (destroyed) {
        // Hit: explodes in the air (rendered below), then noses headfirst into
        // the ground where it leaves a burning wreck.
        sinkRef.current = Math.min(sinkRef.current + dt * 0.7, 1);
        const s = sinkRef.current;
        g.rotation.x = -s * 1.5; // pitch nose-down
        y = 6 - s * 6.2;
        if (s >= 1 && !crashed) setCrashed(true);
        if (modelWrap.current) modelWrap.current.visible = s < 1;
      } else {
        if (modelWrap.current) modelWrap.current.visible = true;
        // Fly-in: swoop from high and behind the line to the hover spot, then bob.
        const ENTER = 3.6;
        if (age < ENTER) {
          const e = 1 - Math.pow(1 - age / ENTER, 3); // easeOutCubic
          const dir = placement.unit.side === "attacker" ? -1 : 1;
          y = THREE.MathUtils.lerp(28, hoverY, e);
          z = THREE.MathUtils.lerp(placement.z + dir * 75, placement.z, e);
        } else {
          y = hoverY;
        }
      }
    } else if (domain === "sea") {
      y = waveHeight(placement.x, placement.z, t) * 0.25;
      g.rotation.z = Math.sin(t * 0.45 + bobSeed) * 0.05; // roll
      g.rotation.x = Math.cos(t * 0.35 + bobSeed) * 0.035; // pitch
      if (destroyed) {
        sinkRef.current = Math.min(sinkRef.current + dt * 0.17, 1);
        const s = sinkRef.current;
        y -= s * 3; // sink beneath the waves
        g.rotation.z += s * 0.6;
      }
    } else {
      // Land unit on the rolling terrain. Soldiers play a death animation;
      // tanks/artillery explode and then leave a fire pile (the model is hidden
      // once the blast finishes). Both stay put — no sink/collapse here.
      y = terrainHeight(placement.x, placement.z);
      if (modelWrap.current) {
        modelWrap.current.visible = !(destroyed && !vis.animatedDeath && exploded);
      }
    }
    y += vis.yOffset ?? 0; // e.g. sit the submarine lower in the water
    g.position.set(x, y, z);
  });

  // Land wrecks (tank/artillery) and burning ships; soldiers use their death
  // animation and aircraft crash (handled separately).
  const showWreckFx = destroyed && !vis.air && !vis.animatedDeath;

  return (
    <>
      <group ref={group} rotation-y={placement.rotationY} position={[placement.x, 0, placement.z]}>
        <group ref={modelWrap}>
          {vis.model ? (
            <ModelUnit
              file={vis.model}
              target={vis.target ?? vis.size}
              color={vis.color}
              yaw={vis.yaw}
              autoOrient={vis.autoOrient}
              doubleSide={vis.doubleSide}
              dim={vis.dim}
              destroyed={destroyed}
              fireToken={fireToken}
              onHeight={setModelH}
            />
          ) : (
            <UnitMesh shape={vis.shape} color={destroyed ? "#555" : color} />
          )}
        </group>
        <HealthBar side={placement.unit.side} y={barY} width={barW} destroyed={destroyed} health={health} />
        {showWreckFx &&
          (domain === "sea" ? (
            // Ships sink and burn (no ground blast).
            <Burning />
          ) : exploded ? (
            // Tank/artillery: a fire pile remains once the blast finishes.
            <Burning />
          ) : (
            // Tank/artillery: the blast covers the unit, then we remove it.
            <SpriteExplosion
              scale={(vis.target ?? vis.size) * 1.4}
              onComplete={() => setExploded(true)}
            />
          ))}
      </group>

      {/* Aircraft: a fireball the instant it's hit (mid-air, centred on the
          plane), then it noses into the ground and leaves a burning wreck. */}
      {destroyed && vis.air && !exploded && (
        <group position={[placement.x, 6, placement.z]}>
          <SpriteExplosion scale={13} lift={0} onComplete={() => setExploded(true)} />
        </group>
      )}
      {crashed && (
        <group position={[placement.x, terrainHeight(placement.x, placement.z) + 0.3, placement.z]}>
          <Burning scale={1.3} />
        </group>
      )}
    </>
  );
}

// ─────────────────────────────── Volley ─────────────────────────────────────

interface Beam {
  key: string;
  from: THREE.Vector3;
  to: THREE.Vector3;
  delay: number; // seconds after the volley starts before this shot fires
}

const BEAM_STAGGER = 0.08; // gap between successive shooters
const BEAM_LIFE = 0.32; // how long each shot stays visible
const BEAM_TRAVEL = 0.22; // seconds for a tracer to fly muzzle → target

/** Self-animating tracer + muzzle flash; appears at `beam.delay` after start. */
function BeamMesh({ beam, startRef }: { beam: Beam; startRef: React.RefObject<number> }) {
  const grp = useRef<THREE.Group>(null);
  const beamMat = useRef<THREE.MeshBasicMaterial>(null);
  const flash = useRef<THREE.Mesh>(null);
  const flashMat = useRef<THREE.MeshBasicMaterial>(null);
  const flashCore = useRef<THREE.Mesh>(null);
  const flashCoreMat = useRef<THREE.MeshBasicMaterial>(null);
  const head = useRef<THREE.Mesh>(null);
  const headMat = useRef<THREE.MeshBasicMaterial>(null);
  const { pos, quat, len, from, dir } = useMemo(() => {
    const d = new THREE.Vector3().subVectors(beam.to, beam.from);
    const length = d.length();
    const mid = new THREE.Vector3().addVectors(beam.from, beam.to).multiplyScalar(0.5);
    const q = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      d.clone().normalize(),
    );
    return { pos: mid, quat: q, len: length, from: beam.from.clone(), dir: d.clone() };
  }, [beam]);

  useFrame(({ clock }) => {
    const age = clock.elapsedTime - (startRef.current ?? 0) - beam.delay;
    const o = age < 0 ? 0 : Math.max(0, 1 - age / BEAM_LIFE);
    if (grp.current) grp.current.visible = o > 0.02 && age >= 0;
    if (beamMat.current) beamMat.current.opacity = o * 0.8;
    // Muzzle flash at the firing unit — big and bright so it's obvious where the
    // shot came from. Fades faster than the tracer (a punchy "blam" at source).
    const fo = age < 0 ? 0 : Math.max(0, 1 - age / (BEAM_LIFE * 0.55));
    if (flashMat.current) flashMat.current.opacity = fo * 0.9;
    if (flash.current) flash.current.scale.setScalar(0.7 + fo * 2.4);
    if (flashCoreMat.current) flashCoreMat.current.opacity = fo;
    if (flashCore.current) flashCore.current.scale.setScalar(0.45 + fo * 1.3);
    // Travelling tracer head flies muzzle → target so the direction (and origin)
    // of each standardized shot reads at a glance.
    const p = age < 0 ? 0 : Math.min(1, age / BEAM_TRAVEL);
    if (head.current) {
      head.current.position.set(from.x + dir.x * p, from.y + dir.y * p, from.z + dir.z * p);
      head.current.scale.setScalar(0.35 + Math.sin(p * Math.PI) * 0.15);
    }
    if (headMat.current) headMat.current.opacity = o > 0.02 ? 1 : 0;
  });

  return (
    <group ref={grp} visible={false}>
      <mesh position={pos} quaternion={quat}>
        <cylinderGeometry args={[0.06, 0.06, len, 6]} />
        <meshBasicMaterial ref={beamMat} color="#ffd24a" transparent opacity={0} toneMapped={false} />
      </mesh>
      {/* Muzzle flash: outer orange glow + white-hot core, at the firing unit. */}
      <mesh ref={flash} position={beam.from}>
        <sphereGeometry args={[1, 10, 10]} />
        <meshBasicMaterial ref={flashMat} color="#ff9d1e" transparent opacity={0} toneMapped={false} />
      </mesh>
      <mesh ref={flashCore} position={beam.from}>
        <sphereGeometry args={[1, 10, 10]} />
        <meshBasicMaterial ref={flashCoreMat} color="#fff6cf" transparent opacity={0} toneMapped={false} />
      </mesh>
      {/* Travelling tracer head. */}
      <mesh ref={head} position={beam.from}>
        <sphereGeometry args={[1, 8, 8]} />
        <meshBasicMaterial ref={headMat} color="#fff2b0" transparent opacity={0} toneMapped={false} />
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
      // Fire from roughly gun/turret height so the muzzle flash sits on the unit.
      m.set(p.unit.id, new THREE.Vector3(p.x, air ? 6 : domain === "sea" ? 1.2 : 1.5, p.z));
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
      let slot = 0;
      for (const s of shooters) {
        const enemies = s.unit.side === "attacker" ? def : att;
        if (!enemies.length) continue;
        const target = enemies[Math.floor(Math.random() * enemies.length)];
        const a = posOf.get(s.unit.id);
        const b = posOf.get(target.unit.id);
        if (!a || !b) continue;
        next.push({ key: `${s.unit.id}-${salvo}`, from: a, to: b, delay: slot * BEAM_STAGGER });
        slot++;
      }
      if (playSounds) {
        const sounds = new Set(shooters.map((p) => fireSoundFor(p.unit.type)));
        sounds.forEach((s) => playSound(s));
      }
      startRef.current = clock.elapsedTime;
      // Longest shot = last shooter's stagger + its burst tail + the shot's life.
      const lastDelay = next.reduce((m, b) => Math.max(m, b.delay), 0);
      durRef.current = lastDelay + BEAM_LIFE + 0.1;
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
            salvo={salvo}
            firing={firingIds.includes(p.unit.id)}
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
// Warm the explosion sheet too: without this the first blast suspends the whole
// scene (~1s freeze) while the 920 KB texture loads on demand. Browser-only —
// during SSR/build there's no server to fetch it from (it would error the build).
if (typeof window !== "undefined") {
  useLoader.preload(THREE.TextureLoader, "/assets/sim/explosion.png");
}

export default function BattleSim({ units, domain, destroyedIds, salvo, firingIds, healthById, playSounds, attackerName, defenderName, className }: BattleSimProps) {
  // Broadside view: elevated enough to frame the units, low enough that the
  // overcast sky still shows above the horizon. Sea is bigger → further back.
  // Naval view sits higher and looks down at a steeper angle over the fleet.
  // Viewed from -X so the attacker (blue) reads on the left and defender (red)
  // on the right.
  const camPos: [number, number, number] = domain === "sea" ? [-44, 44, 48] : [-24, 16, 18];
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
