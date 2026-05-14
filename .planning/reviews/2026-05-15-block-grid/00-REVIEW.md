---
phase: ad-hoc-2026-05-15-block-grid
status: findings
generated_at: 2026-05-15T00:00:00Z
diff_base: 74a5ddeb^ (adbf44a)
diff_head: HEAD
files_reviewed: 11
critical_count: 1
warning_count: 9
info_count: 8
---

# Code Review — Block-Grid Movement Masks (2026-05-15)

## Summary

The block-grid movement mask path (new `movementShape.frag` + FBO + main.frag sampling) is structurally sound: FBO allocation/cleanup is paired correctly in `rebuildBlockNoiseFBO`/`destroy()`, sampling at `(blockingSt + 0.5) / u_blocking` is correct for `NEAREST`/`CLAMP_TO_EDGE`, and uniform plumbing matches between shader and renderer. The most pressing issue is that the new mask path is effectively never taken in production (`BlockNoise` mode is weighted at `0` against `StructuralQuintic` at `1` in `parameters.ts`), so a `MAX_TEXTURE_SIZE`-bound mask FBO is rendered every frame for no visual effect. Several smaller issues: a dead constant (`moveShapeTimeAdjust = 0.`) silently zeroes time on the non-mask path, stale uniform plumbing for `u_resetNoiseScale`/`u_mirror*` remains, and a couple of dead local variables / unused mode constants linger from the refactor.

## Critical Issues

### CR-1. `shapeNoiseMode` weighted random has BlockNoise weight = 0; new mask path never runs in production
- **File:** `src/engine/parameters.ts:317-323`
- **Issue:** `weightedRandom([[ShapeNoiseMode.BlockNoise, 0], [ShapeNoiseMode.StructuralQuintic, 1]], rng)` makes BlockNoise effectively unreachable (cumulative weight = 0, so `randomValue <= 0` only fires on the exact-zero edge case). Comment marks it as a TODO. Combined with `useMovementMask = u_shapeNoiseMode == SHAPE_NOISE_BLOCK_NOISE` in `main.frag:291`, the entire new mask-driven movement branch is dead for randomized seeds. Meanwhile `renderMovementShapeMask` still runs every frame (renderer.ts:792), rendering a `blockingScale`-sized FBO with domain warp + 4 noise samples per pixel that nothing reads. This makes the spike a net negative: high-res shape bake is gone (good) but the new bake produces no visual output (bad). Either this is shipping in a half-disabled state, or the TODO was forgotten.
- **Fix:** Flip the weights to the documented `[BlockNoise, 4], [StructuralQuintic, 1]` (or whatever the validated split is). If StructuralQuintic was meant to be the default until further tuning, gate `renderMovementShapeMask()` in `render()` on `params.shapeNoiseMode === ShapeNoiseMode.BlockNoise` to avoid the wasted FBO pass.

## Warnings

### WR-1. `moveShapeTimeAdjust = 0.` silently freezes shape noise on the non-mask path
- **File:** `src/engine/shaders/main.frag:289`, used at 464, 571, 610, 649
- **Issue:** The constant `moveShapeTimeAdjust` is declared as `0.` and then multiplied into the `t` arg of every `shapeNoise(...)` call and into the time inputs for the extra-move / extra-fall XY scroll (`extraMoveTime = moveTime * u_moveShapeSpeed * moveShapeTimeAdjust`). The old code used `moveShapeTime * 0.25`. With `* 0.`, the shape-noise z-axis no longer animates **and** the extra-move/fall XY scroll is also frozen (the `vec2(extraMoveTime * movementNoiseShapeDirection, 0.952)` offset is now constant). When `useMovementMask` is false (currently the always-case — see CR-1), organic move/fall shapes are static. Either the variable is meant to be a tunable (then it should be > 0 or seed-derived) or it's leftover scaffolding and the multiplications should be deleted.
- **Fix:** If the intent is "no z-animation," delete the `* moveShapeTimeAdjust` factor from each call site so the variable's role is obvious. Otherwise set it to the previous `0.25` (or expose it as a tuned constant) so non-mask seeds animate again.

### WR-2. `useMoveBlob` / `useFallBlob` fields removed from `ShaderParams`, but old saved NFTs spread them back in unconditionally
- **File:** `src/engine/renderer.ts:1086` (`loadState`)
- **Issue:** `params = { ...randomizeShaderParameters(seed), ...state.params };` will overlay every field present in a legacy `state.params` — including the removed `useMoveBlob`, `useFallBlob`, `resetNoiseScale`. They become "extra" properties on the runtime `params` object that TS won't see. That's harmless today but means any future code that relies on `ShaderParams` keys being canonical (e.g. `JSON.stringify(params)` round-trips, structural cloning) silently carries dead state. More importantly, this spread also means new fields (`shapeNoiseMode`, `movementShapeScaling`, `movementNoiseShapeDirection`, `blockNoiseDisableShapeMovement`, `useRibbonThreshold`) are filled in by `randomizeShaderParameters(seed)` — but the *RNG sequence has changed shape* since old saves were created (new `weightedRandom` calls were inserted). The visual identity of old NFTs is no longer perfectly reproducible from the saved snapshot alone; the new fields come from a different RNG position than they would have at save time. The plan explicitly says "Saved NFT metadata shape" is out of scope, so this is by design — but worth flagging because it's the kind of thing that bites later when someone tries to re-render a saved NFT.
- **Fix:** Either (a) document that `state.params` is authoritative-only for fields that existed at save time, and any new RNG-derived field will reroll for old saves; or (b) whitelist only the keys present in `ShaderParams` when spreading, to keep `params` clean.

### WR-3. `u_resetNoiseScale` uniform: dead in shader, dead-but-looked-up in renderer
- **File:** `src/engine/shaders/main.frag:21`, `src/engine/renderer.ts:259`, 844
- **Issue:** `uniform vec2 u_resetNoiseScale;` is still declared in `main.frag` but never referenced — the GLSL compiler optimizes it out. The renderer still calls `gl.getUniformLocation(mainProg, 'u_resetNoiseScale')` (line 259, returns `null`) and keeps the assignment line commented at 844. The matching `params.resetNoiseScale` is also commented out in types and parameters. Dead plumbing on all three sides.
- **Fix:** Delete the uniform declaration in `main.frag`, the `resetNoiseScale: gl.getUniformLocation(...)` line in `mainUnif`, the commented uniform write, and the commented type/param fields. Either commit to keeping it or drop it cleanly.

### WR-4. `u_mirrorAmount` / `u_mirrorAxis` declared but unused in both block-noise shaders
- **File:** `src/engine/shaders/blockNoise.frag:18-19`, `src/engine/shaders/movementShape.frag:19-20`, renderer.ts msUnif/bnUnif
- **Issue:** Both `blockNoise.frag` and `movementShape.frag` declare `u_mirrorAmount` / `u_mirrorAxis`, but neither shader nor the included `blockNoiseDomain.glsl` chunk references them. `mirrorAmount` in `parameters.ts:184` is hardcoded `0`. The renderer still calls `gl.uniform1f`/`gl.uniform1i` for these every frame on both programs (renderer.ts:689-690, 731-732). The comment "TODO deprecated, clean all mirror related stuff up" in `blockNoise.frag:18` acknowledges this. Net cost: a few wasted uniform writes per frame and confusion about whether mirroring still works.
- **Fix:** Remove the uniform declarations from both fragment shaders, remove the `mirrorAmount`/`mirrorAxis` entries from `msUnif`/`bnUnif`, remove the `gl.uniform*` writes, and either delete `mirrorAmount`/`mirrorAxis` from `ShaderParams` or keep them with a comment saying they're reserved.

### WR-5. `shapeNoiseBlockSpeedAdjust` declared, never read
- **File:** `src/engine/shaders/main.frag:288`
- **Issue:** `float shapeNoiseBlockSpeedAdjust = 1.;` is declared at the top of `main()` and never referenced anywhere downstream. Leftover from the refactor.
- **Fix:** Delete the line.

### WR-6. Stale comment claims `REPEAT` wrap, but `createBlockNoiseTexture` is called with `CLAMP_TO_EDGE` for both FBOs
- **File:** `src/engine/renderer.ts:426-427`
- **Issue:** The comment above `createBlockNoiseTexture` reads "REPEAT wrap so fract()-driven UVs in the shader sample seamlessly when the read crosses the [0,1] boundary." But both call sites now pass `gl.CLAMP_TO_EDGE` (lines 448, 455). The behaviour is fine because `main.frag` only samples in-range UVs and `movementShape.frag` does its own `fract()` before going through `blockNoiseDomain`, but the comment is misleading for the next person who touches this code.
- **Fix:** Either change the comment to describe the actual usage (`CLAMP_TO_EDGE` because in-range sampling is guaranteed) or, if seamless wrap is wanted for the extra-mask 2x-tile UV at `main.frag:382`, switch the movement-shape texture to `REPEAT`.

### WR-7. `renderMovementShapeMask` runs every frame regardless of mode
- **File:** `src/engine/renderer.ts:792`
- **Issue:** `render()` unconditionally calls `renderMovementShapeMask(...)` after `renderBlockNoise(...)`, even when `params.shapeNoiseMode === StructuralQuintic` (i.e. when `useMovementMask` in the main shader is `false` and the texture is never sampled). With `blockingScale` up to 512, that's up to 262 144 pixels × (domain warp + 4 noise3D samples + pattern eval) per frame for no visual contribution. Out-of-scope per the plan's "performance not in v1 scope" but this *is* visible in the diff as the spike's only new GPU cost while half-disabled (see CR-1).
- **Fix:** Guard `renderMovementShapeMask(smt, mnt, mnxyt)` with `if (params.shapeNoiseMode === ShapeNoiseMode.BlockNoise)`. Pair with CR-1 — once BlockNoise is the dominant mode, this guard becomes the perf win the plan promised.

### WR-8. `loadImageIntoFramebuffers` race when `forceReset` is called rapidly
- **File:** `src/engine/renderer.ts:1052-1057`
- **Issue:** `forceReset()` for a loaded session calls `loadImageIntoFramebuffers(imageUrl)` and chains a `.then(() => { totalFrameCount = origFrameCount; ... })`. There's no cancellation: rapid repeated resets can fire multiple in-flight image loads. The later resolving promise overwrites `totalFrameCount` and `time` after the earlier one has already done so, so race outcomes depend on `Image.onload` ordering. Pre-existing risk slightly amplified by the new spike (forceReset is now also invoked from hardReset paths). Not introduced by this commit range but visible in the modified file.
- **Fix:** Track the in-flight image with a generation counter (`const myGen = ++resetGen;`) and bail out of the `.then` callback if `myGen !== resetGen`.

### WR-9. `mirrorAmount` deprecated comment lives in `blockNoise.frag` but the parameter is still wired through `renderMovementShapeMask`
- **File:** `src/engine/renderer.ts:731-732`
- **Issue:** Renderer writes `params.mirrorAmount` and `params.mirrorAxis` to `msUnif.mirrorAmount`/`mirrorAxis` for each frame, with `getUniformLocation` always returning `null` because the uniforms aren't referenced in the shader (see WR-4). Same goes for `bnUnif` writes at 689-690. This is the WR-4 issue surfaced again at the call-site level — separately worth fixing because the writes occur in the hot path.
- **Fix:** Delete the four `gl.uniform*(msUnif.mirror.../bnUnif.mirror..., ...)` calls. Or remove the `mirrorAmount`/`mirrorAxis` lookups from `msUnif`/`bnUnif` entirely (cleaner).

## Info

### IN-1. Commented-out code in `CanvasOverlay.tsx`
- **File:** `src/pages/canvas/CanvasOverlay.tsx:96-117`, 497-515
- **Issue:** ~30 lines of upload-button JSX + the `handleUploadClick` / `handleUploadChange` callbacks are commented out, plus the `RMouseEvent` / `RChangeEvent` type imports. Either restore the feature or delete the dead code; commented-out blocks rot and confuse `grep`.
- **Fix:** Remove the commented blocks, or move them behind a feature flag if the upload affordance is coming back.

### IN-2. `SHAPE_NOISE_CURRENT` and other defined-but-unused shape-noise modes
- **File:** `src/engine/shaders/main.frag:134-138`
- **Issue:** `#define SHAPE_NOISE_CURRENT 0`, `SHAPE_NOISE_FBM_QUINTIC 1`, `SHAPE_NOISE_METABALLS 2` are still defined and dispatched in `shapeNoise(...)` even though `parameters.ts` only ever selects mode `3` (StructuralQuintic) or `4` (BlockNoise). The dispatcher branches stay live in the compiled shader, possibly inflating register pressure.
- **Fix:** Either reduce `shapeNoise` to the two cases the TS layer ever produces, or document why the dead modes are kept (e.g. for runtime tweaking via dev console).

### IN-3. `extraMovementMaskUV` recomputes the same expression
- **File:** `src/engine/shaders/main.frag:350` and 381
- **Issue:** Both `movementMaskUV` and `extraMovementMaskUV` start with `(blockingSt + 0.5) / u_blocking`. The second one immediately reassigns via `fract(0.5 + extraMovementMaskUV * 2.)`. Minor; just naming-clarity. Optional: compute `vec2 blockCellUV = (blockingSt + 0.5) / u_blocking;` once and reuse.
- **Fix:** Hoist the shared expression for clarity. No correctness impact.

### IN-4. `movementShape.frag` channel mapping comment vs constants
- **File:** `src/engine/shaders/movementShape.frag:36-41`
- **Issue:** Spatial offsets for the four directional channels (`leftDomain`, `rightDomain + 11.31`, `downDomain + 173.29`, `upDomain + 111.11`) and the time offsets (`t`, `t`, `1.1+t`, `1.1+t`) are magic numbers without a comment explaining the decorrelation goal. The plan's draft used different offsets (`37.17, 111.11, 173.29`) — fine to deviate, but a one-line comment would help.
- **Fix:** Add a comment like `// Distinct spatial/temporal offsets per channel to decorrelate L/R and U/D noise so opposing directions don't collapse to the same value.`

### IN-5. `.gitignore` has trailing blank line and missing newline at EOF
- **File:** `.gitignore` (last 3 lines)
- **Issue:** The diff added two blank lines and `.review/`, but the file ends without a final newline (`\ No newline at end of file`). Cosmetic.
- **Fix:** Append a trailing newline.

### IN-6. `MOVEMENT_MASK_SCALE_EXPONENT = 0.` makes `MOVEMENT_MASK_REFERENCE_SCALE` and `movementMaskXYTime`'s `scaleCompensation` effectively no-ops
- **File:** `src/engine/renderer.ts:36`, `movementMaskXYTime` at 762-771
- **Issue:** With `MOVEMENT_MASK_SCALE_EXPONENT = 0.`, `Math.pow(scaleRatio, 0)` always returns `1`, so `scaleCompensation` is always 1 and the `MOVEMENT_MASK_REFERENCE_SCALE` constant is dead. The comment ("0=no scaling, 1=full inverse blockScale scaling") suggests this is intentionally tuned to 0 for now. If so, the whole `scaleRatio`/`scaleCompensation` calculation is computational overhead per frame for no benefit.
- **Fix:** If `EXPONENT = 0` is the final answer, drop the `scaleRatio`/`scaleCompensation` math and the `MOVEMENT_MASK_REFERENCE_SCALE` constant. If the exponent might be re-tuned, leave a TODO so the next reviewer doesn't think it's dead.

### IN-7. `RESET_VARIANCE_AMOUNT = 0` and `MOVEMENT_THRESHOLD_VARIANCE_AMOUNT = 0` disable both variance systems
- **File:** `src/engine/renderer.ts:41`, 44
- **Issue:** Both `RESET_VARIANCE_AMOUNT` and `MOVEMENT_THRESHOLD_VARIANCE_AMOUNT` are `0` with TODO comments. With both at 0, the `thresholdVariance()` function returns 0 always, and the entire `THRESHOLD_VARIANCE_HIGH_SCALE`, `THRESHOLD_VARIANCE_START_PHASE`, `RESET_VARIANCE_TROUGH_DUTY`, `MOVEMENT_THRESHOLD_VARIANCE_RATE_SEC` constant set is dead config. Not a bug if the TODOs will be addressed, but worth flagging since five constants and a function are currently producing zero effect.
- **Fix:** Either set non-zero amounts (or seed-derive them) to re-enable, or temporarily delete the variance plumbing until a real value is chosen.

### IN-8. `BlockNoise` weight comment is the only signal that the mode is disabled
- **File:** `src/engine/parameters.ts:319`
- **Issue:** `//TODO should be 4, just testing right now` is the only marker that the new feature is gated off. Easy to miss in PR review and easy to forget after merging. Pair with CR-1 — even if not fixed immediately, a more visible signal (a `FIXME:` log line, or an env-var gate) would help.
- **Fix:** Either fix CR-1 in the same change, or upgrade the marker to a runtime warning so it's surfaced when the engine boots in non-production builds.
