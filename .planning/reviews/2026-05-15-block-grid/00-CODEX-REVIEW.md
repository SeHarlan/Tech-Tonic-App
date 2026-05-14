OpenAI Codex v0.128.0 (research preview)
--------
workdir: /Users/scottharlan/GSD-projects/Tech-Tonic-App/.claude/worktrees/busy-sammet-5f4352
model: gpt-5.5
provider: openai
approval: never
sandbox: workspace-write [workdir, /tmp, $TMPDIR, /Users/scottharlan/.codex/memories]
reasoning effort: medium
reasoning summaries: none
session id: 019e2719-784c-7021-b84a-943d04bf2b7d
--------
user
You are reviewing source code changes for a software project phase. Identify bugs, security issues, and code-quality problems. Be specific: cite file paths and line numbers. Use severity tiers: Critical / Warning / Info.

For each finding output:
- File path and line(s)
- Severity (Critical / Warning / Info)
- Issue description
- Concrete suggested fix

Skip stylistic preferences. Skip findings that are pure speculation without evidence in the diff. Focus on issues that would cause incorrect behavior, security vulnerabilities, data loss, or maintenance risk.

--- DIFF ---
diff --git a/.gitignore b/.gitignore
index 498366a..d4e0aaf 100644
--- a/.gitignore
+++ b/.gitignore
@@ -34,3 +34,6 @@ generated-demo/
 
 # Generated thumbnails (local only)
 public/thumbnails/
+
+
+.review/
\ No newline at end of file
diff --git a/docs/superpowers/plans/2026-05-05-block-grid-movement-masks.md b/docs/superpowers/plans/2026-05-05-block-grid-movement-masks.md
new file mode 100644
index 0000000..58c6e56
--- /dev/null
+++ b/docs/superpowers/plans/2026-05-05-block-grid-movement-masks.md
@@ -0,0 +1,783 @@
+# Block Grid Movement Masks Implementation Plan
+
+> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
+
+**Goal:** Replace the expensive high-resolution movement shape bake with block-grid-resolution directional mask textures while keeping the main simulation framebuffer full-resolution.
+
+**Architecture:** Render procedural movement activation into low-resolution mask FBOs sized from `params.blockingScale`, then sample those masks from `main.frag` using block-cell UVs. Persistent brush buffers remain unchanged during the spike so save/load, drawing, erase behavior, and existing NFTs stay compatible.
+
+**Tech Stack:** TypeScript, WebGL2, GLSL ES 3.00, Vite GLSL imports, Bun scripts.
+
+---
+
+## Scope
+
+This plan is a spike plus cleanup path. The first implementation must prove visual quality and performance before any persistent state format changes.
+
+In scope:
+
+- Add a low-resolution procedural movement-mask FBO.
+- Encode directional movement masks as `R = left`, `G = right`, `B = up`, `A = down`.
+- Sample the new mask with block-aligned coordinates in `main.frag`.
+- Remove the `2048 x 2048` `shapeNoiseTexture` bake only after the new mask path matches the intended visuals.
+- Keep full-resolution main framebuffer movement.
+
+Out of scope for this plan:
+
+- Changing saved NFT metadata shape.
+- Changing `movementBuffer` or `paintBuffer` dimensions.
+- Merging persistent movement and paint buffers.
+- Reworking user brush storage.
+
+## Current Code Map
+
+- `src/engine/renderer.ts`
+  - Owns shader program setup, FBO creation, block-noise rendering, shape-noise rendering, texture binding, render loop.
+  - Current high-cost path creates `shapeNoiseTexture` at `SHAPE_NOISE_SIZE = 2048` and renders it every frame.
+- `src/engine/shaders/blockNoise.frag`
+  - Produces current block-noise channels.
+  - Currently doubles as a source for movement shape noise through `R` and `A`.
+- `src/engine/shaders/main.frag`
+  - Samples `u_shapeNoiseTex` in `shapeNoise_BlockNoise()`.
+  - Decodes persistent user movement from `u_movementTexture`.
+  - Applies actual pixel movement in the full-resolution simulation pass.
+- `src/engine/shaders.ts`
+  - Exports shader text modules.
+- `src/engine/drawing.ts`
+  - Owns persistent full-resolution movement and paint brush buffers.
+  - Should remain unchanged in the first spike.
+- `src/engine/state.ts`
+  - Serializes `imageBuffer`, `movementBuffer`, and `paintBuffer`.
+  - Should remain unchanged in the first spike.
+
+## Branch And Baseline
+
+- [ ] **Step 1: Preserve current work before starting the spike**
+
+Run after the current in-progress shader work is reviewed:
+
+```bash
+git status --short --branch
+git add src/engine/parameters.ts src/engine/renderer.ts src/engine/shaders/blockNoise.frag src/engine/shaders/main.frag src/engine/types.ts
+git commit -m "chore: preserve current shader baseline"
+```
+
+Expected: commit succeeds and `git status --short --branch` shows no tracked engine changes remaining.
+
+- [ ] **Step 2: Create a dedicated spike branch**
+
+```bash
+git switch -c spike/block-grid-movement-masks
+```
+
+Expected: branch changes from `main` to `spike/block-grid-movement-masks`.
+
+- [ ] **Step 3: Capture baseline performance manually**
+
+Run the app:
+
+```bash
+bun run dev
+```
+
+Open the canvas page, use a seed that shows movement, and record:
+
+```text
+seed:
+blockingScale:
+average fps after 30 seconds:
+visual notes:
+```
+
+Expected: baseline notes are saved in the PR description or a short local note before implementation begins.
+
+## Task 1: Add Low-Resolution Movement Shape Shader
+
+**Files:**
+
+- Create: `src/engine/shaders/movementShape.frag`
+- Modify: `src/engine/shaders.ts`
+
+- [ ] **Step 1: Create `movementShape.frag`**
+
+Create `src/engine/shaders/movementShape.frag` with this shader:
+
+```glsl
+#version 300 es
+#ifdef GL_FRAGMENT_PRECISION_HIGH
+precision highp float;
+#else
+precision mediump float;
+#endif
+
+uniform float u_seed;
+uniform float u_blocking;
+uniform vec2 u_blackNoiseScale;
+uniform float u_structuralMoveTime;
+uniform float u_movementNoiseTime;
+uniform float u_domainWarpAmount;
+uniform int u_patternMode;
+uniform float u_patternStrength;
+uniform float u_patternFreq;
+uniform vec2 u_patternCenter;
+uniform float u_mirrorAmount;
+uniform int u_mirrorAxis;
+uniform float u_moveThreshold;
+uniform float u_fallThreshold;
+
+in vec2 v_texCoord;
+out vec4 fragColor;
+
+float random3D(vec3 st) {
+    vec3 p = fract((st + u_seed) * vec3(443.897, 441.423, 437.195));
+    p += dot(p, p.yzx + 19.19);
+    return fract((p.x + p.y) * p.z);
+}
+
+float noise3D(vec3 st) {
+    st += vec3(u_seed * 13.591, u_seed * 7.123, 0.0);
+    vec3 i = floor(st);
+    vec3 f = fract(st);
+    float a = random3D(i);
+    float b = random3D(i + vec3(1.0, 0.0, 0.0));
+    float c = random3D(i + vec3(0.0, 1.0, 0.0));
+    float d = random3D(i + vec3(1.0, 1.0, 0.0));
+    float e = random3D(i + vec3(0.0, 0.0, 1.0));
+    float fCorner = random3D(i + vec3(1.0, 0.0, 1.0));
+    float g = random3D(i + vec3(0.0, 1.0, 1.0));
+    float h = random3D(i + vec3(1.0, 1.0, 1.0));
+    vec3 u = f * f * (3.0 - 2.0 * f);
+    float ab = mix(a, b, u.x);
+    float cd = mix(c, d, u.x);
+    float ef = mix(e, fCorner, u.x);
+    float gh = mix(g, h, u.x);
+    float abcd = mix(ab, cd, u.y);
+    float efgh = mix(ef, gh, u.y);
+    return mix(abcd, efgh, u.z);
+}
+
+float structuralNoise(vec2 st, float t) {
+    return noise3D(vec3(st, t));
+}
+
+vec2 movementDomain() {
+    vec2 blockingSt = floor(v_texCoord * u_blocking);
+
+    if (u_mirrorAmount > 0.0) {
+        vec2 mirrorSt = vec2(u_blocking - 1.0) - blockingSt;
+        vec2 corner1 = u_mirrorAxis == 0 ? vec2(0.0, 0.0) : vec2(1.0, 0.0);
+        vec2 corner2 = 1.0 - corner1;
+        float nearCorner = min(length(v_texCoord - corner1), length(v_texCoord - corner2));
+        float mask = smoothstep(1.5, 0.0, nearCorner) * u_mirrorAmount;
+        blockingSt = mix(blockingSt, mirrorSt, mask);
+    }
+
+    vec2 noiseSt = blockingSt * u_blackNoiseScale;
+    vec2 patternOffset = vec2(0.0);
+
+    if (u_patternMode > 0) {
+        vec2 uv = v_texCoord - u_patternCenter;
+        float pattern = 0.0;
+
+        if (u_patternMode == 1) {
+            pattern = sin(length(uv) * u_patternFreq * 6.2832) * 0.5 + 0.5;
+        } else if (u_patternMode == 2) {
+            pattern = sin((uv.x + uv.y) * u_patternFreq * 6.2832) * 0.5 + 0.5;
+        } else if (u_patternMode == 3) {
+            float ridgeNoise = structuralNoise(noiseSt * 0.8 + 333.0, u_structuralMoveTime);
+            pattern = 1.0 - abs(2.0 * ridgeNoise - 1.0);
+        }
+
+        patternOffset = vec2(pattern) * u_patternStrength;
+    }
+
+    float warp = structuralNoise(noiseSt * 0.5 + 500.0, u_structuralMoveTime * 0.25);
+    vec2 warpOffset = vec2(warp) * u_domainWarpAmount;
+    return noiseSt + warpOffset + patternOffset;
+}
+
+void main() {
+    vec2 domain = movementDomain();
+    float t = u_movementNoiseTime;
+
+    float leftNoise = structuralNoise(domain + vec2(0.00, 0.00), t);
+    float rightNoise = structuralNoise(domain + vec2(37.17, 11.31), t);
+    float upNoise = structuralNoise(domain + vec2(111.11, 19.73), t);
+    float downNoise = structuralNoise(domain + vec2(173.29, 71.07), t);
+
+    float left = leftNoise < u_moveThreshold ? 1.0 : 0.0;
+    float right = rightNoise < u_moveThreshold ? 1.0 : 0.0;
+    float up = upNoise < u_fallThreshold ? 1.0 : 0.0;
+    float down = downNoise < u_fallThreshold ? 1.0 : 0.0;
+
+    fragColor = vec4(left, right, up, down);
+}
+```
+
+- [ ] **Step 2: Export the shader**
+
+Modify `src/engine/shaders.ts`:
+
+```ts
+import mainVert from './shaders/main.vert';
+import mainFrag from './shaders/main.frag';
+import drawVert from './shaders/draw.vert';
+import drawFrag from './shaders/draw.frag';
+import displayVert from './shaders/display.vert';
+import displayFrag from './shaders/display.frag';
+import blockNoiseVert from './shaders/blockNoise.vert';
+import blockNoiseFrag from './shaders/blockNoise.frag';
+import movementShapeFrag from './shaders/movementShape.frag';
+import noiseVolumeVert from './shaders/noiseVolume.vert';
+import noiseVolumeFrag from './shaders/noiseVolume.frag';
+
+export {
+  mainVert, mainFrag,
+  drawVert, drawFrag,
+  displayVert, displayFrag,
+  blockNoiseVert, blockNoiseFrag,
+  movementShapeFrag,
+  noiseVolumeVert, noiseVolumeFrag,
+};
+```
+
+- [ ] **Step 3: Verify TypeScript import support**
+
+Run:
+
+```bash
+bun run build
+```
+
+Expected: build fails only because `movementShapeFrag` is not yet consumed, or passes if unused GLSL imports are accepted. Any GLSL syntax error must be fixed before continuing.
+
+- [ ] **Step 4: Commit shader addition**
+
+```bash
+git add src/engine/shaders/movementShape.frag src/engine/shaders.ts
+git commit -m "feat: add block-grid movement shape shader"
+```
+
+Expected: commit succeeds.
+
+## Task 2: Add Movement Shape FBO Plumbing
+
+**Files:**
+
+- Modify: `src/engine/renderer.ts`
+
+- [ ] **Step 1: Import the new shader**
+
+Update the shader import list in `src/engine/renderer.ts`:
+
+```ts
+import { mainVert, mainFrag, displayVert, displayFrag, blockNoiseVert, blockNoiseFrag, movementShapeFrag, noiseVolumeVert, noiseVolumeFrag } from './shaders';
+```
+
+- [ ] **Step 2: Link the movement shape program**
+
+After the block-noise program setup, add:
+
+```ts
+  // --- Movement Shape Program ---
+
+  const msProg = linkProgram(gl, blockNoiseVert, movementShapeFrag);
+  if (!msProg) throw new Error('Failed to create movement shape program');
+
+  const msAttr = {
+    position: gl.getAttribLocation(msProg, 'a_position'),
+    texCoord: gl.getAttribLocation(msProg, 'a_texCoord'),
+  };
+  const msUnif = {
+    seed: gl.getUniformLocation(msProg, 'u_seed'),
+    blocking: gl.getUniformLocation(msProg, 'u_blocking'),
+    blackNoiseScale: gl.getUniformLocation(msProg, 'u_blackNoiseScale'),
+    structuralMoveTime: gl.getUniformLocation(msProg, 'u_structuralMoveTime'),
+    movementNoiseTime: gl.getUniformLocation(msProg, 'u_movementNoiseTime'),
+    domainWarpAmount: gl.getUniformLocation(msProg, 'u_domainWarpAmount'),
+    patternMode: gl.getUniformLocation(msProg, 'u_patternMode'),
+    patternStrength: gl.getUniformLocation(msProg, 'u_patternStrength'),
+    patternFreq: gl.getUniformLocation(msProg, 'u_patternFreq'),
+    patternCenter: gl.getUniformLocation(msProg, 'u_patternCenter'),
+    mirrorAmount: gl.getUniformLocation(msProg, 'u_mirrorAmount'),
+    mirrorAxis: gl.getUniformLocation(msProg, 'u_mirrorAxis'),
+    moveThreshold: gl.getUniformLocation(msProg, 'u_moveThreshold'),
+    fallThreshold: gl.getUniformLocation(msProg, 'u_fallThreshold'),
+  };
+```
+
+- [ ] **Step 3: Add low-resolution movement shape texture handles**
+
+Near the block-noise FBO state, add:
+
+```ts
+  let movementShapeTexture: WebGLTexture | null = null;
+  let movementShapeFBOHandle: WebGLFramebuffer | null = null;
+  let movementShapeSize = 0;
+```
+
+- [ ] **Step 4: Allocate the movement shape texture alongside block noise**
+
+Inside `rebuildBlockNoiseFBO`, after the small block-noise texture is created, add:
+
+```ts
+    movementShapeSize = blockNoiseSize;
+    if (movementShapeTexture) gl.deleteTexture(movementShapeTexture);
+    if (movementShapeFBOHandle) gl.deleteFramebuffer(movementShapeFBOHandle);
+    const ms = createBlockNoiseTexture(movementShapeSize, gl.CLAMP_TO_EDGE, gl.NEAREST);
+    movementShapeTexture = ms.tex;
+    movementShapeFBOHandle = ms.fbo;
+```
+
+- [ ] **Step 5: Render the movement shape texture**
+
+Add this function near `renderBlockNoise`:
+
+```ts
+  function renderMovementShapeMask(structuralMoveTime: number, movementNoiseTime: number) {
+    if (!movementShapeTexture || !movementShapeFBOHandle) return;
+
+    gl.useProgram(msProg);
+
+    gl.uniform1f(msUnif.seed, seed);
+    gl.uniform1f(msUnif.blocking, params.blockingScale);
+    gl.uniform2f(msUnif.blackNoiseScale, params.blackNoiseScale[0], params.blackNoiseScale[1]);
+    gl.uniform1f(msUnif.structuralMoveTime, structuralMoveTime);
+    gl.uniform1f(msUnif.movementNoiseTime, movementNoiseTime);
+    gl.uniform1f(msUnif.domainWarpAmount, params.domainWarpAmount);
+    gl.uniform1i(msUnif.patternMode, params.patternMode);
+    gl.uniform1f(msUnif.patternStrength, params.patternStrength);
+    gl.uniform1f(msUnif.patternFreq, params.patternFreq);
+    gl.uniform2f(msUnif.patternCenter, params.patternCenter[0], params.patternCenter[1]);
+    gl.uniform1f(msUnif.mirrorAmount, params.mirrorAmount);
+    gl.uniform1i(msUnif.mirrorAxis, params.mirrorAxis);
+    gl.uniform1f(msUnif.moveThreshold, 0.33);
+    gl.uniform1f(msUnif.fallThreshold, 0.33);
+
+    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
+    gl.enableVertexAttribArray(msAttr.position);
+    gl.vertexAttribPointer(msAttr.position, 2, gl.FLOAT, false, 0, 0);
+
+    gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
+    gl.enableVertexAttribArray(msAttr.texCoord);
+    gl.vertexAttribPointer(msAttr.texCoord, 2, gl.FLOAT, false, 0, 0);
+
+    gl.bindFramebuffer(gl.FRAMEBUFFER, movementShapeFBOHandle);
+    gl.viewport(0, 0, movementShapeSize, movementShapeSize);
+    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
+
+    gl.viewport(0, 0, canvas.width, canvas.height);
+  }
+```
+
+- [ ] **Step 6: Call movement shape rendering from `render()`**
+
+After `renderBlockNoise(smt, mnt);`, add:
+
+```ts
+    renderMovementShapeMask(smt, mnt);
+```
+
+- [ ] **Step 7: Verify compile**
+
+Run:
+
+```bash
+bun run build
+```
+
+Expected: build passes. If TypeScript reports nullable uniform-location errors, guard the specific `gl.uniform*` call or use the existing project style for nullable uniform locations.
+
+- [ ] **Step 8: Commit FBO plumbing**
+
+```bash
+git add src/engine/renderer.ts
+git commit -m "feat: render block-grid movement shape masks"
+```
+
+Expected: commit succeeds.
+
+## Task 3: Sample Movement Shape Mask In Main Shader
+
+**Files:**
+
+- Modify: `src/engine/shaders/main.frag`
+- Modify: `src/engine/renderer.ts`
+
+- [ ] **Step 1: Add uniform to `main.frag`**
+
+Near the existing texture uniforms, add:
+
+```glsl
+uniform sampler2D u_movementShapeTex;
+```
+
+- [ ] **Step 2: Replace procedural shape activation with mask reads**
+
+In `main.frag`, after `blockingSt` is defined and before `shouldMove` / `shouldFall` are calculated, add:
+
+```glsl
+    vec2 movementMaskUV = (blockingSt + 0.5) / u_blocking;
+    vec4 movementMask = texture(u_movementShapeTex, movementMaskUV);
+
+    float maskHorizontal = movementMask.g - movementMask.r;
+    float maskVertical = movementMask.a - movementMask.b;
+    bool maskMovesHorizontal = abs(maskHorizontal) > 0.5;
+    bool maskMovesVertical = abs(maskVertical) > 0.5;
+```
+
+Then change direction selection so the mask owns organic direction:
+
+```glsl
+    float direction = maskMovesHorizontal ? sign(maskHorizontal) : (moveNoise < 0.5 ? -1.0 : 1.0);
+```
+
+Change organic movement activation:
+
+```glsl
+    bool shouldMove = maskMovesHorizontal;
+    shouldMove = shouldMove || moveMode;
+```
+
+Change fall direction and activation:
+
+```glsl
+    bool shouldFall = maskMovesVertical;
+    shouldFall = shouldFall || waterfallMode || straightFallMode;
+
+    float fallDirection = maskMovesVertical ? sign(maskVertical) : (shouldFallNoise < 0.5 ? -1.0 : 1.0);
+```
+
+Keep the existing brush overrides:
+
+```glsl
+    if (waterfallMode || straightFallMode) {
+      fallDirection = fallDirectionOverride;
+    }
+```
+
+- [ ] **Step 3: Keep extra movement/fall unchanged for the first pass**
+
+Do not remove the existing `extraMoveShape` or `extraFallShape` blocks in this task. They provide a visual comparison and reduce the chance that the first mask integration changes too much at once.
+
+- [ ] **Step 4: Bind `u_movementShapeTex` in `renderer.ts`**
+
+Add a uniform location to `mainUnif`:
+
+```ts
+    movementShapeTex: gl.getUniformLocation(mainProg, 'u_movementShapeTex'),
+```
+
+Bind it during the main render pass after shape/block textures are bound:
+
+```ts
+    if (movementShapeTexture) {
+      gl.activeTexture(gl.TEXTURE7);
+      gl.bindTexture(gl.TEXTURE_2D, movementShapeTexture);
+      gl.uniform1i(mainUnif.movementShapeTex, 7);
+    }
+```
+
+- [ ] **Step 5: Verify compile**
+
+Run:
+
+```bash
+bun run build
+```
+
+Expected: build passes.
+
+- [ ] **Step 6: Run the app and inspect movement**
+
+```bash
+bun run dev
+```
+
+Expected:
+
+- Organic horizontal movement follows block-grid mask regions.
+- Organic vertical fall follows block-grid mask regions.
+- User-painted movement from `u_movementTexture` still overrides direction.
+- Freeze mode still stops movement.
+- Reset/paint modes still work.
+
+- [ ] **Step 7: Commit shader sampling**
+
+```bash
+git add src/engine/shaders/main.frag src/engine/renderer.ts
+git commit -m "feat: drive organic movement from block-grid masks"
+```
+
+Expected: commit succeeds.
+
+## Task 4: Remove The High-Resolution Shape Bake From The Spike Path
+
+**Files:**
+
+- Modify: `src/engine/renderer.ts`
+- Modify: `src/engine/shaders/main.frag`
+
+- [ ] **Step 1: Remove `shapeNoiseTexture` rendering from `renderer.ts`**
+
+Delete the high-resolution shape-noise allocation and render pass:
+
+```ts
+  let shapeNoiseTexture: WebGLTexture | null = null;
+  let shapeNoiseFBOHandle: WebGLFramebuffer | null = null;
+  let shapeNoiseSize = 0;
+```
+
+Delete this allocation block from `rebuildBlockNoiseFBO`:
+
+```ts
+    const maxTexSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
+    shapeNoiseSize = Math.max(blockNoiseSize, Math.min(SHAPE_NOISE_SIZE, maxTexSize));
+    if (shapeNoiseTexture) gl.deleteTexture(shapeNoiseTexture);
+    if (shapeNoiseFBOHandle) gl.deleteFramebuffer(shapeNoiseFBOHandle);
+    const sn = createBlockNoiseTexture(shapeNoiseSize, gl.REPEAT, gl.LINEAR);
+    shapeNoiseTexture = sn.tex;
+    shapeNoiseFBOHandle = sn.fbo;
+```
+
+Delete the second render pass in `renderBlockNoise`:
+
+```ts
+    gl.bindFramebuffer(gl.FRAMEBUFFER, shapeNoiseFBOHandle);
+    gl.viewport(0, 0, shapeNoiseSize, shapeNoiseSize);
+    gl.uniform1f(bnUnif.blocking, shapeNoiseSize);
+    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
+```
+
+- [ ] **Step 2: Remove `u_shapeNoiseTex` binding**
+
+Delete this binding block from the main render pass:
+
+```ts
+    if (shapeNoiseTexture) {
+      gl.activeTexture(gl.TEXTURE6);
+      gl.bindTexture(gl.TEXTURE_2D, shapeNoiseTexture);
+      gl.uniform1i(mainUnif.shapeNoiseTex, 6);
+    }
+```
+
+Delete this uniform write:
+
+```ts
+    gl.uniform1f(mainUnif.shapeNoiseZoom, (params.blockingScale / shapeNoiseSize) / SHAPE_SIZE_FACTOR);
+```
+
+- [ ] **Step 3: Keep `shapeNoise()` available only if still used**
+
+Run:
+
+```bash
+rg -n "shapeNoise\\(|u_shapeNoiseTex|shapeNoiseZoom|SHAPE_NOISE_SIZE|SHAPE_SIZE_FACTOR" src/engine
+```
+
+Expected after cleanup:
+
+- `u_shapeNoiseTex` has no references.
+- `shapeNoiseZoom` has no references.
+- `SHAPE_NOISE_SIZE` has no references.
+- `SHAPE_SIZE_FACTOR` has no references.
+- `shapeNoise()` may still exist if `extraMoveShape` and `extraFallShape` still use it.
+
+- [ ] **Step 4: If `shapeNoise_BlockNoise` is unused, delete it**
+
+If `rg` shows no active call path into `shapeNoise_BlockNoise`, remove:
+
+```glsl
+float shapeNoise_BlockNoise(vec2 p, float t, bool isHorizontal) {
+    vec2 uv = p * u_shapeNoiseZoom;
+    if(isHorizontal) {
+      return texture(u_shapeNoiseTex, fract(uv)).r;
+    } else {
+      return texture(u_shapeNoiseTex, fract(uv)).a;
+    }
+}
+```
+
+Also remove the `SHAPE_NOISE_BLOCK_NOISE` dispatcher branch if no longer needed.
+
+- [ ] **Step 5: Verify build and lint**
+
+Run:
+
+```bash
+bun run build
+bun run lint
+```
+
+Expected: both commands pass.
+
+- [ ] **Step 6: Commit high-res bake removal**
+
+```bash
+git add src/engine/renderer.ts src/engine/shaders/main.frag
+git commit -m "perf: remove high resolution movement shape bake"
+```
+
+Expected: commit succeeds.
+
+## Task 5: Visual And Performance Validation
+
+**Files:**
+
+- No required code files.
+- Update PR description or local validation notes.
+
+- [ ] **Step 1: Run production build**
+
+```bash
+bun run build
+```
+
+Expected: build passes.
+
+- [ ] **Step 2: Run local app**
+
+```bash
+bun run dev
+```
+
+Expected: canvas loads without WebGL compile/link errors.
+
+- [ ] **Step 3: Validate these behaviors manually**
+
+Use at least three seeds. For each seed, record:
+
+```text
+seed:
+blockingScale:
+average fps after 30 seconds:
+movement shape notes:
+paint/reset notes:
+brush override notes:
+freeze notes:
+```
+
+Required checks:
+
+- Organic movement regions are blocky by design.
+- Pixel motion inside active regions remains full-resolution.
+- Directional channels do not produce obvious dead zones from left/right or up/down conflicts.
+- User brush movement still overrides organic movement.
+- `freeze` still prevents movement and natural resets.
+- `empty`, `static`, and `gem` paint modes still affect reset rendering.
+- Global freeze still stops movement and keeps color cycling.
+
+- [ ] **Step 4: Compare performance**
+
+Compare against the baseline captured before Task 1:
+
+```text
+baseline fps:
+new fps:
+absolute fps delta:
+percentage delta:
+visual acceptance: pass/fail
+```
+
+Expected: performance improves meaningfully on the same machine and visual acceptance is pass. If performance does not improve, inspect whether the high-resolution shape pass still exists.
+
+- [ ] **Step 5: Commit validation notes if a project note file is created**
+
+If validation notes are stored in a file, use:
+
+```bash
+git add docs/superpowers/plans/2026-05-05-block-grid-movement-masks.md
+git commit -m "docs: record block-grid movement mask validation"
+```
+
+Expected: commit succeeds. Skip this commit if notes only live in the PR description.
+
+## Task 6: Optional Cleanup After Spike Acceptance
+
+**Files:**
+
+- Modify: `src/engine/shaders/blockNoise.frag`
+- Modify: `src/engine/renderer.ts`
+- Modify: `src/engine/shaders/main.frag`
+
+- [ ] **Step 1: Remove movement channels from `blockNoise.frag` if unused**
+
+If `blockNoise.frag` no longer needs `R` or `A` for movement, simplify the final output:
+
+```glsl
+    fragColor = vec4(0.0, blackNoise, ribbonNoise, 1.0);
+```
+
+Expected: `G` and `B` preserve black/ribbon behavior, while `R` and `A` no longer imply movement data.
+
+- [ ] **Step 2: Remove unused renderer uniforms**
+
+Run:
+
+```bash
+rg -n "movementNoiseTime|blockNoiseMode|shapeNoiseMode|shapeNoiseTex|shapeNoiseZoom" src/engine
+```
+
+For every unused renderer uniform, remove both:
+
+- `gl.getUniformLocation(...)`
+- the corresponding `gl.uniform*` write
+
+Expected: no unused shape-noise plumbing remains.
+
+- [ ] **Step 3: Verify cleanup**
+
+Run:
+
+```bash
+bun run build
+bun run lint
+```
+
+Expected: both commands pass.
+
+- [ ] **Step 4: Commit cleanup**
+
+```bash
+git add src/engine/shaders/blockNoise.frag src/engine/renderer.ts src/engine/shaders/main.frag
+git commit -m "refactor: simplify block noise movement channels"
+```
+
+Expected: commit succeeds.
+
+## Risks
+
+- Direction conflicts can occur when left and right or up and down activate in the same block. The first implementation resolves this by subtracting opposing channels. If dead zones are too common, switch to winner-takes-stronger-noise encoding in `movementShape.frag`.
+- The block-grid mask intentionally removes smooth movement activation edges. This is acceptable only if the visual style still works.
+- Extra movement and extra fall may still use the old shape-noise functions until cleaned up. Keep them during the first visual pass, then remove or redirect them after acceptance.
+- `blockingScale` is currently hardcoded to `64` in `parameters.ts`. The implementation should still support other values because the renderer already rebuilds FBOs when `params.blockingScale` changes.
+- Mobile GPUs may benefit more from the reduced prepass, but may expose precision or texture-unit assumptions. Keep texture unit assignment explicit and below WebGL2 limits.
+
+## Review Checklist
+
+- [ ] `movementBuffer` and `paintBuffer` serialization are unchanged.
+- [ ] No new full-resolution persistent FBOs were added.
+- [ ] New movement shape FBO size equals `ceil(params.blockingScale)`.
+- [ ] `movementShapeTexture` uses `NEAREST` filtering.
+- [ ] `main.frag` samples the mask at `(blockingSt + 0.5) / u_blocking`.
+- [ ] Main framebuffer remains full-resolution.
+- [ ] The `2048 x 2048` shape bake is removed before calling the spike a performance win.
+- [ ] `bun run build` passes.
+- [ ] `bun run lint` passes.
+- [ ] Manual visual validation covers movement, paint, erase, freeze, and global freeze.
+
+## Execution Handoff
+
+Plan complete and saved to `docs/superpowers/plans/2026-05-05-block-grid-movement-masks.md`.
+
+Recommended sequence:
+
+1. Run a code review on the current uncommitted shader changes.
+2. Commit and push the reviewed baseline from `main`.
+3. Create `spike/block-grid-movement-masks`.
+4. Execute this plan task-by-task in a fresh context.
+
+Execution options after the baseline is committed:
+
+1. **Subagent-Driven (recommended)** - dispatch a fresh subagent per task, review between tasks, fast iteration.
+2. **Inline Execution** - execute tasks in this session using executing-plans, batch execution with checkpoints.
diff --git a/scripts/generate-thumbnails.ts b/scripts/generate-thumbnails.ts
index 77434fe..4617591 100644
--- a/scripts/generate-thumbnails.ts
+++ b/scripts/generate-thumbnails.ts
@@ -28,7 +28,7 @@ import { randomizeShaderParameters } from '../src/engine/parameters';
 
 const SEED_MODULUS = 1000;
 const DEFAULT_COUNT = 11;
-const DEFAULT_DURATION_SECS = 45;
+const DEFAULT_DURATION_SECS = 120;
 const DEFAULT_COOLDOWN_SECS = 5; 
 const DEFAULT_OUTPUT = './generated/thumbnails';
 const TARGET_FPS = 60;
diff --git a/src/engine/parameters.ts b/src/engine/parameters.ts
index be78b2b..c2ff8f7 100644
--- a/src/engine/parameters.ts
+++ b/src/engine/parameters.ts
@@ -1,6 +1,18 @@
 import type { ShaderParams } from './types';
 
-export const SEED_MODULUS = 1000;
+export const SEED_MODULUS = 222; //above ~300 start effecting noise shapes way too much
+
+// --- Shape Noise Mode ---
+// Noise algorithm used for waterfall + move (left/right) shapes.
+// Values must match #define constants in main.frag.
+export const ShapeNoiseMode = {
+  // Current: 0,       // trilinear 3D noise volume (C0 — sharp grid angles)
+  // FbmQuintic: 1,    // 4-octave FBM of quintic-smoothed 2D noise
+  // Metaballs: 2,     // animated metaballs with smooth-min union
+  StructuralQuintic: 3, // 3D volume re-sampled with quintic Hermite (C2)
+  BlockNoise: 4,        // direct read from u_blockNoiseTex (R channel)
+} as const;
+export type ShapeNoiseMode = (typeof ShapeNoiseMode)[keyof typeof ShapeNoiseMode];
 
 // --- Seeded RNG (mulberry32) ---
 
@@ -48,49 +60,58 @@ export function weightedRandom<T>(
   return entries[entries.length - 1][0];
 }
 
+// --- Movement Shape Scaling ---
+
+// Snap to values that produce uniform cell-to-pixel mapping in movementShape.frag.
+// FBO size = blockingScale; cells per FBO pixel = scaling. Non-uniform widths arise
+// unless `scaling` is integer (>=1) or `1/scaling` is a power-of-2 divisor of blockingScale.
+// Picks the closest allowed value; on ties (e.g. 0.75 ↔ {1, 0.5}) prefer the smaller
+// scaling so "low scaling = bigger shapes" intent is preserved.
+export function snapMovementShapeScaling(base: number, blockingScale: number): number {
+  if (base >= 1) return Math.max(1, Math.round(base));
+  const maxK = Math.max(1, blockingScale);
+  let bestScaling = 1;
+  let bestDist = Math.abs(base - 1);
+  for (let k = 2; k <= maxK; k *= 2) {
+    const candidate = 1 / k;
+    const dist = Math.abs(base - candidate);
+    if (dist <= bestDist) {
+      bestDist = dist;
+      bestScaling = candidate;
+    }
+  }
+  return bestScaling;
+}
+
 // --- Shape Scale Helpers ---
 
+// baseScale is the number of noise-volume cells spanned across the screen on each axis.
+// fxWithBlocking divides by blockingScale because blockingSt = floor(st * blocking),
+// so multiplying that by (n / blockingScale) recovers the same effective range as n * st.
+// Both axes are kept >= ~1.5 so the StructuralQuintic volume (128×128×64, sampled in cell
+// units) actually has variation across the screen — sub-cell ranges collapse to one value.
 function getShapeScale(
   baseScale: [number, number],
-  threshold: number,
-  adjustmentFactor: number,
   fxWithBlocking: boolean,
   blockingScale: number,
 ): [number, number] {
-  // shapeNormalizer keeps shape size stable so threshold acts as frequency adjuster
-  const shapeNormalizer = 0.2 / threshold;
-  return baseScale.map((n) => {
-    let base = fxWithBlocking ? n / blockingScale : n;
-    base /= shapeNormalizer;
-    base /= adjustmentFactor;
-    return base;
-  }) as [number, number];
+  return baseScale.map((n) =>
+    fxWithBlocking ? n / blockingScale : n,
+  ) as [number, number];
 }
 
 export function getFallShapeScale(
-  threshold: number,
-  useFallBlob: boolean,
   fxWithBlocking: boolean,
   blockingScale: number,
 ): [number, number] {
-  const shouldFallBaseScale: [number, number] = useFallBlob
-    ? [10, 8]
-    : [10, 0.5];
-  const blobAdjustment = useFallBlob ? 3 : 1;
-  return getShapeScale(shouldFallBaseScale, threshold, blobAdjustment, fxWithBlocking, blockingScale);
+  return getShapeScale([10, .33], fxWithBlocking, blockingScale);
 }
 
 export function getMoveShapeScale(
-  threshold: number,
-  useMoveBlob: boolean,
   fxWithBlocking: boolean,
   blockingScale: number,
 ): [number, number] {
-  const shouldMoveBaseScale: [number, number] = useMoveBlob
-    ? [5, 5]
-    : [0.5, 5];
-  const blobAdjustment = useMoveBlob ? 2 : 1;
-  return getShapeScale(shouldMoveBaseScale, threshold, blobAdjustment, fxWithBlocking, blockingScale);
+  return getShapeScale([.33, 10], fxWithBlocking, blockingScale);
 }
 
 // --- Parameter Randomization ---
@@ -98,87 +119,90 @@ export function randomizeShaderParameters(seedValue: number): ShaderParams {
   const rngSeed = normalizeSeed(seedValue);
   const rng = createSeededRNG(rngSeed);
 
-  const randomFloat = (min: number, max: number) =>
-    rng() * (max - min) + min;
+  const randomFloat = (min: number, max: number) => rng() * (max - min) + min;
 
   // Blocking parameters
   const fxWithBlocking = weightedRandom<boolean>(
     [
       [true, 1],
-      [false, 9],
+      [false, 4],
     ],
     rng,
   );
 
-  // const fxWithBlocking = true;
-
-  let blockingScale: number;
-  if (fxWithBlocking) {
-    blockingScale = weightedRandom<number>(
-      [
-        [4, 1],
-        [8, 5],
-        [16, 10],
-        [32, 5],
-        [64, 1],
-      ],
-      rng,
-    );
-  } else {
-    blockingScale = weightedRandom<number>(
-      [
-        [8, 1],
-        [16, 2],
-        [32, 5],
-        [64, 10],
-        [128, 5],
-        [256, 2],
-        [512, 1],
-      ],
-      rng,
-    );
-  }
-
-
-  // Move parameters
-  const shouldMoveThreshold = weightedRandom<number>(
+  // 8-512
+  const blockingScale = weightedRandom<number>(
     [
-      [0.1, 1],
-      [0.15, 2],
-      [0.2, 5],
-      [0.25, 2],
-      [0.3, 1],
+      [8, 1],
+      [16, 2],
+      [32, 3],
+      [64, 5],
+      [128, 10],
+      [256, 10],
+      [512, 5],
     ],
     rng,
   );
+  // const blockingScale = 8; //base block shape for speedd compensation
 
-  const useMoveBlob = false//rng() < 0.2;
-  const moveShapeSpeed = useMoveBlob ? 0.03125 : 0.025;
-  const moveShapeScale = getMoveShapeScale(shouldMoveThreshold, useMoveBlob, fxWithBlocking, blockingScale);
-
-  // Fall parameters
-  const shouldFallThreshold = weightedRandom<number>(
+  // Domain warp: how much the noise boundaries swirl/fold
+  // Operates in normalized noise-space, so no blockingScale scaling needed
+  //1 - 10;
+  const domainWarpAmount = weightedRandom<number>(
     [
-      [0.1, 1],
-      [0.15, 2],
-      [0.2, 5],
-      [0.25, 2],
-      [0.3, 1],
+      [1.0, 1],
+      [2.0, 2],
+      [3.0, 3],
+      [4.0, 4],
+      [5.0, 5],
+      [6.0, 5],
+      [7.0, 4],
+      [8.0, 3],
+      [9.0, 2],
+      [10.0, 1],
     ],
     rng,
   );
 
-  const fallWaterfallMult = weightedRandom<number>(
+  // Pattern overlay: geometric patterns mixed with noise (0=none, 1=radial, 2=diagonal (deprecated), 3=ridged)
+  const patternMode = weightedRandom<number>(
     [
-      [1, 1],
-      [1.25, 2],
-      [1.5, 4],
-      [1.75, 2],
-      [2, 1],
+      [0, 3],
+      [1, 2],
+      [3, 1],
     ],
     rng,
   );
 
+  //TODO - needs work, it seems like the circles are getting tiled
+  const patternStrength = patternMode === 0 ? 0 : randomFloat(0.5, 2);
+  const patternFreq = randomFloat(1.0, 4.0);
+
+  const patternCenter = [0.5, 0.5] as [number, number];
+
+  // TODO deprecated clean all mirror related stuff up
+  const mirrorAmount = 0;
+  const mirrorAxis = 0;
+
+  // Move parameters
+  // const shouldMoveThreshold = weightedRandom<number>(
+  //   [
+  //     [0.1, 1],
+  //     [0.15, 2],
+  //     [0.2, 5],
+  //     [0.25, 2],
+  //     [0.3, 1],
+  //   ],
+  //   rng,
+  // );
+  const shouldMoveThreshold = 0.2;
+  const shouldFallThreshold = shouldMoveThreshold;
+
+  const moveShapeSpeed = 0.025;
+  const moveShapeScale = getMoveShapeScale(fxWithBlocking, blockingScale);
+
+  const fallWaterfallMult = 1; //amount of variation between streams/mini columns (has a built in floor so none will be 0)
+
   const defaultWaterfallMode = weightedRandom<boolean>(
     [
       [false, 1],
@@ -187,25 +211,19 @@ export function randomizeShaderParameters(seedValue: number): ShaderParams {
     rng,
   );
 
-  const useFallBlob = false//rng() < 0.2;
-  const fallShapeSpeed = useFallBlob ? 0.052 : 0.044;
-  const shouldFallScale = getFallShapeScale(shouldFallThreshold, useFallBlob, fxWithBlocking, blockingScale);
+  const fallShapeSpeed = 0.044;
+  const shouldFallScale = getFallShapeScale(fxWithBlocking, blockingScale);
 
-  // Black noise parameters
-  // const blackNoiseThreshold = weightedRandom<number>(
-  //   [
-  //     [0.45, 1],
-  //     [0.5, 6],
-  //     [0.55, 1],
-  //   ],
-  //   rng,
-  // );
-  const blackNoiseThreshold = 0.5
-  
+  //Paint thresholds
+  const blackNoiseThreshold = 0.49;
+  const useRibbonThreshold = 0.25;
+
+  const blackNoiseBaseScaleBase = Math.floor(randomFloat(2, 10));
   const blackNoiseBaseScale = [
-    Math.floor(randomFloat(4, 10)),
-    Math.floor(randomFloat(4, 10)),
+    blackNoiseBaseScaleBase,
+    blackNoiseBaseScaleBase,
   ];
+  // const blackNoiseBaseScale = [Math.floor(randomFloat(5, 20)), Math.floor(randomFloat(3, 15))]
 
   const blackNoiseScale: [number, number] = [
     blackNoiseBaseScale[0] / blockingScale,
@@ -221,21 +239,24 @@ export function randomizeShaderParameters(seedValue: number): ShaderParams {
   );
 
   // Reset parameters
-  const resetThreshold = weightedRandom<number>(
-    [
-      [0.4, 1],
-      [0.45, 2],
-      [0.5, 4],
-      [0.55, 2],
-      [0.6, 1],
-    ],
-    rng,
-  );
+  // const resetThreshold = weightedRandom<number>(
+  //   [
+  //     [0.4, 1],
+  //     [0.45, 2],
+  //     [0.5, 6],
+  //     [0.55, 2],
+  //     [0.6, 1],
+  //   ],
+  //   rng,
+  // );
 
-  const resetNoiseScale: [number, number] = [
-    blackNoiseBaseScale[0] / blockingScale,
-    blackNoiseBaseScale[1] / blockingScale,
-  ];
+  const resetThreshold = 0.45;
+
+  //deprecated, keeping for now just in case
+  // const resetNoiseScale: [number, number] = [
+  //   blackNoiseBaseScale[0] / blockingScale,
+  //   blackNoiseBaseScale[1] / blockingScale,
+  // ];
 
   // Ribbon/dirt parameters
   const dirtNoiseScale: [number, number] = [
@@ -256,98 +277,111 @@ export function randomizeShaderParameters(seedValue: number): ShaderParams {
   );
 
   // Extra fall parameters
-  const extraFallShapeThreshold = weightedRandom<number>(
-    [
-      [0, 1],
-      [0.05, 2],
-      [0.1, 5],
-      [0.2, 2],
-      [0.3, 1],
-    ],
-    rng,
-  );
+  // const extraFallShapeThreshold = weightedRandom<number>(
+  //   [
+  //     [0, 1],
+  //     [0.05, 2],
+  //     [0.1, 5],
+  //     [0.2, 2],
+  //     [0.3, 1],
+  //   ],
+  //   rng,
+  // );
+
+  const extraFallShapeThreshold = 0.0567;
 
   const extraFallShapeScale = getFallShapeScale(
-    extraFallShapeThreshold,
-    useFallBlob,
     fxWithBlocking,
     blockingScale,
   ).map((x) => x * 3) as [number, number];
 
   // Extra move parameters
-  const extraMoveShapeThreshold = weightedRandom<number>(
-    [
-      [0, 1],
-      [0.05, 2],
-      [0.1, 5],
-      [0.2, 2],
-      [0.3, 1],
-    ],
-    rng,
-  );
-
-  const extraMoveShapeScale = getMoveShapeScale(
-    extraMoveShapeThreshold,
-    useMoveBlob,
-    fxWithBlocking,
-    blockingScale,
-  ).map((x) => x * 3) as [number, number];
-
-  // Domain warp: how much the noise boundaries swirl/fold
-  // Operates in normalized noise-space, so no blockingScale scaling needed
-  // const domainWarpAmount = weightedRandom<number>(
+  const extraMoveShapeThreshold = extraFallShapeThreshold;
+  // const extraMoveShapeThreshold = weightedRandom<number>(
   //   [
-  //     [1.0, 1],
-  //     [2.0, 2],
-  //     [3.0, 3],
-  //     [4.0, 3],
-  //     [5.0, 2],
-  //     [6.0, 1],
+  //     [0, 1],
+  //     [0.05, 2],
+  //     [0.1, 5],
+  //     [0.2, 2],
+  //     [0.3, 1],
   //   ],
   //   rng,
   // );
 
-  const domainWarpAmount = 1;
-  
+  const extraMoveShapeScale = getMoveShapeScale(
+    fxWithBlocking,
+    blockingScale,
+  ).map((x) => x * 3) as [number, number];
 
-  // Pattern overlay: geometric patterns mixed with noise (0=none, 1=radial, 2=diagonal, 3=ridged)
-  const patternMode = weightedRandom<number>(
+  // Shape noise mode — 4:1 BlockNoise vs StructuralQuintic.
+  const shapeNoiseMode = weightedRandom<ShapeNoiseMode>(
     [
-      [0, 3],
-      [1, 1],
-      [2, 1],
-      [3, 2],
+      [ShapeNoiseMode.BlockNoise, 0], //TODO should be 4, just testing right now
+      [ShapeNoiseMode.StructuralQuintic, 1],
     ],
     rng,
   );
 
+  // For StructuralQuintic: pick a horizontal direction for the shape scroll.
+  // For BlockNoise: optionally disable XY shape scroll (handled in renderer).
+  let movementNoiseShapeDirection = 1;
+  let blockNoiseDisableShapeMovement = false;
+  if (shapeNoiseMode === ShapeNoiseMode.StructuralQuintic) {
+    movementNoiseShapeDirection = rng() < 0.5 ? 1 : -1;
+  } else {
+    blockNoiseDisableShapeMovement = weightedRandom<boolean>(
+      [
+        [false, 4],
+        [true, 1],
+      ],
+      rng,
+    );
+  }
 
-  const patternStrength = patternMode === 0 ? 0 : randomFloat(0.5, 2);
-  const patternFreq = randomFloat(1.0, 4.0);
-
-  const patternCenter = [0.5, 0.5] as [number, number];
-
-  // Corner mirror: how much opposite corners reflect each other
-  const mirrorAmount = weightedRandom<number>(
-    [
-      [0, 6],
-      [0.5, 3],
-      [1, 1],
-    ],
-    rng,
+  // > 1 creates tiling, but 2 or 3 is kinda cool, might be good for a rare
+  const movementShapeScalingBase = blockNoiseDisableShapeMovement
+    ? weightedRandom(
+        [
+          [0.25, 3],
+          [0.5, 6],
+          [0.75, 4],
+          [1.0, 2],
+        ],
+        rng,
+      )
+    : //if there is shape movement
+      weightedRandom(
+        [
+          [0.25, 1],
+          [0.5, 3],
+          [0.75, 6],
+          [1.0, 10],
+          [2.0, 2],
+          [3.0, 1],
+        ],
+        rng,
+      );
+   
+      
+  // Snap to a value that gives uniform cell-edge spacing on the FBO grid.
+  // Without this, fractional bases like 0.75 produce ragged shape edges.
+  const movementShapeScalingEffective = snapMovementShapeScaling(
+    movementShapeScalingBase,
+    blockingScale,
   );
-  const mirrorAxis = rng() < 0.5 ? 0 : 1; // 0=TL↔BR, 1=TR↔BL
+  const movementShapeScaling = [
+    movementShapeScalingEffective,
+    movementShapeScalingEffective,
+  ] as [number, number];
 
   return {
     seed: rngSeed,
     fxWithBlocking,
     blockingScale,
     shouldMoveThreshold,
-    useMoveBlob,
     moveShapeSpeed,
     moveShapeScale,
     shouldFallThreshold,
-    useFallBlob,
     fallShapeSpeed,
     shouldFallScale,
     fallWaterfallMult,
@@ -356,7 +390,7 @@ export function randomizeShaderParameters(seedValue: number): ShaderParams {
     blackNoiseScale,
     blackNoiseEdgeMult,
     resetThreshold,
-    resetNoiseScale,
+    // resetNoiseScale,
     dirtNoiseScale,
     blankStaticScale,
     blankStaticThreshold,
@@ -371,6 +405,11 @@ export function randomizeShaderParameters(seedValue: number): ShaderParams {
     patternCenter,
     mirrorAmount,
     mirrorAxis,
+    movementShapeScaling,
+    useRibbonThreshold,
+    shapeNoiseMode,
+    movementNoiseShapeDirection,
+    blockNoiseDisableShapeMovement,
   };
 }
 
diff --git a/src/engine/renderer.ts b/src/engine/renderer.ts
index 26585dd..ce7b6ff 100644
--- a/src/engine/renderer.ts
+++ b/src/engine/renderer.ts
@@ -1,5 +1,5 @@
 import type { EngineConfig, EngineState, ShaderParams, DrawMode, Direction, EraseVariant } from './types';
-import { mainVert, mainFrag, displayVert, displayFrag, blockNoiseVert, blockNoiseFrag, noiseVolumeVert, noiseVolumeFrag } from './shaders';
+import { mainVert, mainFrag, displayVert, displayFrag, blockNoiseVert, blockNoiseFrag, movementShapeFrag, noiseVolumeVert, noiseVolumeFrag } from './shaders';
 import { randomizeShaderParameters, normalizeSeed, SEED_MODULUS } from './parameters';
 import { createDrawingManager, type DrawingManager } from './drawing';
 import { captureScreenshot, captureScreenshotBase64, createVideoRecorder } from './recording';
@@ -14,27 +14,52 @@ const FIXED_PIXEL_RATIO_UNIFORM = 1.0;
 const DEFAULT_TARGET_FPS = 60;
 const NOISE_VOL_XY = 128;
 const NOISE_VOL_Z = 64;
-// Shape-noise FBO is baked at SHAPE_NOISE_SIZE_MULT × blockingScale so
-// shapeNoise_BlockNoise can shrink shapes up to that factor without tiling.
-// SHAPE_NOISE_ZOOM is the default UV multiplier used when sampling it —
-// 1/SHAPE_NOISE_SIZE_MULT preserves the pre-existing shape size.
-const SHAPE_NOISE_SIZE_MULT = 2;
-const SHAPE_NOISE_ZOOM = 1.0 / SHAPE_NOISE_SIZE_MULT;
 
 // Constants passed to shader but never randomized
 const BASE_CHUNK_SIZE = 160;
-const BLOCK_TIME_MULT = 0.05;
-const STRUCTURAL_TIME_MULT = 0.01;
-const MOVE_SPEED = 0.0045;
+const BLOCK_TIME_MULT = 1.1;
+
+const STRUCTURAL_TIME_MULT = 0.0025; //structural z axis ( and reset)
+const RESET_NOISE_TIME_MULT = 5.0; //reset noise z drift relative to structural time
+
+const MOVEMENT_NOISE_TIME_MULT = 0.008;//z axis for baked movement noise
+// When params.blockNoiseDisableShapeMovement is true the XY shape scroll is killed
+// and the Z drift speed is scaled by this factor to keep the mask alive.
+const MOVEMENT_NOISE_DISABLED_TIME_MULT_FACTOR = 2.0;
+// Base drift speed at movementShapeScaling = 1. Multiplied by params.movementShapeScaling
+// at use so apparent on-screen speed stays normalized as scaling changes.
+const MOVEMENT_NOISE_X_TIME_MULT_BASE = 0.013;
+const MOVEMENT_NOISE_Y_TIME_MULT_BASE = MOVEMENT_NOISE_X_TIME_MULT_BASE * (FIXED_CANVAS_WIDTH / FIXED_CANVAS_HEIGHT);
+// Movement masks are rendered at blockingScale resolution. A full inverse scale
+// over-corrects coarse masks, so use a softer perceptual compensation curve.
+const MOVEMENT_MASK_REFERENCE_SCALE = 512; // blockScale where XY speed is unchanged
+const MOVEMENT_MASK_SCALE_EXPONENT = 0.; // 0=no scaling, 1=full inverse blockScale scaling
+
+const MOVE_SPEED = 0.0045; //pixel movement
 const RESET_EDGE_THRESHOLD = 0.33;
-const RESET_VARIANCE_AMOUNT = 0.25;
+
+const RESET_VARIANCE_AMOUNT = 0//.2; TODO re-enable
 const RESET_VARIANCE_RATE_SEC = 120;
-// Fraction of period spent in the trough (least-reset) half.
+
+const MOVEMENT_THRESHOLD_VARIANCE_AMOUNT = 0//.15; TODO re-enable
+
+//line up the lowest point of reset variance with the movement variance at neutral leading to low
+//1.0 - THRESHOLD_VARIANCE_START_PHASE (0.375) = 0.625
+//RESET_VARIANCE_RATE_SEC (120)  / 0.625
+const MOVEMENT_THRESHOLD_VARIANCE_RATE_SEC = 192;
+
+// 0.0 starts neutral; 0.375 starts low; 0.5 starts neutral; 0.875 starts high.
+//remember to change DEFAULT_DURATION_SECS  accordingly for the thumbnails to line up with the lowest point
+const THRESHOLD_VARIANCE_START_PHASE = 0.375;
+// Scales only the positive/high side. 1.0 = unchanged, 0.5 = half-height highs.
+const THRESHOLD_VARIANCE_HIGH_SCALE = 0.25;
+// Fraction of period spent in the trough (low-threshold) half.
 // 0.5 = symmetric sine. >0.5 stretches trough, compresses peak.
-const RESET_VARIANCE_TROUGH_DUTY = 0.75;
+const RESET_VARIANCE_TROUGH_DUTY = 0.75; 
+
+
 const RIBBON_DIRT_THRESHOLD = 0.9;
-const USE_RIBBON_THRESHOLD = 0.45;
-const BLANK_STATIC_TIME_MULT = 2.0;
+const BLANK_STATIC_TIME_MULT = 5.0;
 const USE_GRAYSCALE = false;
 const BLANK_COLOR: [number, number, number] = [0.11, 0.11, 0.11]
 const STATIC_COLOR_1: [number, number, number] = [1, 0, 0];
@@ -48,7 +73,7 @@ const EXTRA_FALL_STUTTER_THRESHOLD = 0.1;
 const EXTRA_MOVE_STUTTER_THRESHOLD = 0.1;
 const EXTRA_FALL_SHAPE_TIME_MULT = 0.025;
 // Lower = slower edge-contour wobble on move/fall shapes.
-const CONTOUR_TIME_MULT = 0.25;
+const CONTOUR_TIME_MULT = 0.2;
 
 // Seeds the movement buffer on init and after resets so the sim
 // starts with a preset flow pattern instead of an empty canvas.
@@ -60,18 +85,6 @@ const InitialMovementPattern = {
 type InitialMovementPattern = (typeof InitialMovementPattern)[keyof typeof InitialMovementPattern];
 const INITIAL_MOVEMENT_PATTERN: InitialMovementPattern = InitialMovementPattern.None;
 
-// Noise algorithm used for waterfall + move (left/right) shapes.
-// Swap to compare how each renders the blobby/paint-drip silhouette.
-const ShapeNoiseMode = {
-  // Current: 0, // existing: trilinear 3D noise volume (C0 — produces sharp grid angles)
-  // FbmQuintic: 1, // 4-octave FBM of quintic-smoothed 2D noise (C2 everywhere)
-  // Metaballs: 2, // animated metaballs with smooth-min union — roundest blobs
-  StructuralQuintic: 3, // same 3D volume as Current, re-sampled with quintic Hermite (C2) via manual 8-corner texelFetch
-  BlockNoise: 4, // direct read from u_blockNoiseTex (R channel)
-} as const;
-type ShapeNoiseMode = (typeof ShapeNoiseMode)[keyof typeof ShapeNoiseMode];
-const SHAPE_NOISE_MODE: ShapeNoiseMode = ShapeNoiseMode.BlockNoise;
-
 // --- Shader helper ---
 
 function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
@@ -245,6 +258,7 @@ export function createEngine(config: EngineConfig): Engine {
     resetEdgeThreshold: gl.getUniformLocation(mainProg, 'u_resetEdgeThreshold'),
     resetNoiseScale: gl.getUniformLocation(mainProg, 'u_resetNoiseScale'),
     resetThresholdVariance: gl.getUniformLocation(mainProg, 'u_resetThresholdVariance'),
+    movementThresholdVariance: gl.getUniformLocation(mainProg, 'u_movementThresholdVariance'),
     shouldFallThreshold: gl.getUniformLocation(mainProg, 'u_shouldFallThreshold'),
     shouldFallScale: gl.getUniformLocation(mainProg, 'u_shouldFallScale'),
     fallShapeSpeed: gl.getUniformLocation(mainProg, 'u_fallShapeSpeed'),
@@ -285,10 +299,10 @@ export function createEngine(config: EngineConfig): Engine {
     movementTexture: gl.getUniformLocation(mainProg, 'u_movementTexture'),
     paintTexture: gl.getUniformLocation(mainProg, 'u_paintTexture'),
     blockNoiseTex: gl.getUniformLocation(mainProg, 'u_blockNoiseTex'),
-    shapeNoiseTex: gl.getUniformLocation(mainProg, 'u_shapeNoiseTex'),
-    shapeNoiseZoom: gl.getUniformLocation(mainProg, 'u_shapeNoiseZoom'),
+    movementShapeTex: gl.getUniformLocation(mainProg, 'u_movementShapeTex'),
     noiseVolume: gl.getUniformLocation(mainProg, 'u_noiseVolume'),
     shapeNoiseMode: gl.getUniformLocation(mainProg, 'u_shapeNoiseMode'),
+    movementNoiseShapeDirection: gl.getUniformLocation(mainProg, 'u_movementNoiseShapeDirection'),
     contourTimeMult: gl.getUniformLocation(mainProg, 'u_contourTimeMult'),
     cameraTex: gl.getUniformLocation(mainProg, 'u_cameraTex'),
     useCamera: gl.getUniformLocation(mainProg, 'u_useCamera'),
@@ -318,18 +332,44 @@ export function createEngine(config: EngineConfig): Engine {
     texCoord: gl.getAttribLocation(bnProg, 'a_texCoord'),
   };
   const bnUnif = {
-    seed: gl.getUniformLocation(bnProg, 'u_seed'),
-    blocking: gl.getUniformLocation(bnProg, 'u_blocking'),
-    blackNoiseScale: gl.getUniformLocation(bnProg, 'u_blackNoiseScale'),
-    structuralMoveTime: gl.getUniformLocation(bnProg, 'u_structuralMoveTime'),
-    wrappingTime: gl.getUniformLocation(bnProg, 'u_wrappingTime'),
-    domainWarpAmount: gl.getUniformLocation(bnProg, 'u_domainWarpAmount'),
-    patternMode: gl.getUniformLocation(bnProg, 'u_patternMode'),
-    patternStrength: gl.getUniformLocation(bnProg, 'u_patternStrength'),
-    patternFreq: gl.getUniformLocation(bnProg, 'u_patternFreq'),
-    patternCenter: gl.getUniformLocation(bnProg, 'u_patternCenter'),
-    mirrorAmount: gl.getUniformLocation(bnProg, 'u_mirrorAmount'),
-    mirrorAxis: gl.getUniformLocation(bnProg, 'u_mirrorAxis'),
+    seed: gl.getUniformLocation(bnProg, "u_seed"),
+    blocking: gl.getUniformLocation(bnProg, "u_blocking"),
+    blackNoiseScale: gl.getUniformLocation(bnProg, "u_blackNoiseScale"),
+    structuralMoveTime: gl.getUniformLocation(bnProg, "u_structuralMoveTime"),
+    resetNoiseTimeMult: gl.getUniformLocation(bnProg, "u_resetNoiseTimeMult"),
+    domainWarpAmount: gl.getUniformLocation(bnProg, "u_domainWarpAmount"),
+    patternMode: gl.getUniformLocation(bnProg, "u_patternMode"),
+    patternStrength: gl.getUniformLocation(bnProg, "u_patternStrength"),
+    patternFreq: gl.getUniformLocation(bnProg, "u_patternFreq"),
+    patternCenter: gl.getUniformLocation(bnProg, "u_patternCenter"),
+    mirrorAmount: gl.getUniformLocation(bnProg, "u_mirrorAmount"),
+    mirrorAxis: gl.getUniformLocation(bnProg, "u_mirrorAxis"),
+  };
+
+  // --- Movement Shape Program ---
+
+  const msProg = linkProgram(gl, blockNoiseVert, movementShapeFrag);
+  if (!msProg) throw new Error('Failed to create movement shape program');
+
+  const msAttr = {
+    position: gl.getAttribLocation(msProg, 'a_position'),
+    texCoord: gl.getAttribLocation(msProg, 'a_texCoord'),
+  };
+  const msUnif = {
+    seed: gl.getUniformLocation(msProg, 'u_seed'),
+    blocking: gl.getUniformLocation(msProg, 'u_blocking'),
+    blackNoiseScale: gl.getUniformLocation(msProg, 'u_blackNoiseScale'),
+    structuralMoveTime: gl.getUniformLocation(msProg, 'u_structuralMoveTime'),
+    movementNoiseTime: gl.getUniformLocation(msProg, 'u_movementNoiseTime'),
+    movementNoiseXYTime: gl.getUniformLocation(msProg, 'u_movementNoiseXYTime'),
+    domainWarpAmount: gl.getUniformLocation(msProg, 'u_domainWarpAmount'),
+    patternMode: gl.getUniformLocation(msProg, 'u_patternMode'),
+    patternStrength: gl.getUniformLocation(msProg, 'u_patternStrength'),
+    patternFreq: gl.getUniformLocation(msProg, 'u_patternFreq'),
+    patternCenter: gl.getUniformLocation(msProg, 'u_patternCenter'),
+    mirrorAmount: gl.getUniformLocation(msProg, 'u_mirrorAmount'),
+    mirrorAxis: gl.getUniformLocation(msProg, 'u_mirrorAxis'),
+    movementShapeScaling: gl.getUniformLocation(msProg, 'u_movementShapeScaling'),
   };
 
   // --- Noise Volume Program ---
@@ -378,11 +418,11 @@ export function createEngine(config: EngineConfig): Engine {
   let blockNoiseFBOHandle: WebGLFramebuffer | null = null;
   let blockNoiseSize = 0;
 
-  // Larger sibling FBO baked from the same shader (with u_blocking scaled to
-  // match) so shapeNoise_BlockNoise has headroom to shrink without tiling.
-  let shapeNoiseTexture: WebGLTexture | null = null;
-  let shapeNoiseFBOHandle: WebGLFramebuffer | null = null;
-  let shapeNoiseSize = 0;
+  // Block-grid directional movement mask (R=left, G=right, B=up, A=down).
+  // Sized 1:1 with blockingScale; sampled per block-cell in main.frag.
+  let movementShapeTexture: WebGLTexture | null = null;
+  let movementShapeFBOHandle: WebGLFramebuffer | null = null;
+  let movementShapeSize = 0;
   // REPEAT wrap so fract()-driven UVs in the shader sample seamlessly when
   // the read crosses the [0,1] boundary.
   function createBlockNoiseTexture(size: number, wrap: number, filter: number) {
@@ -409,12 +449,12 @@ export function createEngine(config: EngineConfig): Engine {
     blockNoiseTexture = tex;
     blockNoiseFBOHandle = fbo;
 
-    shapeNoiseSize = Math.max(1, blockNoiseSize * SHAPE_NOISE_SIZE_MULT);
-    if (shapeNoiseTexture) gl.deleteTexture(shapeNoiseTexture);
-    if (shapeNoiseFBOHandle) gl.deleteFramebuffer(shapeNoiseFBOHandle);
-    const sn = createBlockNoiseTexture(shapeNoiseSize, gl.REPEAT, gl.LINEAR);
-    shapeNoiseTexture = sn.tex;
-    shapeNoiseFBOHandle = sn.fbo;
+    movementShapeSize = blockNoiseSize;
+    if (movementShapeTexture) gl.deleteTexture(movementShapeTexture);
+    if (movementShapeFBOHandle) gl.deleteFramebuffer(movementShapeFBOHandle);
+    const ms = createBlockNoiseTexture(movementShapeSize, gl.CLAMP_TO_EDGE, gl.NEAREST);
+    movementShapeTexture = ms.tex;
+    movementShapeFBOHandle = ms.fbo;
   }
 
   // --- Camera Texture (optional, desktop-only ?camera=1) ---
@@ -626,9 +666,8 @@ export function createEngine(config: EngineConfig): Engine {
 
   // --- Block Noise Render ---
 
-  function renderBlockNoise(structuralMoveTime: number, wrappingTime: number) {
+  function renderBlockNoise(structuralMoveTime: number) {
     if (!blockNoiseTexture || !blockNoiseFBOHandle) return;
-    if (!shapeNoiseTexture || !shapeNoiseFBOHandle) return;
 
     // Resize if blockingScale changed
     const neededSize = Math.max(1, Math.ceil(params.blockingScale));
@@ -641,7 +680,7 @@ export function createEngine(config: EngineConfig): Engine {
     gl.uniform1f(bnUnif.seed, seed);
     gl.uniform2f(bnUnif.blackNoiseScale, params.blackNoiseScale[0], params.blackNoiseScale[1]);
     gl.uniform1f(bnUnif.structuralMoveTime, structuralMoveTime);
-    gl.uniform1f(bnUnif.wrappingTime, wrappingTime);
+    gl.uniform1f(bnUnif.resetNoiseTimeMult, RESET_NOISE_TIME_MULT);
     gl.uniform1f(bnUnif.domainWarpAmount, params.domainWarpAmount);
     gl.uniform1i(bnUnif.patternMode, params.patternMode);
     gl.uniform1f(bnUnif.patternStrength, params.patternStrength);
@@ -658,18 +697,51 @@ export function createEngine(config: EngineConfig): Engine {
     gl.enableVertexAttribArray(bnAttr.texCoord);
     gl.vertexAttribPointer(bnAttr.texCoord, 2, gl.FLOAT, false, 0, 0);
 
-    // Pass 1: small block-noise FBO (pixel == block, used for blocking logic).
+    // Small block-noise FBO (pixel == block, used for blocking logic).
     gl.bindFramebuffer(gl.FRAMEBUFFER, blockNoiseFBOHandle);
     gl.viewport(0, 0, blockNoiseSize, blockNoiseSize);
     gl.uniform1f(bnUnif.blocking, params.blockingScale);
     gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
 
-    // Pass 2: same shader at SHAPE_NOISE_SIZE_MULT × resolution with u_blocking
-    // scaled to match — keeps pixel == block, extending the noise domain
-    // proportionally so the texture contains 4× as many shape periods.
-    gl.bindFramebuffer(gl.FRAMEBUFFER, shapeNoiseFBOHandle);
-    gl.viewport(0, 0, shapeNoiseSize, shapeNoiseSize);
-    gl.uniform1f(bnUnif.blocking, params.blockingScale * SHAPE_NOISE_SIZE_MULT);
+    gl.viewport(0, 0, canvas.width, canvas.height);
+  }
+
+  // --- Movement Shape Mask Render ---
+
+  function renderMovementShapeMask(
+    structuralMoveTime: number,
+    movementNoiseTime: number,
+    movementNoiseXYTime: [number, number],
+  ) {
+    if (!movementShapeTexture || !movementShapeFBOHandle) return;
+
+    gl.useProgram(msProg);
+
+    gl.uniform1f(msUnif.seed, seed);
+    gl.uniform1f(msUnif.blocking, params.blockingScale);
+    gl.uniform2f(msUnif.blackNoiseScale, params.blackNoiseScale[0], params.blackNoiseScale[1]);
+    gl.uniform1f(msUnif.structuralMoveTime, structuralMoveTime);
+    gl.uniform1f(msUnif.movementNoiseTime, movementNoiseTime);
+    gl.uniform2f(msUnif.movementNoiseXYTime, movementNoiseXYTime[0], movementNoiseXYTime[1]);
+    gl.uniform1f(msUnif.domainWarpAmount, params.domainWarpAmount);
+    gl.uniform1i(msUnif.patternMode, params.patternMode);
+    gl.uniform1f(msUnif.patternStrength, params.patternStrength);
+    gl.uniform1f(msUnif.patternFreq, params.patternFreq);
+    gl.uniform2f(msUnif.patternCenter, params.patternCenter[0], params.patternCenter[1]);
+    gl.uniform1f(msUnif.mirrorAmount, params.mirrorAmount);
+    gl.uniform1i(msUnif.mirrorAxis, params.mirrorAxis);
+    gl.uniform2f(msUnif.movementShapeScaling, params.movementShapeScaling[0], params.movementShapeScaling[1]);
+
+    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
+    gl.enableVertexAttribArray(msAttr.position);
+    gl.vertexAttribPointer(msAttr.position, 2, gl.FLOAT, false, 0, 0);
+
+    gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
+    gl.enableVertexAttribArray(msAttr.texCoord);
+    gl.vertexAttribPointer(msAttr.texCoord, 2, gl.FLOAT, false, 0, 0);
+
+    gl.bindFramebuffer(gl.FRAMEBUFFER, movementShapeFBOHandle);
+    gl.viewport(0, 0, movementShapeSize, movementShapeSize);
     gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
 
     gl.viewport(0, 0, canvas.width, canvas.height);
@@ -677,13 +749,47 @@ export function createEngine(config: EngineConfig): Engine {
 
   // --- Render ---
 
+  function thresholdVariance(timeSec: number, periodSec: number, amount: number): number {
+    const cyclePos = ((timeSec / periodSec + THRESHOLD_VARIANCE_START_PHASE) % 1 + 1) % 1;
+    const duty = RESET_VARIANCE_TROUGH_DUTY;
+    const variancePhase = cyclePos < duty
+      ? (Math.PI * cyclePos) / duty
+      : Math.PI + (Math.PI * (cyclePos - duty)) / (1 - duty);
+    const variance = -Math.sin(variancePhase) * amount;
+    return variance > 0.0 ? variance * THRESHOLD_VARIANCE_HIGH_SCALE : variance;
+  }
+
+  function movementMaskXYTime(moveTime: number, blockingScale: number): [number, number] {
+    if (params.blockNoiseDisableShapeMovement) return [0, 0];
+    const scaleRatio = MOVEMENT_MASK_REFERENCE_SCALE / Math.max(1, blockingScale);
+    const scaleCompensation = Math.pow(scaleRatio, MOVEMENT_MASK_SCALE_EXPONENT);
+    const [msx, msy] = params.movementShapeScaling;
+    return [
+      moveTime * MOVEMENT_NOISE_X_TIME_MULT_BASE * msx * scaleCompensation,
+      moveTime * MOVEMENT_NOISE_Y_TIME_MULT_BASE * msy * scaleCompensation,
+    ];
+  }
+
   function render() {
     const nextFbIndex = (currentFbIndex + 1) % 2;
 
+    // Manual mode: zero out autonomous thresholds.
+    const effMove = manualModeFlag ? 0.0 : params.shouldMoveThreshold;
+    const effFall = manualModeFlag ? 0.0 : params.shouldFallThreshold;
+    const effReset = manualModeFlag ? 0.0 : params.resetThreshold;
+    const effExtraFall = manualModeFlag ? 0.0 : params.extraFallShapeThreshold;
+    const effExtraMove = manualModeFlag ? 0.0 : params.extraMoveShapeThreshold;
+
     // Block noise pre-pass
     const moveTime = time * (targetFps / 30);
     const smt = manualModeFlag ? 0.0 : moveTime * STRUCTURAL_TIME_MULT;
-    renderBlockNoise(smt, smt * 2);
+    const movementNoiseTimeMult = params.blockNoiseDisableShapeMovement
+      ? MOVEMENT_NOISE_TIME_MULT * MOVEMENT_NOISE_DISABLED_TIME_MULT_FACTOR
+      : MOVEMENT_NOISE_TIME_MULT;
+    const mnt = manualModeFlag ? 0.0 : moveTime * movementNoiseTimeMult;
+    const mnxyt = manualModeFlag ? [0.0, 0.0] as [number, number] : movementMaskXYTime(moveTime, params.blockingScale);
+    renderBlockNoise(smt);
+    renderMovementShapeMask(smt, mnt, mnxyt);
 
     // Main compute pass — render to next framebuffer
     gl.bindFramebuffer(gl.FRAMEBUFFER, ppFBOs[nextFbIndex]);
@@ -702,16 +808,15 @@ export function createEngine(config: EngineConfig): Engine {
     gl.uniform1f(mainUnif.baseChunkSize, BASE_CHUNK_SIZE);
     gl.uniform1f(mainUnif.moveSpeed, MOVE_SPEED);
     gl.uniform1f(mainUnif.resetEdgeThreshold, RESET_EDGE_THRESHOLD);
-    const cyclePos = ((time / RESET_VARIANCE_RATE_SEC) % 1 + 1) % 1;
-    const duty = RESET_VARIANCE_TROUGH_DUTY;
-    const variancePhase = cyclePos < duty
-      ? (Math.PI * cyclePos) / duty
-      : Math.PI + (Math.PI * (cyclePos - duty)) / (1 - duty);
-    const resetThresholdVariance = -Math.sin(variancePhase) * RESET_VARIANCE_AMOUNT;
+    const resetThresholdVariance = thresholdVariance(time, RESET_VARIANCE_RATE_SEC, RESET_VARIANCE_AMOUNT);
+    const movementThresholdVariance = manualModeFlag
+      ? 0.0
+      : thresholdVariance(time, MOVEMENT_THRESHOLD_VARIANCE_RATE_SEC, MOVEMENT_THRESHOLD_VARIANCE_AMOUNT);
+
     gl.uniform1f(mainUnif.resetThresholdVariance, resetThresholdVariance);
+    gl.uniform1f(mainUnif.movementThresholdVariance, movementThresholdVariance);
     gl.uniform1f(mainUnif.blockTimeMult, BLOCK_TIME_MULT);
     gl.uniform1f(mainUnif.structuralTimeMult, STRUCTURAL_TIME_MULT);
-    gl.uniform1f(mainUnif.useRibbonThreshold, USE_RIBBON_THRESHOLD);
     gl.uniform1f(mainUnif.ribbonDirtThreshold, RIBBON_DIRT_THRESHOLD);
     gl.uniform1i(mainUnif.useGrayscale, USE_GRAYSCALE ? 1 : 0);
     gl.uniform1i(mainUnif.useColorCycle, USE_COLOR_CYCLE ? 1 : 0);
@@ -727,22 +832,16 @@ export function createEngine(config: EngineConfig): Engine {
     gl.uniform2f(mainUnif.extraMoveStutterScale, EXTRA_MOVE_STUTTER_SCALE[0], EXTRA_MOVE_STUTTER_SCALE[1]);
     gl.uniform1f(mainUnif.extraFallStutterThreshold, EXTRA_FALL_STUTTER_THRESHOLD);
     gl.uniform1f(mainUnif.extraMoveStutterThreshold, EXTRA_MOVE_STUTTER_THRESHOLD);
-    gl.uniform1i(mainUnif.shapeNoiseMode, SHAPE_NOISE_MODE);
+    gl.uniform1i(mainUnif.shapeNoiseMode, params.shapeNoiseMode);
+    gl.uniform1f(mainUnif.movementNoiseShapeDirection, params.movementNoiseShapeDirection);
     gl.uniform1f(mainUnif.contourTimeMult, CONTOUR_TIME_MULT);
 
-    // Manual mode: zero out autonomous thresholds
-    const effMove = manualModeFlag ? 0.0 : params.shouldMoveThreshold;
-    const effFall = manualModeFlag ? 0.0 : params.shouldFallThreshold;
-    const effReset = manualModeFlag ? 0.0 : params.resetThreshold;
-    const effExtraFall = manualModeFlag ? 0.0 : params.extraFallShapeThreshold;
-    const effExtraMove = manualModeFlag ? 0.0 : params.extraMoveShapeThreshold;
-
     // Seed-derived params
     gl.uniform1f(mainUnif.shouldMoveThreshold, effMove);
     gl.uniform2f(mainUnif.moveShapeScale, params.moveShapeScale[0], params.moveShapeScale[1]);
     gl.uniform1f(mainUnif.moveShapeSpeed, params.moveShapeSpeed);
     gl.uniform1f(mainUnif.resetThreshold, effReset);
-    gl.uniform2f(mainUnif.resetNoiseScale, params.resetNoiseScale[0], params.resetNoiseScale[1]);
+    // gl.uniform2f(mainUnif.resetNoiseScale, params.resetNoiseScale[0], params.resetNoiseScale[1]);
     gl.uniform1f(mainUnif.shouldFallThreshold, effFall);
     gl.uniform2f(mainUnif.shouldFallScale, params.shouldFallScale[0], params.shouldFallScale[1]);
     gl.uniform1f(mainUnif.fallShapeSpeed, params.fallShapeSpeed);
@@ -756,6 +855,7 @@ export function createEngine(config: EngineConfig): Engine {
     gl.uniform2f(mainUnif.blackNoiseScale, params.blackNoiseScale[0], params.blackNoiseScale[1]);
     gl.uniform1f(mainUnif.blackNoiseEdgeMult, params.blackNoiseEdgeMult);
     gl.uniform1f(mainUnif.blackNoiseThreshold, params.blackNoiseThreshold);
+    gl.uniform1f(mainUnif.useRibbonThreshold, params.useRibbonThreshold);
     gl.uniform2f(mainUnif.dirtNoiseScale, params.dirtNoiseScale[0], params.dirtNoiseScale[1]);
     gl.uniform2f(mainUnif.blankStaticScale, params.blankStaticScale[0], params.blankStaticScale[1]);
 
@@ -782,13 +882,12 @@ export function createEngine(config: EngineConfig): Engine {
       gl.uniform1i(mainUnif.blockNoiseTex, 2);
     }
 
-    // Bind larger shape-noise texture → TEXTURE6
-    if (shapeNoiseTexture) {
-      gl.activeTexture(gl.TEXTURE6);
-      gl.bindTexture(gl.TEXTURE_2D, shapeNoiseTexture);
-      gl.uniform1i(mainUnif.shapeNoiseTex, 6);
+    // Bind block-grid movement mask → TEXTURE7
+    if (movementShapeTexture) {
+      gl.activeTexture(gl.TEXTURE7);
+      gl.bindTexture(gl.TEXTURE_2D, movementShapeTexture);
+      gl.uniform1i(mainUnif.movementShapeTex, 7);
     }
-    gl.uniform1f(mainUnif.shapeNoiseZoom, SHAPE_NOISE_ZOOM);
 
     // Bind 3D noise volume → TEXTURE3
     if (noiseVolumeTexture) {
@@ -911,6 +1010,7 @@ export function createEngine(config: EngineConfig): Engine {
       gl.deleteProgram(mainProg);
       gl.deleteProgram(dispProg);
       gl.deleteProgram(bnProg);
+      gl.deleteProgram(msProg);
       gl.deleteProgram(nvProg);
       for (let i = 0; i < 2; i++) {
         gl.deleteTexture(ppTextures[i]);
@@ -918,8 +1018,8 @@ export function createEngine(config: EngineConfig): Engine {
       }
       if (blockNoiseTexture) gl.deleteTexture(blockNoiseTexture);
       if (blockNoiseFBOHandle) gl.deleteFramebuffer(blockNoiseFBOHandle);
-      if (shapeNoiseTexture) gl.deleteTexture(shapeNoiseTexture);
-      if (shapeNoiseFBOHandle) gl.deleteFramebuffer(shapeNoiseFBOHandle);
+      if (movementShapeTexture) gl.deleteTexture(movementShapeTexture);
+      if (movementShapeFBOHandle) gl.deleteFramebuffer(movementShapeFBOHandle);
       if (noiseVolumeTexture) gl.deleteTexture(noiseVolumeTexture);
       if (cameraTexture) gl.deleteTexture(cameraTexture);
       cameraTexture = null;
@@ -981,7 +1081,9 @@ export function createEngine(config: EngineConfig): Engine {
 
     async loadState(state) {
       seed = normalizeSeed(state.seed);
-      params = state.params;
+      // Forward-compat: fill in any fields missing from older saved states
+      // by re-deriving from seed. Saved values still win on overlap.
+      params = { ...randomizeShaderParameters(seed), ...state.params };
       totalFrameCount = state.totalFrameCount;
       time = totalFrameCount / targetFps;
 
diff --git a/src/engine/shaders.ts b/src/engine/shaders.ts
index 535485a..6d9fee7 100644
--- a/src/engine/shaders.ts
+++ b/src/engine/shaders.ts
@@ -6,6 +6,7 @@ import displayVert from './shaders/display.vert';
 import displayFrag from './shaders/display.frag';
 import blockNoiseVert from './shaders/blockNoise.vert';
 import blockNoiseFrag from './shaders/blockNoise.frag';
+import movementShapeFrag from './shaders/movementShape.frag';
 import noiseVolumeVert from './shaders/noiseVolume.vert';
 import noiseVolumeFrag from './shaders/noiseVolume.frag';
 
@@ -14,5 +15,6 @@ export {
   drawVert, drawFrag,
   displayVert, displayFrag,
   blockNoiseVert, blockNoiseFrag,
+  movementShapeFrag,
   noiseVolumeVert, noiseVolumeFrag,
 };
diff --git a/src/engine/shaders/blockNoise.frag b/src/engine/shaders/blockNoise.frag
index 4f157dc..c872b46 100644
--- a/src/engine/shaders/blockNoise.frag
+++ b/src/engine/shaders/blockNoise.frag
@@ -9,109 +9,29 @@ uniform float u_seed;
 uniform float u_blocking;
 uniform vec2 u_blackNoiseScale;
 uniform float u_structuralMoveTime;
-uniform float u_wrappingTime;
+uniform float u_resetNoiseTimeMult;
 uniform float u_domainWarpAmount;
 uniform int u_patternMode;       // 0=none, 1=radial, 2=diagonal, 3=ridged
 uniform float u_patternStrength; // 0-1 blend with noise
 uniform float u_patternFreq;     // repetitions across canvas (1-4)
 uniform vec2 u_patternCenter;    // focal point for patterns (golden ratio positions)
-uniform float u_mirrorAmount;    // 0-1 strength of corner mirroring
+uniform float u_mirrorAmount;    // TODO deprecated, clean all mirror related stuff up
 uniform int u_mirrorAxis;        // 0=TL↔BR, 1=TR↔BL
 
 in vec2 v_texCoord;
 out vec4 fragColor;
 
-float random3D(vec3 st) {
-    vec3 p = fract((st + u_seed) * vec3(443.897, 441.423, 437.195));
-    p += dot(p, p.yzx + 19.19);
-    return fract((p.x + p.y) * p.z);
-}
-
-float noise3D(vec3 st) {
-    st += vec3(u_seed * 13.591, u_seed * 7.123, 0.0);
-    vec3 i = floor(st);
-    vec3 f = fract(st);
-    float a = random3D(i);
-    float b = random3D(i + vec3(1.0, 0.0, 0.0));
-    float c = random3D(i + vec3(0.0, 1.0, 0.0));
-    float d = random3D(i + vec3(1.0, 1.0, 0.0));
-    float e = random3D(i + vec3(0.0, 0.0, 1.0));
-    float f_corner = random3D(i + vec3(1.0, 0.0, 1.0));
-    float g = random3D(i + vec3(0.0, 1.0, 1.0));
-    float h = random3D(i + vec3(1.0, 1.0, 1.0));
-    vec3 u = f * f * (3.0 - 2.0 * f);
-    float ab = mix(a, b, u.x);
-    float cd = mix(c, d, u.x);
-    float ef = mix(e, f_corner, u.x);
-    float gh = mix(g, h, u.x);
-    float abcd = mix(ab, cd, u.y);
-    float efgh = mix(ef, gh, u.y);
-    return mix(abcd, efgh, u.z);
-}
-
-float structuralNoise(vec2 st, float t) {
-    return noise3D(vec3(st, t));
-}
+#include chunks/blockNoiseDomain.glsl;
 
 void main() {
-    vec2 blockingSt = floor(v_texCoord * u_blocking);
-
-    // Corner mirror: blend coordinates toward their 180°-rotated counterpart
-    // so ALL channels naturally mirror near opposite corners
-    if (u_mirrorAmount > 0.0) {
-      vec2 mirrorSt = vec2(u_blocking - 1.0) - blockingSt;
-      // Mask: distance from the closer of the two corners on the chosen diagonal
-      vec2 corner1 = u_mirrorAxis == 0 ? vec2(0.0, 0.0) : vec2(1.0, 0.0);
-      vec2 corner2 = 1.0 - corner1;
-      float nearCorner = min(length(v_texCoord - corner1), length(v_texCoord - corner2));
-      // Blend: full mirror in corners, fades to original toward center
-      float mask = smoothstep(1.5, 0.0, nearCorner) * u_mirrorAmount;
-      blockingSt = mix(blockingSt, mirrorSt, mask);
-    }
-
-    // Normalized noise coordinates (consistent range ~0-10 regardless of blockingScale)
-    vec2 noiseSt = blockingSt * u_blackNoiseScale;
-
-    // R: wrappingNoise (scaled down for wider variation)
-    float wrappingNoise = structuralNoise(noiseSt * 0.25 + 11.909, u_wrappingTime);
-
-    // Pattern: compute a geometric bias that offsets noise coordinates
-    vec2 patternOffset = vec2(0.0);
-    if (u_patternMode > 0) {
-      vec2 uv = v_texCoord - u_patternCenter;
-      float pattern = 0.0;
-
-      if (u_patternMode == 1) {
-        pattern = sin(length(uv) * u_patternFreq * 6.2832) * 0.5 + 0.5;
-      } else if (u_patternMode == 2) {
-        pattern = sin((uv.x + uv.y) * u_patternFreq * 6.2832) * 0.5 + 0.5;
-      } else if (u_patternMode == 3) {
-        float ridgeNoise = structuralNoise(noiseSt * 0.8 + 333., u_structuralMoveTime);
-        pattern = 1.0 - abs(2.0 * ridgeNoise - 1.0);
-      }
-
-      patternOffset = vec2(pattern) * u_patternStrength;
-    }
-
-    // Domain warp
-    float warp = structuralNoise(noiseSt * .5 + 500., u_structuralMoveTime);
-    vec2 warpOffset = vec2(warp) * u_domainWarpAmount;
-
-    vec2 totalOffset = warpOffset + patternOffset;
+    vec2 noiseSt = blockNoiseDomain(v_texCoord);
 
+    // R: resetNoise
+    float resetNoise = structuralNoise(noiseSt, u_structuralMoveTime * u_resetNoiseTimeMult);
     // G: blackNoise
-    float blackNoise = structuralNoise(noiseSt + totalOffset + 1000., u_structuralMoveTime);
+    float blackNoise = structuralNoise(noiseSt + 11.11, u_structuralMoveTime + 11.11);
     // B: ribbonNoise
-    float ribbonNoise = structuralNoise(noiseSt + totalOffset - 2000., u_structuralMoveTime);
-
-    // Preserve the unclamped blackNoise in alpha for shape-noise consumers
-    // (the .g/.b clamp below is for the blocking-mask threshold logic and
-    // would never let move/fall noise cross its trigger thresholds).
-    float shapeNoiseValue = blackNoise;
-
-    // Balanced fill: compress toward 0.5 and clamp to guarantee mix
-    blackNoise = clamp(0.3 + blackNoise * 0.4, 0.3, 0.7);
-    ribbonNoise = clamp(0.3 + ribbonNoise * 0.4, 0.3, 0.7);
+    float ribbonNoise = structuralNoise(noiseSt + 22.22, u_structuralMoveTime * 0.5 + 22.22);
 
-    fragColor = vec4(wrappingNoise, blackNoise, ribbonNoise, shapeNoiseValue);
+    fragColor = vec4(resetNoise, blackNoise, ribbonNoise, 1.0);
 }
diff --git a/src/engine/shaders/chunks/blockNoiseDomain.glsl b/src/engine/shaders/chunks/blockNoiseDomain.glsl
new file mode 100644
index 0000000..9578845
--- /dev/null
+++ b/src/engine/shaders/chunks/blockNoiseDomain.glsl
@@ -0,0 +1,57 @@
+float random3D(vec3 st) {
+    vec3 p = fract((st + u_seed) * vec3(443.897, 441.423, 437.195));
+    p += dot(p, p.yzx + 19.19);
+    return fract((p.x + p.y) * p.z);
+}
+
+float noise3D(vec3 st) {
+    st += vec3(u_seed * 13.591, u_seed * 7.123, 0.0);
+    vec3 i = floor(st);
+    vec3 f = fract(st);
+    float a = random3D(i);
+    float b = random3D(i + vec3(1.0, 0.0, 0.0));
+    float c = random3D(i + vec3(0.0, 1.0, 0.0));
+    float d = random3D(i + vec3(1.0, 1.0, 0.0));
+    float e = random3D(i + vec3(0.0, 0.0, 1.0));
+    float f_corner = random3D(i + vec3(1.0, 0.0, 1.0));
+    float g = random3D(i + vec3(0.0, 1.0, 1.0));
+    float h = random3D(i + vec3(1.0, 1.0, 1.0));
+    vec3 u = f * f * (3.0 - 2.0 * f);
+    float ab = mix(a, b, u.x);
+    float cd = mix(c, d, u.x);
+    float ef = mix(e, f_corner, u.x);
+    float gh = mix(g, h, u.x);
+    float abcd = mix(ab, cd, u.y);
+    float efgh = mix(ef, gh, u.y);
+    return mix(abcd, efgh, u.z);
+}
+
+float structuralNoise(vec2 st, float t) {
+    return noise3D(vec3(st, t));
+}
+
+vec2 blockNoiseDomain(vec2 texCoord) {
+    vec2 blockingSt = floor(texCoord * u_blocking);
+    vec2 noiseSt = blockingSt * u_blackNoiseScale;
+
+    vec2 patternOffset = vec2(0.0);
+    if (u_patternMode > 0) {
+        vec2 uv = texCoord - u_patternCenter;
+        float pattern = 0.0;
+
+        if (u_patternMode == 1) {
+            pattern = sin(length(uv) * u_patternFreq * 6.2832) * 0.5 + 0.5;
+        } else if (u_patternMode == 2) {
+            pattern = sin((uv.x + uv.y) * u_patternFreq * 6.2832) * 0.5 + 0.5;
+        } else if (u_patternMode == 3) {
+            float ridgeNoise = structuralNoise(noiseSt * 0.8 + 333.0, u_structuralMoveTime);
+            pattern = 1.0 - abs(2.0 * ridgeNoise - 1.0);
+        }
+
+        patternOffset = vec2(pattern) * u_patternStrength;
+    }
+
+    float warp = structuralNoise(noiseSt * 0.5 + 500.0, u_structuralMoveTime * 0.05);
+    vec2 warpOffset = vec2(warp) * u_domainWarpAmount;
+    return noiseSt + warpOffset + patternOffset;
+}
diff --git a/src/engine/shaders/main.frag b/src/engine/shaders/main.frag
index 2474a08..22a189d 100644
--- a/src/engine/shaders/main.frag
+++ b/src/engine/shaders/main.frag
@@ -20,6 +20,7 @@ uniform mediump float u_resetThreshold;
 uniform mediump float u_resetEdgeThreshold;
 uniform vec2 u_resetNoiseScale;
 uniform mediump float u_resetThresholdVariance;
+uniform mediump float u_movementThresholdVariance;
 uniform mediump float u_shouldFallThreshold;
 uniform vec2 u_shouldFallScale;
 uniform float u_fallShapeSpeed;
@@ -58,10 +59,10 @@ uniform float u_defaultWaterfallMode;
 uniform sampler2D u_movementTexture;
 uniform sampler2D u_paintTexture;
 uniform sampler2D u_blockNoiseTex;
-uniform sampler2D u_shapeNoiseTex;
-uniform float u_shapeNoiseZoom;
+uniform sampler2D u_movementShapeTex;
 uniform highp sampler3D u_noiseVolume;
 uniform int u_shapeNoiseMode;
+uniform float u_movementNoiseShapeDirection;
 uniform float u_contourTimeMult;
 uniform sampler2D u_cameraTex;
 uniform float u_useCamera;
@@ -212,26 +213,14 @@ float shapeNoise_Metaballs(vec2 p, float t) {
     return clamp(0.5 - d, 0.0, 1.0);
 }
 
-// Direct read from the larger 4x shape-noise texture (.a channel = unclamped
-// blackNoise — full [0,1] range). The bake's .g/.b are clamped to [0.3, 0.7]
-// for the blocking-mask threshold logic, which would prevent move/fall noise
-// from ever crossing its trigger thresholds. t slides the UV in noise-space,
-// matching the temporal coupling other modes get from their t arg.
-float shapeNoise_BlockNoise(vec2 p, float t) {
-    vec2 uv = (1.0 - p) * u_shapeNoiseZoom; //+ vec2(t, t * 0.5);
-    return texture(u_shapeNoiseTex, fract(uv)).a;
-}
-
 // Dispatcher — second arg animates the result even when baked into p already.
-float shapeNoise(vec2 p, float t) {
+float shapeNoise(vec2 p, float t, bool isHorizontal) {
     if (u_shapeNoiseMode == SHAPE_NOISE_FBM_QUINTIC) {
         return shapeNoise_FbmQuintic(p, t);
     } else if (u_shapeNoiseMode == SHAPE_NOISE_METABALLS) {
         return shapeNoise_Metaballs(p, t);
     } else if (u_shapeNoiseMode == SHAPE_NOISE_STRUCTURAL_QUINTIC) {
         return structuralNoiseQuintic(p, t);
-    } else if (u_shapeNoiseMode == SHAPE_NOISE_BLOCK_NOISE) {
-        return shapeNoise_BlockNoise(p, t);
     }
     return structuralNoise(p, t);
 }
@@ -295,6 +284,12 @@ void main() {
     vec2 st = v_texCoord;
     vec4 blankColor = vec4(u_blankColor, 1.);
 
+    bool moveMovementNoisePatterns = true; //only applies to non baked movement noise
+    float shapeNoiseBlockSpeedAdjust = 1.;
+    float moveShapeTimeAdjust = 0.;
+
+    bool useMovementMask = u_shapeNoiseMode == SHAPE_NOISE_BLOCK_NOISE;
+
 
     //adjust for perceived brightness of rgb, where blue stays the same, red and green decrease
     blankColor.rgb *= vec3(.9, 0.6, 1.0);
@@ -332,6 +327,89 @@ void main() {
 
     vec2 blockingSt = useBlocking ? floor(st * u_blocking) : st;
 
+    float shouldMoveThreshold = max(0.0, u_shouldMoveThreshold + u_movementThresholdVariance);
+    float shouldFallThreshold = max(0.0, u_shouldFallThreshold + u_movementThresholdVariance);
+    float extraMoveShapeThreshold = max(0.0, u_extraMoveShapeThreshold + u_movementThresholdVariance);
+    float extraFallShapeThreshold = max(0.0, u_extraFallShapeThreshold + u_movementThresholdVariance);
+
+    bool maskMovesHorizontal = false;
+    float maskHorizontalDirection = 1.;
+    bool maskMovesVertical = false;
+    float maskVerticalDirection = 1.;
+
+    bool maskExtraMovesHorizontal = false;
+    float maskExtraHorizontalDirection = 1.;
+    bool maskExtraMovesVertical = false;
+    float maskExtraVerticalDirection = 1.;
+
+    if (useMovementMask) {
+        //MAIN MOVEMENT MASK
+      // Block-grid movement noise. Channels: R=left, G=right, B=up, A=down.
+      // Sampled at block-cell center so adjacent pixels in the same block
+      // read identical continuous noise values.
+      vec2 movementMaskUV = (blockingSt + 0.5) / u_blocking;
+      vec4 movementMask = texture(u_movementShapeTex, movementMaskUV);
+
+      bool maskMovesLeft = movementMask.r < shouldMoveThreshold;
+      bool maskMovesRight = movementMask.g < shouldMoveThreshold;
+      bool maskMovesUp = movementMask.b < shouldFallThreshold;
+      bool maskMovesDown = movementMask.a < shouldFallThreshold;
+
+      maskMovesHorizontal = maskMovesLeft || maskMovesRight;
+      maskMovesVertical = maskMovesUp || maskMovesDown;
+
+      if (maskMovesLeft && maskMovesRight) {
+        // collisions cancel out movement
+        maskHorizontalDirection = 0.0;
+      } else if (maskMovesLeft) {
+        maskHorizontalDirection = 1.0;
+      } else if (maskMovesRight) {
+        maskHorizontalDirection = -1.0;
+      }
+
+      if (maskMovesUp && maskMovesDown) {
+        // collisions cancel out movement
+        maskVerticalDirection = 0.0;
+      } else if (maskMovesUp) {
+        maskVerticalDirection = -1.0;
+      } else if (maskMovesDown) {
+        maskVerticalDirection = 1.0;
+      }
+
+
+      //EXTRA MOVEMENT MASK
+      vec2 extraMovementMaskUV = (blockingSt + 0.5) / u_blocking;
+      extraMovementMaskUV = fract(0.5 + extraMovementMaskUV * 2.);
+
+      vec4 extraMovementMask = texture(u_movementShapeTex, extraMovementMaskUV);
+
+      bool maskExtraMovesLeft = extraMovementMask.r < extraMoveShapeThreshold;
+      bool maskExtraMovesRight = extraMovementMask.g < extraMoveShapeThreshold;
+      bool maskExtraMovesUp = extraMovementMask.b < extraFallShapeThreshold;
+      bool maskExtraMovesDown = extraMovementMask.a < extraFallShapeThreshold;
+
+      maskExtraMovesHorizontal = maskExtraMovesLeft || maskExtraMovesRight;
+      maskExtraMovesVertical = maskExtraMovesUp || maskExtraMovesDown;
+
+      if (maskExtraMovesLeft && maskExtraMovesRight) {
+        // collisions cancel out movement
+        maskExtraHorizontalDirection = 0.0;
+      } else if (maskExtraMovesLeft) {
+        maskExtraHorizontalDirection = 1.0;
+      } else if (maskExtraMovesRight) {
+        maskExtraHorizontalDirection = -1.0;
+      }
+
+      if (maskExtraMovesUp && maskExtraMovesDown) {
+        // collisions cancel out movement
+        maskExtraVerticalDirection = 0.0;
+      } else if (maskExtraMovesUp) {
+        maskExtraVerticalDirection = -1.0;
+      } else if (maskExtraMovesDown) {
+        maskExtraVerticalDirection = 1.0;
+      }
+    }
+
     float blockTime = floor(time * u_blockTimeMult);
 
     float moveTime = time * (u_targetFps / 30.);
@@ -354,7 +432,7 @@ void main() {
 
     vec2 moveShapeSt = u_fxWithBlocking ? blockingSt : st;
 
-    if (u_shapeNoiseMode != SHAPE_NOISE_BLOCK_NOISE) {
+    if (!useMovementMask) {
       moveShapeSt *= u_moveShapeScale;
 
       float moveContourTime = moveTime * u_moveShapeSpeed * u_contourTimeMult;
@@ -363,19 +441,31 @@ void main() {
       float moveShapeContourStrength = (1.-moveContourNoise) * 0.2;
       float moveShapeContour = noise(vec2(moveShapeSt.y * moveShapeContourMult, moveContourTime)) * moveShapeContourStrength;
       moveShapeSt.x += moveShapeContour;
-    }
+    } 
 
-    float moveShapeTime = moveTime * u_moveShapeSpeed;
+  
 
-    bool moveMovementNoisePatterns = true;
 
-    if(moveMovementNoisePatterns) {
-      //move left/right
-      moveShapeSt += vec2(moveShapeTime, 100.);
-    }
+        // Calculate movement offset for the row, if it should move
+    float moveSpeed = u_moveSpeed; // Adjust for faster/slower movement
+    float moveAmount = 0.0; //gets set later
+
+    float direction = maskHorizontalDirection; //comes direction from the baked noise 
+    bool shouldMove = maskMovesHorizontal;
+
+    float movementNoiseShapeDirection = u_movementNoiseShapeDirection;
 
-    mediump float moveNoise = shapeNoise(moveShapeSt, moveShapeTime * 0.25);
-    float direction = moveNoise < 0.5 ? -1.0 : 1.0;
+    if(!useMovementMask) {
+      float moveShapeTime = moveTime * u_moveShapeSpeed;
+
+      if(moveMovementNoisePatterns) {
+        moveShapeSt -= vec2(moveShapeTime * 1.1 * movementNoiseShapeDirection, 0.);
+      }
+      mediump float moveNoise = shapeNoise(moveShapeSt, moveShapeTime * moveShapeTimeAdjust, true);
+      direction = moveNoise < 0.5 ? -1.0 : 1.0;
+      direction *= movementNoiseShapeDirection; //need to account for the reversed shape direction
+      shouldMove = moveNoise < shouldMoveThreshold;
+    }
 
     // Sample drawing buffer at actual pixel position (not block-snapped)
     // This allows sub-block brush sizes while the visual blocking still applies
@@ -399,7 +489,8 @@ void main() {
         moveDirectionOverride = 1.0;
       }
     }
-
+    shouldMove = shouldMove || moveMode; //TODO, should be able to remove "modeMode" and just override should move when movemode would have been true?
+ 
     // Decode G channel (waterfall/trickle) from movement buffer
     bool trickleMode = false;
     bool waterfallMode = false;
@@ -451,28 +542,11 @@ void main() {
       direction = moveDirectionOverride;
     }
 
-    float shouldMoveThreshold = u_shouldMoveThreshold;
-    float shouldFallThreshold = u_shouldFallThreshold;
-
-    // if (u_shapeNoiseMode == SHAPE_NOISE_BLOCK_NOISE) {
-    //   float blockNoiseShapeThreshAdjust = 0.1;
-    //   shouldMoveThreshold += blockNoiseShapeThreshAdjust;
-    //   shouldFallThreshold += blockNoiseShapeThreshAdjust;
-    // }
-
-    bool shouldMove = moveNoise < shouldMoveThreshold || moveNoise > 1. - shouldMoveThreshold;
-    shouldMove = shouldMove || moveMode;
-
-    // Calculate movement offset for the row, if it should move
-    float moveSpeed = u_moveSpeed; // Adjust for faster/slower movement
-
-    float moveAmount = 0.0;
-
 
     //FALL
     vec2 shouldFallSt = u_fxWithBlocking ? blockingSt : st;
 
-    if (u_shapeNoiseMode != SHAPE_NOISE_BLOCK_NOISE) {
+    if (!useMovementMask) {
       shouldFallSt *= u_shouldFallScale;
 
       float fallContourTime = moveTime * u_fallShapeSpeed * u_contourTimeMult;
@@ -483,54 +557,83 @@ void main() {
       shouldFallSt.y += fallShapeContour;
     }
 
-    float fallShapeTime = moveTime * u_fallShapeSpeed;
+    bool shouldFall = maskMovesVertical;
+    float fallDirection = maskVerticalDirection; //comes direction from the baked noise 
 
-    if(moveMovementNoisePatterns) {
-      //move down
-      shouldFallSt += vec2(0.268, fallShapeTime);
-    }
+    if(!useMovementMask) {
+      float fallShapeTime = moveTime * u_fallShapeSpeed;
 
-    mediump float shouldFallNoise  = shapeNoise(shouldFallSt, fallShapeTime * 0.25);
+      if(moveMovementNoisePatterns) {
+        //move down
+        shouldFallSt += vec2(0., fallShapeTime);
+      }
+
+      mediump float shouldFallNoise  = shapeNoise(shouldFallSt, fallShapeTime * moveShapeTimeAdjust, false);
+
+      shouldFall =  shouldFallNoise < shouldFallThreshold;
+      fallDirection = 1.;
+    }
 
 
-    bool shouldFall =  shouldFallNoise  < shouldFallThreshold || shouldFallNoise > 1. - shouldFallThreshold;
     shouldFall = shouldFall || waterfallMode || straightFallMode;
 
-    float fallDirection = shouldFallNoise  < 0.5 ? -1.0 : 1.0; //1.0 if hard code down;
+    
     // Override fall direction if vertical brush mode is active
     if (waterfallMode || straightFallMode) {
       fallDirection = fallDirectionOverride;
     }
-      
 
-    vec2 resetNoiseSt = blockingSt * u_resetNoiseScale;
-    mediump float resetNoise = structuralNoise(resetNoiseSt + 678.543, structuralMoveTime);
 
+    mediump float blackNoiseEdge = random(st.y + vec2(10.45)) * u_blackNoiseEdgeMult;
+
+
+    vec2 blockNoiseUV = (blockingSt + 0.5) / u_blocking;
+    vec4 blockNoiseVal = texture(u_blockNoiseTex, blockNoiseUV);
+
+
+    mediump float blackNoise = blockNoiseVal.g + blackNoiseEdge;
+    bool useBlack = blackNoise < u_blackNoiseThreshold;
+
+    mediump float ribbonNoise = blockNoiseVal.b - blackNoiseEdge;
+    bool useRibbon = ribbonNoise < u_useRibbonThreshold;
+    
+    bool horizontalGem = blockNoiseVal.g + blockNoiseVal.b > 1.;
+      
+    mediump float resetNoise = blockNoiseVal.r;
     bool willReset = resetNoise < u_resetThreshold + u_resetThresholdVariance;
 
     //EXTRA MOVES
 
-    vec2 extraMoveShapeSt = u_fxWithBlocking ? blockingSt : st;
-    float extraMoveTime = moveTime * u_moveShapeSpeed ;
+    bool inExtraMove = maskExtraMovesHorizontal;
 
-    if (u_shapeNoiseMode != SHAPE_NOISE_BLOCK_NOISE)
+    if (!useMovementMask) {
+      float extraMoveTime = moveTime * u_moveShapeSpeed * moveShapeTimeAdjust;
+      vec2 extraMoveShapeSt = u_fxWithBlocking ? blockingSt : st;
       extraMoveShapeSt *= u_extraMoveShapeScale;
 
-    if(moveMovementNoisePatterns) {
-      //extra move left/right
-      extraMoveShapeSt += vec2(extraMoveTime * direction, 0.952);
+      if(moveMovementNoisePatterns) {
+        //extra move left/right
+        extraMoveShapeSt += vec2(extraMoveTime * movementNoiseShapeDirection, 0.952);
+      }
+      mediump float extraMoveShape = shapeNoise((1.0 - extraMoveShapeSt), extraMoveTime, true);
+      inExtraMove = extraMoveShape < extraMoveShapeThreshold;
+
+      maskExtraHorizontalDirection = direction;
     }
 
-    mediump float extraMoveShape = shapeNoise(extraMoveShapeSt - 1.345, extraMoveTime);
+    inExtraMove = inExtraMove || shuffleMode;
 
     bool extraMoveStutter = random(floor(st * u_extraMoveStutterScale) + moveTime + 1.49) < u_extraMoveStutterThreshold;
-    bool inExtraMove = extraMoveShape < u_extraMoveShapeThreshold;
-    inExtraMove = inExtraMove || shuffleMode;
     bool extraMoves = extraMoveStutter && inExtraMove;
 
-    shouldMove = shouldMove || extraMoves;
-
-    if (shouldMove) {
+    if(useMovementMask) {
+      if(extraMoves && !shouldMove) {
+        //if using baked extra movement noise and not in a main move block, override move direction with extra horizontal direction
+        direction = maskExtraHorizontalDirection;
+      }
+    }
+      
+    if (shouldMove || extraMoves) {
       moveAmount = direction * moveSpeed * blockSize.x;
     }
 
@@ -539,27 +642,38 @@ void main() {
     float yFall = moveSpeed * blockSize.y;
 
     //EXTRA FALL
-    vec2 extraFallShapeSt = u_fxWithBlocking ? blockingSt : st;
-    
-    if (u_shapeNoiseMode != SHAPE_NOISE_BLOCK_NOISE)
+    bool inExtraFall = maskExtraMovesVertical;
+    if (!useMovementMask) {
+      vec2 extraFallShapeSt = u_fxWithBlocking ? blockingSt : st;
       extraFallShapeSt *= u_extraFallShapeScale;
+      float extraFallTime = moveTime * u_fallShapeSpeed * moveShapeTimeAdjust;
 
-    float extraFallTime = moveTime * u_fallShapeSpeed;
+      if(moveMovementNoisePatterns) {
+        //extra move down
+        extraFallShapeSt += vec2(0.268, extraFallTime);
+      }
+      mediump float extraFallShape = shapeNoise((1.0 - extraFallShapeSt) + 0.55, extraFallTime, false);
+      inExtraFall = extraFallShape < extraFallShapeThreshold;
 
-    if(moveMovementNoisePatterns) {
-      //extra move down
-      extraFallShapeSt += vec2(0.268, extraFallTime);
-    }
+      maskExtraVerticalDirection = fallDirection;
+    } 
 
-    mediump float extraFallShape = shapeNoise(extraFallShapeSt + 1.529, extraFallTime * 0.25);
-    bool extraFallStutter = random(floor(st * u_extraFallStutterScale) + moveTime + 2.) < u_extraFallStutterThreshold;
-    bool inExtraFall = extraFallShape < u_extraFallShapeThreshold;
     inExtraFall = inExtraFall || trickleMode;
+
+
+    bool extraFallStutter = random(floor(st * u_extraFallStutterScale) + moveTime + 2.) < u_extraFallStutterThreshold;
     bool extraFall = extraFallStutter && inExtraFall;
 
-    shouldFall = shouldFall || extraFall;
+    if(useMovementMask) {
+      //if using baked extra movement noise and not in a main fall block, override fall direction with extra vertical direction
+      if(extraFall && !shouldFall) {
+        fallDirection = maskExtraVerticalDirection;
+      }
+    }
+
+    if(shouldFall || extraFall) {
 
-    if(shouldFall) {
+      fallAmount = yFall;
       // Determine if this pixel uses waterfall variance:
       // - brush stroke: waterfallMode = variance, straightFallMode = no variance
       // - organic fall: use u_defaultWaterfallMode
@@ -570,12 +684,14 @@ void main() {
 
       if (useWaterfallVariance && u_fallWaterfallMult > 0.) {
         float waterX = u_fxWithBlocking ? blockingSt.x : floor(st.x * (u_resolution.x / 2.));
-        vec2 waterFallSt = vec2(waterX, floor(moveTime * .5));
-        float waterFallVariance = random(waterFallSt) * u_fallWaterfallMult;
-        waterFallSpeedMult = (u_fallWaterfallMult / 2.) * waterFallVariance;
+
+        vec2 waterFallSt = vec2(waterX, blockTime);
+
+        float waterFallVariance = (0.5 - random(waterFallSt)) * u_fallWaterfallMult;
+
+        fallAmount += yFall * 0.1 + yFall * waterFallVariance;
       }
 
-      fallAmount = yFall + yFall * waterFallSpeedMult;
       fallAmount *= fallDirection;
     }
 
@@ -632,21 +748,7 @@ void main() {
 
     vec4 initColor = vec4(1.);
 
-    mediump float blackNoiseEdge = random(st.y + vec2(10.45)) * u_blackNoiseEdgeMult;
-
-
-    vec2 blockNoiseUV = (blockingSt + 0.5) / u_blocking;
-    vec4 blockNoiseVal = texture(u_blockNoiseTex, blockNoiseUV);
-
-
-    mediump float blackNoise = blockNoiseVal.g + blackNoiseEdge;
-    bool useBlack = blackNoise < u_blackNoiseThreshold;
 
-    mediump float ribbonNoise = blockNoiseVal.b - blackNoiseEdge;
-    bool useRibbon = ribbonNoise < u_useRibbonThreshold;
-
-
-    bool horizontalGem = blockNoiseVal.g + blockNoiseVal.b > 1.;
 
     // Apply reset variant overrides (must happen before useBlank calculation)
     if (resetMode) {
@@ -666,8 +768,7 @@ void main() {
     }
 
     bool useBlankStatic = random(st * u_blankStaticScale + floor(
-      cos(moveTime * 10.123) * u_blankStaticTimeMult +
-      sin(moveTime * 1.05) * u_blankStaticTimeMult) + 1.) < u_blankStaticThreshold;
+      fract(moveTime * 10.123) * u_blankStaticTimeMult) + 1.) < u_blankStaticThreshold;
 
     bool useBlank = (useBlankStatic && !useRibbon) || useBlack;
 
@@ -693,9 +794,8 @@ void main() {
 
       vec2 dirtNoiseSt = floor(st * u_dirtNoiseScale);
       float rnd = random(dirtNoiseSt + blockTime);
-      float blockRnd = random(dirtNoiseSt + blockTime + 10.24);
 
-      bool useBlock = useRibbon && blockRnd < u_ribbonDirtThreshold;
+      bool useBlock = useRibbon && rnd < u_ribbonDirtThreshold;
 
       vec2 stPlus = ((st) / blockSize);
       if(useBlock) {
@@ -743,8 +843,6 @@ void main() {
       useReset = false;
     }
 
-    //TODO remove this, its for testing
-    useReset = true;
     // Sample from the previous state with the calculated coordinates
     vec4 color = texture(u_texture, st);
     // During the first 0.05 seconds after resize, show the gradient
diff --git a/src/engine/shaders/movementShape.frag b/src/engine/shaders/movementShape.frag
new file mode 100644
index 0000000..46fb572
--- /dev/null
+++ b/src/engine/shaders/movementShape.frag
@@ -0,0 +1,42 @@
+#version 300 es
+#ifdef GL_FRAGMENT_PRECISION_HIGH
+precision highp float;
+#else
+precision mediump float;
+#endif
+
+uniform float u_seed;
+uniform float u_blocking;
+uniform vec2 u_blackNoiseScale;
+uniform float u_structuralMoveTime;
+uniform float u_movementNoiseTime;
+uniform vec2 u_movementNoiseXYTime;
+uniform float u_domainWarpAmount;
+uniform int u_patternMode;
+uniform float u_patternStrength;
+uniform float u_patternFreq;
+uniform vec2 u_patternCenter;
+uniform float u_mirrorAmount;
+uniform int u_mirrorAxis;
+uniform vec2 u_movementShapeScaling;
+
+in vec2 v_texCoord;
+out vec4 fragColor;
+
+#include chunks/blockNoiseDomain.glsl;
+
+void main() {
+    float t = u_movementNoiseTime;
+
+    vec2 leftDomain = blockNoiseDomain(fract(v_texCoord * u_movementShapeScaling + vec2(u_movementNoiseXYTime.x, 0.0)));
+    vec2 rightDomain = blockNoiseDomain(fract(v_texCoord * u_movementShapeScaling + vec2(-u_movementNoiseXYTime.x, 0.0)));
+    vec2 downDomain = blockNoiseDomain(fract(v_texCoord * u_movementShapeScaling + vec2(0.0, u_movementNoiseXYTime.y)));
+    vec2 upDomain = blockNoiseDomain(fract(v_texCoord * u_movementShapeScaling + vec2(0.0, -u_movementNoiseXYTime.y)));
+
+    float leftNoise = structuralNoise(leftDomain, t);
+    float rightNoise = structuralNoise(rightDomain + vec2(11.31, 11.31), t);
+    float downNoise = structuralNoise(downDomain + vec2(173.29, 173.29), 1.1 + t);
+    float upNoise = structuralNoise(upDomain + vec2(111.11, 111.11), 1.1 + t);
+
+    fragColor = vec4(leftNoise, rightNoise, upNoise, downNoise);
+}
diff --git a/src/engine/types.ts b/src/engine/types.ts
index 666e391..1e34d77 100644
--- a/src/engine/types.ts
+++ b/src/engine/types.ts
@@ -26,20 +26,19 @@ export interface ShaderParams {
   fxWithBlocking: boolean;
   blockingScale: number;
   shouldMoveThreshold: number;
-  useMoveBlob: boolean;
   moveShapeSpeed: number;
   moveShapeScale: [number, number];
   shouldFallThreshold: number;
-  useFallBlob: boolean;
   fallShapeSpeed: number;
   shouldFallScale: [number, number];
   fallWaterfallMult: number;
   defaultWaterfallMode: boolean;
   blackNoiseThreshold: number;
+  useRibbonThreshold: number;
   blackNoiseScale: [number, number];
   blackNoiseEdgeMult: number;
   resetThreshold: number;
-  resetNoiseScale: [number, number];
+  // resetNoiseScale: [number, number];
   dirtNoiseScale: [number, number];
   blankStaticScale: [number, number];
   blankStaticThreshold: number;
@@ -54,6 +53,10 @@ export interface ShaderParams {
   patternCenter: [number, number];
   mirrorAmount: number;
   mirrorAxis: number;
+  movementShapeScaling: [number, number];
+  shapeNoiseMode: number;
+  movementNoiseShapeDirection: number;
+  blockNoiseDisableShapeMovement: boolean;
 }
 
 // --- Drawing Types ---
diff --git a/src/pages/canvas/CanvasOverlay.tsx b/src/pages/canvas/CanvasOverlay.tsx
index 36ce25b..04c5af0 100644
--- a/src/pages/canvas/CanvasOverlay.tsx
+++ b/src/pages/canvas/CanvasOverlay.tsx
@@ -1,4 +1,7 @@
-import { useMemo, useCallback, useEffect, useState, useRef, type PointerEvent as RPointerEvent, type MouseEvent as RMouseEvent, type ChangeEvent as RChangeEvent } from 'react';
+import {
+  useMemo, useCallback, useEffect, useState, useRef, type PointerEvent as RPointerEvent,
+  // type MouseEvent as RMouseEvent, type ChangeEvent as RChangeEvent
+} from 'react';
 import { useAtom } from 'jotai';
 import { useAccount } from '@solana/connector';
 import { MenuButton } from '../../components/ui/MenuButton';
@@ -7,7 +10,7 @@ import { useNavigate } from 'react-router';
 import { cn } from '../../utils/ui-helpers';
 import { OverlayTabs, type OverlayTab } from './OverlayTabs';
 import { NftBrowser, loadNftIntoEngine, loadNftIntoEngineAsync, loadSketchSeed } from './NftBrowser';
-import { XIcon, CaretLineLeft, CaretLineRight, ShuffleIcon, FloppyDiskIcon, CircleNotchIcon, ImageSquareIcon } from '@phosphor-icons/react';
+import { XIcon, CaretLineLeft, CaretLineRight, ShuffleIcon, FloppyDiskIcon, CircleNotchIcon } from '@phosphor-icons/react';
 import { SaveDialog } from './SaveDialog';
 import { useNftStore } from '../../hooks/useNftStore';
 import { useOverlay } from '../../hooks/useOverlay';
@@ -90,28 +93,28 @@ export function CanvasOverlay({ canvasBottom: _canvasBottom, engine, onClose, sh
   const isBrowsing = activeTab !== 'sketch' && browserItems.length > 0;
 
   const [saveDialogOpen, setSaveDialogOpen] = useState(false);
-  const uploadInputRef = useRef<HTMLInputElement>(null);
-
-  const handleUploadClick = useCallback((e: RMouseEvent) => {
-    e.stopPropagation();
-    uploadInputRef.current?.click();
-  }, []);
-
-  const handleUploadChange = useCallback(async (e: RChangeEvent<HTMLInputElement>) => {
-    const file = e.target.files?.[0];
-    e.target.value = '';
-    if (!file || !engine) return;
-    const url = URL.createObjectURL(file);
-    try {
-      await engine.loadImage(url);
-      console.log('[Upload] Image loaded into draft framebuffer');
-      onClose();
-    } catch (err) {
-      console.warn('[Upload] Failed to load image into engine:', err);
-    } finally {
-      URL.revokeObjectURL(url);
-    }
-  }, [engine, onClose]);
+  // const uploadInputRef = useRef<HTMLInputElement>(null);
+
+  // const handleUploadClick = useCallback((e: RMouseEvent) => {
+  //   e.stopPropagation();
+  //   uploadInputRef.current?.click();
+  // }, []);
+
+  // const handleUploadChange = useCallback(async (e: RChangeEvent<HTMLInputElement>) => {
+  //   const file = e.target.files?.[0];
+  //   e.target.value = '';
+  //   if (!file || !engine) return;
+  //   const url = URL.createObjectURL(file);
+  //   try {
+  //     await engine.loadImage(url);
+  //     console.log('[Upload] Image loaded into draft framebuffer');
+  //     onClose();
+  //   } catch (err) {
+  //     console.warn('[Upload] Failed to load image into engine:', err);
+  //   } finally {
+  //     URL.revokeObjectURL(url);
+  //   }
+  // }, [engine, onClose]);
 
   // --- On-chain update ---
   const [updateBusy, setUpdateBusy] = useState(false);

hook: SessionStart
hook: SessionStart Completed
codex
I’m reviewing this as a diff-only code review, so I’m focusing on issues directly evidenced in the changed lines rather than trying to infer runtime behavior beyond the patch.
codex
**Findings**

- `src/engine/shaders/blockNoise.frag:23`, `src/engine/shaders/movementShape.frag:24`  
  Severity: Critical  
  Issue: The shaders now use `#include chunks/blockNoiseDomain.glsl;`, but GLSL ES/WebGL does not support `#include` natively, and this diff does not add shader preprocessing. If the existing pipeline does not already expand includes, these shaders will fail to compile at runtime.  
  Suggested fix: Either inline the shared GLSL chunk into both shaders, or add/verify a build-time shader preprocessor and use its supported include syntax.

- `src/engine/shaders/main.frag:327,349`  
  Severity: Critical  
  Issue: Movement mask UVs are derived from `blockingSt`, but `blockingSt` is `st` when `u_fxWithBlocking` is false. Since most randomized params set `fxWithBlocking` false, `(blockingSt + 0.5) / u_blocking` samples only a tiny corner of `u_movementShapeTex`, making the movement mask nearly constant across the screen.  
  Suggested fix: Compute mask coordinates from `floor(st * u_blocking)` independently of `u_fxWithBlocking`, e.g. `vec2 maskBlockSt = floor(st * u_blocking); vec2 movementMaskUV = (maskBlockSt + 0.5) / u_blocking;`.

- `src/engine/parameters.ts:3`, `src/engine/renderer.ts:1083`  
  Severity: Warning  
  Issue: `SEED_MODULUS` changed from `1000` to `222`, and `loadState` normalizes saved seeds with the new modulus. Existing saved states/NFTs with seeds above 221 will load with a different runtime `seed`, changing procedural noise despite the compatibility goal.  
  Suggested fix: Keep the persisted seed modulus backward-compatible, or avoid re-normalizing loaded state seeds with the new modulus. If a smaller seed range is desired for new generation, apply it only when creating new seeds.

- `src/engine/shaders/main.frag:356-363`  
  Severity: Warning  
  Issue: The movement mask channel direction mapping appears reversed: `R=left` sets `maskHorizontalDirection = 1.0`, while `G=right` sets `-1.0`. This contradicts the stated channel encoding and the planned `G - R` direction logic.  
  Suggested fix: Swap the signs so left maps negative and right maps positive, unless the downstream sampling convention is intentionally inverted and documented.

- `src/engine/parameters.ts:327`  
  Severity: Warning  
  Issue: Newly randomized params never select the new movement-mask path because `ShapeNoiseMode.BlockNoise` has weight `0`, while `main.frag` only enables `useMovementMask` for `SHAPE_NOISE_BLOCK_NOISE`. The new FBO still renders every frame but is unused for new seeds.  
  Suggested fix: Restore a nonzero weight for `ShapeNoiseMode.BlockNoise`, or gate `renderMovementShapeMask` so it only runs when the active params actually use it.
tokens used
60,546
**Findings**

- `src/engine/shaders/blockNoise.frag:23`, `src/engine/shaders/movementShape.frag:24`  
  Severity: Critical  
  Issue: The shaders now use `#include chunks/blockNoiseDomain.glsl;`, but GLSL ES/WebGL does not support `#include` natively, and this diff does not add shader preprocessing. If the existing pipeline does not already expand includes, these shaders will fail to compile at runtime.  
  Suggested fix: Either inline the shared GLSL chunk into both shaders, or add/verify a build-time shader preprocessor and use its supported include syntax.

- `src/engine/shaders/main.frag:327,349`  
  Severity: Critical  
  Issue: Movement mask UVs are derived from `blockingSt`, but `blockingSt` is `st` when `u_fxWithBlocking` is false. Since most randomized params set `fxWithBlocking` false, `(blockingSt + 0.5) / u_blocking` samples only a tiny corner of `u_movementShapeTex`, making the movement mask nearly constant across the screen.  
  Suggested fix: Compute mask coordinates from `floor(st * u_blocking)` independently of `u_fxWithBlocking`, e.g. `vec2 maskBlockSt = floor(st * u_blocking); vec2 movementMaskUV = (maskBlockSt + 0.5) / u_blocking;`.

- `src/engine/parameters.ts:3`, `src/engine/renderer.ts:1083`  
  Severity: Warning  
  Issue: `SEED_MODULUS` changed from `1000` to `222`, and `loadState` normalizes saved seeds with the new modulus. Existing saved states/NFTs with seeds above 221 will load with a different runtime `seed`, changing procedural noise despite the compatibility goal.  
  Suggested fix: Keep the persisted seed modulus backward-compatible, or avoid re-normalizing loaded state seeds with the new modulus. If a smaller seed range is desired for new generation, apply it only when creating new seeds.

- `src/engine/shaders/main.frag:356-363`  
  Severity: Warning  
  Issue: The movement mask channel direction mapping appears reversed: `R=left` sets `maskHorizontalDirection = 1.0`, while `G=right` sets `-1.0`. This contradicts the stated channel encoding and the planned `G - R` direction logic.  
  Suggested fix: Swap the signs so left maps negative and right maps positive, unless the downstream sampling convention is intentionally inverted and documented.

- `src/engine/parameters.ts:327`  
  Severity: Warning  
  Issue: Newly randomized params never select the new movement-mask path because `ShapeNoiseMode.BlockNoise` has weight `0`, while `main.frag` only enables `useMovementMask` for `SHAPE_NOISE_BLOCK_NOISE`. The new FBO still renders every frame but is unused for new seeds.  
  Suggested fix: Restore a nonzero weight for `ShapeNoiseMode.BlockNoise`, or gate `renderMovementShapeMask` so it only runs when the active params actually use it.
