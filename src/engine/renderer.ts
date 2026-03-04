import type { EngineConfig, EngineState, ShaderParams, DrawMode, Direction, EraseVariant } from './types';
import { mainVert, mainFrag, displayVert, displayFrag, blockNoiseVert, blockNoiseFrag, noiseVolumeVert, noiseVolumeFrag } from './shaders';
import { randomizeShaderParameters, normalizeSeed, SEED_MODULUS } from './parameters';
import { createDrawingManager, type DrawingManager } from './drawing';
import { captureScreenshot, captureScreenshotBase64, createVideoRecorder } from './recording';
import { serializeState, loadStateIntoTextures, type SerializedState } from './state';

// --- Constants ---

const CANVAS_SCALE = 1;
const FIXED_CANVAS_WIDTH = 1080 * CANVAS_SCALE;  
const FIXED_CANVAS_HEIGHT = 1920 * CANVAS_SCALE; 
const FIXED_PIXEL_RATIO_UNIFORM = 1.0;
const DEFAULT_TARGET_FPS = 60;
const NOISE_VOL_XY = 128;
const NOISE_VOL_Z = 64;

// Constants passed to shader but never randomized
const BASE_CHUNK_SIZE = 160;
const BLOCK_TIME_MULT = 0.05;
const STRUCTURAL_TIME_MULT = 0.01;
const MOVE_SPEED = 0.0045;
const RESET_EDGE_THRESHOLD = 0.33;
const RIBBON_DIRT_THRESHOLD = 0.9;
const USE_RIBBON_THRESHOLD = 0.33;
const USE_GRAYSCALE = false;
const BLANK_STATIC_THRESHOLD = 0.5;
const BLANK_STATIC_TIME_MULT = 2.0;
const BLANK_COLOR: [number, number, number] = [0, 0, 0];
const STATIC_COLOR_1: [number, number, number] = [1, 0, 0];
const STATIC_COLOR_2: [number, number, number] = [0, 1, 0];
const STATIC_COLOR_3: [number, number, number] = [0, 0, 1];
const USE_COLOR_CYCLE = true;
const CYCLE_COLOR_HUE_BASE_SPEED = 0.005;
const EXTRA_FALL_STUTTER_SCALE: [number, number] = [50.0, 500.01];
const EXTRA_MOVE_STUTTER_SCALE: [number, number] = [500.0, 50.01];
const EXTRA_FALL_STUTTER_THRESHOLD = 0.1;
const EXTRA_MOVE_STUTTER_THRESHOLD = 0.1;
const EXTRA_FALL_SHAPE_TIME_MULT = 0.025;

// --- Shader helper ---

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error('Shader compile error:', gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function linkProgram(gl: WebGL2RenderingContext, vertSrc: string, fragSrc: string): WebGLProgram | null {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vertSrc);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc);
  if (!vs || !fs) return null;

  const prog = gl.createProgram()!;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error('Program link error:', gl.getProgramInfoLog(prog));
    gl.deleteProgram(prog);
    return null;
  }
  return prog;
}

function createFBOTexture(gl: WebGL2RenderingContext, w: number, h: number) {
  const texture = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const fbo = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  return { texture, fbo };
}

// --- Engine Interface ---

export interface Engine {
  start(): void;
  stop(): void;
  destroy(): void;

  setSeed(seed: number): void;
  getSeed(): number;
  setGlobalFreeze(frozen: boolean): void;
  isGlobalFrozen(): boolean;
  setManualMode(manual: boolean): void;
  isManualMode(): boolean;
  forceReset(): void;

  serializeState(): Promise<SerializedState>;
  loadState(state: EngineState): Promise<void>;
  loadSession(seed: number, totalFrameCount: number, imageUrl: string): Promise<void>;

  getDrawingManager(): DrawingManager;

  handlePointerDown(canvasX: number, canvasY: number): void;
  handlePointerMove(canvasX: number, canvasY: number): void;
  handlePointerUp(): void;

  setDrawMode(mode: DrawMode): void;
  getDrawMode(): DrawMode;
  setDirection(dir: Direction): void;
  getDirection(): Direction;
  setWaterfallVariant(v: boolean): void;
  getWaterfallVariant(): boolean;
  setEraseVariant(v: EraseVariant): void;
  getEraseVariant(): EraseVariant;

  getParams(): ShaderParams;
  getTime(): number;
  getTotalFrameCount(): number;
  isRunning(): boolean;

  loadMovementBuffer(image: HTMLImageElement): void;

  captureScreenshot(): void;
  captureScreenshotBase64(): Promise<string>;
  startRecording(): void;
  stopRecording(): void;
  isRecording(): boolean;

  getCanvasDisplayRect(): { left: number; top: number; width: number; height: number };
}

// --- Factory ---

export function createEngine(config: EngineConfig): Engine {
  const { canvas, onFpsUpdate, onRecordingStop } = config;

  // --- WebGL2 Context ---

  const glResult = canvas.getContext('webgl2', {
    preserveDrawingBuffer: true,
    antialias: false,
  });
  if (!glResult) throw new Error('WebGL2 not supported');
  const gl: WebGL2RenderingContext = glResult;

  canvas.width = FIXED_CANVAS_WIDTH;
  canvas.height = FIXED_CANVAS_HEIGHT;
  gl.viewport(0, 0, canvas.width, canvas.height);

  // Crisp pixel rendering — no bilinear smoothing when canvas is scaled.
  // Firefox only supports -moz-crisp-edges; Chrome/Safari support pixelated.
  // Setting an unsupported value is a no-op, so try vendor prefix first.
  canvas.style.imageRendering = '-moz-crisp-edges';
  canvas.style.imageRendering = 'pixelated';

  // Prevent mobile browser gestures (pinch-zoom, scroll, pull-to-refresh)
  canvas.style.touchAction = 'none';

  // Remove inline-element baseline gap below canvas
  canvas.style.display = 'block';

  // --- Main Shader Program ---

  const mainProg = linkProgram(gl, mainVert, mainFrag);
  if (!mainProg) throw new Error('Failed to create main shader program');

  const mainAttr = {
    position: gl.getAttribLocation(mainProg, 'a_position'),
    texCoord: gl.getAttribLocation(mainProg, 'a_texCoord'),
  };

  const mainUnif = {
    displayFps: gl.getUniformLocation(mainProg, 'u_displayFps'),
    targetFps: gl.getUniformLocation(mainProg, 'u_targetFps'),
    frameCount: gl.getUniformLocation(mainProg, 'u_frameCount'),
    texture: gl.getUniformLocation(mainProg, 'u_texture'),
    resolution: gl.getUniformLocation(mainProg, 'u_resolution'),
    time: gl.getUniformLocation(mainProg, 'u_time'),
    pixelRatio: gl.getUniformLocation(mainProg, 'u_pixelDensity'),
    seed: gl.getUniformLocation(mainProg, 'u_seed'),
    baseChunkSize: gl.getUniformLocation(mainProg, 'u_baseChunkSize'),
    shouldMoveThreshold: gl.getUniformLocation(mainProg, 'u_shouldMoveThreshold'),
    moveSpeed: gl.getUniformLocation(mainProg, 'u_moveSpeed'),
    moveShapeScale: gl.getUniformLocation(mainProg, 'u_moveShapeScale'),
    moveShapeSpeed: gl.getUniformLocation(mainProg, 'u_moveShapeSpeed'),
    resetThreshold: gl.getUniformLocation(mainProg, 'u_resetThreshold'),
    resetEdgeThreshold: gl.getUniformLocation(mainProg, 'u_resetEdgeThreshold'),
    resetNoiseScale: gl.getUniformLocation(mainProg, 'u_resetNoiseScale'),
    shouldFallThreshold: gl.getUniformLocation(mainProg, 'u_shouldFallThreshold'),
    shouldFallScale: gl.getUniformLocation(mainProg, 'u_shouldFallScale'),
    fallShapeSpeed: gl.getUniformLocation(mainProg, 'u_fallShapeSpeed'),
    fxWithBlocking: gl.getUniformLocation(mainProg, 'u_fxWithBlocking'),
    blockTimeMult: gl.getUniformLocation(mainProg, 'u_blockTimeMult'),
    structuralTimeMult: gl.getUniformLocation(mainProg, 'u_structuralTimeMult'),
    extraMoveShapeThreshold: gl.getUniformLocation(mainProg, 'u_extraMoveShapeThreshold'),
    extraMoveStutterScale: gl.getUniformLocation(mainProg, 'u_extraMoveStutterScale'),
    extraMoveStutterThreshold: gl.getUniformLocation(mainProg, 'u_extraMoveStutterThreshold'),
    extraFallShapeThreshold: gl.getUniformLocation(mainProg, 'u_extraFallShapeThreshold'),
    extraFallShapeTimeMult: gl.getUniformLocation(mainProg, 'u_extraFallShapeTimeMult'),
    extraFallStutterScale: gl.getUniformLocation(mainProg, 'u_extraFallStutterScale'),
    extraFallStutterThreshold: gl.getUniformLocation(mainProg, 'u_extraFallStutterThreshold'),
    fallWaterfallMult: gl.getUniformLocation(mainProg, 'u_fallWaterfallMult'),
    extraFallShapeScale: gl.getUniformLocation(mainProg, 'u_extraFallShapeScale'),
    extraMoveShapeScale: gl.getUniformLocation(mainProg, 'u_extraMoveShapeScale'),
    blocking: gl.getUniformLocation(mainProg, 'u_blocking'),
    blackNoiseScale: gl.getUniformLocation(mainProg, 'u_blackNoiseScale'),
    blackNoiseEdgeMult: gl.getUniformLocation(mainProg, 'u_blackNoiseEdgeMult'),
    blackNoiseThreshold: gl.getUniformLocation(mainProg, 'u_blackNoiseThreshold'),
    useRibbonThreshold: gl.getUniformLocation(mainProg, 'u_useRibbonThreshold'),
    ribbonDirtThreshold: gl.getUniformLocation(mainProg, 'u_ribbonDirtThreshold'),
    dirtNoiseScale: gl.getUniformLocation(mainProg, 'u_dirtNoiseScale'),
    useGrayscale: gl.getUniformLocation(mainProg, 'u_useGrayscale'),
    useColorCycle: gl.getUniformLocation(mainProg, 'u_useColorCycle'),
    blankStaticScale: gl.getUniformLocation(mainProg, 'u_blankStaticScale'),
    blankStaticThreshold: gl.getUniformLocation(mainProg, 'u_blankStaticThreshold'),
    blankStaticTimeMult: gl.getUniformLocation(mainProg, 'u_blankStaticTimeMult'),
    blankColor: gl.getUniformLocation(mainProg, 'u_blankColor'),
    staticColor1: gl.getUniformLocation(mainProg, 'u_staticColor1'),
    staticColor2: gl.getUniformLocation(mainProg, 'u_staticColor2'),
    staticColor3: gl.getUniformLocation(mainProg, 'u_staticColor3'),
    cycleColorHueSpeed: gl.getUniformLocation(mainProg, 'u_cycleColorHueSpeed'),
    globalFreeze: gl.getUniformLocation(mainProg, 'u_globalFreeze'),
    forceReset: gl.getUniformLocation(mainProg, 'u_forceReset'),
    manualMode: gl.getUniformLocation(mainProg, 'u_manualMode'),
    defaultWaterfallMode: gl.getUniformLocation(mainProg, 'u_defaultWaterfallMode'),
    movementTexture: gl.getUniformLocation(mainProg, 'u_movementTexture'),
    paintTexture: gl.getUniformLocation(mainProg, 'u_paintTexture'),
    blockNoiseTex: gl.getUniformLocation(mainProg, 'u_blockNoiseTex'),
    noiseVolume: gl.getUniformLocation(mainProg, 'u_noiseVolume'),
  };

  // --- Display Program ---

  const dispProg = linkProgram(gl, displayVert, displayFrag);
  if (!dispProg) throw new Error('Failed to create display program');

  const dispAttr = {
    position: gl.getAttribLocation(dispProg, 'a_position'),
    texCoord: gl.getAttribLocation(dispProg, 'a_texCoord'),
  };
  const dispUnif = {
    texture: gl.getUniformLocation(dispProg, 'u_texture'),
  };

  // --- Block Noise Program ---

  const bnProg = linkProgram(gl, blockNoiseVert, blockNoiseFrag);
  if (!bnProg) throw new Error('Failed to create block noise program');

  const bnAttr = {
    position: gl.getAttribLocation(bnProg, 'a_position'),
    texCoord: gl.getAttribLocation(bnProg, 'a_texCoord'),
  };
  const bnUnif = {
    seed: gl.getUniformLocation(bnProg, 'u_seed'),
    blocking: gl.getUniformLocation(bnProg, 'u_blocking'),
    blackNoiseScale: gl.getUniformLocation(bnProg, 'u_blackNoiseScale'),
    structuralMoveTime: gl.getUniformLocation(bnProg, 'u_structuralMoveTime'),
    wrappingTime: gl.getUniformLocation(bnProg, 'u_wrappingTime'),
  };

  // --- Noise Volume Program ---

  const nvProg = linkProgram(gl, noiseVolumeVert, noiseVolumeFrag);
  if (!nvProg) throw new Error('Failed to create noise volume program');

  const nvAttr = {
    position: gl.getAttribLocation(nvProg, 'a_position'),
    texCoord: gl.getAttribLocation(nvProg, 'a_texCoord'),
  };
  const nvUnif = {
    seed: gl.getUniformLocation(nvProg, 'u_seed'),
    zSlice: gl.getUniformLocation(nvProg, 'u_zSlice'),
    texSize: gl.getUniformLocation(nvProg, 'u_texSize'),
  };

  // --- Geometry Buffers ---

  const vertexBuffer = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1, -1,  1, -1,  -1, 1,  1, 1,
  ]), gl.STATIC_DRAW);

  const texCoordBuffer = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    0, 0,  1, 0,  0, 1,  1, 1,
  ]), gl.STATIC_DRAW);

  // --- Ping-Pong Framebuffers ---

  const ppTextures: [WebGLTexture, WebGLTexture] = [null!, null!];
  const ppFBOs: [WebGLFramebuffer, WebGLFramebuffer] = [null!, null!];
  for (let i = 0; i < 2; i++) {
    const { texture, fbo } = createFBOTexture(gl, canvas.width, canvas.height);
    ppTextures[i] = texture;
    ppFBOs[i] = fbo;
  }
  let currentFbIndex = 0;

  // --- Block Noise FBO ---

  let blockNoiseTexture: WebGLTexture | null = null;
  let blockNoiseFBOHandle: WebGLFramebuffer | null = null;
  let blockNoiseSize = 0;

  function rebuildBlockNoiseFBO(bScale: number) {
    blockNoiseSize = Math.max(1, Math.ceil(bScale));
    if (blockNoiseTexture) gl.deleteTexture(blockNoiseTexture);
    if (blockNoiseFBOHandle) gl.deleteFramebuffer(blockNoiseFBOHandle);

    blockNoiseTexture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, blockNoiseTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, blockNoiseSize, blockNoiseSize, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    blockNoiseFBOHandle = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, blockNoiseFBOHandle);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, blockNoiseTexture, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  // --- 3D Noise Volume ---

  let noiseVolumeTexture: WebGLTexture | null = null;
  const noiseVolFBO = gl.createFramebuffer()!;

  function generateNoiseVolume() {
    if (!noiseVolumeTexture) {
      noiseVolumeTexture = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_3D, noiseVolumeTexture);
      gl.texImage3D(gl.TEXTURE_3D, 0, gl.R8, NOISE_VOL_XY, NOISE_VOL_XY, NOISE_VOL_Z, 0, gl.RED, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.REPEAT);
      gl.bindTexture(gl.TEXTURE_3D, null);
    }

    gl.useProgram(nvProg);
    gl.uniform1f(nvUnif.seed, seed);
    gl.uniform1f(nvUnif.texSize, NOISE_VOL_XY);

    gl.bindFramebuffer(gl.FRAMEBUFFER, noiseVolFBO);
    gl.viewport(0, 0, NOISE_VOL_XY, NOISE_VOL_XY);

    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.enableVertexAttribArray(nvAttr.position);
    gl.vertexAttribPointer(nvAttr.position, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
    gl.enableVertexAttribArray(nvAttr.texCoord);
    gl.vertexAttribPointer(nvAttr.texCoord, 2, gl.FLOAT, false, 0, 0);

    for (let z = 0; z < NOISE_VOL_Z; z++) {
      gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, noiseVolumeTexture, 0, z);
      gl.uniform1f(nvUnif.zSlice, z);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
  }

  // --- Drawing Manager ---

  const drawing = createDrawingManager(gl, canvas.width, canvas.height);

  // --- State ---

  let seed = normalizeSeed(config.seed ?? Math.floor(Math.random() * SEED_MODULUS));
  let params = randomizeShaderParameters(seed);
  let time = 0;
  let totalFrameCount = 0;
  let frameCount = 0;
  let currentFps = 0;
  let globalFreezeFlag = false;
  let manualModeFlag = false;
  let forceResetFlag = false;
  let forceResetFrames = 0;
  let running = false;
  let animFrameId = 0;
  let lastRenderTime = 0;
  let lastFpsUpdateTime = 0;
  const targetFps = DEFAULT_TARGET_FPS;
  const frameInterval = 1000 / targetFps;

  // Drawing input state
  let drawMode: DrawMode = 'waterfall';
  let direction: Direction = 'down';
  let waterfallVariant = false;
  let eraseVariant: EraseVariant = 'movement';
  let isPointerDown = false;
  let lastPointerX = 0;
  let lastPointerY = 0;

  // Video recorder
  const recorder = createVideoRecorder(canvas, onRecordingStop);

  // --- Initialize ---

  rebuildBlockNoiseFBO(params.blockingScale);
  generateNoiseVolume();
  drawing.generateBrushSizeOptions();

  // --- Apply Seed ---

  function applySeed(newSeed: number) {
    seed = normalizeSeed(newSeed);
    params = randomizeShaderParameters(seed);
    rebuildBlockNoiseFBO(params.blockingScale);
    generateNoiseVolume();
    drawing.generateBrushSizeOptions();
  }

  // --- Block Noise Render ---

  function renderBlockNoise(structuralMoveTime: number, wrappingTime: number) {
    if (!blockNoiseTexture || !blockNoiseFBOHandle) return;

    // Resize if blockingScale changed
    const neededSize = Math.max(1, Math.ceil(params.blockingScale));
    if (neededSize !== blockNoiseSize) {
      rebuildBlockNoiseFBO(params.blockingScale);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, blockNoiseFBOHandle);
    gl.viewport(0, 0, blockNoiseSize, blockNoiseSize);
    gl.useProgram(bnProg);

    gl.uniform1f(bnUnif.seed, seed);
    gl.uniform1f(bnUnif.blocking, params.blockingScale);
    gl.uniform2f(bnUnif.blackNoiseScale, params.blackNoiseScale[0], params.blackNoiseScale[1]);
    gl.uniform1f(bnUnif.structuralMoveTime, structuralMoveTime);
    gl.uniform1f(bnUnif.wrappingTime, wrappingTime);

    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.enableVertexAttribArray(bnAttr.position);
    gl.vertexAttribPointer(bnAttr.position, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
    gl.enableVertexAttribArray(bnAttr.texCoord);
    gl.vertexAttribPointer(bnAttr.texCoord, 2, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    gl.viewport(0, 0, canvas.width, canvas.height);
  }

  // --- Render ---

  function render() {
    const nextFbIndex = (currentFbIndex + 1) % 2;

    // Block noise pre-pass
    const moveTime = time * (targetFps / 30);
    const smt = manualModeFlag ? 0.0 : moveTime * STRUCTURAL_TIME_MULT;
    renderBlockNoise(smt, smt * 2);

    // Main compute pass — render to next framebuffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, ppFBOs[nextFbIndex]);
    gl.useProgram(mainProg);

    // Frame uniforms
    gl.uniform1f(mainUnif.targetFps, targetFps);
    gl.uniform1f(mainUnif.time, time);
    gl.uniform1f(mainUnif.frameCount, totalFrameCount);
    gl.uniform1f(mainUnif.displayFps, currentFps);
    gl.uniform2f(mainUnif.resolution, canvas.width, canvas.height);
    gl.uniform1f(mainUnif.pixelRatio, FIXED_PIXEL_RATIO_UNIFORM);
    gl.uniform1f(mainUnif.seed, seed);

    // Fixed constants
    gl.uniform1f(mainUnif.baseChunkSize, BASE_CHUNK_SIZE);
    gl.uniform1f(mainUnif.moveSpeed, MOVE_SPEED);
    gl.uniform1f(mainUnif.resetEdgeThreshold, RESET_EDGE_THRESHOLD);
    gl.uniform1f(mainUnif.blockTimeMult, BLOCK_TIME_MULT);
    gl.uniform1f(mainUnif.structuralTimeMult, STRUCTURAL_TIME_MULT);
    gl.uniform1f(mainUnif.useRibbonThreshold, USE_RIBBON_THRESHOLD);
    gl.uniform1f(mainUnif.ribbonDirtThreshold, RIBBON_DIRT_THRESHOLD);
    gl.uniform1i(mainUnif.useGrayscale, USE_GRAYSCALE ? 1 : 0);
    gl.uniform1i(mainUnif.useColorCycle, USE_COLOR_CYCLE ? 1 : 0);
    gl.uniform1f(mainUnif.blankStaticThreshold, BLANK_STATIC_THRESHOLD);
    gl.uniform1f(mainUnif.blankStaticTimeMult, BLANK_STATIC_TIME_MULT);
    gl.uniform3f(mainUnif.blankColor, BLANK_COLOR[0], BLANK_COLOR[1], BLANK_COLOR[2]);
    gl.uniform3f(mainUnif.staticColor1, STATIC_COLOR_1[0], STATIC_COLOR_1[1], STATIC_COLOR_1[2]);
    gl.uniform3f(mainUnif.staticColor2, STATIC_COLOR_2[0], STATIC_COLOR_2[1], STATIC_COLOR_2[2]);
    gl.uniform3f(mainUnif.staticColor3, STATIC_COLOR_3[0], STATIC_COLOR_3[1], STATIC_COLOR_3[2]);
    gl.uniform1f(mainUnif.cycleColorHueSpeed, CYCLE_COLOR_HUE_BASE_SPEED * (60 / targetFps));
    gl.uniform1f(mainUnif.extraFallShapeTimeMult, EXTRA_FALL_SHAPE_TIME_MULT);
    gl.uniform2f(mainUnif.extraFallStutterScale, EXTRA_FALL_STUTTER_SCALE[0], EXTRA_FALL_STUTTER_SCALE[1]);
    gl.uniform2f(mainUnif.extraMoveStutterScale, EXTRA_MOVE_STUTTER_SCALE[0], EXTRA_MOVE_STUTTER_SCALE[1]);
    gl.uniform1f(mainUnif.extraFallStutterThreshold, EXTRA_FALL_STUTTER_THRESHOLD);
    gl.uniform1f(mainUnif.extraMoveStutterThreshold, EXTRA_MOVE_STUTTER_THRESHOLD);

    // Manual mode: zero out autonomous thresholds
    const effMove = manualModeFlag ? 0.0 : params.shouldMoveThreshold;
    const effFall = manualModeFlag ? 0.0 : params.shouldFallThreshold;
    const effReset = manualModeFlag ? 0.0 : params.resetThreshold;
    const effExtraFall = manualModeFlag ? 0.0 : params.extraFallShapeThreshold;
    const effExtraMove = manualModeFlag ? 0.0 : params.extraMoveShapeThreshold;

    // Seed-derived params
    gl.uniform1f(mainUnif.shouldMoveThreshold, effMove);
    gl.uniform2f(mainUnif.moveShapeScale, params.moveShapeScale[0], params.moveShapeScale[1]);
    gl.uniform1f(mainUnif.moveShapeSpeed, params.moveShapeSpeed);
    gl.uniform1f(mainUnif.resetThreshold, effReset);
    gl.uniform2f(mainUnif.resetNoiseScale, params.resetNoiseScale[0], params.resetNoiseScale[1]);
    gl.uniform1f(mainUnif.shouldFallThreshold, effFall);
    gl.uniform2f(mainUnif.shouldFallScale, params.shouldFallScale[0], params.shouldFallScale[1]);
    gl.uniform1f(mainUnif.fallShapeSpeed, params.fallShapeSpeed);
    gl.uniform1f(mainUnif.fxWithBlocking, params.fxWithBlocking ? 1.0 : 0.0);
    gl.uniform1f(mainUnif.extraMoveShapeThreshold, effExtraMove);
    gl.uniform1f(mainUnif.extraFallShapeThreshold, effExtraFall);
    gl.uniform1f(mainUnif.fallWaterfallMult, params.fallWaterfallMult);
    gl.uniform2f(mainUnif.extraFallShapeScale, params.extraFallShapeScale[0], params.extraFallShapeScale[1]);
    gl.uniform2f(mainUnif.extraMoveShapeScale, params.extraMoveShapeScale[0], params.extraMoveShapeScale[1]);
    gl.uniform1f(mainUnif.blocking, params.blockingScale);
    gl.uniform2f(mainUnif.blackNoiseScale, params.blackNoiseScale[0], params.blackNoiseScale[1]);
    gl.uniform1f(mainUnif.blackNoiseEdgeMult, params.blackNoiseEdgeMult);
    gl.uniform1f(mainUnif.blackNoiseThreshold, params.blackNoiseThreshold);
    gl.uniform2f(mainUnif.dirtNoiseScale, params.dirtNoiseScale[0], params.dirtNoiseScale[1]);
    gl.uniform2f(mainUnif.blankStaticScale, params.blankStaticScale[0], params.blankStaticScale[1]);

    // State flags
    gl.uniform1f(mainUnif.globalFreeze, globalFreezeFlag ? 1.0 : 0.0);
    gl.uniform1f(mainUnif.forceReset, forceResetFlag ? 1.0 : 0.0);
    gl.uniform1f(mainUnif.manualMode, manualModeFlag ? 1.0 : 0.0);
    gl.uniform1f(mainUnif.defaultWaterfallMode, params.defaultWaterfallMode ? 1.0 : 0.0);

    // Bind movement texture → TEXTURE1
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, drawing.getMovementTexture());
    gl.uniform1i(mainUnif.movementTexture, 1);

    // Bind paint texture → TEXTURE4
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, drawing.getPaintTexture());
    gl.uniform1i(mainUnif.paintTexture, 4);

    // Bind block noise texture → TEXTURE2
    if (blockNoiseTexture) {
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, blockNoiseTexture);
      gl.uniform1i(mainUnif.blockNoiseTex, 2);
    }

    // Bind 3D noise volume → TEXTURE3
    if (noiseVolumeTexture) {
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_3D, noiseVolumeTexture);
      gl.uniform1i(mainUnif.noiseVolume, 3);
    }

    // Bind previous frame → TEXTURE0
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, ppTextures[currentFbIndex]);
    gl.uniform1i(mainUnif.texture, 0);

    // Draw full-screen quad
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.enableVertexAttribArray(mainAttr.position);
    gl.vertexAttribPointer(mainAttr.position, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
    gl.enableVertexAttribArray(mainAttr.texCoord);
    gl.vertexAttribPointer(mainAttr.texCoord, 2, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // Display blit pass — render to screen
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.useProgram(dispProg);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, ppTextures[nextFbIndex]);
    gl.uniform1i(dispUnif.texture, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.enableVertexAttribArray(dispAttr.position);
    gl.vertexAttribPointer(dispAttr.position, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
    gl.enableVertexAttribArray(dispAttr.texCoord);
    gl.vertexAttribPointer(dispAttr.texCoord, 2, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // Swap ping-pong index
    currentFbIndex = nextFbIndex;

    // Recording tick
    recorder.tick();
  }

  // --- Animate Loop ---

  function animate() {
    const now = performance.now();
    const elapsed = now - lastRenderTime;

    if (elapsed < frameInterval) {
      animFrameId = requestAnimationFrame(animate);
      return;
    }
    // Carry over leftover time to reduce drift
    lastRenderTime = now - (elapsed % frameInterval);

    // Advance deterministic time only when not frozen
    if (!globalFreezeFlag) {
      time = totalFrameCount / targetFps;
      frameCount++;
      totalFrameCount++;
    }

    // Handle force-reset countdown
    if (forceResetFrames > 0) {
      forceResetFrames--;
      if (forceResetFrames <= 0) {
        forceResetFlag = false;
      }
    }

    render();

    // FPS tracking
    const fpsElapsed = now - lastFpsUpdateTime;
    if (fpsElapsed >= 1000) {
      currentFps = Math.round((frameCount * 1000) / fpsElapsed);
      frameCount = 0;
      lastFpsUpdateTime = now;
      onFpsUpdate?.(currentFps);
    }

    animFrameId = requestAnimationFrame(animate);
  }

  // --- Engine Object ---

  const engine: Engine = {
    start() {
      if (running) return;
      running = true;
      lastRenderTime = performance.now();
      lastFpsUpdateTime = performance.now();
      animFrameId = requestAnimationFrame(animate);
    },

    stop() {
      running = false;
      cancelAnimationFrame(animFrameId);
    },

    destroy() {
      engine.stop();
      recorder.destroy();
      drawing.destroy();
      gl.deleteProgram(mainProg);
      gl.deleteProgram(dispProg);
      gl.deleteProgram(bnProg);
      gl.deleteProgram(nvProg);
      for (let i = 0; i < 2; i++) {
        gl.deleteTexture(ppTextures[i]);
        gl.deleteFramebuffer(ppFBOs[i]);
      }
      if (blockNoiseTexture) gl.deleteTexture(blockNoiseTexture);
      if (blockNoiseFBOHandle) gl.deleteFramebuffer(blockNoiseFBOHandle);
      if (noiseVolumeTexture) gl.deleteTexture(noiseVolumeTexture);
      gl.deleteFramebuffer(noiseVolFBO);
      gl.deleteBuffer(vertexBuffer);
      gl.deleteBuffer(texCoordBuffer);
    },

    setSeed(newSeed: number) {
      applySeed(newSeed);

      // Clear both ping-pong framebuffers completely
      for (let i = 0; i < 2; i++) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, ppFBOs[i]);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);

      // Clear drawing buffers (movement + paint)
      drawing.clearAll();

      // Reset time and pointer state
      time = 0;
      totalFrameCount = 0;
      isPointerDown = false;
    },
    getSeed() { return seed; },

    setGlobalFreeze(frozen: boolean) { globalFreezeFlag = frozen; },
    isGlobalFrozen() { return globalFreezeFlag; },

    setManualMode(manual: boolean) { manualModeFlag = manual; },
    isManualMode() { return manualModeFlag; },

    forceReset() {
      forceResetFlag = true;
      forceResetFrames = 3;

      // Clear drawing buffers (movement + paint)
      drawing.clearAll();

      // Clear both ping-pong framebuffers
      for (let i = 0; i < 2; i++) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, ppFBOs[i]);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);

      // Reset time
      time = 0;
      totalFrameCount = 0;

      // Clear pointer state to prevent stuck strokes
      isPointerDown = false;
    },

    async serializeState() {
      return serializeState(
        gl, canvas,
        ppTextures[currentFbIndex],
        drawing.getMovementTexture(),
        drawing.getPaintTexture(),
        time, totalFrameCount, seed, params,
      );
    },

    async loadState(state) {
      seed = normalizeSeed(state.seed);
      params = state.params;
      time = state.time;
      totalFrameCount = state.totalFrameCount;

      // Convert Blobs to object URLs for image loading
      const toSrc = (buf: Blob | HTMLImageElement) =>
        buf instanceof Blob ? URL.createObjectURL(buf) : buf;

      const imgSrc = toSrc(state.imageBuffer);
      const movSrc = toSrc(state.movementBuffer);
      const paintSrc = toSrc(state.paintBuffer);

      await loadStateIntoTextures(
        gl,
        canvas.width,
        canvas.height,
        { imageBufferSrc: imgSrc, movementBufferSrc: movSrc, paintBufferSrc: paintSrc },
        {
          framebufferTextures: ppTextures,
          movementTexture: drawing.getMovementTexture(),
          paintTexture: drawing.getPaintTexture(),
        },
      );

      // Revoke object URLs if we created them
      if (typeof imgSrc === 'string') URL.revokeObjectURL(imgSrc);
      if (typeof movSrc === 'string') URL.revokeObjectURL(movSrc);
      if (typeof paintSrc === 'string') URL.revokeObjectURL(paintSrc);

      rebuildBlockNoiseFBO(params.blockingScale);
      generateNoiseVolume();
    },

    async loadSession(newSeed: number, newTotalFrameCount: number, imageUrl: string) {
      // Set seed & recompute params
      seed = normalizeSeed(newSeed);
      params = randomizeShaderParameters(seed);

      // Set time
      totalFrameCount = newTotalFrameCount;
      time = totalFrameCount / targetFps;

      // Load PNG into an HTMLImageElement
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.crossOrigin = 'anonymous';
        el.onload = () => resolve(el);
        el.onerror = reject;
        el.src = imageUrl;
      });

      // Load image into both ping-pong framebuffer textures
      for (const tex of ppTextures) {
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      }

      // Clear movement and paint textures (no drawing data to restore)
      const blank = new Uint8Array(canvas.width * canvas.height * 4);
      gl.bindTexture(gl.TEXTURE_2D, drawing.getMovementTexture());
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, canvas.width, canvas.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, blank);
      gl.bindTexture(gl.TEXTURE_2D, drawing.getPaintTexture());
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, canvas.width, canvas.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, blank);
      gl.bindTexture(gl.TEXTURE_2D, null);

      // Rebuild dependent resources
      rebuildBlockNoiseFBO(params.blockingScale);
      generateNoiseVolume();

      // Clear pointer state
      isPointerDown = false;
    },

    loadMovementBuffer(image: HTMLImageElement) {
      // Flip vertically: WebGL uses bottom-left origin, images use top-left
      const flipCanvas = document.createElement('canvas');
      flipCanvas.width = canvas.width;
      flipCanvas.height = canvas.height;
      const ctx = flipCanvas.getContext('2d')!;
      ctx.translate(0, flipCanvas.height);
      ctx.scale(1, -1);
      ctx.drawImage(image, 0, 0, flipCanvas.width, flipCanvas.height);

      gl.bindTexture(gl.TEXTURE_2D, drawing.getMovementTexture());
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, flipCanvas);
      gl.bindTexture(gl.TEXTURE_2D, null);
    },

    getDrawingManager() { return drawing; },

    handlePointerDown(canvasX: number, canvasY: number) {
      isPointerDown = true;
      lastPointerX = canvasX;
      lastPointerY = canvasY;
      drawing.drawAt(canvasX, canvasY, drawMode, direction, {
        waterfallVariant,
        eraseVariant,
        blocking: params.fxWithBlocking,
        blockingScale: params.blockingScale,
      });
    },

    handlePointerMove(canvasX: number, canvasY: number) {
      if (!isPointerDown) return;
      drawing.drawLine(lastPointerX, lastPointerY, canvasX, canvasY, drawMode, direction, {
        waterfallVariant,
        eraseVariant,
        blocking: params.fxWithBlocking,
        blockingScale: params.blockingScale,
      });
      lastPointerX = canvasX;
      lastPointerY = canvasY;
    },

    handlePointerUp() {
      isPointerDown = false;
    },

    setDrawMode(mode: DrawMode) { drawMode = mode; },
    getDrawMode() { return drawMode; },
    setDirection(dir: Direction) { direction = dir; },
    getDirection() { return direction; },
    setWaterfallVariant(v: boolean) { waterfallVariant = v; },
    getWaterfallVariant() { return waterfallVariant; },
    setEraseVariant(v: EraseVariant) { eraseVariant = v; },
    getEraseVariant() { return eraseVariant; },

    getParams() { return params; },
    getTime() { return time; },
    getTotalFrameCount() { return totalFrameCount; },
    isRunning() { return running; },

    captureScreenshot() {
      captureScreenshot(gl, canvas, ppTextures[currentFbIndex]);
    },
    async captureScreenshotBase64() {
      return captureScreenshotBase64(gl, canvas, ppTextures[currentFbIndex]);
    },
    startRecording() { recorder.start(); },
    stopRecording() { recorder.stop(); },
    isRecording() { return recorder.isRecording(); },

    getCanvasDisplayRect() {
      const rect = canvas.getBoundingClientRect();
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    },
  };

  // Load initial state if provided
  if (config.initialState) {
    engine.loadState(config.initialState).catch((err) => {
      console.error('Failed to load initial engine state:', err);
    });
  }

  return engine;
}
