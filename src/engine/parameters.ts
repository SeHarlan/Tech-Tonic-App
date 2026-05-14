import type { ShaderParams } from './types';

export const SEED_MODULUS = 222; //above ~300 start effecting noise shapes way too much

// --- Shape Noise Mode ---
// Noise algorithm used for waterfall + move (left/right) shapes.
// Values must match #define constants in main.frag.
export const ShapeNoiseMode = {
  // Current: 0,       // trilinear 3D noise volume (C0 — sharp grid angles)
  // FbmQuintic: 1,    // 4-octave FBM of quintic-smoothed 2D noise
  // Metaballs: 2,     // animated metaballs with smooth-min union
  StructuralQuintic: 3, // 3D volume re-sampled with quintic Hermite (C2)
  BlockNoise: 4,        // direct read from u_blockNoiseTex (R channel)
} as const;
export type ShapeNoiseMode = (typeof ShapeNoiseMode)[keyof typeof ShapeNoiseMode];

// --- Seeded RNG (mulberry32) ---

export function createSeededRNG(seedValue: number): () => number {
  let a = seedValue;
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function normalizeSeed(seedValue: number): number {
  const numericSeed = Number(seedValue);
  if (!Number.isFinite(numericSeed)) return 0;
  return Math.floor(Math.abs(numericSeed)) % SEED_MODULUS;
}

// --- Weighted Random ---

export function weightedRandom<T>(
  weights: [T, number][],
  rng: () => number = Math.random,
): T {
  const entries: [T, number][] = weights;

  if (entries.length === 0) return undefined as T;

  const totalWeight = entries.reduce(
    (acc, [, weight]) => acc + Math.max(0, weight),
    0,
  );
  if (totalWeight === 0) return undefined as T;

  const randomValue = rng() * totalWeight;
  let cumulativeWeight = 0;
  for (const [value, weight] of entries) {
    cumulativeWeight += Math.max(0, weight);
    if (randomValue <= cumulativeWeight) {
      return value;
    }
  }
  // Fallback (floating point edge cases)
  return entries[entries.length - 1][0];
}

// --- Movement Shape Scaling ---

// Snap to values that produce uniform cell-to-pixel mapping in movementShape.frag.
// FBO size = blockingScale; cells per FBO pixel = scaling. Non-uniform widths arise
// unless `scaling` is integer (>=1) or `1/scaling` is a power-of-2 divisor of blockingScale.
// Picks the closest allowed value; on ties (e.g. 0.75 ↔ {1, 0.5}) prefer the smaller
// scaling so "low scaling = bigger shapes" intent is preserved.
export function snapMovementShapeScaling(base: number, blockingScale: number): number {
  if (base >= 1) return Math.max(1, Math.round(base));
  const maxK = Math.max(1, blockingScale);
  let bestScaling = 1;
  let bestDist = Math.abs(base - 1);
  for (let k = 2; k <= maxK; k *= 2) {
    const candidate = 1 / k;
    const dist = Math.abs(base - candidate);
    if (dist <= bestDist) {
      bestDist = dist;
      bestScaling = candidate;
    }
  }
  return bestScaling;
}

// --- Shape Scale Helpers ---

// baseScale is the number of noise-volume cells spanned across the screen on each axis.
// fxWithBlocking divides by blockingScale because blockingSt = floor(st * blocking),
// so multiplying that by (n / blockingScale) recovers the same effective range as n * st.
// Both axes are kept >= ~1.5 so the StructuralQuintic volume (128×128×64, sampled in cell
// units) actually has variation across the screen — sub-cell ranges collapse to one value.
function getShapeScale(
  baseScale: [number, number],
  fxWithBlocking: boolean,
  blockingScale: number,
): [number, number] {
  return baseScale.map((n) =>
    fxWithBlocking ? n / blockingScale : n,
  ) as [number, number];
}

export function getFallShapeScale(
  fxWithBlocking: boolean,
  blockingScale: number,
): [number, number] {
  return getShapeScale([10, .33], fxWithBlocking, blockingScale);
}

export function getMoveShapeScale(
  fxWithBlocking: boolean,
  blockingScale: number,
): [number, number] {
  return getShapeScale([.33, 10], fxWithBlocking, blockingScale);
}

// --- Parameter Randomization ---
export function randomizeShaderParameters(seedValue: number): ShaderParams {
  const rngSeed = normalizeSeed(seedValue);
  const rng = createSeededRNG(rngSeed);

  const randomFloat = (min: number, max: number) => rng() * (max - min) + min;

  // Blocking parameters
  const fxWithBlocking = weightedRandom<boolean>(
    [
      [true, 1],
      [false, 4],
    ],
    rng,
  );

  // 8-512
  const blockingScale = weightedRandom<number>(
    [
      [8, 1],
      [16, 2],
      [32, 3],
      [64, 5],
      [128, 10],
      [256, 10],
      [512, 5],
    ],
    rng,
  );
  // const blockingScale = 8; //base block shape for speedd compensation

  // Domain warp: how much the noise boundaries swirl/fold
  // Operates in normalized noise-space, so no blockingScale scaling needed
  //1 - 10;
  const domainWarpAmount = weightedRandom<number>(
    [
      [1.0, 1],
      [2.0, 2],
      [3.0, 3],
      [4.0, 4],
      [5.0, 5],
      [6.0, 5],
      [7.0, 4],
      [8.0, 3],
      [9.0, 2],
      [10.0, 1],
    ],
    rng,
  );

  // Pattern overlay: geometric patterns mixed with noise (0=none, 1=radial, 2=diagonal (deprecated), 3=ridged)
  const patternMode = weightedRandom<number>(
    [
      [0, 3],
      [1, 2],
      [3, 1],
    ],
    rng,
  );

  //TODO - needs work, it seems like the circles are getting tiled
  const patternStrength = patternMode === 0 ? 0 : randomFloat(0.5, 2);
  const patternFreq = randomFloat(1.0, 4.0);

  const patternCenter = [0.5, 0.5] as [number, number];

  // TODO deprecated clean all mirror related stuff up
  const mirrorAmount = 0;
  const mirrorAxis = 0;

  // Move parameters
  // const shouldMoveThreshold = weightedRandom<number>(
  //   [
  //     [0.1, 1],
  //     [0.15, 2],
  //     [0.2, 5],
  //     [0.25, 2],
  //     [0.3, 1],
  //   ],
  //   rng,
  // );
  const shouldMoveThreshold = 0.2;
  const shouldFallThreshold = shouldMoveThreshold;

  const moveShapeSpeed = 0.025;
  const moveShapeScale = getMoveShapeScale(fxWithBlocking, blockingScale);

  const fallWaterfallMult = 1; //amount of variation between streams/mini columns (has a built in floor so none will be 0)

  const defaultWaterfallMode = weightedRandom<boolean>(
    [
      [false, 1],
      [true, 4],
    ],
    rng,
  );

  const fallShapeSpeed = 0.044;
  const shouldFallScale = getFallShapeScale(fxWithBlocking, blockingScale);

  //Paint thresholds
  const blackNoiseThreshold = 0.49;
  const useRibbonThreshold = 0.25;

  const blackNoiseBaseScaleBase = Math.floor(randomFloat(2, 10));
  const blackNoiseBaseScale = [
    blackNoiseBaseScaleBase,
    blackNoiseBaseScaleBase,
  ];
  // const blackNoiseBaseScale = [Math.floor(randomFloat(5, 20)), Math.floor(randomFloat(3, 15))]

  const blackNoiseScale: [number, number] = [
    blackNoiseBaseScale[0] / blockingScale,
    blackNoiseBaseScale[1] / blockingScale,
  ];

  const blackNoiseEdgeMult = weightedRandom<number>(
    [
      [0.0, 1],
      [0.025, 4],
    ],
    rng,
  );

  // Reset parameters
  // const resetThreshold = weightedRandom<number>(
  //   [
  //     [0.4, 1],
  //     [0.45, 2],
  //     [0.5, 6],
  //     [0.55, 2],
  //     [0.6, 1],
  //   ],
  //   rng,
  // );

  const resetThreshold = 0.45;

  //deprecated, keeping for now just in case
  // const resetNoiseScale: [number, number] = [
  //   blackNoiseBaseScale[0] / blockingScale,
  //   blackNoiseBaseScale[1] / blockingScale,
  // ];

  // Ribbon/dirt parameters
  const dirtNoiseScale: [number, number] = [
    randomFloat(2400.0, 2600.0),
    randomFloat(2400.0, 2600.0),
  ];

  const blankStaticScale: [number, number] = [randomFloat(90, 110.0), 0.321];

  const blankStaticThreshold = weightedRandom<number>(
    [
      [0.4, 1],
      [0.5, 6],
      [0.7, 3],
      [0.9, 1],
    ],
    rng,
  );

  // Extra fall parameters
  // const extraFallShapeThreshold = weightedRandom<number>(
  //   [
  //     [0, 1],
  //     [0.05, 2],
  //     [0.1, 5],
  //     [0.2, 2],
  //     [0.3, 1],
  //   ],
  //   rng,
  // );

  const extraFallShapeThreshold = 0.0567;

  const extraFallShapeScale = getFallShapeScale(
    fxWithBlocking,
    blockingScale,
  ).map((x) => x * 3) as [number, number];

  // Extra move parameters
  const extraMoveShapeThreshold = extraFallShapeThreshold;
  // const extraMoveShapeThreshold = weightedRandom<number>(
  //   [
  //     [0, 1],
  //     [0.05, 2],
  //     [0.1, 5],
  //     [0.2, 2],
  //     [0.3, 1],
  //   ],
  //   rng,
  // );

  const extraMoveShapeScale = getMoveShapeScale(
    fxWithBlocking,
    blockingScale,
  ).map((x) => x * 3) as [number, number];

  // Shape noise mode — 4:1 BlockNoise vs StructuralQuintic.
  const shapeNoiseMode = weightedRandom<ShapeNoiseMode>(
    [
      [ShapeNoiseMode.BlockNoise, 0], //TODO should be 4, just testing right now
      [ShapeNoiseMode.StructuralQuintic, 1],
    ],
    rng,
  );

  // For StructuralQuintic: pick a horizontal direction for the shape scroll.
  // For BlockNoise: optionally disable XY shape scroll (handled in renderer).
  let movementNoiseShapeDirection = 1;
  let blockNoiseDisableShapeMovement = false;
  if (shapeNoiseMode === ShapeNoiseMode.StructuralQuintic) {
    movementNoiseShapeDirection = rng() < 0.5 ? 1 : -1;
  } else {
    blockNoiseDisableShapeMovement = weightedRandom<boolean>(
      [
        [false, 4],
        [true, 1],
      ],
      rng,
    );
  }

  // > 1 creates tiling, but 2 or 3 is kinda cool, might be good for a rare
  const movementShapeScalingBase = blockNoiseDisableShapeMovement
    ? weightedRandom(
        [
          [0.25, 3],
          [0.5, 6],
          [0.75, 4],
          [1.0, 2],
        ],
        rng,
      )
    : //if there is shape movement
      weightedRandom(
        [
          [0.25, 1],
          [0.5, 3],
          [0.75, 6],
          [1.0, 10],
          [2.0, 2],
          [3.0, 1],
        ],
        rng,
      );
   
      
  // Snap to a value that gives uniform cell-edge spacing on the FBO grid.
  // Without this, fractional bases like 0.75 produce ragged shape edges.
  const movementShapeScalingEffective = snapMovementShapeScaling(
    movementShapeScalingBase,
    blockingScale,
  );
  const movementShapeScaling = [
    movementShapeScalingEffective,
    movementShapeScalingEffective,
  ] as [number, number];

  return {
    seed: rngSeed,
    fxWithBlocking,
    blockingScale,
    shouldMoveThreshold,
    moveShapeSpeed,
    moveShapeScale,
    shouldFallThreshold,
    fallShapeSpeed,
    shouldFallScale,
    fallWaterfallMult,
    defaultWaterfallMode,
    blackNoiseThreshold,
    blackNoiseScale,
    blackNoiseEdgeMult,
    resetThreshold,
    // resetNoiseScale,
    dirtNoiseScale,
    blankStaticScale,
    blankStaticThreshold,
    extraFallShapeThreshold,
    extraFallShapeScale,
    extraMoveShapeThreshold,
    extraMoveShapeScale,
    domainWarpAmount,
    patternMode,
    patternStrength,
    patternFreq,
    patternCenter,
    mirrorAmount,
    mirrorAxis,
    movementShapeScaling,
    useRibbonThreshold,
    shapeNoiseMode,
    movementNoiseShapeDirection,
    blockNoiseDisableShapeMovement,
  };
}

// --- Default Parameters (seed 0) ---

export const DEFAULT_PARAMS: ShaderParams = randomizeShaderParameters(0);
