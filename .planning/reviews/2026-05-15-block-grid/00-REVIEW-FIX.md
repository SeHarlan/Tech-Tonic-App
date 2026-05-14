---
phase: ad-hoc-2026-05-15-block-grid
fixed_at: 2026-05-15T00:00:00Z
review_path: .planning/reviews/2026-05-15-block-grid/00-FIX-QUEUE.md
iteration: 1
findings_in_scope: 10
fixed: 10
skipped: 0
status: all_fixed
---

# Phase ad-hoc-2026-05-15-block-grid — Code Review Fix Report

**Fixed at:** 2026-05-15T00:00:00Z
**Source review:** `.planning/reviews/2026-05-15-block-grid/00-FIX-QUEUE.md`
**Iteration:** 1

**Summary:**
- Findings in scope: 10
- Fixed: 10
- Skipped: 0

All fixes applied inside isolated worktree `/tmp/sv-00-reviewfix-sR1LuG`
on temp branch `gsd-reviewfix/00-15372`; cleanup tail fast-forwards
`claude/busy-sammet-5f4352` to capture the commits below.

## Fixed Issues

### CR-1: `shapeNoiseMode` weighted random has BlockNoise weight = 0
**Files modified:** `src/engine/parameters.ts`
**Commit:** `4dd6f9f`
**Applied fix:** Changed BlockNoise weight from `0` to `4`; deleted the `//TODO should be 4, just testing right now` comment. New seeds now hit the mask-driven movement branch in `main.frag` at the intended 4:1 ratio vs StructuralQuintic.

### WR-1: `loadState` re-normalizes saved seeds with the new SEED_MODULUS
**Files modified:** `src/engine/renderer.ts`
**Commit:** `d4d7dce`
**Applied fix:** Replaced `seed = normalizeSeed(state.seed)` with `seed = state.seed` in `loadState`. Saved NFT seeds ≥222 are no longer silently mutated on reload. Fresh-seed normalization at line 548 untouched.

### WR-2: `u_resetNoiseScale` is dead plumbing
**Files modified:** `src/engine/shaders/main.frag`, `src/engine/renderer.ts`
**Commit:** `fe5e7ad`
**Applied fix:** Deleted the `uniform vec2 u_resetNoiseScale;` declaration in `main.frag`, the `resetNoiseScale: gl.getUniformLocation(...)` entry in `mainUnif`, and the commented `gl.uniform2f` write near line 844.

### WR-3: `u_mirrorAmount` / `u_mirrorAxis` declared but unused
**Files modified:** `src/engine/shaders/blockNoise.frag`, `src/engine/shaders/movementShape.frag`, `src/engine/renderer.ts`
**Commit:** `90f642c`
**Applied fix:** Deleted both uniform declarations from each fragment shader (including the "TODO deprecated" comment), removed `mirrorAmount`/`mirrorAxis` entries from both `bnUnif` and `msUnif`, and the four corresponding `gl.uniform*` writes inside `renderBlockNoise` and `renderMovementShapeMask`. Left `params.mirrorAmount`/`params.mirrorAxis` in types/parameters per scope.

### WR-4: `shapeNoiseBlockSpeedAdjust` declared, never read
**Files modified:** `src/engine/shaders/main.frag`
**Commit:** `22f5023`
**Applied fix:** Deleted the single unused `float shapeNoiseBlockSpeedAdjust = 1.;` line at the top of `main()`.

### WR-5: Stale REPEAT-wrap comment above CLAMP_TO_EDGE texture
**Files modified:** `src/engine/renderer.ts`
**Commit:** `182cab2`
**Applied fix:** Rewrote the comment above `createBlockNoiseTexture` to describe actual behavior: `CLAMP_TO_EDGE because in-range sampling is guaranteed by (blockingSt + 0.5) / u_blocking; NEAREST keeps block boundaries crisp.`

### WR-6: `renderMovementShapeMask` runs every frame regardless of mode
**Files modified:** `src/engine/renderer.ts`
**Commit:** `66d7996`
**Applied fix:** Added `ShapeNoiseMode` to the existing `./parameters` import, then wrapped the `renderMovementShapeMask(smt, mnt, mnxyt)` call in `if (params.shapeNoiseMode === ShapeNoiseMode.BlockNoise) { ... }`. Avoids up to ~262 144 wasted pixel-shader invocations per frame in StructuralQuintic mode.

### IN-1: Hoist shared expression for `movementMaskUV` / `extraMovementMaskUV`
**Files modified:** `src/engine/shaders/main.frag`
**Commit:** `ed2cb37`
**Applied fix:** Added `vec2 blockCellUV = (blockingSt + 0.5) / u_blocking;` immediately before the `if (useMovementMask)` block. Replaced both `(blockingSt + 0.5) / u_blocking` occurrences inside the block with `blockCellUV`. The `extraMovementMaskUV = fract(0.5 + extraMovementMaskUV * 2.);` reassignment stays.

### IN-2: Dead commented-out upload UI in `CanvasOverlay.tsx`
**Files modified:** `src/pages/canvas/CanvasOverlay.tsx`
**Commit:** `171c71b`
**Applied fix:** Deleted the commented `handleUploadClick`/`handleUploadChange` callbacks, commented `uploadInputRef`, the commented upload `MenuButton` + `<input>` JSX block (~lines 497-515), the commented `RMouseEvent`/`RChangeEvent` type imports, and the orphaned `ImageSquareIcon` reference. Verified via grep that none of the removed identifiers were referenced elsewhere.

### IN-3: `.gitignore` missing trailing newline
**Files modified:** `.gitignore`
**Commit:** `6dce506`
**Applied fix:** Appended a single trailing newline. Verified via `xxd` that the final byte is now `0x0a`.

---

_Fixed: 2026-05-15T00:00:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
