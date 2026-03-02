// --- Constants ---

const CYCLE_COLOR_HUE_BASE_SPEED = 0.005;
const DEFAULT_TARGET_FPS = 60;

export const RECORD_DURATION_FRAMES = 1 / CYCLE_COLOR_HUE_BASE_SPEED; // 200 frames
export const RECORD_DURATION_SECONDS = RECORD_DURATION_FRAMES / DEFAULT_TARGET_FPS;
export const RECORD_BITRATE = 50_000_000; // 50 Mbps

// --- Screenshot ---

export function captureScreenshot(
  gl: WebGL2RenderingContext,
  canvas: HTMLCanvasElement,
  currentTexture: WebGLTexture | null,
): void {
  gl.viewport(0, 0, canvas.width, canvas.height);

  const pixels = new Uint8Array(canvas.width * canvas.height * 4);

  // Try reading from screen first
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

  // Fallback: read from texture if screen read failed (all zeros)
  if (!pixels.some((p) => p !== 0) && currentTexture) {
    const tempFb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, tempFb);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D, currentTexture, 0,
    );
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(tempFb);
  }

  // Create temp canvas and flip vertically (WebGL origin is bottom-left)
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = canvas.width;
  tempCanvas.height = canvas.height;
  const ctx = tempCanvas.getContext('2d');
  if (!ctx) {
    console.error('Failed to get 2D context for screenshot');
    return;
  }

  const imageData = ctx.createImageData(canvas.width, canvas.height);
  for (let y = 0; y < canvas.height; y++) {
    const srcRow = y * canvas.width * 4;
    const dstRow = (canvas.height - 1 - y) * canvas.width * 4;
    imageData.data.set(pixels.subarray(srcRow, srcRow + canvas.width * 4), dstRow);
  }
  ctx.putImageData(imageData, 0, 0);

  // Download
  tempCanvas.toBlob((blob) => {
    if (!blob) {
      console.error('Failed to create screenshot blob');
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `screenshot-${Date.now()}.png`;
    a.click();
    URL.revokeObjectURL(url);
  }, 'image/png');
}

// --- Screenshot as Base64 (for asset generation) ---

export async function captureScreenshotBase64(
  gl: WebGL2RenderingContext,
  canvas: HTMLCanvasElement,
  currentTexture: WebGLTexture | null,
): Promise<string> {
  gl.viewport(0, 0, canvas.width, canvas.height);

  const pixels = new Uint8Array(canvas.width * canvas.height * 4);

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

  if (!pixels.some((p) => p !== 0) && currentTexture) {
    const tempFb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, tempFb);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D, currentTexture, 0,
    );
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(tempFb);
  }

  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = canvas.width;
  tempCanvas.height = canvas.height;
  const ctx = tempCanvas.getContext('2d')!;

  const imageData = ctx.createImageData(canvas.width, canvas.height);
  for (let y = 0; y < canvas.height; y++) {
    const srcRow = y * canvas.width * 4;
    const dstRow = (canvas.height - 1 - y) * canvas.width * 4;
    imageData.data.set(pixels.subarray(srcRow, srcRow + canvas.width * 4), dstRow);
  }
  ctx.putImageData(imageData, 0, 0);

  return tempCanvas.toDataURL('image/png');
}

// --- Video Recorder ---

export interface VideoRecorder {
  isRecording(): boolean;
  start(): void;
  stop(): void;
  /** Call once per frame from the render loop. Auto-stops after RECORD_DURATION_FRAMES. */
  tick(): void;
  destroy(): void;
}

export function createVideoRecorder(
  canvas: HTMLCanvasElement,
  onStop?: (blob: Blob, extension: string) => void,
): VideoRecorder {
  let mediaRecorder: MediaRecorder | null = null;
  let recordedChunks: Blob[] = [];
  let recording = false;
  let framesRemaining = 0;
  let mimeType = 'video/webm';
  let fileExt = 'webm';

  function start() {
    if (recording) return;

    const stream = canvas.captureStream();
    recordedChunks = [];

    // Pick best available format (prefer MP4/H.264 for QuickTime compatibility)
    const formats = [
      'video/mp4; codecs=avc1.42E01E',
      'video/mp4',
      'video/webm; codecs=vp9',
      'video/webm',
    ];
    mimeType = formats.find((f) => MediaRecorder.isTypeSupported(f)) || 'video/webm';
    fileExt = mimeType.startsWith('video/mp4') ? 'mp4' : 'webm';

    mediaRecorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: RECORD_BITRATE,
    });

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) recordedChunks.push(e.data);
    };

    mediaRecorder.onstop = () => {
      const blob = new Blob(recordedChunks, { type: mimeType });

      if (onStop) {
        onStop(blob, fileExt);
      } else {
        // Default: download
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `recording-${Date.now()}.${fileExt}`;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }, 1000);
      }

      mediaRecorder = null;
      recordedChunks = [];
    };

    mediaRecorder.start();
    recording = true;
    framesRemaining = RECORD_DURATION_FRAMES;
  }

  function stop() {
    if (!recording) return;
    recording = false;

    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }
  }

  return {
    isRecording: () => recording,
    start,
    stop,
    tick() {
      if (!recording) return;
      framesRemaining--;
      if (framesRemaining <= 0) {
        stop();
      }
    },
    destroy() {
      stop();
    },
  };
}
