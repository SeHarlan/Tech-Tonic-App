import type { EngineConfig, EngineState, ShaderParams, DrawMode, Direction, EraseVariant } from './types';
import { mainVert, mainFrag, displayVert, displayFrag, blockNoiseVert, blockNoiseFrag, noiseVolumeVert, noiseVolumeFrag } from './shaders';
import { randomizeShaderParameters, normalizeSeed, SEED_MODULUS } from './parameters';
import { createDrawingManager, type DrawingManager } from './drawing';
import { captureScreenshot, captureScreenshotBase64, createVideoRecorder, type VideoRecorder } from './recording';
import { serializeState, loadStateIntoTextures, type SerializedState } from './state';

// --- Constants ---

const CANVAS_SCALE = 1.2;
const FIXED_CANVAS_WIDTH = 900 * CANVAS_SCALE;  // 1080
const FIXED_CANVAS_HEIGHT = 1600 * CANVAS_SCALE; // 1920
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
  isRunning(): boolean;

  captureScreenshot(): void;
  captureScreenshotBase64(): Promise<string>;
  startRecording(): void;
  stopRecording(): void;
  isRecording(): boolean;

  getCanvasDisplayRect(): { left: number; top: number; width: number; height: number };
}

// --- PLACEHOLDER: render loop and factory will follow in next edit ---
