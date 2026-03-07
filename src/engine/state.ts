import type { ShaderParams } from './types';

// --- Serialized State ---

export interface SerializedState {
  seed: number;
  totalFrameCount: number;
  params: ShaderParams;
  imageBuffer: Blob;     // PNG — main simulation framebuffer
  movementBuffer: Blob;  // PNG — persistent movement/freeze brush data
  paintBuffer: Blob;     // PNG — persistent paint brush data
}

// --- Read texture to PNG ---

async function readTextureToPNG(
  gl: WebGL2RenderingContext,
  canvas: HTMLCanvasElement,
  texture: WebGLTexture,
): Promise<Blob> {
  const width = canvas.width;
  const height = canvas.height;
  const pixels = new Uint8Array(width * height * 4);

  // Bind texture to temporary framebuffer and read pixels
  const tempFb = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, tempFb);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D, texture, 0,
  );
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.deleteFramebuffer(tempFb);

  // Flip vertically (WebGL bottom-left origin) and encode as PNG
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = width;
  tempCanvas.height = height;
  const ctx = tempCanvas.getContext('2d')!;
  const imageData = ctx.createImageData(width, height);
  for (let y = 0; y < height; y++) {
    const src = y * width * 4;
    const dst = (height - 1 - y) * width * 4;
    imageData.data.set(pixels.subarray(src, src + width * 4), dst);
  }
  ctx.putImageData(imageData, 0, 0);

  return new Promise((resolve) =>
    tempCanvas.toBlob((blob) => resolve(blob!), 'image/png'),
  );
}

// --- Serialize ---

// Captures current engine state as serializable blobs.
// Sequential (not parallel) to avoid holding 3x ~8MB buffers simultaneously.
export async function serializeState(
  gl: WebGL2RenderingContext,
  canvas: HTMLCanvasElement,
  framebufferTexture: WebGLTexture,
  movementTexture: WebGLTexture,
  paintTexture: WebGLTexture,
  totalFrameCount: number,
  seed: number,
  params: ShaderParams,
): Promise<SerializedState> {
  const imageBuffer = await readTextureToPNG(gl, canvas, framebufferTexture);
  const movementBuffer = await readTextureToPNG(gl, canvas, movementTexture);
  const paintBuffer = await readTextureToPNG(gl, canvas, paintTexture);

  return { seed, totalFrameCount, params, imageBuffer, movementBuffer, paintBuffer };
}

// --- Load state into textures ---

// Called at startup from saved NFT or standalone URL.
export async function loadStateIntoTextures(
  gl: WebGL2RenderingContext,
  expectedWidth: number,
  expectedHeight: number,
  state: {
    imageBufferSrc: string | HTMLImageElement;
    movementBufferSrc: string | HTMLImageElement;
    paintBufferSrc: string | HTMLImageElement;
  },
  targets: {
    framebufferTextures: [WebGLTexture, WebGLTexture]; // both ping-pong textures
    movementTexture: WebGLTexture;
    paintTexture: WebGLTexture;
  },
): Promise<void> {
  const loadImage = (src: string | HTMLImageElement): Promise<HTMLImageElement> => {
    if (src instanceof HTMLImageElement) return Promise.resolve(src);
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  };

  const [imageImg, movementImg, paintImg] = await Promise.all([
    loadImage(state.imageBufferSrc),
    loadImage(state.movementBufferSrc),
    loadImage(state.paintBufferSrc),
  ]);

  // Validate dimensions
  const buffers = [
    { name: 'imageBuffer', img: imageImg },
    { name: 'movementBuffer', img: movementImg },
    { name: 'paintBuffer', img: paintImg },
  ];
  for (const { name, img } of buffers) {
    if (img.naturalWidth !== expectedWidth || img.naturalHeight !== expectedHeight) {
      console.error(
        `State load error: ${name} dimensions ${img.naturalWidth}x${img.naturalHeight} ` +
        `do not match expected ${expectedWidth}x${expectedHeight}. ` +
        `Buffer data may be corrupted or from a different canvas size.`,
      );
    }
  }

  // Flip image vertically for WebGL (readTextureToPNG saves as standard
  // top-left-origin PNG, but WebGL textures use bottom-left origin).
  const flipForGL = (img: HTMLImageElement): HTMLCanvasElement => {
    const c = document.createElement('canvas');
    c.width = expectedWidth;
    c.height = expectedHeight;
    const ctx = c.getContext('2d')!;
    ctx.translate(0, c.height);
    ctx.scale(1, -1);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return c;
  };

  const flippedImage = flipForGL(imageImg);
  const flippedMovement = flipForGL(movementImg);
  const flippedPaint = flipForGL(paintImg);

  // Load image into BOTH ping-pong framebuffer textures.
  // The ping-pong alternates which texture is read each frame —
  // if only one is loaded, the other shows garbage every other cycle.
  for (const tex of targets.framebufferTextures) {
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, flippedImage);
  }

  // Movement and paint are single textures (no ping-pong)
  gl.bindTexture(gl.TEXTURE_2D, targets.movementTexture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, flippedMovement);

  gl.bindTexture(gl.TEXTURE_2D, targets.paintTexture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, flippedPaint);

  gl.bindTexture(gl.TEXTURE_2D, null);
}
