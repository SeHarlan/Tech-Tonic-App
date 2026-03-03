// Shader parameter variables
const baseChunkSize = 160.; // a constant helps account for pixel density for movement and ribbons

// Time parameters
const blockTimeMult = 0.05;
const structuralTimeMult = 0.01;

  // // Blocking parameters
let blockingScale = 128.0 * 2;
let fxWithBlocking = false;


// Fall parameters
let shouldFallThreshold = 0.2;
let useFallBlob = false;
let shouldFallScale = getFallShapeScale(shouldFallThreshold);
let fallShapeSpeed = useFallBlob ? 0.052 : 0.044;

let fallWaterfallMult = 1.5;


const moveSpeed = 0.0045; //(was 0.0033)


let shouldMoveThreshold = 0.2;
let useMoveBlob = false;
let moveShapeSpeed = useMoveBlob ? 0.03125 : 0.025;
let moveShapeScale = getMoveShapeScale(shouldMoveThreshold);


let blackNoiseThreshold = 0.5;
let blackNoiseScale = [8, 8].map(x => x / blockingScale);//shape of blank space
let blackNoiseEdgeMult = 0.02;

let resetThreshold = .5;
let resetNoiseScale = [8,8].map((x) => x / blockingScale);
const resetEdgeThreshold = .33;

const ribbonDirtThreshold = 0.9;
const useRibbonThreshold = .33;
let dirtNoiseScale = [2500.1, 2490.9];

const useGrayscale = false;
const blankStaticThreshold = 0.5; //space in the static
let blankStaticScale = [100.0, 0.01];
const blankStaticTimeMult = 2.0;

let blankColor = [0., 0., 0.];
let staticColor1 = [1, 0, 0];
let staticColor2 = [0, 1, 0];
let staticColor3 = [0, 0, 1];

let useColorCycle = true;


//extra stuff
let extraFallShapeTimeMult = 0.025;

let extraFallShapeThreshold = 0.2;
let extraFallShapeScale = [30, 1].map((x) =>
  fxWithBlocking ? x / blockingScale : x
);
let extraFallStutterThreshold = 0.1;
const extraFallStutterScale = [50.0, 500.01];

let extraMoveShapeThreshold = 0.2;

let extraMoveShapeScale = [1, 10].map((x) =>
  fxWithBlocking ? x / blockingScale : x
)
let extraMoveStutterThreshold = 0.1;
const extraMoveStutterScale = [500.0, 50.01];


const cycleColorHueBaseSpeed = 0.005; //doubled after display pass fix (was 0.0025)

//FPS control
const DEFAULT_TARGET_FPS = 60;
let targetFps = DEFAULT_TARGET_FPS; // target FPS
let frameInterval = 1000 / targetFps;

let cycleColorHueSpeed = cycleColorHueBaseSpeed * (60 / targetFps);

// Video recording config — duration matches one full hue cycle (400 frames at 60fps)
const RECORD_DURATION_FRAMES = 1 / cycleColorHueBaseSpeed; // 400
const RECORD_DURATION_SECONDS = RECORD_DURATION_FRAMES / DEFAULT_TARGET_FPS;
const RECORD_BITRATE = 50_000_000;// 50 Mbps — max quality

const CANVAS_SCALE = 1.2;
const FIXED_CANVAS_WIDTH = 900 * CANVAS_SCALE;
const FIXED_CANVAS_HEIGHT = 1600 * CANVAS_SCALE;
const TARGET_CANVAS_ASPECT = FIXED_CANVAS_WIDTH / FIXED_CANVAS_HEIGHT;
const FIXED_PIXEL_RATIO_UNIFORM = 1.0;
const SEED_MODULUS = 1000;
const LOW_FPS_THRESHOLD_RATIO = 0.5;
const LOW_FPS_STREAK_TO_SHOW = 2;

// Video recording state
let isRecordingVideo = false;
let mediaRecorder = null;
let recordedChunks = [];
let recordingFramesRemaining = 0;
let fpsWarningIndicator = null;
let fpsWarningText = null;
let lowFpsStreak = 0;



function getShapeScale(baseScale, threshold, adjustmentFactor) {
  const shapeNormalizer = 0.2 / threshold; //keeps the shape size the same so threshold acts more like a frequency adjuster
  return baseScale.map((n) => {
    let base = fxWithBlocking ? n / blockingScale : n;
    base /= shapeNormalizer;
    base /= adjustmentFactor;
    return base;
  });
}

function getFallShapeScale(threshold) {
  const shouldFallBaseScale = useFallBlob ? [10, 8] : [10, 0.5];
  const blobAdjustment = useFallBlob ? 3 : 1;
  return getShapeScale(
    shouldFallBaseScale,
    threshold,
    blobAdjustment
  )
}

function getMoveShapeScale(threshold) {
  const shouldMoveBaseScale = useMoveBlob ? [5, 5] : [0.5, 5];
  const blobAdjustment = useMoveBlob ? 2 : 1;

  return getShapeScale(
    shouldMoveBaseScale,
    threshold,
    blobAdjustment
  )
}
// Seeded random number generator (mulberry32)
function createSeededRNG(seedValue) {
  let a = seedValue;
  return function() {
    let t = a += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}

function floorToNearest(value, nearest) {
  return Math.floor(value / nearest) * nearest;
}

function normalizeSeed(seedValue) {
  const numericSeed = Number(seedValue);
  if (!Number.isFinite(numericSeed)) return 0;
  return Math.floor(Math.abs(numericSeed)) % SEED_MODULUS;
}

function weightedRandom(weights, rng = Math.random) { 
  // Takes either:
  //   - Array of tuples: [[value, weight], ...]
  //   - Object: {value: weight}
  // Returns one value where a value with a higher weight is more likely to be chosen
  
  // Normalize to array of tuples
  const entries = Array.isArray(weights) 
    ? weights 
    : Object.entries(weights);
  
  if (entries.length === 0) return undefined;
  
  const totalWeight = entries.reduce((acc, [, weight]) => acc + Math.max(0, weight), 0);
  if (totalWeight === 0) return undefined;
  
  const randomValue = rng() * totalWeight;
  let cumulativeWeight = 0;
  for (const [value, weight] of entries) {
    cumulativeWeight += Math.max(0, weight);
    if (randomValue <= cumulativeWeight) {
      return value;
    }
  }
  // Fallback (shouldn't reach here, but handles floating point edge cases)
  return entries[entries.length - 1][0];
}

// Function to randomize all shader parameters
function randomizeShaderParameters(seedValue = null) {
  // return
  // Use provided seed or current seed, or generate new one
  const rngSeed = normalizeSeed(seedValue !== null ? seedValue : seed || setSeed());
  const rng = createSeededRNG(rngSeed);

  // Helper function for random float in range
  const randomFloat = (min, max) => rng() * (max - min) + min;

  const randomFromArray = (array) => array[Math.floor(rng() * array.length)];

  const getArrayOfSquares = (start, length) => {
    return Array.from({ length }, (_, i) => start * Math.pow(2, i));
  };

  // Blocking parameters
  fxWithBlocking = weightedRandom([
    [true, 1],
    [false, 4],
  ], rng);


  if (fxWithBlocking) {
    blockingScale = weightedRandom([
      [4, 1],
      [8, 3],
      [16, 6],
      [32, 3],
      [64, 1],
    ], rng);
  } else {
    blockingScale = weightedRandom([
      [8, 1],
      [16, 2],
      [32, 4],
      [64, 6],
      [128, 4],
      [256, 2],
    ], rng);
  }

  // // Move parameters
  shouldMoveThreshold = weightedRandom([
    [0.1, 1],
    [0.15, 2],
    [0.2, 5],
    [0.25, 2],
    [0.3, 1],
  ], rng);

  useMoveBlob = rng() < 0.2;
  moveShapeSpeed = useMoveBlob ? 0.03125 : 0.025;
  moveShapeScale = getMoveShapeScale(shouldMoveThreshold);

  // // Fall parameters:
  shouldFallThreshold = weightedRandom([
    [0.1, 1],
    [0.15, 2],
    [0.2, 5],
    [0.25, 2],
    [0.3, 1],
  ], rng);

  fallWaterfallMult = weightedRandom([
    [1, 1],
    [1.25, 2],
    [1.5, 4],
    [1.75, 2],
    [2, 1],
  ], rng);

  defaultWaterfallMode = weightedRandom([
    [false, 1],
    [true, 4],
  ], rng);

  waterfallVariant = defaultWaterfallMode;

  useFallBlob = rng() < 0.2;
  fallShapeSpeed = useFallBlob ? 0.052 : 0.044;

  shouldFallScale = getFallShapeScale(shouldFallThreshold);

  // // Black noise parameters
  blackNoiseThreshold = weightedRandom([
    [0.45, 1],
    [0.5, 4],
    [0.55, 1],
  ], rng);


  const blackNoiseBaseScale = [
    Math.floor(randomFloat(4, 10)),
    Math.floor(randomFloat(4, 10)),
  ];


  blackNoiseScale = blackNoiseBaseScale.map((x) => x / blockingScale); //shape of blank space
  blackNoiseEdgeMult = weightedRandom([
    [0.0, 1],
    [0.025, 4],
  ], rng);

  // // Reset parameters
  resetThreshold = weightedRandom([
    [0.4, 1],
    [0.5, 4],
    [0.6, 1],
  ], rng);

  const resetNoiseBaseScale = blackNoiseBaseScale;
  resetNoiseScale = resetNoiseBaseScale.map((x) => x / blockingScale);

  // ribbon dirt parameters
  dirtNoiseScale = [randomFloat(2400.0, 2600.0), randomFloat(2400.0, 2600.0)];


  blankStaticScale = [randomFloat(90, 110.0), 0.321];

  // // Extra fall parameters
  extraFallShapeThreshold = weightedRandom([
    [0, 1],
    [0.05, 2],
    [0.1, 5],
    [0.2, 2],
    [0.3, 1],
  ], rng);

  extraFallShapeScale = getFallShapeScale(extraFallShapeThreshold).map(
    (x) => x * 3,
  );

  // // Extra move parameters
  extraMoveShapeThreshold = weightedRandom([
    [0, 1],
    [0.05, 2],
    [0.1, 5],
    [0.2, 2],
    [0.3, 1],
  ], rng);

  extraMoveShapeScale = getMoveShapeScale(extraMoveShapeThreshold).map(
    (x) => x * 3,
  );

  console.log("Shader parameters randomized with seed:", rngSeed);
}

let seed = 0; // Random seed for shader
const setSeed = () => {
  return Math.floor(Math.random() * SEED_MODULUS); // Generate a shader-safe integer seed
}

// Timing (simulation time is derived from deterministic frame count)
let time = 0;


let gl, canvas, program;
let vertexBuffer, texCoordBuffer;
let framebuffers = [null, null];
let textures = [null, null];
let currentFbIndex = 0; //frame buffer index
let cachedShaders = {}; // Cache shader sources to avoid repeated fetching
let isLoaded = false; // Track if resources are loaded

// Drawing buffers - separate persistent movement and one-shot paint
let movementTexture = null;
let movementFBO = null;
let paintTexture = null;
let paintFBO = null;
let drawProgram = null; // WebGL shader program for drawing brushes
let displayProgram = null; // Minimal blit shader for display pass
let blockNoiseProgram = null; // Block noise pre-computation shader
let blockNoiseFBO = null;
let blockNoiseTexture = null;
let blockNoiseSize = 0;
let noiseVolumeProgram = null; // Noise volume generation shader
let noiseVolumeTexture = null; // 3D noise volume texture
let noiseVolumeFBO = null; // FBO for generating noise volume slices
const NOISE_VOL_XY = 128;
const NOISE_VOL_Z = 64;
let drawVertexBuffer = null;
let isDrawing = false;
let lastDrawX = 0;
let lastDrawY = 0;
let brushSize = 0; // Brush radius in pixels (will be set based on canvas size)
let brushSizeOptions = []; // Array of valid brush sizes (powers of 4)
let brushSizeIndex = 4; // Current index in brushSizeOptions

// Mode management with color channel encoding
// Movement buffer:
//   R channel: <0.25=off, 0.25-0.5=shuffle, 0.5-0.75=move left, 0.75+=move right
//   G channel: <0.25=off, 0.25-0.40=trickle, 0.40-0.55=straight down, 0.55-0.70=waterfall down, 0.70-0.85=straight up, 0.85+=waterfall up
//   B channel: <0.25=off, 0.25+=freeze
// Paint buffer:
//   R channel: <0.625=empty, 0.625-0.875=static, 0.875+=gem
let currentMode = 'waterfall'; // Default mode
let currentDirection = 'down'; // For move/waterfall: 'left', 'right', 'up', 'down'
let waterfallVariant = true; // true = waterfall (variable speed), false = straight (uniform speed)
let defaultWaterfallMode = true; // Default for organic fall movement
let eraseVariant = 'both'; // For erase mode: 'both', 'movement', 'paint'
let globalFreeze = false; // Global freeze mode - stops all movement
let manualMode = false; // Manual mode - stops default movements (but keeps color cycling)
let forceReset = false; // Force reset mode for clear operation
let forceResetFrames = 0; // Frames remaining for force reset

// Returns true if the current mode targets the movement buffer
function isMovementMode() {
  return currentMode === 'waterfall' || currentMode === 'move' ||
         currentMode === 'trickle' || currentMode === 'shuffle' ||
         currentMode === 'freeze' || currentMode === 'erase';
}

// Returns true if the current mode targets the paint buffer
function isPaintMode() {
  return currentMode === 'static' || currentMode === 'gem' || currentMode === 'empty';
}

// Get color for movement buffer modes
// R channel: <0.25=off, 0.25-0.5=shuffle, 0.5-0.75=move left, 0.75+=move right
// G channel: <0.25=off, 0.25-0.40=trickle, 0.40-0.55=straight down, 0.55-0.70=waterfall down, 0.70-0.85=straight up, 0.85+=waterfall up
// B channel: <0.25=off, 0.25+=freeze
function getMovementColor() {
  let r = 0.0, g = 0.0, b = 0.0;

  if (currentMode === 'erase') {
    return [0.0, 0.0, 0.0];
  }

  // R channel (move/shuffle)
  if (currentMode === 'shuffle') {
    r = 0.375;
  } else if (currentMode === 'move') {
    r = currentDirection === 'left' ? 0.875 : 0.625;
  }

  // G channel (waterfall/trickle/straight)
  if (currentMode === 'trickle') {
    g = 0.325;
  } else if (currentMode === 'waterfall') {
    if (currentDirection === 'down') {
      g = waterfallVariant ? 0.625 : 0.475;  // waterfall down : straight down
    } else {
      g = waterfallVariant ? 0.925 : 0.775;  // waterfall up : straight up
    }
  }

  // B channel (freeze)
  if (currentMode === 'freeze') {
    b = 0.375;
  }

  return [r, g, b];
}

// Get color for paint buffer modes
// R channel encodes variant: empty=0.5, static=0.75, gem=1.0
function getPaintColor() {
  switch (currentMode) {
    case 'empty':  return [0.5, 0.0, 0.0];
    case 'static': return [0.75, 0.0, 0.0];
    case 'gem':    return [1.0, 0.0, 0.0];
    default:       return [0.25, 0.0, 0.0];
  }
}

function clearDrawingBuffers() {
  if (movementFBO) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, movementFBO);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }
  if (paintFBO) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, paintFBO);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

// ============================================================
// ACTION FUNCTIONS
// Centralized actions that can be triggered by UI and keyboard
// ============================================================
const actions = {
  // === Directional Movement Actions ===
  waterfallUp: () => {
    if (currentMode === 'waterfall' && currentDirection === 'up') {
      waterfallVariant = !waterfallVariant;
    }
    currentMode = 'waterfall';
    currentDirection = 'up';
    console.log('Mode: waterfall up, variant:', waterfallVariant ? 'waterfall' : 'straight');
    updateStatusDisplay();
    updateMenuActiveStates();
  },

  waterfallDown: () => {
    if (currentMode === 'waterfall' && currentDirection === 'down') {
      waterfallVariant = !waterfallVariant;
    }
    currentMode = 'waterfall';
    currentDirection = 'down';
    console.log('Mode: waterfall down, variant:', waterfallVariant ? 'waterfall' : 'straight');
    updateStatusDisplay();
    updateMenuActiveStates();
  },

  moveLeft: () => {
    currentMode = 'move';
    currentDirection = 'left';
    console.log('Mode: move left');
    updateStatusDisplay();
    updateMenuActiveStates();
  },

  moveRight: () => {
    currentMode = 'move';
    currentDirection = 'right';
    console.log('Mode: move right');
    updateStatusDisplay();
    updateMenuActiveStates();
  },

  // === Core Brush Mode Actions ===
  eraseMovement: () => {
    if (currentMode !== 'erase') {
      currentMode = 'erase';
      eraseVariant = 'movement';
    } else if (eraseVariant === 'paint') {
      eraseVariant = 'both';
    } else if (eraseVariant === 'both') {
      eraseVariant = 'paint';
    }
    console.log('Mode: erase', eraseVariant);
    updateStatusDisplay();
    updateMenuActiveStates();
  },

  freezeBrush: () => {
    currentMode = 'freeze';
    console.log('Mode: freeze');
    updateStatusDisplay();
    updateMenuActiveStates();
  },

  shuffle: () => {
    currentMode = 'shuffle';
    console.log('Mode: shuffle');
    updateStatusDisplay();
    updateMenuActiveStates();
  },

  trickle: () => {
    currentMode = 'trickle';
    console.log('Mode: trickle');
    updateStatusDisplay();
    updateMenuActiveStates();
  },

  // === Paint Mode Actions ===
  resetInitialMovement: () => {
    if (currentMode !== 'erase') {
      currentMode = 'erase';
      eraseVariant = 'paint';
    } else if (eraseVariant === 'movement') {
      eraseVariant = 'both';
    } else if (eraseVariant === 'both') {
      eraseVariant = 'movement';
    }
    console.log('Mode: erase', eraseVariant);
    updateStatusDisplay();
    updateMenuActiveStates();
  },

  drawStatic: () => {
    currentMode = 'static';
    console.log('Mode: static');
    updateStatusDisplay();
    updateMenuActiveStates();
  },

  drawGem: () => {
    currentMode = 'gem';
    console.log('Mode: gem');
    updateStatusDisplay();
    updateMenuActiveStates();
  },

  drawSpace: () => {
    currentMode = 'empty';
    console.log('Mode: space');
    updateStatusDisplay();
    updateMenuActiveStates();
  },

  // Cycle through erase variants (for 'e' key)
  cycleEraseMode: () => {
    const variants = ['both', 'movement', 'paint'];
    if (currentMode !== 'erase') {
      currentMode = 'erase';
      eraseVariant = 'both';
    } else {
      const idx = variants.indexOf(eraseVariant);
      eraseVariant = variants[(idx + 1) % variants.length];
    }
    console.log('Erase mode:', eraseVariant);
    updateStatusDisplay();
    updateMenuActiveStates();
  },

  // === Global Actions ===
  toggleGlobalFreeze: () => {
    globalFreeze = !globalFreeze;
    if (globalFreeze) {
      isDrawing = false;
      hideBrushOverlay();
    }
    updateLowFpsIndicator();
    console.log('Paused:', globalFreeze ? 'ON' : 'OFF');
    updateStatusDisplay();
    updateMenuActiveStates();
  },

  newSeed: () => {
    resetWithNewSeed();
  },

  globalReset: () => {
    clearDrawingBuffers();
    forceReset = true;
    forceResetFrames = 2;
    console.log('Global reset: buffers cleared, forcing reset for 2 frames');
  },

  globalClear: () => {
    clearDrawingBuffers();
    console.log('Drawing buffers cleared');
  },

  saveScreenshot: () => {
    saveScreenshot();
  },

  recordVideo: () => {
    toggleVideoRecording();
  },

  // === Settings Toggles ===
  toggleManualMode: () => {
    manualMode = !manualMode;
    console.log('Manual mode:', manualMode ? 'ON' : 'OFF');
    updateStatusDisplay();
    updateMenuActiveStates();
  },

  toggleBlockFX: () => {
    fxWithBlocking = !fxWithBlocking;
    console.log('Block FX:', fxWithBlocking ? 'ON' : 'OFF');
    // Recalculate brush size options for new mode
    generateBrushSizeOptions();
    updateBrushSizeDisplay();
    updateStatusDisplay();
  },

  // === Brush Size Actions ===
  increaseBrushSize: () => {
    if (brushSizeOptions.length > 0) {
      brushSizeIndex = Math.min(brushSizeOptions.length - 1, brushSizeIndex + 1);
      brushSize = brushSizeOptions[brushSizeIndex];
      console.log('Brush size:', brushSize);
      updateStatusDisplay();
      updateBrushSizeDisplay();
    }
  },

  decreaseBrushSize: () => {
    if (brushSizeOptions.length > 0) {
      brushSizeIndex = Math.max(0, brushSizeIndex - 1);
      brushSize = brushSizeOptions[brushSizeIndex];
      console.log('Brush size:', brushSize);
      updateStatusDisplay();
      updateBrushSizeDisplay();
    }
  },

  closeMenu: () => {
    closeRadialMenu();
  }
};

// loading management functions
function hideLoadingOverlay() {
    const loadingOverlay = document.getElementById('loading-overlay');
    if (loadingOverlay) {
        loadingOverlay.classList.add('hidden');
    }
}

function showErrorOverlay(message) {
    const errorOverlay = document.getElementById('error-overlay');
    if (errorOverlay) {
        errorOverlay.classList.remove('hidden');
    }
}

function setupPerformanceIndicators() {
    fpsWarningIndicator = document.getElementById('fps-warning-indicator');
    fpsWarningText = document.getElementById('fps-warning-text');
}

function updateLowFpsIndicator() {
  if (!fpsWarningIndicator || !fpsWarningText) return;

  const lowFpsThreshold = targetFps * LOW_FPS_THRESHOLD_RATIO;
  const isLowFps = !globalFreeze && currentFps < lowFpsThreshold;

  if (isLowFps) {
    lowFpsStreak++;
  } else {
    lowFpsStreak = 0;
  }

  if (isLowFps && lowFpsStreak >= LOW_FPS_STREAK_TO_SHOW) {
    fpsWarningText.textContent = `Slow Rendering`;
    fpsWarningIndicator.classList.remove('hidden');
    return;
  }

  fpsWarningIndicator.classList.add('hidden');
}

// Update status display
function updateStatusDisplay() {
    const modeText = document.getElementById('mode-text');
    const brushText = document.getElementById('brush-text');
    if (modeText) {
        let displayText = currentMode;
        if (currentMode === 'waterfall' && currentDirection) {
            displayText = (waterfallVariant ? 'waterfall' : 'straight') + ' ' + currentDirection;
        } else if (currentMode === 'move' && currentDirection) {
            displayText += ' ' + currentDirection;
        }
        if (currentMode === 'erase') {
            displayText += ' ' + eraseVariant;
        }
        if (globalFreeze) {
            displayText += ' [PAUSED]';
        }
        if (manualMode) {
            displayText += ' [MANUAL]';
        }
        modeText.textContent = displayText;
    }
    if (brushText) {
        brushText.textContent = Math.round(brushSize * 2);
    }
}


// Initialize when the page loads
window.onload = async function() {
    // Loading overlay is already visible by default in the HTML
    
    canvas = document.getElementById('glCanvas');
    gl = canvas.getContext('webgl2', {
      preserveDrawingBuffer: true,
      antialias: false
    });

    if (!gl) {
        console.error('WebGL2 not supported');
        showErrorOverlay('WebGL2 is not supported in your browser');
        return;
    }

    // Match canvas size to window
    resizeCanvas();
    window.addEventListener('resize', handleResize);

    // Load shaders
    try {
      // Load shaders in parallel
      const [vertexShaderSource, fragmentShaderSource] = await Promise.all([
        fetchShader("vertexShader.glsl"),
        fetchShader("fragmentShader.glsl"),
      ]);

      // Create shader program
      program = createProgram(vertexShaderSource, fragmentShaderSource);
      if (!program) {
        throw new Error("Failed to create shader program");
      }

      // Set up textures and framebuffers for ping-pong rendering
      setupFramebuffers();

      // Initialize buffers for geometry
      setupBuffers();
      
      // Setup drawing program
      setupDrawingProgram();

      // Setup display (blit) program for screen pass
      setupDisplayProgram();

      // Setup block noise program and FBO
      setupBlockNoiseProgram();
      setupBlockNoiseFBO();

      // Setup noise volume program
      setupNoiseVolumeProgram();

      // Generate seed first, then randomize parameters with it
      seed = setSeed();
      console.log("Seed:", seed); // Log the seed for debugging
      
      // Randomize shader parameters using the seed
      randomizeShaderParameters(seed);
      // Generate noise volume for this seed
      generateNoiseVolume();
      // Regenerate brush options with correct blocking state
      generateBrushSizeOptions();
      updateBrushSizeDisplay();
      // Mark as loaded
      isLoaded = true;

      hideLoadingOverlay();

      // Start the rendering loop
      animate();

      // Add keyboard listeners
      setupKeyboardListeners();
      
      // Add mouse event listeners
      setupMouseListeners();

      // Setup radial menu
      setupRadialMenu();

      // Setup brush overlay
      setupBrushOverlay();

      // Setup performance warning indicators
      setupPerformanceIndicators();

      // Initialize status display
      updateStatusDisplay();
    } catch (error) {
        console.error('Error loading shaders:', error);
        showErrorOverlay(error.message || 'Failed to initialize WebGL');
    }
};

// Resize handler for display-only scaling (simulation resolution stays fixed)
function handleResize() {
    // Resize the canvas using our improved function
    resizeCanvas();

    // Update status display
    updateStatusDisplay();
}

// Generate brush size options
// In blocking mode: sizes range from 1 block to 1/4 screen in blocks
// In normal mode: sizes range from 1/160 to 1/2 of smallest dimension in pixels
function generateBrushSizeOptions() {
  const minDimension = Math.min(canvas.width, canvas.height);
  brushSizeOptions = [];

  // Same size range for both modes
  const maxSize = minDimension / 4; // Quarter radius = half screen diameter
  const step = maxSize / 10; // Divide the max size into 10 steps (1/20 to 10/20)

  // Add smaller options below 1/20, dividing by 2 each time
  const smallestOption = step; // This is 1/20
  brushSizeOptions.push(Math.max(1, smallestOption / 32)); // 1/640, min 1px
  brushSizeOptions.push(Math.max(1, smallestOption / 16)); // 1/320, min 1px
  brushSizeOptions.push(Math.max(1, smallestOption / 8)); // 1/160, min 1px
  brushSizeOptions.push(Math.max(1, smallestOption / 4)); // 1/80, min 1px
  brushSizeOptions.push(Math.max(1, smallestOption / 2)); // 1/40, min 1px

  // Generate 10 options from 1/20 to 10/20 (largest is half the smallest dimension)
  for (let i = 1; i <= 10; i++) {
    brushSizeOptions.push(i * step);
  }

  // Remove duplicates (can happen when small sizes hit 1px minimum)
  brushSizeOptions = [...new Set(brushSizeOptions)];

  // Default to lower middle option
  brushSizeIndex = Math.min(6, brushSizeOptions.length - 1);

  brushSize = brushSizeOptions[brushSizeIndex];
}

async function fetchShader(url) {
    // Return cached version if available
    if (cachedShaders[url]) {
        return cachedShaders[url];
    }
    
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch shader: ${url}`);
        }
        const shaderSource = await response.text();
        
        // Cache the shader source
        cachedShaders[url] = shaderSource;
        
        return shaderSource;
    } catch (error) {
        console.error(`Error fetching shader ${url}:`, error);
        throw error;
    }
}

function resizeCanvas(isInitial = false) {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const fitScale = Math.min(
      viewportWidth / FIXED_CANVAS_WIDTH,
      viewportHeight / FIXED_CANVAS_HEIGHT
    );
    let displayWidth = FIXED_CANVAS_WIDTH * fitScale;
    let displayHeight = FIXED_CANVAS_HEIGHT * fitScale;

    // Snap display dimensions to integer CSS pixels to keep edges crisp.
    displayWidth = Math.floor(displayWidth);
    displayHeight = Math.floor(displayHeight);

    const displayLeft = Math.floor((viewportWidth - displayWidth) / 2);
    const displayTop = Math.floor((viewportHeight - displayHeight) / 2);

    // Set display size and placement (CSS pixels)
    canvas.style.width = displayWidth + 'px';
    canvas.style.height = displayHeight + 'px';
    canvas.style.left = displayLeft + 'px';
    canvas.style.top = displayTop + 'px';

    // Keep a fixed simulation resolution for deterministic output.
    canvas.width = FIXED_CANVAS_WIDTH;
    canvas.height = FIXED_CANVAS_HEIGHT;

    gl.viewport(0, 0, canvas.width, canvas.height);
    
    // Only setup framebuffers during initial load or when explicitly called
    if (isInitial || !framebuffers[0]) {
        setupFramebuffers();
    }
}

function createShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error('Shader compilation error:', gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
    }
    
    return shader;
}

function createProgram(vertexSource, fragmentSource) {
    const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexSource);
    const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
    
    if (!vertexShader || !fragmentShader) {
        return null;
    }
    
    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.error('Program linking error:', gl.getProgramInfoLog(program));
        return null;
    }
    
    // Get locations of attributes and uniforms
    program.attribLocations = {
        position: gl.getAttribLocation(program, 'a_position'),
        texCoord: gl.getAttribLocation(program, 'a_texCoord')
    };
    
  program.uniformLocations = {
    displayFps: gl.getUniformLocation(program, "u_displayFps"),
    targetFps: gl.getUniformLocation(program, "u_targetFps"),
    frameCount: gl.getUniformLocation(program, "u_frameCount"),
    texture: gl.getUniformLocation(program, "u_texture"),
    resolution: gl.getUniformLocation(program, "u_resolution"),
    time: gl.getUniformLocation(program, "u_time"),
    pixelRatio: gl.getUniformLocation(program, "u_pixelDensity"), // Add pixel ratio uniform
    seed: gl.getUniformLocation(program, "u_seed"),
    baseChunkSize: gl.getUniformLocation(program, "u_baseChunkSize"),
    shouldMoveThreshold: gl.getUniformLocation(
      program,
      "u_shouldMoveThreshold"
    ),
    moveSpeed: gl.getUniformLocation(program, "u_moveSpeed"),
    moveShapeScale: gl.getUniformLocation(program, "u_moveShapeScale"),
    moveShapeSpeed: gl.getUniformLocation(program, "u_moveShapeSpeed"),
    resetThreshold: gl.getUniformLocation(program, "u_resetThreshold"),
    resetEdgeThreshold: gl.getUniformLocation(program, "u_resetEdgeThreshold"),
    resetNoiseScale: gl.getUniformLocation(program, "u_resetNoiseScale"),
    shouldFallThreshold: gl.getUniformLocation(program, "u_shouldFallThreshold"),
    shouldFallScale: gl.getUniformLocation(program, "u_shouldFallScale"),
    fallShapeSpeed: gl.getUniformLocation(program, "u_fallShapeSpeed"),
    fxWithBlocking: gl.getUniformLocation(program, "u_fxWithBlocking"),
    blockTimeMult: gl.getUniformLocation(program, "u_blockTimeMult"),
    structuralTimeMult: gl.getUniformLocation(program, "u_structuralTimeMult"),
    extraMoveShapeThreshold: gl.getUniformLocation(
      program,
      "u_extraMoveShapeThreshold"
    ),
    extraMoveStutterScale: gl.getUniformLocation(program, "u_extraMoveStutterScale"),
    extraMoveStutterThreshold: gl.getUniformLocation(
      program,
      "u_extraMoveStutterThreshold"
    ),
    extraFallShapeThreshold: gl.getUniformLocation(
      program,
      "u_extraFallShapeThreshold"
    ),
    extraFallShapeTimeMult: gl.getUniformLocation(program, "u_extraFallShapeTimeMult"),
    extraFallStutterScale: gl.getUniformLocation(program, "u_extraFallStutterScale"),
    extraFallStutterThreshold: gl.getUniformLocation(
      program,
      "u_extraFallStutterThreshold"
    ),
    fallWaterfallMult: gl.getUniformLocation(program, "u_fallWaterfallMult"),
    extraFallShapeScale: gl.getUniformLocation(program, "u_extraFallShapeScale"),
    extraMoveShapeScale: gl.getUniformLocation(program, "u_extraMoveShapeScale"),
    blocking: gl.getUniformLocation(program, "u_blocking"),
    blackNoiseScale: gl.getUniformLocation(program, "u_blackNoiseScale"),
    blackNoiseEdgeMult: gl.getUniformLocation(program, "u_blackNoiseEdgeMult"),
    blackNoiseThreshold: gl.getUniformLocation(program, "u_blackNoiseThreshold"),
    useRibbonThreshold: gl.getUniformLocation(program, "u_useRibbonThreshold"),
    ribbonDirtThreshold: gl.getUniformLocation(program, "u_ribbonDirtThreshold"),
    dirtNoiseScale: gl.getUniformLocation(program, "u_dirtNoiseScale"),
    useGrayscale: gl.getUniformLocation(program, "u_useGrayscale"),
    useColorCycle: gl.getUniformLocation(program, "u_useColorCycle"),
    blankStaticScale: gl.getUniformLocation(program, "u_blankStaticScale"),
    blankStaticThreshold: gl.getUniformLocation(program, "u_blankStaticThreshold"),
    blankStaticTimeMult: gl.getUniformLocation(program, "u_blankStaticTimeMult"),
    blankColor: gl.getUniformLocation(program, "u_blankColor"),
    staticColor1: gl.getUniformLocation(program, "u_staticColor1"),
    staticColor2: gl.getUniformLocation(program, "u_staticColor2"),
    staticColor3: gl.getUniformLocation(program, "u_staticColor3"),
    cycleColorHueSpeed: gl.getUniformLocation(program, "u_cycleColorHueSpeed"),
    globalFreeze: gl.getUniformLocation(program, "u_globalFreeze"),
    forceReset: gl.getUniformLocation(program, "u_forceReset"),
    manualMode: gl.getUniformLocation(program, "u_manualMode"),
    defaultWaterfallMode: gl.getUniformLocation(program, "u_defaultWaterfallMode"),
    movementTexture: gl.getUniformLocation(program, "u_movementTexture"),
    paintTexture: gl.getUniformLocation(program, "u_paintTexture"),
    blockNoiseTex: gl.getUniformLocation(program, "u_blockNoiseTex"),
    noiseVolume: gl.getUniformLocation(program, "u_noiseVolume"),
  };
    
    return program;
}

function createFBOTexture(width, height) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

  return { texture, fbo };
}

function setupFramebuffers() {
    const width = canvas.width;
    const height = canvas.height;
    
    // Generate brush size options and set to middle
    generateBrushSizeOptions();
    
    // Clean up existing textures and framebuffers
    for (let i = 0; i < 2; i++) {
        if (textures[i]) gl.deleteTexture(textures[i]);
        if (framebuffers[i]) gl.deleteFramebuffer(framebuffers[i]);
    }
    
    // Create two textures and framebuffers for ping-pong rendering
    for (let i = 0; i < 2; i++) {
        const result = createFBOTexture(width, height);
        textures[i] = result.texture;
        framebuffers[i] = result.fbo;
    }

    // Create movement buffer (persistent - stores movement/freeze brush strokes)
    if (movementTexture) gl.deleteTexture(movementTexture);
    if (movementFBO) gl.deleteFramebuffer(movementFBO);
    ({ texture: movementTexture, fbo: movementFBO } = createFBOTexture(width, height));
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // Create paint buffer (transient - cleared each frame after consumption)
    if (paintTexture) gl.deleteTexture(paintTexture);
    if (paintFBO) gl.deleteFramebuffer(paintFBO);
    ({ texture: paintTexture, fbo: paintFBO } = createFBOTexture(width, height));
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    
    // Create drawing shader program if not already created
    if (!drawProgram) {
      setupDrawingProgram();
      if (!drawProgram) {
        console.error('Failed to create drawing program');
      }
    }
    
    // Reset bindings
    gl.bindTexture(gl.TEXTURE_2D, null);
    
    console.log('Drawing buffer initialized:', width, 'x', height);
}

// Setup WebGL shader program for drawing circles
function setupDrawingProgram() {
  const drawVertexShaderSource = `#version 300 es
    in vec2 a_position;
    uniform mediump vec2 u_resolution;

    void main() {
      vec2 clipSpace = (a_position / u_resolution) * 2.0 - 1.0;
      gl_Position = vec4(clipSpace, 0.0, 1.0);
    }
  `;

  const drawFragmentShaderSource = `#version 300 es
    precision mediump float;

    uniform vec3 u_color;
    uniform float u_squareMode;
    uniform vec2 u_center;
    uniform vec2 u_radius;

    out vec4 outColor;

    void main() {
      vec2 diff = gl_FragCoord.xy - u_center;

      bool outside;
      if (u_squareMode > 0.5) {
        vec2 normalizedDiff = abs(diff) / u_radius;
        outside = max(normalizedDiff.x, normalizedDiff.y) > 1.0;
      } else {
        outside = length(diff) > u_radius.x;
      }

      if (outside) discard;

      outColor = vec4(u_color, 1.0);
    }
  `;
  
  const vertexShader = createShader(gl, gl.VERTEX_SHADER, drawVertexShaderSource);
  const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, drawFragmentShaderSource);
  
  if (!vertexShader) {
    console.error('Failed to create drawing vertex shader');
    return;
  }
  
  if (!fragmentShader) {
    console.error('Failed to create drawing fragment shader');
    return;
  }
  
  drawProgram = gl.createProgram();
  gl.attachShader(drawProgram, vertexShader);
  gl.attachShader(drawProgram, fragmentShader);
  gl.linkProgram(drawProgram);
  
  if (!gl.getProgramParameter(drawProgram, gl.LINK_STATUS)) {
    const error = gl.getProgramInfoLog(drawProgram);
    console.error('Drawing program linking error:', error);
    gl.deleteProgram(drawProgram);
    drawProgram = null;
    return;
  }
  
  // Check for shader compilation errors
  if (!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS)) {
    const error = gl.getShaderInfoLog(vertexShader);
    console.error('Drawing vertex shader compilation error:', error);
    gl.deleteProgram(drawProgram);
    drawProgram = null;
    return;
  }
  
  if (!gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS)) {
    const error = gl.getShaderInfoLog(fragmentShader);
    console.error('Drawing fragment shader compilation error:', error);
    gl.deleteProgram(drawProgram);
    drawProgram = null;
    return;
  }
  
  // Get uniform and attribute locations
  drawProgram.attribLocations = {
    position: gl.getAttribLocation(drawProgram, 'a_position')
  };
  
  drawProgram.uniformLocations = {
    resolution: gl.getUniformLocation(drawProgram, 'u_resolution'),
    center: gl.getUniformLocation(drawProgram, 'u_center'),
    radius: gl.getUniformLocation(drawProgram, 'u_radius'),
    color: gl.getUniformLocation(drawProgram, 'u_color'),
    squareMode: gl.getUniformLocation(drawProgram, 'u_squareMode'),
  };
  
  console.log('Drawing program created');
  
  // Create vertex buffer for circle (we'll generate vertices dynamically)
  if (!drawVertexBuffer) {
    drawVertexBuffer = gl.createBuffer();
  }
}

// Setup minimal blit shader for display pass (just copies texture to screen)
function setupDisplayProgram() {
  const vertexSrc = `#version 300 es
    in vec2 a_position;
    in vec2 a_texCoord;
    out vec2 v_texCoord;
    void main() {
      gl_Position = vec4(a_position, 0.0, 1.0);
      v_texCoord = a_texCoord;
    }
  `;
  const fragmentSrc = `#version 300 es
    precision mediump float;
    uniform sampler2D u_texture;
    in vec2 v_texCoord;
    out vec4 fragColor;
    void main() {
      fragColor = texture(u_texture, v_texCoord);
    }
  `;

  const vs = createShader(gl, gl.VERTEX_SHADER, vertexSrc);
  const fs = createShader(gl, gl.FRAGMENT_SHADER, fragmentSrc);
  if (!vs || !fs) {
    console.error('Failed to create display shaders');
    return;
  }

  displayProgram = gl.createProgram();
  gl.attachShader(displayProgram, vs);
  gl.attachShader(displayProgram, fs);
  gl.linkProgram(displayProgram);

  if (!gl.getProgramParameter(displayProgram, gl.LINK_STATUS)) {
    console.error('Display program linking error:', gl.getProgramInfoLog(displayProgram));
    gl.deleteProgram(displayProgram);
    displayProgram = null;
    return;
  }

  displayProgram.attribLocations = {
    position: gl.getAttribLocation(displayProgram, 'a_position'),
    texCoord: gl.getAttribLocation(displayProgram, 'a_texCoord')
  };
  displayProgram.uniformLocations = {
    texture: gl.getUniformLocation(displayProgram, 'u_texture')
  };

  console.log('Display (blit) program created');
}

// Block noise pass: computes wrappingNoise, blackNoise, ribbonNoise at block resolution
function setupBlockNoiseProgram() {
  const vertexSrc = `#version 300 es
    in vec2 a_position;
    in vec2 a_texCoord;
    out vec2 v_texCoord;
    void main() {
      gl_Position = vec4(a_position, 0.0, 1.0);
      v_texCoord = a_texCoord;
    }
  `;

  const fragmentSrc = `#version 300 es
    #ifdef GL_FRAGMENT_PRECISION_HIGH
    precision highp float;
    #else
    precision mediump float;
    #endif

    uniform float u_seed;
    uniform float u_blocking;
    uniform vec2 u_blackNoiseScale;
    uniform float u_structuralMoveTime;
    uniform float u_wrappingTime;

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
      float f_corner = random3D(i + vec3(1.0, 0.0, 1.0));
      float g = random3D(i + vec3(0.0, 1.0, 1.0));
      float h = random3D(i + vec3(1.0, 1.0, 1.0));
      vec3 u = f * f * (3.0 - 2.0 * f);
      float ab = mix(a, b, u.x);
      float cd = mix(c, d, u.x);
      float ef = mix(e, f_corner, u.x);
      float gh = mix(g, h, u.x);
      float abcd = mix(ab, cd, u.y);
      float efgh = mix(ef, gh, u.y);
      return mix(abcd, efgh, u.z);
    }

    float structuralNoise(vec2 st, float t) {
      return noise3D(vec3(st, t));
    }

    void main() {
      vec2 blockingSt = floor(v_texCoord * u_blocking);

      // R: wrappingNoise (scaled down for wider variation)
      float wrappingNoise = structuralNoise(blockingSt * u_blackNoiseScale * 0.25 + 11.909, u_wrappingTime);
      // G: blackNoise
      float blackNoise = structuralNoise(blockingSt * u_blackNoiseScale + 1000., u_structuralMoveTime);
      // B: ribbonNoise
      float ribbonNoise = structuralNoise(blockingSt * u_blackNoiseScale - 2000., u_structuralMoveTime);

      fragColor = vec4(wrappingNoise, blackNoise, ribbonNoise, 1.0);
    }
  `;

  const vs = createShader(gl, gl.VERTEX_SHADER, vertexSrc);
  const fs = createShader(gl, gl.FRAGMENT_SHADER, fragmentSrc);
  if (!vs || !fs) {
    console.error('Failed to create block noise shaders');
    return;
  }

  blockNoiseProgram = gl.createProgram();
  gl.attachShader(blockNoiseProgram, vs);
  gl.attachShader(blockNoiseProgram, fs);
  gl.linkProgram(blockNoiseProgram);

  if (!gl.getProgramParameter(blockNoiseProgram, gl.LINK_STATUS)) {
    console.error('Block noise program linking error:', gl.getProgramInfoLog(blockNoiseProgram));
    gl.deleteProgram(blockNoiseProgram);
    blockNoiseProgram = null;
    return;
  }

  blockNoiseProgram.attribLocations = {
    position: gl.getAttribLocation(blockNoiseProgram, 'a_position'),
    texCoord: gl.getAttribLocation(blockNoiseProgram, 'a_texCoord')
  };
  blockNoiseProgram.uniformLocations = {
    seed: gl.getUniformLocation(blockNoiseProgram, 'u_seed'),
    blocking: gl.getUniformLocation(blockNoiseProgram, 'u_blocking'),
    blackNoiseScale: gl.getUniformLocation(blockNoiseProgram, 'u_blackNoiseScale'),
    structuralMoveTime: gl.getUniformLocation(blockNoiseProgram, 'u_structuralMoveTime'),
    wrappingTime: gl.getUniformLocation(blockNoiseProgram, 'u_wrappingTime'),
  };

  console.log('Block noise program created');
}

function setupBlockNoiseFBO() {
  blockNoiseSize = Math.max(1, Math.ceil(blockingScale));

  if (blockNoiseTexture) gl.deleteTexture(blockNoiseTexture);
  if (blockNoiseFBO) gl.deleteFramebuffer(blockNoiseFBO);

  blockNoiseTexture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, blockNoiseTexture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, blockNoiseSize, blockNoiseSize, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  blockNoiseFBO = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, blockNoiseFBO);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, blockNoiseTexture, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, null);
}

function setupNoiseVolumeProgram() {
  const vertexSrc = `#version 300 es
    in vec2 a_position;
    in vec2 a_texCoord;
    out vec2 v_texCoord;
    void main() {
      gl_Position = vec4(a_position, 0.0, 1.0);
      v_texCoord = a_texCoord;
    }
  `;

  const fragmentSrc = `#version 300 es
    precision highp float;
    uniform float u_seed;
    uniform float u_zSlice;
    uniform float u_texSize;
    in vec2 v_texCoord;
    out vec4 fragColor;

    float random3D(vec3 st) {
      vec3 p = fract((st + u_seed) * vec3(443.897, 441.423, 437.195));
      p += dot(p, p.yzx + 19.19);
      return fract((p.x + p.y) * p.z);
    }

    void main() {
      vec2 gridPos = floor(v_texCoord * u_texSize);
      float val = random3D(vec3(gridPos, u_zSlice));
      fragColor = vec4(val, 0.0, 0.0, 1.0);
    }
  `;

  const vs = createShader(gl, gl.VERTEX_SHADER, vertexSrc);
  const fs = createShader(gl, gl.FRAGMENT_SHADER, fragmentSrc);
  if (!vs || !fs) {
    console.error('Failed to create noise volume shaders');
    return;
  }

  noiseVolumeProgram = gl.createProgram();
  gl.attachShader(noiseVolumeProgram, vs);
  gl.attachShader(noiseVolumeProgram, fs);
  gl.linkProgram(noiseVolumeProgram);

  if (!gl.getProgramParameter(noiseVolumeProgram, gl.LINK_STATUS)) {
    console.error('Noise volume program linking error:', gl.getProgramInfoLog(noiseVolumeProgram));
    gl.deleteProgram(noiseVolumeProgram);
    noiseVolumeProgram = null;
    return;
  }

  noiseVolumeProgram.attribLocations = {
    position: gl.getAttribLocation(noiseVolumeProgram, 'a_position'),
    texCoord: gl.getAttribLocation(noiseVolumeProgram, 'a_texCoord')
  };
  noiseVolumeProgram.uniformLocations = {
    seed: gl.getUniformLocation(noiseVolumeProgram, 'u_seed'),
    zSlice: gl.getUniformLocation(noiseVolumeProgram, 'u_zSlice'),
    texSize: gl.getUniformLocation(noiseVolumeProgram, 'u_texSize')
  };
}

function generateNoiseVolume() {
  if (!noiseVolumeProgram) return;

  // Create 3D texture if it doesn't exist
  if (!noiseVolumeTexture) {
    noiseVolumeTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_3D, noiseVolumeTexture);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.R8, NOISE_VOL_XY, NOISE_VOL_XY, NOISE_VOL_Z, 0, gl.RED, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.REPEAT);
    gl.bindTexture(gl.TEXTURE_3D, null);
  }

  // Create FBO for slice rendering if needed
  if (!noiseVolumeFBO) {
    noiseVolumeFBO = gl.createFramebuffer();
  }

  // Render each Z slice
  gl.useProgram(noiseVolumeProgram);
  gl.uniform1f(noiseVolumeProgram.uniformLocations.seed, seed);
  gl.uniform1f(noiseVolumeProgram.uniformLocations.texSize, NOISE_VOL_XY);

  gl.bindFramebuffer(gl.FRAMEBUFFER, noiseVolumeFBO);
  gl.viewport(0, 0, NOISE_VOL_XY, NOISE_VOL_XY);

  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.enableVertexAttribArray(noiseVolumeProgram.attribLocations.position);
  gl.vertexAttribPointer(noiseVolumeProgram.attribLocations.position, 2, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
  gl.enableVertexAttribArray(noiseVolumeProgram.attribLocations.texCoord);
  gl.vertexAttribPointer(noiseVolumeProgram.attribLocations.texCoord, 2, gl.FLOAT, false, 0, 0);

  for (let z = 0; z < NOISE_VOL_Z; z++) {
    gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, noiseVolumeTexture, 0, z);
    gl.uniform1f(noiseVolumeProgram.uniformLocations.zSlice, z);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  // Restore state
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, canvas.width, canvas.height);
}

function renderBlockNoise(structuralMoveTime, wrappingTime) {
  if (!blockNoiseProgram || !blockNoiseFBO) return;

  // Resize if blockingScale changed
  const neededSize = Math.max(1, Math.ceil(blockingScale));
  if (neededSize !== blockNoiseSize) {
    setupBlockNoiseFBO();
  }

  gl.bindFramebuffer(gl.FRAMEBUFFER, blockNoiseFBO);
  gl.viewport(0, 0, blockNoiseSize, blockNoiseSize);
  gl.useProgram(blockNoiseProgram);

  gl.uniform1f(blockNoiseProgram.uniformLocations.seed, seed);
  gl.uniform1f(blockNoiseProgram.uniformLocations.blocking, blockingScale);
  gl.uniform2f(blockNoiseProgram.uniformLocations.blackNoiseScale, blackNoiseScale[0], blackNoiseScale[1]);
  gl.uniform1f(blockNoiseProgram.uniformLocations.structuralMoveTime, structuralMoveTime);
  gl.uniform1f(blockNoiseProgram.uniformLocations.wrappingTime, wrappingTime);

  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.enableVertexAttribArray(blockNoiseProgram.attribLocations.position);
  gl.vertexAttribPointer(blockNoiseProgram.attribLocations.position, 2, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
  gl.enableVertexAttribArray(blockNoiseProgram.attribLocations.texCoord);
  gl.vertexAttribPointer(blockNoiseProgram.attribLocations.texCoord, 2, gl.FLOAT, false, 0, 0);

  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  // Restore viewport
  gl.viewport(0, 0, canvas.width, canvas.height);
}

function setupBuffers() {
    // Create a position buffer for a full-screen quad
    const positions = new Float32Array([
        -1.0, -1.0,
         1.0, -1.0,
        -1.0,  1.0,
         1.0,  1.0
    ]);
    
    vertexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
    
    // Create a texture coordinate buffer
    const texCoords = new Float32Array([
        0.0, 0.0,
        1.0, 0.0,
        0.0, 1.0,
        1.0, 1.0
    ]);
    
    texCoordBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, texCoords, gl.STATIC_DRAW);
    
    // Create vertex buffer for drawing (simple quad)
    if (!drawVertexBuffer) {
        drawVertexBuffer = gl.createBuffer();
    }
}



let lastTime = 0;
let frameCount = 0;
let totalFrameCount = 0; // Total frame count that doesn't reset
let lastFpsUpdateTime = 0;
let currentFps = 0;
let fpsUpdateInterval = 1000; 
let lastRenderTime = 0;

function animate() {
  const now = performance.now();
  const desiredFrameInterval = 1000 / targetFps;

  // Keep frameInterval in sync with the chosen target
  if (desiredFrameInterval !== frameInterval) {
    frameInterval = desiredFrameInterval;
  }

  // // Throttle rendering to the target FPS
  const elapsedSinceRender = now - lastRenderTime;
  if (elapsedSinceRender < frameInterval) {
    requestAnimationFrame(animate);
    return;
  }
  //Reduce drift by carrying over leftover time
  lastRenderTime = now - (elapsedSinceRender % frameInterval);

  // Only advance deterministic simulation time when not frozen.
  if (!globalFreeze) {
    time = totalFrameCount / targetFps;
    // Track frame rate using rendered frames only.
    frameCount++;
    totalFrameCount++;
  }
  // When frozen, time stays at its current value (not updated).
  
  // Handle force reset frames
  if (forceResetFrames > 0) {
    forceResetFrames--;
    if (forceResetFrames <= 0) {
      forceReset = false;
    }
  }
  
  render();

  const elapsed = now - lastFpsUpdateTime;
  if (elapsed >= fpsUpdateInterval) {
    currentFps = Math.round((frameCount * 1000) / elapsed);
    frameCount = 0;
    lastFpsUpdateTime = now;
    updateLowFpsIndicator();
    if (currentFps !== DEFAULT_TARGET_FPS) {
      console.log(`Current FPS: ${ currentFps }`)
    };
  }

  requestAnimationFrame(animate);
}


function render() {
  // Ensure all resources are ready before rendering
  if (!isLoaded || !program || !textures[0] || !textures[1]) return;

  // Ping-pong between framebuffers
  const nextFbIndex = (currentFbIndex + 1) % 2;

  // Compute block noise pass before main pass
  {
    const moveTime = time * (targetFps / 30.);
    const smt = manualMode ? 0.0 : moveTime * structuralTimeMult;
    renderBlockNoise(smt, smt * 2.);
  }

  // Main compute pass - render to framebuffer
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffers[nextFbIndex]);
  gl.useProgram(program);

  // Set uniforms
  gl.uniform1f(program.uniformLocations.targetFps, targetFps);
  gl.uniform1f(program.uniformLocations.time, time);
  gl.uniform1f(program.uniformLocations.frameCount, totalFrameCount);
  gl.uniform1f(program.uniformLocations.displayFps, currentFps);
  
  gl.uniform2f(
    program.uniformLocations.resolution,
    canvas.width,
    canvas.height
  );
  gl.uniform1f(
    program.uniformLocations.pixelRatio,
    FIXED_PIXEL_RATIO_UNIFORM
  );
  gl.uniform1f(program.uniformLocations.seed, seed);
  gl.uniform1f(program.uniformLocations.baseChunkSize, baseChunkSize);
  // Apply manual mode: set thresholds to 0 to stop default movements
  const effectiveMoveThreshold = manualMode ? 0.0 : shouldMoveThreshold;
  const effectiveFallThreshold = manualMode ? 0.0 : shouldFallThreshold;
  const effectiveResetThreshold = manualMode ? 0.0 : resetThreshold;
  const effectiveExtraFallThreshold = manualMode ? 0.0 : extraFallShapeThreshold;
  const effectiveExtraMoveThreshold = manualMode ? 0.0 : extraMoveShapeThreshold;
  
  gl.uniform1f(
    program.uniformLocations.shouldMoveThreshold,
    effectiveMoveThreshold
  );
  gl.uniform1f(program.uniformLocations.moveSpeed, moveSpeed);
  gl.uniform2f(
    program.uniformLocations.moveShapeScale,
    moveShapeScale[0],
    moveShapeScale[1]
  );
  gl.uniform1f(program.uniformLocations.moveShapeSpeed, moveShapeSpeed);
  gl.uniform1f(program.uniformLocations.resetThreshold, effectiveResetThreshold);
  gl.uniform1f(program.uniformLocations.resetEdgeThreshold, resetEdgeThreshold);
  gl.uniform2f(
    program.uniformLocations.resetNoiseScale,
    resetNoiseScale[0],
    resetNoiseScale[1]
  );
  gl.uniform1f(program.uniformLocations.shouldFallThreshold, effectiveFallThreshold);
  gl.uniform2f(
    program.uniformLocations.shouldFallScale,
    shouldFallScale[0],
    shouldFallScale[1]
  );
  gl.uniform1f(program.uniformLocations.fallShapeSpeed, fallShapeSpeed);
  gl.uniform1f(program.uniformLocations.fxWithBlocking, fxWithBlocking);
  gl.uniform1f(program.uniformLocations.blockTimeMult, blockTimeMult);
  gl.uniform1f(program.uniformLocations.structuralTimeMult, structuralTimeMult);
  gl.uniform1f(
    program.uniformLocations.extraMoveShapeThreshold,
    effectiveExtraMoveThreshold
  );
  gl.uniform2f(
    program.uniformLocations.extraMoveStutterScale,
    extraMoveStutterScale[0],
    extraMoveStutterScale[1]
  );
  gl.uniform1f(
    program.uniformLocations.extraMoveStutterThreshold,
    extraMoveStutterThreshold
  );
  gl.uniform1f(
    program.uniformLocations.extraFallShapeThreshold,
    effectiveExtraFallThreshold
  );
  gl.uniform1f(
    program.uniformLocations.extraFallShapeTimeMult,
    extraFallShapeTimeMult
  );
  gl.uniform2f(
    program.uniformLocations.extraFallStutterScale,
    extraFallStutterScale[0],
    extraFallStutterScale[1]
  );
  gl.uniform1f(
    program.uniformLocations.extraFallStutterThreshold,
    extraFallStutterThreshold
  );
  gl.uniform1f(
    program.uniformLocations.fallWaterfallMult,
    fallWaterfallMult
  );
  gl.uniform2f(
    program.uniformLocations.extraFallShapeScale,
    extraFallShapeScale[0],
    extraFallShapeScale[1]
  );
  gl.uniform2f(
    program.uniformLocations.extraMoveShapeScale,
    extraMoveShapeScale[0],
    extraMoveShapeScale[1]
  );
  gl.uniform1f(program.uniformLocations.blocking, blockingScale);
  gl.uniform2f(
    program.uniformLocations.blackNoiseScale,
    blackNoiseScale[0],
    blackNoiseScale[1]
  );
  gl.uniform1f(program.uniformLocations.blackNoiseEdgeMult, blackNoiseEdgeMult);
  gl.uniform1f(program.uniformLocations.blackNoiseThreshold, blackNoiseThreshold);
  gl.uniform1f(program.uniformLocations.useRibbonThreshold, useRibbonThreshold);
  gl.uniform1f(program.uniformLocations.ribbonDirtThreshold, ribbonDirtThreshold);
  gl.uniform2f(
    program.uniformLocations.dirtNoiseScale,
    dirtNoiseScale[0],
    dirtNoiseScale[1]
  );
  gl.uniform1i(program.uniformLocations.useGrayscale, useGrayscale ? 1 : 0);
  gl.uniform1i(program.uniformLocations.useColorCycle, useColorCycle ? 1 : 0);
  gl.uniform2f(
    program.uniformLocations.blankStaticScale,
    blankStaticScale[0],
    blankStaticScale[1]
  );
  gl.uniform1f(program.uniformLocations.blankStaticThreshold, blankStaticThreshold);
  gl.uniform1f(program.uniformLocations.blankStaticTimeMult, blankStaticTimeMult);
  gl.uniform3f(
    program.uniformLocations.blankColor,
    blankColor[0],
    blankColor[1],
    blankColor[2]
  );
  gl.uniform3f(
    program.uniformLocations.staticColor1,
    staticColor1[0],
    staticColor1[1],
    staticColor1[2]
  );
  gl.uniform3f(
    program.uniformLocations.staticColor2,
    staticColor2[0],
    staticColor2[1],
    staticColor2[2]
  );
  gl.uniform3f(
    program.uniformLocations.staticColor3,
    staticColor3[0],
    staticColor3[1],
    staticColor3[2]
  );
  gl.uniform1f(program.uniformLocations.cycleColorHueSpeed, cycleColorHueSpeed);
  gl.uniform1f(program.uniformLocations.globalFreeze, globalFreeze ? 1.0 : 0.0);
  gl.uniform1f(program.uniformLocations.forceReset, forceReset ? 1.0 : 0.0);
  gl.uniform1f(program.uniformLocations.manualMode, manualMode ? 1.0 : 0.0);
  gl.uniform1f(program.uniformLocations.defaultWaterfallMode, defaultWaterfallMode ? 1.0 : 0.0);

  // Bind movement texture to TEXTURE1
  gl.activeTexture(gl.TEXTURE1);
  if (movementTexture && program.uniformLocations.movementTexture) {
    gl.bindTexture(gl.TEXTURE_2D, movementTexture);
    gl.uniform1i(program.uniformLocations.movementTexture, 1);
  } else {
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  // Bind paint texture to TEXTURE4
  gl.activeTexture(gl.TEXTURE4);
  if (paintTexture && program.uniformLocations.paintTexture) {
    gl.bindTexture(gl.TEXTURE_2D, paintTexture);
    gl.uniform1i(program.uniformLocations.paintTexture, 4);
  } else {
    gl.bindTexture(gl.TEXTURE_2D, null);
  }
  
  // Bind the block noise texture to TEXTURE2
  if (blockNoiseTexture && program.uniformLocations.blockNoiseTex) {
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, blockNoiseTexture);
    gl.uniform1i(program.uniformLocations.blockNoiseTex, 2);
  }

  // Bind the 3D noise volume to TEXTURE3
  if (noiseVolumeTexture && program.uniformLocations.noiseVolume) {
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_3D, noiseVolumeTexture);
    gl.uniform1i(program.uniformLocations.noiseVolume, 3);
  }

  // Bind the input texture (previous frame)
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, textures[currentFbIndex]);
  gl.uniform1i(program.uniformLocations.texture, 0);

  // Set up position attribute
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.enableVertexAttribArray(program.attribLocations.position);
  gl.vertexAttribPointer(
    program.attribLocations.position,
    2,
    gl.FLOAT,
    false,
    0,
    0
  );

  // Set up texture coordinate attribute
  gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
  gl.enableVertexAttribArray(program.attribLocations.texCoord);
  gl.vertexAttribPointer(
    program.attribLocations.texCoord,
    2,
    gl.FLOAT,
    false,
    0,
    0
  );

  // Draw the quad
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  // Render the result to the screen using the minimal blit shader
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.useProgram(displayProgram);

  // Bind the texture we just rendered to
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, textures[nextFbIndex]);
  gl.uniform1i(displayProgram.uniformLocations.texture, 0);

  // Set up position attribute for display program
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.enableVertexAttribArray(displayProgram.attribLocations.position);
  gl.vertexAttribPointer(displayProgram.attribLocations.position, 2, gl.FLOAT, false, 0, 0);

  // Set up texture coordinate attribute for display program
  gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
  gl.enableVertexAttribArray(displayProgram.attribLocations.texCoord);
  gl.vertexAttribPointer(displayProgram.attribLocations.texCoord, 2, gl.FLOAT, false, 0, 0);

  // Draw to the canvas
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  // Paint buffer is persistent (like movement) — cleared only by erase or global clear

  // Update the current framebuffer index
  currentFbIndex = nextFbIndex;

  // Frame-precise recording stop
  if (isRecordingVideo) {
    recordingFramesRemaining--;
    if (recordingFramesRemaining <= 0) {
      stopVideoRecording();
    }
  }
}

function setupKeyboardListeners() {
  window.addEventListener('keydown', (event) => {
    const key = event.key.toLowerCase();

    // Global actions always allowed (even when paused)
    switch(key) {
      case ' ':
        event.preventDefault(); // Prevent page scroll
        actions.toggleGlobalFreeze();
        return;
      case 'p':
        actions.saveScreenshot();
        return;
      case 'r':
        actions.recordVideo();
        return;
      case 'n':
        actions.newSeed();
        return;
      case 'm':
        if (isMenuOpen) {
          closeRadialMenu();
        } else {
          openRadialMenu();
        }
        return;
    }

    // Block all canvas/drawing actions when paused
    if (globalFreeze) return;

    switch(key) {
      // Arrow keys for cross actions
      case 'arrowup':
        actions.waterfallUp();
        break;
      case 'arrowdown':
        actions.waterfallDown();
        break;
      case 'arrowleft':
        actions.moveLeft();
        break;
      case 'arrowright':
        actions.moveRight();
        break;

      // Letter shortcuts for modes
      case 'e':
        actions.cycleEraseMode();
        break;
      case 'f':
        actions.freezeBrush();
        break;
      case 's':
        actions.shuffle();
        break;
      case 't':
        actions.trickle();
        break;
      case 'd':
        actions.drawStatic();
        break;
      case 'g':
        actions.drawGem();
        break;
      case 'o':
        actions.drawSpace();
        break;

      // Brush size
      case '[':
        actions.decreaseBrushSize();
        break;
      case ']':
        actions.increaseBrushSize();
        break;

      // Manual mode
      case 'x':
        actions.toggleManualMode();
        break;
    }
  });
}

function saveScreenshot() {
  gl.viewport(0, 0, canvas.width, canvas.height);
  
  const pixels = new Uint8Array(canvas.width * canvas.height * 4);
  
  // Try reading from screen first
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  
  // Fallback: read from texture if screen read failed (all zeros)
  if (!pixels.some(p => p !== 0) && textures[currentFbIndex]) {
    const tempFb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, tempFb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, textures[currentFbIndex], 0);
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
    console.error('Failed to get 2D context');
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
      console.error('Failed to create blob');
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

function toggleVideoRecording() {
  if (isRecordingVideo) {
    stopVideoRecording();
  } else {
    startVideoRecording();
  }
}

function startVideoRecording() {
  const stream = canvas.captureStream(); // captures at the canvas render rate
  recordedChunks = [];

  // Pick best available format (prefer MP4/H.264 for QuickTime compatibility)
  const formats = [
    'video/mp4; codecs=avc1.42E01E',
    'video/mp4',
    'video/webm; codecs=vp9',
    'video/webm',
  ];
  const mimeType = formats.find(f => MediaRecorder.isTypeSupported(f)) || 'video/webm';
  const fileExt = mimeType.startsWith('video/mp4') ? 'mp4' : 'webm';

  mediaRecorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: RECORD_BITRATE });

  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) recordedChunks.push(e.data);
  };

  mediaRecorder.onstop = () => {
    const blob = new Blob(recordedChunks, { type: mimeType });
    console.log(`Video encoding finished, blob size: ${blob.size}`);
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
    mediaRecorder = null;
    recordedChunks = [];
    console.log('Video saved');
  };

  mediaRecorder.start();
  isRecordingVideo = true;

  // Show recording indicator
  const indicator = document.getElementById('gif-recording-indicator');
  if (indicator) indicator.classList.remove('hidden');
  const btn = document.getElementById('btn-record-gif');
  if (btn) btn.classList.add('recording');

  // Frame-precise duration for perfect hue-cycle looping
  recordingFramesRemaining = RECORD_DURATION_FRAMES;
  console.log(`Video recording started (${RECORD_DURATION_FRAMES} frames / ~${RECORD_DURATION_SECONDS.toFixed(1)}s, format: ${mimeType})`);
}

function stopVideoRecording() {
  if (!isRecordingVideo) return;

  isRecordingVideo = false;

  // Hide recording indicator
  const indicator = document.getElementById('gif-recording-indicator');
  if (indicator) indicator.classList.add('hidden');
  const btn = document.getElementById('btn-record-gif');
  if (btn) btn.classList.remove('recording');

  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
    console.log('Video recording stopped');
  }
}

function resetWithNewSeed() {
  // Generate new seed first, then randomize parameters with it
  seed = setSeed();
  console.log("New seed:", seed);
  
  // Randomize shader parameters using the seed
  randomizeShaderParameters(seed);
  // Regenerate noise volume for new seed
  generateNoiseVolume();

  // Reset simulation timing counters.
  time = 0;

  // Reset frame count
  frameCount = 0;
  totalFrameCount = 0;
  lastFpsUpdateTime = performance.now();

  // Clear framebuffers by reinitializing them
  setupFramebuffers();

  console.log('Reset with new seed');
}

// Convert mouse coordinates to canvas pixel coordinates
function getCanvasCoordinates(event) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const x = (event.clientX - rect.left) * scaleX;
  // Flip Y coordinate: canvas has origin at top-left, WebGL texture has origin at bottom-left
  const y = canvas.height - (event.clientY - rect.top) * scaleY;
  return { x, y };
}

// Draw a circle at the specified position using WebGL
function drawAt(x, y) {
  if (!drawProgram) {
    console.warn('Drawing program not initialized');
    return;
  }

  // Snap position to grid in blocking mode, keep square shape
  let radiusX = brushSize;
  let radiusY = brushSize;
  if (fxWithBlocking) {
    const blockWidthPx = canvas.width / blockingScale;
    const blockHeightPx = canvas.height / blockingScale;
    // Use brush-scaled grid: snap to whichever is smaller (brush or block)
    const snapX = Math.min(blockWidthPx, Math.max(1, Math.floor(brushSize)));
    const snapY = Math.min(blockHeightPx, Math.max(1, Math.floor(brushSize * (blockHeightPx / blockWidthPx))));
    x = Math.floor(x / snapX) * snapX + snapX / 2;
    y = Math.floor(y / snapY) * snapY + snapY / 2;
    radiusY = brushSize * (blockHeightPx / blockWidthPx);
  }

  // Determine target buffer and color
  const movementMode = isMovementMode();
  const paintMode = isPaintMode();

  // Build brush-sized quad vertices (clamp to canvas bounds)
  const left = Math.max(0, x - radiusX);
  const right = Math.min(canvas.width, x + radiusX);
  const bottom = Math.max(0, y - radiusY);
  const top = Math.min(canvas.height, y + radiusY);

  const vertices = new Float32Array([
    left, bottom,
    right, bottom,
    left, top,
    right, top
  ]);

  gl.useProgram(drawProgram);
  gl.viewport(0, 0, canvas.width, canvas.height);

  // Set up vertex buffer with brush-sized quad
  gl.bindBuffer(gl.ARRAY_BUFFER, drawVertexBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(drawProgram.attribLocations.position);
  gl.vertexAttribPointer(drawProgram.attribLocations.position, 2, gl.FLOAT, false, 0, 0);

  // Set uniforms
  gl.uniform2f(drawProgram.uniformLocations.resolution, canvas.width, canvas.height);
  gl.uniform2f(drawProgram.uniformLocations.center, x, y);
  gl.uniform2f(drawProgram.uniformLocations.radius, radiusX, radiusY);
  gl.uniform1f(drawProgram.uniformLocations.squareMode, fxWithBlocking ? 1.0 : 0.0);

  if (currentMode === 'erase') {
    // Erase mode: clear buffers based on eraseVariant
    gl.uniform3f(drawProgram.uniformLocations.color, 0.0, 0.0, 0.0);

    if (eraseVariant === 'movement' || eraseVariant === 'both') {
      gl.colorMask(true, true, true, true);
      gl.bindFramebuffer(gl.FRAMEBUFFER, movementFBO);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    if (eraseVariant === 'paint' || eraseVariant === 'both') {
      gl.colorMask(true, false, false, true);
      gl.bindFramebuffer(gl.FRAMEBUFFER, paintFBO);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
  } else if (movementMode) {
    // Movement modes: write to movement buffer with channel isolation
    const color = getMovementColor();
    gl.uniform3f(drawProgram.uniformLocations.color, color[0], color[1], color[2]);

    // Channel isolation: R for horizontal, G for vertical, B always (clears/sets freeze)
    const writeR = currentMode === 'shuffle' || currentMode === 'move';
    const writeG = currentMode === 'waterfall' || currentMode === 'trickle';
    const writeB = true;
    gl.colorMask(writeR, writeG, writeB, true);

    gl.bindFramebuffer(gl.FRAMEBUFFER, movementFBO);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // Movement also clears paint (movement overrides paint)
    gl.colorMask(true, false, false, true);
    gl.uniform3f(drawProgram.uniformLocations.color, 0.0, 0.0, 0.0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, paintFBO);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  } else if (paintMode) {
    // Paint modes: write to paint buffer
    const color = getPaintColor();
    gl.uniform3f(drawProgram.uniformLocations.color, color[0], color[1], color[2]);
    gl.colorMask(true, false, false, true);

    gl.bindFramebuffer(gl.FRAMEBUFFER, paintFBO);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  }

  // Reset color mask
  gl.colorMask(true, true, true, true);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

// Draw a line between two points (for smooth drawing)
function drawLine(x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const distance = Math.sqrt(dx * dx + dy * dy);
  const steps = Math.max(1, Math.floor(distance / (brushSize * 0.5)));
  
  // Draw multiple circles along the line
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = x1 + dx * t;
    const y = y1 + dy * t;
    drawAt(x, y);
  }
}

function setupMouseListeners() {
  // Mouse events
  canvas.addEventListener('mousedown', (event) => {
    // Don't start drawing if paused, menu is open, or in drawer swipe zone
    if (globalFreeze || isMenuOpen) return;
    if (event.clientY > window.innerHeight - SWIPE_BOTTOM_ZONE) return;

    isDrawing = true;
    const coords = getCanvasCoordinates(event);
    lastDrawX = coords.x;
    lastDrawY = coords.y;
    drawAt(coords.x, coords.y);
  });

  // Window-level mousemove so drawing continues over the drawer handle
  window.addEventListener('mousemove', (event) => {
    if (!isDrawing || globalFreeze || isMenuOpen) return;
    const coords = getCanvasCoordinates(event);
    drawLine(lastDrawX, lastDrawY, coords.x, coords.y);
    lastDrawX = coords.x;
    lastDrawY = coords.y;
  });

  // Window-level mouseup so drawing stops even if mouse is outside the canvas
  window.addEventListener('mouseup', () => {
    isDrawing = false;
  });

  // Touch events for mobile support
  canvas.addEventListener('touchstart', (event) => {
    event.preventDefault();
    // Don't start drawing if paused, menu is open, or in drawer swipe zone
    if (globalFreeze || isMenuOpen) return;
    const touch = event.touches[0];
    if (!touch) return;
    if (touch.clientY > window.innerHeight - SWIPE_BOTTOM_ZONE) return;

    isDrawing = true;
    if (touch) {
      const coords = getCanvasCoordinates(touch);
      lastDrawX = coords.x;
      lastDrawY = coords.y;
      drawAt(coords.x, coords.y);
    }
  });

  canvas.addEventListener('touchmove', (event) => {
    event.preventDefault();
    if (!isDrawing || globalFreeze || isMenuOpen) return;
    const touch = event.touches[0];
    if (!touch) return;
    const coords = getCanvasCoordinates(touch);
    drawLine(lastDrawX, lastDrawY, coords.x, coords.y);
    lastDrawX = coords.x;
    lastDrawY = coords.y;
  });

  canvas.addEventListener('touchend', (event) => {
    event.preventDefault();
    isDrawing = false;
  });

  canvas.addEventListener('touchcancel', (event) => {
    event.preventDefault();
    isDrawing = false;
  });
}

// ===== BRUSH OVERLAY =====
let brushOverlay = null;

function setupBrushOverlay() {
  brushOverlay = document.getElementById('brush-overlay');
  if (!brushOverlay) {
    console.warn('Brush overlay element not found');
    return;
  }

  // Mouse move - always track position
  canvas.addEventListener('mousemove', updateBrushOverlay);
  canvas.addEventListener('mouseenter', showBrushOverlay);
  canvas.addEventListener('mouseleave', hideBrushOverlay);

  // Touch events
  canvas.addEventListener('touchmove', handleTouchOverlay, { passive: true });
  canvas.addEventListener('touchstart', handleTouchOverlay, { passive: true });
  canvas.addEventListener('touchend', hideBrushOverlay);
  canvas.addEventListener('touchcancel', hideBrushOverlay);

  // Pointer events for pen/stylus hover detection
  canvas.addEventListener('pointerenter', handlePointerOverlay);
  canvas.addEventListener('pointermove', handlePointerOverlay);
  canvas.addEventListener('pointerleave', hideBrushOverlay);
}

function updateBrushOverlay(event) {
  if (!brushOverlay || isMenuOpen) {
    hideBrushOverlay();
    return;
  }

  const x = event.clientX;
  const y = event.clientY;

  updateBrushOverlayPosition(x, y);
  showBrushOverlay();
}

function handleTouchOverlay(event) {
  if (!brushOverlay || isMenuOpen) {
    hideBrushOverlay();
    return;
  }

  const touch = event.touches[0];
  if (!touch) return;

  updateBrushOverlayPosition(touch.clientX, touch.clientY);
  showBrushOverlay();
}

function handlePointerOverlay(event) {
  if (!brushOverlay || isMenuOpen) {
    hideBrushOverlay();
    return;
  }

  // Show overlay for pen/stylus hover (pointerType is 'pen') and mouse
  // Touch is handled separately
  if (event.pointerType === 'touch') return;

  updateBrushOverlayPosition(event.clientX, event.clientY);
  showBrushOverlay();
}

function updateBrushOverlayPosition(clientX, clientY) {
  if (!brushOverlay) return;

  // Position the overlay at cursor
  brushOverlay.style.left = clientX + 'px';
  brushOverlay.style.top = clientY + 'px';

  // Convert simulation pixels to displayed CSS pixels.
  const rect = canvas.getBoundingClientRect();
  const displayScaleX = rect.width / canvas.width;
  const displayScaleY = rect.height / canvas.height;
  let displayWidth = (brushSize * 2) * displayScaleX;
  let displayHeight = (brushSize * 2) * displayScaleY;

  if (fxWithBlocking) {
    const blockWidthPx = canvas.width / blockingScale;
    const blockHeightPx = canvas.height / blockingScale;
    displayHeight = (brushSize * 2) * (blockHeightPx / blockWidthPx) * displayScaleY;
    brushOverlay.classList.add('square');
  } else {
    brushOverlay.classList.remove('square');
  }

  brushOverlay.style.width = displayWidth + 'px';
  brushOverlay.style.height = displayHeight + 'px';
}

function showBrushOverlay() {
  if (brushOverlay && !isMenuOpen && !isMenuAnimating && !globalFreeze) {
    brushOverlay.classList.add('visible');
  }
}

function hideBrushOverlay() {
  if (brushOverlay) {
    brushOverlay.classList.remove('visible');
  }
}

// ===== RADIAL MENU SYSTEM =====
let menuContainer = null;
let radialMenu = null;
let isMenuOpen = false;
let isMenuAnimating = false;
let brushPreviewEnabled = false;
let isDraggingBrushSize = false;
let brushDragStartY = 0;
let brushDragStartIndex = 0;

// Swipe-up drawer detection
let swipeStartY = 0;
let swipeStartX = 0;
let swipeStartTime = 0;
let isSwipingDrawer = false;
const SWIPE_BOTTOM_ZONE = 60;       // px from bottom edge where swipe can start
const SWIPE_MIN_DISTANCE = 30;      // minimum upward px to trigger open
const SWIPE_MAX_HORIZONTAL = 50;    // max horizontal drift allowed
const SWIPE_MAX_DURATION = 500;     // max ms for the gesture

function setupRadialMenu() {
  menuContainer = document.getElementById('menu-container');

  if (!menuContainer) {
    console.warn('Menu container not found');
    return;
  }

  console.log('Setting up menu...');

  // Hide brush overlay when touching the menu area
  menuContainer.addEventListener('touchstart', hideBrushOverlay, { passive: true });

  // Universal action handler using data-action attributes
  menuContainer.addEventListener('click', (e) => {
    if (isMenuAnimating) return;
    const actionElement = e.target.closest('[data-action]');
    if (!actionElement) return;

    e.preventDefault();
    e.stopPropagation();

    const actionName = actionElement.dataset.action;

    // When paused, only allow unpause, screenshot, record, and menu close
    const pauseAllowedActions = ['toggleGlobalFreeze', 'saveScreenshot', 'recordVideo', 'closeMenu'];
    if (globalFreeze && !pauseAllowedActions.includes(actionName)) return;

    // Special handling for settings toggle
    if (actionName === 'openSettings') {
      toggleSettingsSubmenu();
      return;
    }

    // Execute action if it exists
    if (actions[actionName]) {
      actions[actionName]();
    } else {
      console.warn('Unknown action:', actionName);
    }
  });

  // Setup settings checkboxes
  const manualModeCheckbox = document.getElementById('setting-manual-mode');
  const waterfallModeCheckbox = document.getElementById('setting-waterfall-mode');
  const blockFXCheckbox = document.getElementById('setting-block-fx');

  if (manualModeCheckbox) {
    manualModeCheckbox.checked = manualMode;
    manualModeCheckbox.addEventListener('change', (e) => {
      manualMode = e.target.checked;
      console.log('Manual mode:', manualMode ? 'ON' : 'OFF');
      updateStatusDisplay();
    });
  }

  if (blockFXCheckbox) {
    blockFXCheckbox.checked = fxWithBlocking;
    blockFXCheckbox.addEventListener('change', (e) => {
      fxWithBlocking = e.target.checked;
      console.log('Block FX:', fxWithBlocking ? 'ON' : 'OFF');
      generateBrushSizeOptions();
      updateBrushSizeDisplay();
      updateStatusDisplay();
    });
  }

  // Setup brush size drag on display area
  const brushDisplay = menuContainer.querySelector('.brush-size-display');
  if (brushDisplay) {
    brushDisplay.addEventListener('mousedown', startBrushDrag);
    brushDisplay.addEventListener('touchstart', startBrushDrag);
  }

  // Swipe-up from bottom edge to open menu
  document.addEventListener('pointerdown', handleSwipeStart);
  document.addEventListener('pointermove', handleSwipeMove);
  document.addEventListener('pointerup', handleSwipeEnd);
  document.addEventListener('pointercancel', handleSwipeEnd);

  // Tap on drawer handle also opens menu
  const drawerHandle = document.getElementById('drawer-handle');
  if (drawerHandle) {
    drawerHandle.addEventListener('pointerdown', (e) => {
      if (!isMenuOpen && !isMenuAnimating) {
        e.stopPropagation();
        openRadialMenu();
      }
    });
  }

  // Click outside menu to close it and start drawing
  document.addEventListener('pointerdown', handleClickOutside);

  // Brush drag global handlers
  document.addEventListener('mousemove', handleBrushDrag);
  document.addEventListener('touchmove', handleBrushDrag, { passive: false });
  document.addEventListener('mouseup', endBrushDrag);
  document.addEventListener('touchend', endBrushDrag);

  updateMenuActiveStates();
  updateBrushSizeDisplay();
  console.log('Menu setup complete');
}

function toggleSettingsSubmenu() {
  const submenu = document.getElementById('settings-submenu');
  if (submenu) {
    submenu.classList.toggle('hidden');
  }
}

function handleSwipeStart(e) {
  if (isMenuOpen) return;

  const clientY = e.clientY;
  const clientX = e.clientX;
  const viewportHeight = window.innerHeight;

  // Only detect swipes starting near the bottom edge
  if (clientY < viewportHeight - SWIPE_BOTTOM_ZONE) return;

  isSwipingDrawer = true;
  swipeStartY = clientY;
  swipeStartX = clientX;
  swipeStartTime = Date.now();
}

function handleSwipeMove(e) {
  if (!isSwipingDrawer) return;

  const dx = Math.abs(e.clientX - swipeStartX);
  const dy = swipeStartY - e.clientY; // positive = upward

  // Cancel if horizontal drift is too large
  if (dx > SWIPE_MAX_HORIZONTAL) {
    isSwipingDrawer = false;
    return;
  }

  // Check if swipe distance and timing qualify
  const elapsed = Date.now() - swipeStartTime;
  if (dy >= SWIPE_MIN_DISTANCE && elapsed <= SWIPE_MAX_DURATION) {
    isSwipingDrawer = false;
    openRadialMenu();
  }
}

function handleSwipeEnd() {
  isSwipingDrawer = false;
}

function handleClickOutside(e) {
  if (!isMenuOpen || !menuContainer || isMenuAnimating) return;

  // Check if click is inside the menu container
  if (menuContainer.contains(e.target)) {
    return; // Click is inside menu, don't close
  }

  // Click is outside menu - close it
  closeRadialMenu();
}

function openRadialMenu() {
  if (!menuContainer || isMenuAnimating) return;

  // Cancel any ongoing drawing
  isDrawing = false;

  // Cancel any in-progress swipe
  isSwipingDrawer = false;

  // Hide brush overlay
  hideBrushOverlay();

  // Block interactions during animation
  isMenuAnimating = true;
  menuContainer.addEventListener('transitionend', () => { isMenuAnimating = false; }, { once: true });
  setTimeout(() => { isMenuAnimating = false; }, 300);

  // Slide menu up
  menuContainer.classList.remove('menu-closed');
  isMenuOpen = true;

  // Update brush size display
  updateBrushSizeDisplay();
  updateMenuActiveStates();
  updateStatusDisplay();
}

function closeRadialMenu() {
  if (!menuContainer || !isMenuOpen || isMenuAnimating) return;

  // Close any open submenus
  closeAllSubmenus();

  // Block interactions during animation
  isMenuAnimating = true;
  menuContainer.addEventListener('transitionend', () => { isMenuAnimating = false; }, { once: true });
  setTimeout(() => { isMenuAnimating = false; }, 300);

  // Hide brush overlay before setting isMenuOpen to false,
  // so touch events from the close interaction don't re-show it
  hideBrushOverlay();

  // Slide menu down (CSS transition handles animation)
  menuContainer.classList.add('menu-closed');
  isMenuOpen = false;
}

function closeAllSubmenus() {
  // Close settings submenu
  const settingsSubmenu = document.getElementById('settings-submenu');
  if (settingsSubmenu) {
    settingsSubmenu.classList.add('hidden');
  }
}

function handleMenuItemClick(e) {
  const item = e.currentTarget;
  const mode = item.dataset.mode;
  const direction = item.dataset.direction;
  const variant = item.dataset.variant;

  console.log('Menu item clicked:', mode, direction, variant);

  if (mode === 'waterfall' || mode === 'move') {
    currentMode = mode;
    currentDirection = direction || currentDirection;
  } else if (mode) {
    currentMode = mode;
  }

  updateStatusDisplay();
  updateMenuActiveStates();
}

function handleSubmenuItemClick(e) {
  const item = e.currentTarget;
  const mode = item.dataset.mode;
  const variant = item.dataset.variant;

  console.log('Submenu item clicked:', mode, variant);

  if (mode) {
    currentMode = mode;
  }

  updateStatusDisplay();
  updateMenuActiveStates();
}

function updateMenuActiveStates() {
  if (!menuContainer) return;

  // Get all action buttons
  const actionButtons = menuContainer.querySelectorAll('[data-action]');

  actionButtons.forEach(btn => {
    const action = btn.dataset.action;
    let isActive = false;

    // Determine active state based on action and current mode
    switch(action) {
      case 'waterfallUp':
        isActive = currentMode === 'waterfall' && currentDirection === 'up';
        break;
      case 'waterfallDown':
        isActive = currentMode === 'waterfall' && currentDirection === 'down';
        break;
      case 'moveLeft':
        isActive = currentMode === 'move' && currentDirection === 'left';
        break;
      case 'moveRight':
        isActive = currentMode === 'move' && currentDirection === 'right';
        break;
      case 'eraseMovement':
        isActive = currentMode === 'erase' && (eraseVariant === 'movement' || eraseVariant === 'both');
        break;
      case 'resetInitialMovement':
        isActive = currentMode === 'erase' && (eraseVariant === 'paint' || eraseVariant === 'both');
        break;
      case 'freezeBrush':
        isActive = currentMode === 'freeze';
        break;
      case 'shuffle':
        isActive = currentMode === 'shuffle';
        break;
      case 'trickle':
        isActive = currentMode === 'trickle';
        break;
      case 'drawStatic':
        isActive = currentMode === 'static';
        break;
      case 'drawGem':
        isActive = currentMode === 'gem';
        break;
      case 'drawSpace':
        isActive = currentMode === 'empty';
        break;
      case 'toggleGlobalFreeze':
        isActive = globalFreeze;
        break;
      case 'toggleManualMode':
        isActive = manualMode;
        break;
    }

    btn.classList.toggle('active', isActive);

    // Dim buttons that are disabled when paused (never dim the pause button itself)
    const pauseAllowedActions = ['toggleGlobalFreeze', 'saveScreenshot', 'recordVideo'];
    const isPausedDisabled = globalFreeze && !pauseAllowedActions.includes(action);
    btn.classList.toggle('paused-disabled', isPausedDisabled);

    // Update waterfall/straight arrow icons (both always show same variant)
    if (action === 'waterfallUp' || action === 'waterfallDown') {
      const icon = btn.querySelector('.icon');
      if (icon) {
        if (action === 'waterfallUp') {
          icon.textContent = waterfallVariant ? '⤊' : '↑';
        } else {
          icon.textContent = waterfallVariant ? '⤋' : '↓';
        }
      }
    }
  });

  // Toggle paused state on menu sections
  const brushColumn = document.querySelector('.brush-column');
  if (brushColumn) brushColumn.classList.toggle('paused', globalFreeze);
  const movementSection = document.querySelector('.movement-section');
  if (movementSection) movementSection.classList.toggle('paused', globalFreeze);
  const paintSection = document.querySelector('.paint-section');
  if (paintSection) paintSection.classList.toggle('paused', globalFreeze);

  // Update pause button icon
  const pauseBtn = document.getElementById('btn-pause');
  if (pauseBtn) {
    const icon = pauseBtn.querySelector('.icon');
    if (icon) {
      icon.textContent = globalFreeze ? '▶' : '⏸\uFE0E';
    }
  }
}

// Brush size drag handling
function startBrushDrag(e) {
  if (globalFreeze) return;
  e.preventDefault();
  e.stopPropagation();

  isDraggingBrushSize = true;
  brushDragStartY = e.touches ? e.touches[0].clientY : e.clientY;
  brushDragStartIndex = brushSizeIndex;
}

function handleBrushDrag(e) {
  if (!isDraggingBrushSize) return;

  e.preventDefault();
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;
  const deltaY = brushDragStartY - clientY; // Up = positive = larger brush

  // Each 20px of drag changes one size step
  const indexDelta = Math.floor(deltaY / 20);
  const newIndex = Math.max(0, Math.min(brushSizeOptions.length - 1, brushDragStartIndex + indexDelta));

  if (newIndex !== brushSizeIndex) {
    brushSizeIndex = newIndex;
    brushSize = brushSizeOptions[brushSizeIndex];
    updateBrushSizeDisplay();
    updateStatusDisplay();
  }
}

function endBrushDrag() {
  isDraggingBrushSize = false;
}

function updateBrushSizeDisplay() {
  if (!menuContainer) return;

  const brushPreview = menuContainer.querySelector('.brush-preview');
  const brushLabel = menuContainer.querySelector('.brush-size-label');

  if (brushPreview) {
    // Scale preview between 8px and 40px
    const minPreview = 8;
    const maxPreview = 40;
    const scale = brushSizeIndex / Math.max(1, brushSizeOptions.length - 1);
    const previewSize = minPreview + scale * (maxPreview - minPreview);
    brushPreview.style.width = previewSize + 'px';
    brushPreview.style.height = previewSize + 'px';
    // Square for blocking mode, circle for normal mode
    brushPreview.style.borderRadius = fxWithBlocking ? '0' : '50%';
  }

  if (brushLabel) {
    brushLabel.textContent = Math.round(brushSize * 2) + 'px';
  }
}

// Utility panel handlers
function toggleBrushPreview() {
  brushPreviewEnabled = !brushPreviewEnabled;
  const btn = document.getElementById('btn-preview');
  if (btn) {
    btn.classList.toggle('active', brushPreviewEnabled);
  }
  console.log('Brush preview:', brushPreviewEnabled ? 'ON' : 'OFF');
}

function handleClearClick() {
  clearDrawingBuffers();
  console.log('Drawing buffers cleared');
}

function handleResetClick() {
  clearDrawingBuffers();
  forceReset = true;
  forceResetFrames = 2;
  console.log('Drawing buffers cleared, forcing reset for 2 frames');
}
