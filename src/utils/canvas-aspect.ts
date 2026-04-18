// getBoundingClientRect (floats) vs clientWidth/Height (rounded ints): the
// former preserves intrinsic aspect exactly for replaced elements, the latter
// false-positives on fractional layout sizes. Fullscreen stretch deviates by
// double-digit percentages, so 0.5% cleanly separates normal from stretched.
const ASPECT_TOLERANCE = 0.005;

/**
 * Convert a screen-space (client) point to engine canvas coordinates
 * (bottom-origin Y-flipped for non-rotated, direct mapping for rotated).
 * Rotated = canvas CSS `transform: rotate(90deg)` (portrait viewport) —
 * screen X spans canvas Y, screen Y spans canvas X.
 */
export function clientToCanvas(
  clientX: number,
  clientY: number,
  canvas: HTMLCanvasElement,
  rotated: boolean,
): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  if (rotated) {
    return {
      x: canvas.width * ((clientY - rect.top) / rect.height),
      y: canvas.height * ((clientX - rect.left) / rect.width),
    };
  }
  return {
    x: (clientX - rect.left) * (canvas.width / rect.width),
    y: canvas.height - (clientY - rect.top) * (canvas.height / rect.height),
  };
}

export function assertSaveableCanvasAspect(canvas: HTMLCanvasElement, rotated = false): void {
  const rect = canvas.getBoundingClientRect();
  const displayW = rect.width;
  const displayH = rect.height;
  // When the canvas is CSS-rotated 90°, its bounding box is the native rect
  // with W/H swapped, so swap native dims for the aspect check.
  const nativeW = rotated ? canvas.height : canvas.width;
  const nativeH = rotated ? canvas.width : canvas.height;
  const lhs = displayW * nativeH;
  const rhs = displayH * nativeW;
  const tolerance = Math.max(lhs, rhs) * ASPECT_TOLERANCE;
  if (Math.abs(lhs - rhs) > tolerance) {
    throw new Error(
      `Cannot save: canvas aspect mismatch (display ${displayW.toFixed(1)}x${displayH.toFixed(1)}, native ${nativeW}x${nativeH}).`,
    );
  }
}
