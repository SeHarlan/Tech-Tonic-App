# Block Grid Movement Masks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the expensive high-resolution movement shape bake with block-grid-resolution directional mask textures while keeping the main simulation framebuffer full-resolution.

**Architecture:** Render procedural movement activation into low-resolution mask FBOs sized from `params.blockingScale`, then sample those masks from `main.frag` using block-cell UVs. Persistent brush buffers remain unchanged during the spike so save/load, drawing, erase behavior, and existing NFTs stay compatible.

**Tech Stack:** TypeScript, WebGL2, GLSL ES 3.00, Vite GLSL imports, Bun scripts.

---

## Scope

This plan is a spike plus cleanup path. The first implementation must prove visual quality and performance before any persistent state format changes.

In scope:

- Add a low-resolution procedural movement-mask FBO.
- Encode directional movement masks as `R = left`, `G = right`, `B = up`, `A = down`.
- Sample the new mask with block-aligned coordinates in `main.frag`.
- Remove the `2048 x 2048` `shapeNoiseTexture` bake only after the new mask path matches the intended visuals.
- Keep full-resolution main framebuffer movement.

Out of scope for this plan:

- Changing saved NFT metadata shape.
- Changing `movementBuffer` or `paintBuffer` dimensions.
- Merging persistent movement and paint buffers.
- Reworking user brush storage.

## Current Code Map

- `src/engine/renderer.ts`
  - Owns shader program setup, FBO creation, block-noise rendering, shape-noise rendering, texture binding, render loop.
  - Current high-cost path creates `shapeNoiseTexture` at `SHAPE_NOISE_SIZE = 2048` and renders it every frame.
- `src/engine/shaders/blockNoise.frag`
  - Produces current block-noise channels.
  - Currently doubles as a source for movement shape noise through `R` and `A`.
- `src/engine/shaders/main.frag`
  - Samples `u_shapeNoiseTex` in `shapeNoise_BlockNoise()`.
  - Decodes persistent user movement from `u_movementTexture`.
  - Applies actual pixel movement in the full-resolution simulation pass.
- `src/engine/shaders.ts`
  - Exports shader text modules.
- `src/engine/drawing.ts`
  - Owns persistent full-resolution movement and paint brush buffers.
  - Should remain unchanged in the first spike.
- `src/engine/state.ts`
  - Serializes `imageBuffer`, `movementBuffer`, and `paintBuffer`.
  - Should remain unchanged in the first spike.

## Branch And Baseline

- [ ] **Step 1: Preserve current work before starting the spike**

Run after the current in-progress shader work is reviewed:

```bash
git status --short --branch
git add src/engine/parameters.ts src/engine/renderer.ts src/engine/shaders/blockNoise.frag src/engine/shaders/main.frag src/engine/types.ts
git commit -m "chore: preserve current shader baseline"
```

Expected: commit succeeds and `git status --short --branch` shows no tracked engine changes remaining.

- [ ] **Step 2: Create a dedicated spike branch**

```bash
git switch -c spike/block-grid-movement-masks
```

Expected: branch changes from `main` to `spike/block-grid-movement-masks`.

- [ ] **Step 3: Capture baseline performance manually**

Run the app:

```bash
bun run dev
```

Open the canvas page, use a seed that shows movement, and record:

```text
seed:
blockingScale:
average fps after 30 seconds:
visual notes:
```

Expected: baseline notes are saved in the PR description or a short local note before implementation begins.

## Task 1: Add Low-Resolution Movement Shape Shader

**Files:**

- Create: `src/engine/shaders/movementShape.frag`
- Modify: `src/engine/shaders.ts`

- [ ] **Step 1: Create `movementShape.frag`**

Create `src/engine/shaders/movementShape.frag` with this shader:

```glsl
#version 300 es
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform float u_seed;
uniform float u_blocking;
uniform vec2 u_blackNoiseScale;
uniform float u_structuralMoveTime;
uniform float u_movementNoiseTime;
uniform float u_domainWarpAmount;
uniform int u_patternMode;
uniform float u_patternStrength;
uniform float u_patternFreq;
uniform vec2 u_patternCenter;
uniform float u_mirrorAmount;
uniform int u_mirrorAxis;
uniform float u_moveThreshold;
uniform float u_fallThreshold;

in vec2 v_texCoord;
out vec4 fragColor;

float random3D(vec3 st) {
    vec3 p = fract((st + u_seed) * vec3(443.897, 441.423, 437.195));
    p += dot(p, p.yzx + 19.19);
    return fract((p.x + p.y) * p.z);
}

float noise3D(vec3 st) {
    st += vec3(u_seed * 13.591, u_seed * 7.123, 0.0);
    vec3 i = floor(st);
    vec3 f = fract(st);
    float a = random3D(i);
    float b = random3D(i + vec3(1.0, 0.0, 0.0));
    float c = random3D(i + vec3(0.0, 1.0, 0.0));
    float d = random3D(i + vec3(1.0, 1.0, 0.0));
    float e = random3D(i + vec3(0.0, 0.0, 1.0));
    float fCorner = random3D(i + vec3(1.0, 0.0, 1.0));
    float g = random3D(i + vec3(0.0, 1.0, 1.0));
    float h = random3D(i + vec3(1.0, 1.0, 1.0));
    vec3 u = f * f * (3.0 - 2.0 * f);
    float ab = mix(a, b, u.x);
    float cd = mix(c, d, u.x);
    float ef = mix(e, fCorner, u.x);
    float gh = mix(g, h, u.x);
    float abcd = mix(ab, cd, u.y);
    float efgh = mix(ef, gh, u.y);
    return mix(abcd, efgh, u.z);
}

float structuralNoise(vec2 st, float t) {
    return noise3D(vec3(st, t));
}

vec2 movementDomain() {
    vec2 blockingSt = floor(v_texCoord * u_blocking);

    if (u_mirrorAmount > 0.0) {
        vec2 mirrorSt = vec2(u_blocking - 1.0) - blockingSt;
        vec2 corner1 = u_mirrorAxis == 0 ? vec2(0.0, 0.0) : vec2(1.0, 0.0);
        vec2 corner2 = 1.0 - corner1;
        float nearCorner = min(length(v_texCoord - corner1), length(v_texCoord - corner2));
        float mask = smoothstep(1.5, 0.0, nearCorner) * u_mirrorAmount;
        blockingSt = mix(blockingSt, mirrorSt, mask);
    }

    vec2 noiseSt = blockingSt * u_blackNoiseScale;
    vec2 patternOffset = vec2(0.0);

    if (u_patternMode > 0) {
        vec2 uv = v_texCoord - u_patternCenter;
        float pattern = 0.0;

        if (u_patternMode == 1) {
            pattern = sin(length(uv) * u_patternFreq * 6.2832) * 0.5 + 0.5;
        } else if (u_patternMode == 2) {
            pattern = sin((uv.x + uv.y) * u_patternFreq * 6.2832) * 0.5 + 0.5;
        } else if (u_patternMode == 3) {
            float ridgeNoise = structuralNoise(noiseSt * 0.8 + 333.0, u_structuralMoveTime);
            pattern = 1.0 - abs(2.0 * ridgeNoise - 1.0);
        }

        patternOffset = vec2(pattern) * u_patternStrength;
    }

    float warp = structuralNoise(noiseSt * 0.5 + 500.0, u_structuralMoveTime * 0.25);
    vec2 warpOffset = vec2(warp) * u_domainWarpAmount;
    return noiseSt + warpOffset + patternOffset;
}

void main() {
    vec2 domain = movementDomain();
    float t = u_movementNoiseTime;

    float leftNoise = structuralNoise(domain + vec2(0.00, 0.00), t);
    float rightNoise = structuralNoise(domain + vec2(37.17, 11.31), t);
    float upNoise = structuralNoise(domain + vec2(111.11, 19.73), t);
    float downNoise = structuralNoise(domain + vec2(173.29, 71.07), t);

    float left = leftNoise < u_moveThreshold ? 1.0 : 0.0;
    float right = rightNoise < u_moveThreshold ? 1.0 : 0.0;
    float up = upNoise < u_fallThreshold ? 1.0 : 0.0;
    float down = downNoise < u_fallThreshold ? 1.0 : 0.0;

    fragColor = vec4(left, right, up, down);
}
```

- [ ] **Step 2: Export the shader**

Modify `src/engine/shaders.ts`:

```ts
import mainVert from './shaders/main.vert';
import mainFrag from './shaders/main.frag';
import drawVert from './shaders/draw.vert';
import drawFrag from './shaders/draw.frag';
import displayVert from './shaders/display.vert';
import displayFrag from './shaders/display.frag';
import blockNoiseVert from './shaders/blockNoise.vert';
import blockNoiseFrag from './shaders/blockNoise.frag';
import movementShapeFrag from './shaders/movementShape.frag';
import noiseVolumeVert from './shaders/noiseVolume.vert';
import noiseVolumeFrag from './shaders/noiseVolume.frag';

export {
  mainVert, mainFrag,
  drawVert, drawFrag,
  displayVert, displayFrag,
  blockNoiseVert, blockNoiseFrag,
  movementShapeFrag,
  noiseVolumeVert, noiseVolumeFrag,
};
```

- [ ] **Step 3: Verify TypeScript import support**

Run:

```bash
bun run build
```

Expected: build fails only because `movementShapeFrag` is not yet consumed, or passes if unused GLSL imports are accepted. Any GLSL syntax error must be fixed before continuing.

- [ ] **Step 4: Commit shader addition**

```bash
git add src/engine/shaders/movementShape.frag src/engine/shaders.ts
git commit -m "feat: add block-grid movement shape shader"
```

Expected: commit succeeds.

## Task 2: Add Movement Shape FBO Plumbing

**Files:**

- Modify: `src/engine/renderer.ts`

- [ ] **Step 1: Import the new shader**

Update the shader import list in `src/engine/renderer.ts`:

```ts
import { mainVert, mainFrag, displayVert, displayFrag, blockNoiseVert, blockNoiseFrag, movementShapeFrag, noiseVolumeVert, noiseVolumeFrag } from './shaders';
```

- [ ] **Step 2: Link the movement shape program**

After the block-noise program setup, add:

```ts
  // --- Movement Shape Program ---

  const msProg = linkProgram(gl, blockNoiseVert, movementShapeFrag);
  if (!msProg) throw new Error('Failed to create movement shape program');

  const msAttr = {
    position: gl.getAttribLocation(msProg, 'a_position'),
    texCoord: gl.getAttribLocation(msProg, 'a_texCoord'),
  };
  const msUnif = {
    seed: gl.getUniformLocation(msProg, 'u_seed'),
    blocking: gl.getUniformLocation(msProg, 'u_blocking'),
    blackNoiseScale: gl.getUniformLocation(msProg, 'u_blackNoiseScale'),
    structuralMoveTime: gl.getUniformLocation(msProg, 'u_structuralMoveTime'),
    movementNoiseTime: gl.getUniformLocation(msProg, 'u_movementNoiseTime'),
    domainWarpAmount: gl.getUniformLocation(msProg, 'u_domainWarpAmount'),
    patternMode: gl.getUniformLocation(msProg, 'u_patternMode'),
    patternStrength: gl.getUniformLocation(msProg, 'u_patternStrength'),
    patternFreq: gl.getUniformLocation(msProg, 'u_patternFreq'),
    patternCenter: gl.getUniformLocation(msProg, 'u_patternCenter'),
    mirrorAmount: gl.getUniformLocation(msProg, 'u_mirrorAmount'),
    mirrorAxis: gl.getUniformLocation(msProg, 'u_mirrorAxis'),
    moveThreshold: gl.getUniformLocation(msProg, 'u_moveThreshold'),
    fallThreshold: gl.getUniformLocation(msProg, 'u_fallThreshold'),
  };
```

- [ ] **Step 3: Add low-resolution movement shape texture handles**

Near the block-noise FBO state, add:

```ts
  let movementShapeTexture: WebGLTexture | null = null;
  let movementShapeFBOHandle: WebGLFramebuffer | null = null;
  let movementShapeSize = 0;
```

- [ ] **Step 4: Allocate the movement shape texture alongside block noise**

Inside `rebuildBlockNoiseFBO`, after the small block-noise texture is created, add:

```ts
    movementShapeSize = blockNoiseSize;
    if (movementShapeTexture) gl.deleteTexture(movementShapeTexture);
    if (movementShapeFBOHandle) gl.deleteFramebuffer(movementShapeFBOHandle);
    const ms = createBlockNoiseTexture(movementShapeSize, gl.CLAMP_TO_EDGE, gl.NEAREST);
    movementShapeTexture = ms.tex;
    movementShapeFBOHandle = ms.fbo;
```

- [ ] **Step 5: Render the movement shape texture**

Add this function near `renderBlockNoise`:

```ts
  function renderMovementShapeMask(structuralMoveTime: number, movementNoiseTime: number) {
    if (!movementShapeTexture || !movementShapeFBOHandle) return;

    gl.useProgram(msProg);

    gl.uniform1f(msUnif.seed, seed);
    gl.uniform1f(msUnif.blocking, params.blockingScale);
    gl.uniform2f(msUnif.blackNoiseScale, params.blackNoiseScale[0], params.blackNoiseScale[1]);
    gl.uniform1f(msUnif.structuralMoveTime, structuralMoveTime);
    gl.uniform1f(msUnif.movementNoiseTime, movementNoiseTime);
    gl.uniform1f(msUnif.domainWarpAmount, params.domainWarpAmount);
    gl.uniform1i(msUnif.patternMode, params.patternMode);
    gl.uniform1f(msUnif.patternStrength, params.patternStrength);
    gl.uniform1f(msUnif.patternFreq, params.patternFreq);
    gl.uniform2f(msUnif.patternCenter, params.patternCenter[0], params.patternCenter[1]);
    gl.uniform1f(msUnif.mirrorAmount, params.mirrorAmount);
    gl.uniform1i(msUnif.mirrorAxis, params.mirrorAxis);
    gl.uniform1f(msUnif.moveThreshold, 0.33);
    gl.uniform1f(msUnif.fallThreshold, 0.33);

    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.enableVertexAttribArray(msAttr.position);
    gl.vertexAttribPointer(msAttr.position, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
    gl.enableVertexAttribArray(msAttr.texCoord);
    gl.vertexAttribPointer(msAttr.texCoord, 2, gl.FLOAT, false, 0, 0);

    gl.bindFramebuffer(gl.FRAMEBUFFER, movementShapeFBOHandle);
    gl.viewport(0, 0, movementShapeSize, movementShapeSize);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    gl.viewport(0, 0, canvas.width, canvas.height);
  }
```

- [ ] **Step 6: Call movement shape rendering from `render()`**

After `renderBlockNoise(smt, mnt);`, add:

```ts
    renderMovementShapeMask(smt, mnt);
```

- [ ] **Step 7: Verify compile**

Run:

```bash
bun run build
```

Expected: build passes. If TypeScript reports nullable uniform-location errors, guard the specific `gl.uniform*` call or use the existing project style for nullable uniform locations.

- [ ] **Step 8: Commit FBO plumbing**

```bash
git add src/engine/renderer.ts
git commit -m "feat: render block-grid movement shape masks"
```

Expected: commit succeeds.

## Task 3: Sample Movement Shape Mask In Main Shader

**Files:**

- Modify: `src/engine/shaders/main.frag`
- Modify: `src/engine/renderer.ts`

- [ ] **Step 1: Add uniform to `main.frag`**

Near the existing texture uniforms, add:

```glsl
uniform sampler2D u_movementShapeTex;
```

- [ ] **Step 2: Replace procedural shape activation with mask reads**

In `main.frag`, after `blockingSt` is defined and before `shouldMove` / `shouldFall` are calculated, add:

```glsl
    vec2 movementMaskUV = (blockingSt + 0.5) / u_blocking;
    vec4 movementMask = texture(u_movementShapeTex, movementMaskUV);

    float maskHorizontal = movementMask.g - movementMask.r;
    float maskVertical = movementMask.a - movementMask.b;
    bool maskMovesHorizontal = abs(maskHorizontal) > 0.5;
    bool maskMovesVertical = abs(maskVertical) > 0.5;
```

Then change direction selection so the mask owns organic direction:

```glsl
    float direction = maskMovesHorizontal ? sign(maskHorizontal) : (moveNoise < 0.5 ? -1.0 : 1.0);
```

Change organic movement activation:

```glsl
    bool shouldMove = maskMovesHorizontal;
    shouldMove = shouldMove || moveMode;
```

Change fall direction and activation:

```glsl
    bool shouldFall = maskMovesVertical;
    shouldFall = shouldFall || waterfallMode || straightFallMode;

    float fallDirection = maskMovesVertical ? sign(maskVertical) : (shouldFallNoise < 0.5 ? -1.0 : 1.0);
```

Keep the existing brush overrides:

```glsl
    if (waterfallMode || straightFallMode) {
      fallDirection = fallDirectionOverride;
    }
```

- [ ] **Step 3: Keep extra movement/fall unchanged for the first pass**

Do not remove the existing `extraMoveShape` or `extraFallShape` blocks in this task. They provide a visual comparison and reduce the chance that the first mask integration changes too much at once.

- [ ] **Step 4: Bind `u_movementShapeTex` in `renderer.ts`**

Add a uniform location to `mainUnif`:

```ts
    movementShapeTex: gl.getUniformLocation(mainProg, 'u_movementShapeTex'),
```

Bind it during the main render pass after shape/block textures are bound:

```ts
    if (movementShapeTexture) {
      gl.activeTexture(gl.TEXTURE7);
      gl.bindTexture(gl.TEXTURE_2D, movementShapeTexture);
      gl.uniform1i(mainUnif.movementShapeTex, 7);
    }
```

- [ ] **Step 5: Verify compile**

Run:

```bash
bun run build
```

Expected: build passes.

- [ ] **Step 6: Run the app and inspect movement**

```bash
bun run dev
```

Expected:

- Organic horizontal movement follows block-grid mask regions.
- Organic vertical fall follows block-grid mask regions.
- User-painted movement from `u_movementTexture` still overrides direction.
- Freeze mode still stops movement.
- Reset/paint modes still work.

- [ ] **Step 7: Commit shader sampling**

```bash
git add src/engine/shaders/main.frag src/engine/renderer.ts
git commit -m "feat: drive organic movement from block-grid masks"
```

Expected: commit succeeds.

## Task 4: Remove The High-Resolution Shape Bake From The Spike Path

**Files:**

- Modify: `src/engine/renderer.ts`
- Modify: `src/engine/shaders/main.frag`

- [ ] **Step 1: Remove `shapeNoiseTexture` rendering from `renderer.ts`**

Delete the high-resolution shape-noise allocation and render pass:

```ts
  let shapeNoiseTexture: WebGLTexture | null = null;
  let shapeNoiseFBOHandle: WebGLFramebuffer | null = null;
  let shapeNoiseSize = 0;
```

Delete this allocation block from `rebuildBlockNoiseFBO`:

```ts
    const maxTexSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    shapeNoiseSize = Math.max(blockNoiseSize, Math.min(SHAPE_NOISE_SIZE, maxTexSize));
    if (shapeNoiseTexture) gl.deleteTexture(shapeNoiseTexture);
    if (shapeNoiseFBOHandle) gl.deleteFramebuffer(shapeNoiseFBOHandle);
    const sn = createBlockNoiseTexture(shapeNoiseSize, gl.REPEAT, gl.LINEAR);
    shapeNoiseTexture = sn.tex;
    shapeNoiseFBOHandle = sn.fbo;
```

Delete the second render pass in `renderBlockNoise`:

```ts
    gl.bindFramebuffer(gl.FRAMEBUFFER, shapeNoiseFBOHandle);
    gl.viewport(0, 0, shapeNoiseSize, shapeNoiseSize);
    gl.uniform1f(bnUnif.blocking, shapeNoiseSize);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
```

- [ ] **Step 2: Remove `u_shapeNoiseTex` binding**

Delete this binding block from the main render pass:

```ts
    if (shapeNoiseTexture) {
      gl.activeTexture(gl.TEXTURE6);
      gl.bindTexture(gl.TEXTURE_2D, shapeNoiseTexture);
      gl.uniform1i(mainUnif.shapeNoiseTex, 6);
    }
```

Delete this uniform write:

```ts
    gl.uniform1f(mainUnif.shapeNoiseZoom, (params.blockingScale / shapeNoiseSize) / SHAPE_SIZE_FACTOR);
```

- [ ] **Step 3: Keep `shapeNoise()` available only if still used**

Run:

```bash
rg -n "shapeNoise\\(|u_shapeNoiseTex|shapeNoiseZoom|SHAPE_NOISE_SIZE|SHAPE_SIZE_FACTOR" src/engine
```

Expected after cleanup:

- `u_shapeNoiseTex` has no references.
- `shapeNoiseZoom` has no references.
- `SHAPE_NOISE_SIZE` has no references.
- `SHAPE_SIZE_FACTOR` has no references.
- `shapeNoise()` may still exist if `extraMoveShape` and `extraFallShape` still use it.

- [ ] **Step 4: If `shapeNoise_BlockNoise` is unused, delete it**

If `rg` shows no active call path into `shapeNoise_BlockNoise`, remove:

```glsl
float shapeNoise_BlockNoise(vec2 p, float t, bool isHorizontal) {
    vec2 uv = p * u_shapeNoiseZoom;
    if(isHorizontal) {
      return texture(u_shapeNoiseTex, fract(uv)).r;
    } else {
      return texture(u_shapeNoiseTex, fract(uv)).a;
    }
}
```

Also remove the `SHAPE_NOISE_BLOCK_NOISE` dispatcher branch if no longer needed.

- [ ] **Step 5: Verify build and lint**

Run:

```bash
bun run build
bun run lint
```

Expected: both commands pass.

- [ ] **Step 6: Commit high-res bake removal**

```bash
git add src/engine/renderer.ts src/engine/shaders/main.frag
git commit -m "perf: remove high resolution movement shape bake"
```

Expected: commit succeeds.

## Task 5: Visual And Performance Validation

**Files:**

- No required code files.
- Update PR description or local validation notes.

- [ ] **Step 1: Run production build**

```bash
bun run build
```

Expected: build passes.

- [ ] **Step 2: Run local app**

```bash
bun run dev
```

Expected: canvas loads without WebGL compile/link errors.

- [ ] **Step 3: Validate these behaviors manually**

Use at least three seeds. For each seed, record:

```text
seed:
blockingScale:
average fps after 30 seconds:
movement shape notes:
paint/reset notes:
brush override notes:
freeze notes:
```

Required checks:

- Organic movement regions are blocky by design.
- Pixel motion inside active regions remains full-resolution.
- Directional channels do not produce obvious dead zones from left/right or up/down conflicts.
- User brush movement still overrides organic movement.
- `freeze` still prevents movement and natural resets.
- `empty`, `static`, and `gem` paint modes still affect reset rendering.
- Global freeze still stops movement and keeps color cycling.

- [ ] **Step 4: Compare performance**

Compare against the baseline captured before Task 1:

```text
baseline fps:
new fps:
absolute fps delta:
percentage delta:
visual acceptance: pass/fail
```

Expected: performance improves meaningfully on the same machine and visual acceptance is pass. If performance does not improve, inspect whether the high-resolution shape pass still exists.

- [ ] **Step 5: Commit validation notes if a project note file is created**

If validation notes are stored in a file, use:

```bash
git add docs/superpowers/plans/2026-05-05-block-grid-movement-masks.md
git commit -m "docs: record block-grid movement mask validation"
```

Expected: commit succeeds. Skip this commit if notes only live in the PR description.

## Task 6: Optional Cleanup After Spike Acceptance

**Files:**

- Modify: `src/engine/shaders/blockNoise.frag`
- Modify: `src/engine/renderer.ts`
- Modify: `src/engine/shaders/main.frag`

- [ ] **Step 1: Remove movement channels from `blockNoise.frag` if unused**

If `blockNoise.frag` no longer needs `R` or `A` for movement, simplify the final output:

```glsl
    fragColor = vec4(0.0, blackNoise, ribbonNoise, 1.0);
```

Expected: `G` and `B` preserve black/ribbon behavior, while `R` and `A` no longer imply movement data.

- [ ] **Step 2: Remove unused renderer uniforms**

Run:

```bash
rg -n "movementNoiseTime|blockNoiseMode|shapeNoiseMode|shapeNoiseTex|shapeNoiseZoom" src/engine
```

For every unused renderer uniform, remove both:

- `gl.getUniformLocation(...)`
- the corresponding `gl.uniform*` write

Expected: no unused shape-noise plumbing remains.

- [ ] **Step 3: Verify cleanup**

Run:

```bash
bun run build
bun run lint
```

Expected: both commands pass.

- [ ] **Step 4: Commit cleanup**

```bash
git add src/engine/shaders/blockNoise.frag src/engine/renderer.ts src/engine/shaders/main.frag
git commit -m "refactor: simplify block noise movement channels"
```

Expected: commit succeeds.

## Risks

- Direction conflicts can occur when left and right or up and down activate in the same block. The first implementation resolves this by subtracting opposing channels. If dead zones are too common, switch to winner-takes-stronger-noise encoding in `movementShape.frag`.
- The block-grid mask intentionally removes smooth movement activation edges. This is acceptable only if the visual style still works.
- Extra movement and extra fall may still use the old shape-noise functions until cleaned up. Keep them during the first visual pass, then remove or redirect them after acceptance.
- `blockingScale` is currently hardcoded to `64` in `parameters.ts`. The implementation should still support other values because the renderer already rebuilds FBOs when `params.blockingScale` changes.
- Mobile GPUs may benefit more from the reduced prepass, but may expose precision or texture-unit assumptions. Keep texture unit assignment explicit and below WebGL2 limits.

## Review Checklist

- [ ] `movementBuffer` and `paintBuffer` serialization are unchanged.
- [ ] No new full-resolution persistent FBOs were added.
- [ ] New movement shape FBO size equals `ceil(params.blockingScale)`.
- [ ] `movementShapeTexture` uses `NEAREST` filtering.
- [ ] `main.frag` samples the mask at `(blockingSt + 0.5) / u_blocking`.
- [ ] Main framebuffer remains full-resolution.
- [ ] The `2048 x 2048` shape bake is removed before calling the spike a performance win.
- [ ] `bun run build` passes.
- [ ] `bun run lint` passes.
- [ ] Manual visual validation covers movement, paint, erase, freeze, and global freeze.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-05-block-grid-movement-masks.md`.

Recommended sequence:

1. Run a code review on the current uncommitted shader changes.
2. Commit and push the reviewed baseline from `main`.
3. Create `spike/block-grid-movement-masks`.
4. Execute this plan task-by-task in a fresh context.

Execution options after the baseline is committed:

1. **Subagent-Driven (recommended)** - dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** - execute tasks in this session using executing-plans, batch execution with checkpoints.
