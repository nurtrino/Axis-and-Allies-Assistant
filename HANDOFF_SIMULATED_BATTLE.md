# Handoff — `claude/simulated-battle` branch (3D Battle Simulator)

This branch adds a **3D battle simulator** to the Axis & Allies companion and
trims the turn portal. Everything below is committed and pushed to
`origin/claude/simulated-battle`. Pull it locally, finish the foliage task
(bottom of this doc), then merge/push to GitHub.

---

## Build / run / deploy

```bash
npm install
npm run build          # next build (also runs TypeScript)
npm run dev            # local dev (no DB needed for the demo routes)
```

- **DB-free demo routes** (no Postgres required):
  - `/battle-arena-demo` — full engine battle, **3D battlefield + dice side by side** (wide layout).
  - `/battle-demo` — same, narrow layout.
  - `/battle-sim-demo` — standalone 3D scene with manual Fire Volley / Sea-Land toggle.
- Real campaign battle: `/campaigns/[id]/battle`.
- Render auto-deploys from the branch; build cmd already runs `prisma migrate deploy`.

Useful: `npm run verify:turn` exercises the turn-engine server actions against a
local pglite DB (note: a couple of its phase-advance assertions are stale after
the phase removal — see "Turn portal changes").

---

## What changed (high level)

1. **Turn portal** trimmed to **Purchase → Conduct Combat → Collect Income**
   (R&D still optional/grayed). Combat Move, Noncombat Move, and Mobilize phases
   were removed from the flow. **No data was deleted** — see below.
2. **3D battle simulator** (React Three Fiber / three.js) wired into the real
   battle screen and the demo pages, driven by the existing dice + rules engine.

---

## Turn portal changes (DATA PRESERVED)

- `src/lib/turn.ts` — `PHASES` now only lists research(1)/purchase(2)/combat(4)/
  income(7). **Phase numbers are intentionally NOT reused** so existing
  `Campaign.activePhase` values stay valid. `advance()` walks the enabled phase
  numbers and skips retired ones.
- `src/components/TurnPortal.tsx` — Combat Move / Noncombat / Mobilize panels
  removed; **Conduct Combat** now just opens the Battle Simulator.
- **Nothing was dropped from the DB.** Models `CombatMoveOrder`, `Movement`,
  `PendingUnit`, `UnitStock`, `NationState` and all their server actions in
  `src/app/actions.ts` remain; export/import and round logging are untouched.
- Turn order is **USSR first** (`TURN_ORDER` = ASSIGNABLE_POWERS).

---

## 3D simulator — architecture

Stack: `three`, `@react-three/fiber` (v9, React 19), `@react-three/drei` (v10).
All client-only (WebGL); the sim is `dynamic(..., { ssr:false })`.

### Key files
- **`src/lib/battlescene.ts`** (pure, no three import) — the **unit registry**
  and layout math. This is where most per-unit tuning lives (`UNIT_VISUAL`).
- **`src/components/sim/BattleSim.tsx`** — the entire R3F scene (Canvas, sky,
  clouds, ocean/terrain, models, health bars, tracers, camera, intro).
- **`src/components/BattleStage.tsx`** — the dice + rules engine host; renders
  `BattleSim` beside the dice box and drives it from engine state.
- **`src/lib/battle.ts`** — the step-by-step combat engine (unchanged logic;
  only the dice step colors were swapped to blue=attacker/red=defender).
- **`src/lib/sfx.ts`** — `playSound(name, volume)` one-shot audio helper.

### How the engine drives the 3D (in `BattleStage.tsx`)
- On **Begin Battle**: build `simUnits` from `createBattle().attacker/defender`
  using the engine `uid` as each unit's id.
- Each roll (`rollStep`): only the dice that **hit** become `firingIds`; `salvo`
  increments (triggers a staggered volley); fire SFX play staggered (~90ms,
  capped at 14); engine `resolveRoll` applied.
- Derived each render: `simDestroyed` (units with hp≤0, plus the whole losing
  side once the battle is over) and `simHealth` (`hp/maxHp` per uid → health bars
  drain; a damaged battleship shows a half bar).
- `playSounds={false}` on `BattleSim` here (BattleStage plays them, deterministic).
- Outcome line names the country: e.g. "Germany takes Karelia"
  (`statusLine()` + `attackerName`/`defenderName`/`territoryName` props).

### Scene internals (`BattleSim.tsx`)
- `useSunDirection()` — shared sun (elevation 30°). Drives `SkyDome`, water, light.
- `SceneEnvironment` — procedural `RoomEnvironment` PMREM IBL so metallic
  materials aren't black (do NOT remove — that was the "everything is dark" fix).
- `SkyDome` — three `Sky` addon, hazy/overcast settings.
- `CloudLayer` — drei `<Clouds>/<Cloud>` (overcast).
- `Ocean` — three `Water` addon (waternormals.jpg). Dark, low-reflection.
- `Ground` — tiled grass texture over rolling hills, **darkened** (this is what
  the foliage task touches — see bottom).
- `ModelUnit` — loads a glTF, **auto-scales by largest dimension**, grounds the
  base to y=0, auto-orients the long axis to the attack axis (Z), applies
  per-model `yaw`, `color` (matte), `dim`, `doubleSide`, and **forces all
  materials opaque** (fixes BLEND soldier/carrier). Reports height via `onHeight`.
- `Unit` — bob/sink animation; `yOffset` sits ships in the water; on destroy it
  sinks ships / drops planes / collapses land units (slow, `dt*0.17`) + `Burning`.
- `Burning` — **emissive flame + smoke only, NO point light** (a per-unit light
  caused a material-recompile freeze when many died — do NOT re-add a light).
- `HealthBar` — billboarded, attacker=blue / defender=red, eases to true health.
- `Volley` / `BeamMesh` — staggered tracers (≈0.09s apart), self-animating.
- `IntroCamera` — 4.5s cinematic sweep, then hands off to OrbitControls.
- `WasdControls` — WASD panning on top of orbit/zoom.
- Title card — `.battle-intro-card` overlay (CSS in `globals.css`) shows
  "Attacker vs Defender" (country-named) during the intro pan.

---

## Tuning cheat-sheet (where to nudge things)

| Want to change | File / spot |
|---|---|
| Unit size | `UNIT_VISUAL[x].target` in `battlescene.ts` |
| Unit facing | `UNIT_VISUAL[x].yaw` (radians); `autoOrient:false` for planes |
| Ship waterline depth | `UNIT_VISUAL[x].yOffset` (more negative = deeper) |
| Sub/tank color | `UNIT_VISUAL[x].color` (matte tint) |
| Carrier darkness | `UNIT_VISUAL.carrier.dim` |
| Formation spacing | `formation()` in `battlescene.ts` (scales with largest unit) |
| Sink speed | `dt * 0.17` in `Unit`'s useFrame |
| Beam stagger / life | `BEAM_STAGGER` / `BEAM_LIFE` in `BattleSim.tsx` |
| Camera start (sea/land) | `camPos` in `BattleSim` default export |
| Intro length | `DUR` in `IntroCamera` |
| Sky haze / clouds | `SkyDome` uniforms / `CloudLayer` |
| Ocean color/reflection | `Ocean` `waterColor` / `sunColor` / `distortionScale` |
| Team colors | `ATTACKER_COLOR` / `DEFENDER_COLOR` (sim) and `ATTACKER_TINT`/`DEFENDER_TINT` + `battle.ts` step colors |

---

## Model asset pipeline (how units were added)

Source models live nowhere in the repo (originals were deleted after processing).
Optimized GLBs are in **`public/assets/sim/models/`**:
`warship.glb` (all surface ships), `carrier.glb`, `submarine.glb`, `tank.glb`,
`bomber.glb`, `fighter.glb`, `artillery.glb`, `infantry.glb`. (~36 MB total.)

To add/replace a model:
```bash
# FBX → glTF (binary):
node_modules/fbx2gltf/bin/Linux/FBX2glTF -b -i in.fbx -o out.glb
# Optimize (quantize mesh = no runtime decoder; webp textures; resize):
npx gltf-transform optimize in.glb public/assets/sim/models/NAME.glb \
  --compress quantize --texture-compress webp --texture-size 1024
```
Then reference `NAME` via `model: "NAME"` in `UNIT_VISUAL`. Textures: aim
≤2K, models a few MB. `useGLTF.preload` is already called for all `MODEL_FILES`.

Sounds are in `public/sounds/` (`naval-fire`, `tank-fire`, `infantry-fire`,
`artillery-fire`, `plane-fire`, `dice-roll`); mapped by `fireSoundFor()`.

---

## ⏳ PENDING TASK — dead grass + foliage on the land battlefield

You're adding: **1 dead-grass texture, 2 dead-tree models, 1 dead-bush model.**
Drop them in the repo, then wire as below (or hand back to a session to do it).

### 1) Place the files
- Dead grass texture → `public/assets/sim/dead-grass.jpg`
- Tree/bush models (GLB; optimize like above) →
  `public/assets/sim/models/tree1.glb`, `tree2.glb`, `bush.glb`
  - If they're FBX/OBJ, convert with FBX2glTF / gltf-transform first.

### 2) Swap the ground texture (`Ground` in `BattleSim.tsx`)
Change the loader path from `"/assets/sim/grass.jpg"` to
`"/assets/sim/dead-grass.jpg"` and consider removing the `color="#5f6749"`
darkening (the dead-grass texture is already drab). Keep the `repeat`/anisotropy.

### 3) Scatter the trees & bushes (new `Foliage` component)
Add a `Foliage` component rendered inside the land branch of `Scene`
(`{domain === "sea" ? <Ocean/> : (<><Ground/><Foliage/></>)}`). Approach for a
realistic, non-uniform look:
- Load `tree1/tree2/bush` with `useGLTF`, **clone per instance** (`SkeletonUtils.clone`).
- Scatter ~20–40 instances using a **deterministic seeded RNG** (NOT `Math.random`
  at render — the React-compiler lint forbids it; use a hash like `seedFrom()`
  already in the file, or a mulberry32 seeded by index).
- **Keep the center clear**: skip any position within the unit formation box
  (roughly |x| < 30 and |z| < 26) so foliage doesn't overlap the armies.
- Vary per instance: position across the field (e.g. ±120 x/z), random yaw,
  scale jitter (~0.8–1.4×), and mix the two tree models + bush (~60/40 tree/bush).
- Ground them: scale to a target height like the models do, sit base at y≈0
  (terrain is gently rolling; y=0 is fine, or sample the hill height).
- Reuse the `ModelUnit` material handling pattern: `castShadow`, opaque, and
  set `side` as needed; **do not add lights**.

This is straightforward once the files are in; ping a session with the exact
filenames/formats and it can write the `Foliage` component in one pass.

---

## Gotchas / do-not-break
- **No per-unit dynamic lights** (freeze). Fire is emissive only.
- **Keep `SceneEnvironment`** (IBL) — without it metallic models render black.
- **Force materials opaque** in `ModelUnit` — several models ship `alphaMode:BLEND`.
- Two demo WebGL contexts (Babylon dice-box + R3F) coexist on the battle screen;
  it's fine now that the death-freeze is gone, but watch perf if adding more.
- React-compiler lint: no `Math.random`/`Date.now` at render; mutate three objects
  via refs or `useMemo`-locals (see existing patterns).
