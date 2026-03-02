import type { DrawMode, Direction, EraseVariant } from './types';
import drawVert from './shaders/draw.vert';
import drawFrag from './shaders/draw.frag';

// --- Types ---

export interface DrawingManager {
  drawAt(
    x: number,
    y: number,
    mode: DrawMode,
    direction: Direction,
    opts: DrawOpts,
  ): void;
  drawLine(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    mode: DrawMode,
    direction: Direction,
    opts: DrawOpts,
  ): void;
  clearAll(): void;
  getMovementTexture(): WebGLTexture;
  getPaintTexture(): WebGLTexture;
  getMovementFBO(): WebGLFramebuffer;
  getPaintFBO(): WebGLFramebuffer;
  setBrushSize(size: number): void;
  getBrushSize(): number;
  getBrushSizeIndex(): number;
  setBrushSizeIndex(index: number): void;
  getBrushSizeOptions(): number[];
  generateBrushSizeOptions(): void;
  increaseBrushSize(): void;
  decreaseBrushSize(): void;
  resize(width: number, height: number): void;
  destroy(): void;
}

export interface DrawOpts {
  waterfallVariant?: boolean;
  eraseVariant?: EraseVariant;
  blocking?: boolean;
  blockingScale?: number;
}

// --- Color Encoding ---

function isMovementMode(mode: DrawMode): boolean {
  return (
    mode === 'waterfall' ||
    mode === 'move' ||
    mode === 'trickle' ||
    mode === 'shuffle' ||
    mode === 'freeze' ||
    mode === 'erase'
  );
}

function isPaintMode(mode: DrawMode): boolean {
  return mode === 'static' || mode === 'gem' || mode === 'empty';
}

// R channel: <0.25=off, 0.25-0.5=shuffle, 0.5-0.75=move left, 0.75+=move right
// G channel: <0.25=off, 0.25-0.40=trickle, 0.40-0.55=straight down, 0.55-0.70=waterfall down, 0.70-0.85=straight up, 0.85+=waterfall up
// B channel: <0.25=off, 0.25+=freeze
function getMovementColor(
  mode: DrawMode,
  direction: Direction,
  waterfallVariant: boolean,
): [number, number, number] {
  if (mode === 'erase') return [0.0, 0.0, 0.0];

  let r = 0.0,
    g = 0.0,
    b = 0.0;

  // R channel (move/shuffle)
  if (mode === 'shuffle') {
    r = 0.375;
  } else if (mode === 'move') {
    r = direction === 'left' ? 0.875 : 0.625;
  }

  // G channel (waterfall/trickle/straight)
  if (mode === 'trickle') {
    g = 0.325;
  } else if (mode === 'waterfall') {
    if (direction === 'down') {
      g = waterfallVariant ? 0.625 : 0.475; // waterfall down : straight down
    } else {
      g = waterfallVariant ? 0.925 : 0.775; // waterfall up : straight up
    }
  }

  // B channel (freeze)
  if (mode === 'freeze') {
    b = 0.375;
  }

  return [r, g, b];
}

// R channel encodes variant: empty=0.5, static=0.75, gem=1.0
function getPaintColor(mode: DrawMode): [number, number, number] {
  switch (mode) {
    case 'empty':
      return [0.5, 0.0, 0.0];
    case 'static':
      return [0.75, 0.0, 0.0];
    case 'gem':
      return [1.0, 0.0, 0.0];
    default:
      return [0.25, 0.0, 0.0];
  }
}

// --- Shader Program Setup ---

interface DrawProgram {
  program: WebGLProgram;
  attribLocations: { position: number };
  uniformLocations: {
    resolution: WebGLUniformLocation | null;
    center: WebGLUniformLocation | null;
    radius: WebGLUniformLocation | null;
    color: WebGLUniformLocation | null;
    squareMode: WebGLUniformLocation | null;
  };
}

function createShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error('Draw shader compile error:', gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function setupDrawProgram(gl: WebGL2RenderingContext): DrawProgram | null {
  const vs = createShader(gl, gl.VERTEX_SHADER, drawVert);
  const fs = createShader(gl, gl.FRAGMENT_SHADER, drawFrag);
  if (!vs || !fs) return null;

  const program = gl.createProgram()!;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error(
      'Draw program link error:',
      gl.getProgramInfoLog(program),
    );
    gl.deleteProgram(program);
    return null;
  }

  return {
    program,
    attribLocations: {
      position: gl.getAttribLocation(program, 'a_position'),
    },
    uniformLocations: {
      resolution: gl.getUniformLocation(program, 'u_resolution'),
      center: gl.getUniformLocation(program, 'u_center'),
      radius: gl.getUniformLocation(program, 'u_radius'),
      color: gl.getUniformLocation(program, 'u_color'),
      squareMode: gl.getUniformLocation(program, 'u_squareMode'),
    },
  };
}

// --- FBO helper ---

function createFBOTexture(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
): { texture: WebGLTexture; fbo: WebGLFramebuffer } {
  const texture = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(
    gl.TEXTURE_2D, 0, gl.RGBA,
    width, height, 0,
    gl.RGBA, gl.UNSIGNED_BYTE, null,
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const fbo = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D, texture, 0,
  );

  return { texture, fbo };
}

// --- Factory ---

export function createDrawingManager(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
): DrawingManager {
  const drawProg = setupDrawProgram(gl);
  if (!drawProg) throw new Error('Failed to create drawing program');

  const vertexBuffer = gl.createBuffer()!;

  let movementTex: WebGLTexture;
  let movementFbo: WebGLFramebuffer;
  let paintTex: WebGLTexture;
  let paintFbo: WebGLFramebuffer;

  let canvasWidth = width;
  let canvasHeight = height;

  // Brush state
  let brushSizeOptions: number[] = [];
  let brushSizeIndex = 6;
  let brushSize = 0;

  function initBuffers(w: number, h: number) {
    // Movement buffer
    ({ texture: movementTex, fbo: movementFbo } = createFBOTexture(gl, w, h));
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // Paint buffer
    ({ texture: paintTex, fbo: paintFbo } = createFBOTexture(gl, w, h));
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  function genBrushSizeOptions() {
    const minDimension = Math.min(canvasWidth, canvasHeight);
    brushSizeOptions = [];

    const maxSize = minDimension / 4;
    const step = maxSize / 10;
    const smallestOption = step;

    brushSizeOptions.push(Math.max(1, smallestOption / 32));
    brushSizeOptions.push(Math.max(1, smallestOption / 16));
    brushSizeOptions.push(Math.max(1, smallestOption / 8));
    brushSizeOptions.push(Math.max(1, smallestOption / 4));
    brushSizeOptions.push(Math.max(1, smallestOption / 2));

    for (let i = 1; i <= 10; i++) {
      brushSizeOptions.push(i * step);
    }

    // Remove duplicates
    brushSizeOptions = [...new Set(brushSizeOptions)];

    brushSizeIndex = Math.min(6, brushSizeOptions.length - 1);
    brushSize = brushSizeOptions[brushSizeIndex];
  }

  // Initialize
  initBuffers(width, height);
  genBrushSizeOptions();

  // --- Drawing ---

  function drawAt(
    x: number,
    y: number,
    mode: DrawMode,
    direction: Direction,
    opts: DrawOpts,
  ) {
    const blocking = opts.blocking ?? false;
    const blockingScale = opts.blockingScale ?? 128;

    // Snap position to grid in blocking mode
    let radiusX = brushSize;
    let radiusY = brushSize;
    if (blocking) {
      const blockWidthPx = canvasWidth / blockingScale;
      const blockHeightPx = canvasHeight / blockingScale;
      const snapX = Math.min(blockWidthPx, Math.max(1, Math.floor(brushSize)));
      const snapY = Math.min(
        blockHeightPx,
        Math.max(1, Math.floor(brushSize * (blockHeightPx / blockWidthPx))),
      );
      x = Math.floor(x / snapX) * snapX + snapX / 2;
      y = Math.floor(y / snapY) * snapY + snapY / 2;
      radiusY = brushSize * (blockHeightPx / blockWidthPx);
    }

    const movementMode = isMovementMode(mode);
    const paintMode = isPaintMode(mode);

    // Build brush-sized quad vertices (clamp to canvas bounds)
    const left = Math.max(0, x - radiusX);
    const right = Math.min(canvasWidth, x + radiusX);
    const bottom = Math.max(0, y - radiusY);
    const top = Math.min(canvasHeight, y + radiusY);

    const vertices = new Float32Array([
      left, bottom, right, bottom, left, top, right, top,
    ]);

    gl.useProgram(drawProg.program);
    gl.viewport(0, 0, canvasWidth, canvasHeight);

    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(drawProg.attribLocations.position);
    gl.vertexAttribPointer(
      drawProg.attribLocations.position, 2, gl.FLOAT, false, 0, 0,
    );

    gl.uniform2f(drawProg.uniformLocations.resolution, canvasWidth, canvasHeight);
    gl.uniform2f(drawProg.uniformLocations.center, x, y);
    gl.uniform2f(drawProg.uniformLocations.radius, radiusX, radiusY);
    gl.uniform1f(drawProg.uniformLocations.squareMode, blocking ? 1.0 : 0.0);

    const eraseVariant = opts.eraseVariant ?? 'both';
    const waterfallVariant = opts.waterfallVariant ?? true;

    if (mode === 'erase') {
      gl.uniform3f(drawProg.uniformLocations.color, 0.0, 0.0, 0.0);

      if (eraseVariant === 'movement' || eraseVariant === 'both') {
        gl.colorMask(true, true, true, true);
        gl.bindFramebuffer(gl.FRAMEBUFFER, movementFbo);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
      if (eraseVariant === 'paint' || eraseVariant === 'both') {
        gl.colorMask(true, false, false, true);
        gl.bindFramebuffer(gl.FRAMEBUFFER, paintFbo);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
    } else if (movementMode) {
      const color = getMovementColor(mode, direction, waterfallVariant);
      gl.uniform3f(drawProg.uniformLocations.color, color[0], color[1], color[2]);

      // Channel isolation: R for horizontal, G for vertical, B always
      const writeR = mode === 'shuffle' || mode === 'move';
      const writeG = mode === 'waterfall' || mode === 'trickle';
      gl.colorMask(writeR, writeG, true, true);

      gl.bindFramebuffer(gl.FRAMEBUFFER, movementFbo);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      // Movement also clears paint
      gl.colorMask(true, false, false, true);
      gl.uniform3f(drawProg.uniformLocations.color, 0.0, 0.0, 0.0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, paintFbo);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    } else if (paintMode) {
      const color = getPaintColor(mode);
      gl.uniform3f(drawProg.uniformLocations.color, color[0], color[1], color[2]);
      gl.colorMask(true, false, false, true);

      gl.bindFramebuffer(gl.FRAMEBUFFER, paintFbo);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    // Reset state
    gl.colorMask(true, true, true, true);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  function drawLine(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    mode: DrawMode,
    direction: Direction,
    opts: DrawOpts,
  ) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const steps = Math.max(1, Math.floor(distance / (brushSize * 0.5)));

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      drawAt(x1 + dx * t, y1 + dy * t, mode, direction, opts);
    }
  }

  return {
    drawAt,
    drawLine,

    clearAll() {
      gl.bindFramebuffer(gl.FRAMEBUFFER, movementFbo);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      gl.bindFramebuffer(gl.FRAMEBUFFER, paintFbo);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    },

    getMovementTexture: () => movementTex,
    getPaintTexture: () => paintTex,
    getMovementFBO: () => movementFbo,
    getPaintFBO: () => paintFbo,

    setBrushSize(size: number) {
      brushSize = size;
    },
    getBrushSize: () => brushSize,
    getBrushSizeIndex: () => brushSizeIndex,
    setBrushSizeIndex(index: number) {
      brushSizeIndex = Math.max(0, Math.min(index, brushSizeOptions.length - 1));
      brushSize = brushSizeOptions[brushSizeIndex];
    },
    getBrushSizeOptions: () => brushSizeOptions,
    generateBrushSizeOptions: genBrushSizeOptions,

    increaseBrushSize() {
      if (brushSizeIndex < brushSizeOptions.length - 1) {
        brushSizeIndex++;
        brushSize = brushSizeOptions[brushSizeIndex];
      }
    },
    decreaseBrushSize() {
      if (brushSizeIndex > 0) {
        brushSizeIndex--;
        brushSize = brushSizeOptions[brushSizeIndex];
      }
    },

    resize(w: number, h: number) {
      canvasWidth = w;
      canvasHeight = h;

      // Recreate buffers at new size
      if (movementTex) gl.deleteTexture(movementTex);
      if (movementFbo) gl.deleteFramebuffer(movementFbo);
      if (paintTex) gl.deleteTexture(paintTex);
      if (paintFbo) gl.deleteFramebuffer(paintFbo);

      initBuffers(w, h);
      genBrushSizeOptions();
    },

    destroy() {
      gl.deleteTexture(movementTex);
      gl.deleteFramebuffer(movementFbo);
      gl.deleteTexture(paintTex);
      gl.deleteFramebuffer(paintFbo);
      gl.deleteBuffer(vertexBuffer);
      gl.deleteProgram(drawProg.program);
    },
  };
}
