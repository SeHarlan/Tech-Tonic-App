---
phase: ad-hoc-2026-05-15-block-grid
status: findings
generated_at: 2026-05-15T00:00:00Z
sources: [claude, codex]
fix_count: 10
files_affected:
  - src/engine/parameters.ts
  - src/engine/renderer.ts
  - src/engine/shaders/main.frag
  - src/engine/shaders/blockNoise.frag
  - src/engine/shaders/movementShape.frag
  - src/pages/canvas/CanvasOverlay.tsx
  - .gitignore
estimated_line_delta: 110
user_gate_triggers: none-fired
---

# Phase ad-hoc-2026-05-15-block-grid — Fix Queue

Orchestrator-selected subset of findings from REVIEW.md and CODEX-REVIEW.md. Filter applied against project intent (the spike plan at `docs/superpowers/plans/2026-05-05-block-grid-movement-masks.md`), in-progress tuning markers, and verified codebase facts.

## Critical Issues

### CR-1. `shapeNoiseMode` weighted random has BlockNoise weight = 0; new mask path is dead for new seeds
- **File:** `src/engine/parameters.ts:317-323`
- **Issue:** `weightedRandom([[ShapeNoiseMode.BlockNoise, 0], [ShapeNoiseMode.StructuralQuintic, 1]], rng)` makes BlockNoise unreachable. The author's own comment says `//TODO should be 4, just testing right now`. With the new `useMovementMask = u_shapeNoiseMode == SHAPE_NOISE_BLOCK_NOISE` gate in `main.frag:291`, the entire mask-driven movement branch is dead for randomized seeds while `renderMovementShapeMask` still runs every frame — making the spike a net negative.
- **Fix:** Set the BlockNoise weight to `4` (matching the author's own TODO) and remove the TODO comment. Result: `weightedRandom([[ShapeNoiseMode.BlockNoise, 4], [ShapeNoiseMode.StructuralQuintic, 1]], rng)`.
- **Reasoning:** Caught by both reviewers (Claude CR-1, Codex WR-equivalent). Author intent is documented in the source itself.

## Warnings

### WR-1. `loadState` re-normalizes saved seeds with the new (smaller) modulus, silently changing old NFT output
- **File:** `src/engine/renderer.ts:1083`
- **Issue:** `SEED_MODULUS` changed from `1000` to `222` in `parameters.ts:3`. `loadState` does `seed = normalizeSeed(state.seed)`, which now collapses any saved seed ≥ 222 to `seed % 222` — giving a completely different procedural output than the NFT was minted with. The plan declares "Saved NFT metadata shape" out of scope, but the seed *value* is metadata and the new modulus silently mutates it.
- **Fix:** In `loadState`, use the persisted seed verbatim (or only normalize if it's outside the saveable range): `seed = state.seed`. The `normalizeSeed` call at `renderer.ts:548` for fresh seeds still applies the new modulus to new generation.
- **Reasoning:** Codex single-reviewer finding, verified against current code. The user has active NFT-update plans (per project memory), so save-load fidelity matters. Low-risk fix.

### WR-2. `u_resetNoiseScale` is dead in shader, dead-but-looked-up in renderer
- **File:** `src/engine/shaders/main.frag:21`, `src/engine/renderer.ts:259,844`
- **Issue:** `uniform vec2 u_resetNoiseScale;` declared in `main.frag` but never referenced. Renderer still calls `gl.getUniformLocation(mainProg, 'u_resetNoiseScale')` (returns `null`); a corresponding `gl.uniform2f` write is already commented out at 844. Matching `params.resetNoiseScale` is also commented in types and parameters. Dead plumbing on all three sides.
- **Fix:** Delete the uniform declaration in `main.frag`, the `resetNoiseScale: gl.getUniformLocation(...)` entry in `mainUnif`, and the commented uniform write at 844.
- **Reasoning:** Claude WR-3. Pure dead-code cleanup with no behavioral risk.

### WR-3. `u_mirrorAmount` / `u_mirrorAxis` declared but unused in both block-noise shaders; uniform writes happen every frame
- **File:** `src/engine/shaders/blockNoise.frag:18-19`, `src/engine/shaders/movementShape.frag:19-20`, `src/engine/renderer.ts:689-690,731-732`
- **Issue:** Both `blockNoise.frag` and `movementShape.frag` declare `u_mirrorAmount`/`u_mirrorAxis`, but neither shader (nor the included `blockNoiseDomain.glsl` chunk) references them. The renderer still issues `gl.uniform1f`/`gl.uniform1i` for both programs every frame. The author's own comment ("TODO deprecated, clean all mirror related stuff up") in `blockNoise.frag:18` acknowledges this.
- **Fix:** Delete the uniform declarations from both fragment shaders. Delete the `mirrorAmount`/`mirrorAxis` entries from `bnUnif` and `msUnif` in `renderer.ts`, and the four `gl.uniform*(bnUnif.mirror*, ...)` / `gl.uniform*(msUnif.mirror*, ...)` writes. Leave `params.mirrorAmount`/`mirrorAxis` alone — they may still be wired elsewhere.
- **Reasoning:** Claude WR-4 + WR-9. Author flagged it themselves. Pure cleanup, removes per-frame waste.

### WR-4. `shapeNoiseBlockSpeedAdjust` declared, never read
- **File:** `src/engine/shaders/main.frag:288`
- **Issue:** `float shapeNoiseBlockSpeedAdjust = 1.;` is declared at the top of `main()` and never referenced anywhere downstream. Leftover from the refactor.
- **Fix:** Delete the line.
- **Reasoning:** Claude WR-5. Trivial.

### WR-5. Stale `REPEAT` wrap comment above `CLAMP_TO_EDGE` texture creation
- **File:** `src/engine/renderer.ts:426-427` (the comment above `createBlockNoiseTexture` call sites at ~448, 455)
- **Issue:** Comment says "REPEAT wrap so fract()-driven UVs in the shader sample seamlessly when the read crosses the [0,1] boundary" but both call sites now pass `gl.CLAMP_TO_EDGE`. Behavior is fine (in-range sampling is guaranteed) but the comment is misleading.
- **Fix:** Rewrite the comment to describe actual usage: "CLAMP_TO_EDGE because in-range sampling is guaranteed by `(blockingSt + 0.5) / u_blocking` UV math; NEAREST keeps block boundaries crisp."
- **Reasoning:** Claude WR-6. Documentation accuracy.

### WR-6. `renderMovementShapeMask` runs every frame regardless of mode
- **File:** `src/engine/renderer.ts:792`
- **Issue:** `render()` unconditionally calls `renderMovementShapeMask(...)` even when `params.shapeNoiseMode === StructuralQuintic` (mask is never sampled). With `blockingScale` up to 512, that's up to 262 144 wasted GPU pixels per frame.
- **Fix:** Guard the call: `if (params.shapeNoiseMode === ShapeNoiseMode.BlockNoise) renderMovementShapeMask(smt, mnt, mnxyt);`. Import `ShapeNoiseMode` from `./parameters` if not already imported in renderer.
- **Reasoning:** Claude WR-7. Pairs with CR-1 — once BlockNoise becomes the dominant mode, this guard is the perf win the plan promised.

## Info

### IN-1. Hoist shared expression for `movementMaskUV` / `extraMovementMaskUV`
- **File:** `src/engine/shaders/main.frag:350,381`
- **Issue:** Both `movementMaskUV` and `extraMovementMaskUV` start with the same `(blockingSt + 0.5) / u_blocking`. Trivial cleanup.
- **Fix:** Compute `vec2 blockCellUV = (blockingSt + 0.5) / u_blocking;` once just before the `if (useMovementMask) {` block, then use `blockCellUV` for `movementMaskUV` and as the base for `extraMovementMaskUV`.
- **Reasoning:** Claude IN-3. No correctness impact, improves clarity.

### IN-2. Dead commented-out upload UI in `CanvasOverlay.tsx`
- **File:** `src/pages/canvas/CanvasOverlay.tsx:96-117,497-515` plus the `RMouseEvent`/`RChangeEvent` type imports
- **Issue:** ~30 lines of commented JSX + `handleUploadClick`/`handleUploadChange` callbacks. Commented blocks rot and confuse `grep`.
- **Fix:** Delete the commented blocks and unused `RMouseEvent`/`RChangeEvent` type imports. If upload is coming back, git history preserves the code.
- **Reasoning:** Claude IN-1. Standard dead-code hygiene.

### IN-3. `.gitignore` missing trailing newline
- **File:** `.gitignore` (last line)
- **Issue:** File ends without final newline. Cosmetic.
- **Fix:** Append a trailing newline.
- **Reasoning:** Claude IN-5. Trivial.

## Skipped Findings (audit trail)

**Codex single-reviewer claims that were verified FALSE against the actual code:**
- `blockNoise.frag:23, movementShape.frag:24 (codex, Critical)` — Claim: WebGL doesn't support `#include`. VERIFIED FALSE: project uses `vite-plugin-glsl` v1.5.5 (see `vite.config.ts`) which expands `#include` at build time.
- `main.frag:327,349 (codex, Critical)` — Claim: `blockingSt = st` when `u_fxWithBlocking` is false, making mask UV sample a tiny corner. VERIFIED FALSE: `blockingSt` is gated on `useBlocking = u_blocking > 0.0` (`main.frag:326-328`), not `u_fxWithBlocking`. The mask UV math is correct.

**Codex findings that need human visual verification, not auto-fix:**
- `main.frag:356-363 (codex, Warning)` — Claim: R=left → +1, G=right → -1 is reversed vs plan. The plan's `direction = sign(g - r)` would have right → +1. The non-mask path also multiplies by `movementNoiseShapeDirection` which the mask path doesn't, so a sign asymmetry between paths is possible. This may or may not visually manifest. DEFERRED — please verify by running the app with a BlockNoise seed and observing left/right organic movement direction.

**Findings deferred to user judgment (parameter tuning in progress):**
- `main.frag:289 (claude, WR-1)` — `moveShapeTimeAdjust = 0.` freezes non-mask shape noise. The commit `f0574ec wip: movement parameter tuning` suggests this is intentional during tuning. Once CR-1 lands (BlockNoise becomes dominant), the non-mask path that uses this constant runs less often.
- `renderer.ts:36 (claude, IN-6)` — `MOVEMENT_MASK_SCALE_EXPONENT = 0.` makes related scale math dead. TODO comment suggests intentional tuning state.
- `renderer.ts:41,44 (claude, IN-7)` — Both variance amounts at `0` with TODOs. Disabled mid-tuning.
- `parameters.ts:319 (claude, IN-8)` — TODO comment visibility. Mooted by CR-1.

**Pre-existing issues outside this diff range:**
- `renderer.ts:1052-1057 (claude, WR-8)` — `loadImageIntoFramebuffers` race on rapid `forceReset`. Pre-existing, visible-in-modified-file but not introduced in this commit range.

**Findings skipped per the spike plan's explicit out-of-scope list:**
- `renderer.ts:1086 (claude, WR-2)` — `loadState` spreads legacy `state.params` over fresh randomization. Plan says "Saved NFT metadata shape is out of scope." (Note: the related SEED_MODULUS issue at the same call site IS applied as WR-1 because it silently mutates seed values, which is a different concern than metadata shape.)

**Findings skipped as low-value / risk-of-regression:**
- `main.frag:134-138 (claude, IN-2)` — Defined-but-unused shape-noise modes 0/1/2. Claude noted these may be kept for runtime dev-console tweaking; the shader compiler dead-codes unused branches anyway.
- `movementShape.frag:36-41 (claude, IN-4)` — Magic-number channel offsets. Minor; the offsets work and are stable.
