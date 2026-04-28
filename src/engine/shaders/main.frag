#version 300 es
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform sampler2D u_texture;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_pixelDensity, u_frameCount;
uniform float u_seed;
uniform float u_targetFps;
uniform float u_baseChunkSize;
uniform mediump float u_shouldMoveThreshold;
uniform float u_moveSpeed;
uniform vec2 u_moveShapeScale;
uniform float u_moveShapeSpeed;
uniform mediump float u_resetThreshold;
uniform mediump float u_resetEdgeThreshold;
uniform vec2 u_resetNoiseScale;
uniform mediump float u_resetThresholdVariance;
uniform mediump float u_shouldFallThreshold;
uniform vec2 u_shouldFallScale;
uniform float u_fallShapeSpeed;
uniform bool u_fxWithBlocking;
uniform float u_blockTimeMult;
uniform float u_structuralTimeMult;
uniform mediump float u_extraMoveShapeThreshold;
uniform vec2 u_extraMoveStutterScale;
uniform mediump float u_extraMoveStutterThreshold;
uniform mediump float u_extraFallShapeThreshold;
uniform vec2 u_extraFallStutterScale;
uniform mediump float u_extraFallStutterThreshold;
uniform float u_fallWaterfallMult;
uniform vec2 u_extraFallShapeScale;
uniform float u_blocking;
uniform mediump float u_blackNoiseEdgeMult;
uniform mediump float u_blackNoiseThreshold;
uniform mediump float u_useRibbonThreshold;
uniform vec2 u_dirtNoiseScale;
uniform mediump float u_ribbonDirtThreshold;
uniform vec2 u_blankStaticScale;
uniform mediump float u_blankStaticThreshold;
uniform float u_blankStaticTimeMult;
uniform vec3 u_blankColor;
uniform bool u_useGrayscale;
uniform bool u_useColorCycle;
uniform vec3 u_staticColor1;
uniform vec3 u_staticColor2;
uniform vec3 u_staticColor3;
uniform vec2 u_extraMoveShapeScale;
uniform float u_cycleColorHueSpeed;
uniform float u_globalFreeze;
uniform float u_forceReset;
uniform float u_manualMode;
uniform float u_defaultWaterfallMode;
uniform sampler2D u_movementTexture;
uniform sampler2D u_paintTexture;
uniform sampler2D u_blockNoiseTex;
uniform sampler2D u_shapeNoiseTex;
uniform float u_shapeNoiseZoom;
uniform highp sampler3D u_noiseVolume;
uniform int u_shapeNoiseMode;
uniform float u_contourTimeMult;
uniform sampler2D u_cameraTex;
uniform float u_useCamera;
uniform vec2 u_cameraSize;


in vec2 v_texCoord;
out vec4 fragColor;

// Using a shorter PI constant to avoid precision issues
const float PI = 3.14159265;

// Drawing buffer color detection thresholds
// R channel: <0.25=off, 0.25-0.5=shuffle, 0.5-0.75=move left, 0.75+=move right
// G channel: <0.25=off, 0.25-0.40=trickle, 0.40-0.55=straight down, 0.55-0.70=waterfall down, 0.70-0.85=straight up, 0.85+=waterfall up
// B channel: <0.25=off, 0.25+=freeze
const float DRAW_ACTIVE_THRESHOLD = 0.25;
const float DRAW_SHIFT_THRESHOLD = 0.5;
const float DRAW_DIRECTION_THRESHOLD = 0.75;
// G channel thresholds (5-way split)
const float G_TRICKLE_MAX = 0.40;
const float G_STRAIGHT_DOWN_MAX = 0.55;
const float G_WATERFALL_DOWN_MAX = 0.70;
const float G_STRAIGHT_UP_MAX = 0.85;


// Sin-free pseudo-random using fract of large prime multiplications
float random(vec2 st) {
    vec3 p = fract(vec3(st.xyx + u_seed) * vec3(443.897, 441.423, 437.195));
    p += dot(p, p.yzx + 19.19);
    return fract((p.x + p.y) * p.z);
}

// Noise volume dimensions — must match NOISE_VOL_XY/NOISE_VOL_Z in renderer.ts.
#define NOISE_VOL_XY 128
#define NOISE_VOL_Z 64

// Quintic Hermite fade — C2 continuous, no kinks at grid points.
vec2 quinticFade(vec2 f) { return f * f * f * (f * (f * 6.0 - 15.0) + 10.0); }
vec3 quinticFade(vec3 f) { return f * f * f * (f * (f * 6.0 - 15.0) + 10.0); }

// 3D structural noise — pre-computed noise volume, hardware trilinear.
float structuralNoise(vec2 st, float t) {
    vec3 p = vec3(st, t) + vec3(u_seed * 13.591, u_seed * 7.123, 0.0);
    return texture(u_noiseVolume, (p + 0.5) / vec3(float(NOISE_VOL_XY), float(NOISE_VOL_XY), float(NOISE_VOL_Z))).r;
}

// Simplified Perlin noise function
float noise(vec2 st) {
    st += vec2(u_seed * 13.591, u_seed * 7.123);

    vec2 i = floor(st);
    vec2 f = fract(st);

    float a = random(i);
    float b = random(i + vec2(1.0, 0.0));
    float c = random(i + vec2(0.0, 1.0));
    float d = random(i + vec2(1.0, 1.0));

    vec2 u = quinticFade(f);

    return mix(mix(a, b, u.x),
               mix(c, d, u.x), u.y);
}

// --- Shape noise (waterfall + move shapes) ---
// Each mode returns a value approximately in [0,1], to be thresholded downstream.
// Switch between them via u_shapeNoiseMode. See ShapeNoiseMode enum in renderer.ts.
#define SHAPE_NOISE_CURRENT 0
#define SHAPE_NOISE_FBM_QUINTIC 1
#define SHAPE_NOISE_METABALLS 2
#define SHAPE_NOISE_STRUCTURAL_QUINTIC 3
#define SHAPE_NOISE_BLOCK_NOISE 4

// 4-octave fBm of quintic 2D noise, with a small rotation per octave to avoid
// axis-aligned banding. Output is normalised to ~[0,1].
float fbm2(vec2 p) {
    const mat2 rot = mat2(0.80, 0.60, -0.60, 0.80);
    float v = 0.0;
    float amp = 0.5;
    v += amp * noise(p); p = rot * p * 2.03; amp *= 0.5;
    v += amp * noise(p); p = rot * p * 2.07; amp *= 0.5;
    v += amp * noise(p); p = rot * p * 2.11; amp *= 0.5;
    v += amp * noise(p);
    // max amp = 0.5 + 0.25 + 0.125 + 0.0625 = 0.9375
    return v / 0.9375;
}

// Cubic smooth-min — blends two SDFs without creasing.
float smin(float a, float b, float k) {
    float h = max(k - abs(a - b), 0.0) / k;
    return min(a, b) - h * h * h * k * (1.0 / 6.0);
}

float shapeNoise_FbmQuintic(vec2 p, float t) {
    return fbm2(p + vec2(t * 1.3, -t * 0.7));
}

// Same 3D volume as structuralNoise() but blended with C2 quintic Hermite —
// bypasses hardware trilinear (which is C0) so edges don't kink at grid points.
// Wrap via bitwise AND: volume dims are powers of 2, and AND handles negatives.
float structuralNoiseQuintic(vec2 st, float t) {
    vec3 p = vec3(st, t) + vec3(u_seed * 13.591, u_seed * 7.123, 0.0);
    vec3 i = floor(p);
    vec3 f = fract(p);
    vec3 u = quinticFade(f);

    const ivec3 WRAP_MASK = ivec3(NOISE_VOL_XY - 1, NOISE_VOL_XY - 1, NOISE_VOL_Z - 1);
    ivec3 i0 = ivec3(i) & WRAP_MASK;
    ivec3 i1 = (ivec3(i) + ivec3(1)) & WRAP_MASK;

    float c000 = texelFetch(u_noiseVolume, ivec3(i0.x, i0.y, i0.z), 0).r;
    float c100 = texelFetch(u_noiseVolume, ivec3(i1.x, i0.y, i0.z), 0).r;
    float c010 = texelFetch(u_noiseVolume, ivec3(i0.x, i1.y, i0.z), 0).r;
    float c110 = texelFetch(u_noiseVolume, ivec3(i1.x, i1.y, i0.z), 0).r;
    float c001 = texelFetch(u_noiseVolume, ivec3(i0.x, i0.y, i1.z), 0).r;
    float c101 = texelFetch(u_noiseVolume, ivec3(i1.x, i0.y, i1.z), 0).r;
    float c011 = texelFetch(u_noiseVolume, ivec3(i0.x, i1.y, i1.z), 0).r;
    float c111 = texelFetch(u_noiseVolume, ivec3(i1.x, i1.y, i1.z), 0).r;

    float x00 = mix(c000, c100, u.x);
    float x10 = mix(c010, c110, u.x);
    float x01 = mix(c001, c101, u.x);
    float x11 = mix(c011, c111, u.x);
    float y0 = mix(x00, x10, u.y);
    float y1 = mix(x01, x11, u.y);
    return mix(y0, y1, u.z);
}

// Animated metaballs — one drifting blob per integer cell, combined with smin.
// Sample the 3x3 neighbourhood so unions cross cell boundaries.
float shapeNoise_Metaballs(vec2 p, float t) {
    vec2 cell = floor(p);
    float d = 100.0;
    for (int oy = -1; oy <= 1; oy++) {
        for (int ox = -1; ox <= 1; ox++) {
            vec2 c = cell + vec2(float(ox), float(oy));
            float phase = random(c) * 6.2831853;
            vec2 off = 0.5 + 0.3 * vec2(
                sin(t * 1.7 + phase),
                cos(t * 1.3 + phase * 1.7)
            );
            float r = 0.35 + 0.2 * random(c + 11.2);
            d = smin(d, length(p - (c + off)) - r, 0.4);
        }
    }
    // Convert SDF to [0,1]: inside ball → >0.5, outside → <0.5.
    return clamp(0.5 - d, 0.0, 1.0);
}

// Direct read from the larger 4x shape-noise texture (.a channel = unclamped
// blackNoise — full [0,1] range). The bake's .g/.b are clamped to [0.3, 0.7]
// for the blocking-mask threshold logic, which would prevent move/fall noise
// from ever crossing its trigger thresholds. t slides the UV in noise-space,
// matching the temporal coupling other modes get from their t arg.
float shapeNoise_BlockNoise(vec2 p, float t) {
    vec2 uv = (1.0 - p) * u_shapeNoiseZoom; //+ vec2(t, t * 0.5);
    return texture(u_shapeNoiseTex, fract(uv)).a;
}

// Dispatcher — second arg animates the result even when baked into p already.
float shapeNoise(vec2 p, float t) {
    if (u_shapeNoiseMode == SHAPE_NOISE_FBM_QUINTIC) {
        return shapeNoise_FbmQuintic(p, t);
    } else if (u_shapeNoiseMode == SHAPE_NOISE_METABALLS) {
        return shapeNoise_Metaballs(p, t);
    } else if (u_shapeNoiseMode == SHAPE_NOISE_STRUCTURAL_QUINTIC) {
        return structuralNoiseQuintic(p, t);
    } else if (u_shapeNoiseMode == SHAPE_NOISE_BLOCK_NOISE) {
        return shapeNoise_BlockNoise(p, t);
    }
    return structuralNoise(p, t);
}



//HUE FUNCTIONS
// Fast hue rotation using Rodrigues' formula (rotation around the (1,1,1) axis)
vec3 rotateHue(vec3 color, float angle) {
    float cosA = cos(angle * 6.28318);
    float sinA = sin(angle * 6.28318);
    vec3 k = vec3(0.57735); // 1/sqrt(3)
    return color * cosA + cross(k, color) * sinA + k * dot(k, color) * (1.0 - cosA);
}

// Function to increase color by moving through the color wheel
vec4 increaseColorHue(vec4 color, float amount) {
    vec3 rgb = rotateHue(color.rgb, amount);
    return vec4(rgb, color.a);
}

vec4 cycleColorHue(vec4 color, float speed) {
    //if black or white color, return the color
    bool isBlack = dot(color.rgb, vec3(1.0)) < 0.01;
    bool isWhite = dot(color.rgb, vec3(1.0)) > 2.99;
    if (isBlack || isWhite) {
        return color;
    }

    return increaseColorHue(color, speed);
}

vec4 createWithHueCycle(vec4 base, float time) {

  float amount = time * u_cycleColorHueSpeed;
  return increaseColorHue(base, amount);
}

// Function to create a gradient pattern within a block
vec4 createGradientBlock(vec2 st, bool horizontal) {
  float wavelength = 32.1;

  vec4 base = vec4(1., 1., 1., 1.0);
  float amount = 0.;

  if(horizontal) {
    float x = 1.;
    base = vec4(x, 0.,0.5, 1.0);
    amount = cos(PI/2. + st.y * PI * wavelength) * 0.5 + 0.5; // Amount to increase hue
  } else {
    float y = 1. ;
    base = vec4(y, 0., 0.5, 1.0);
    amount = cos(PI/2. + st.x * PI * wavelength) * 0.5 + 0.5; // Amount to increase hue
  }
  base = increaseColorHue(base, amount);

  return base;
}

void main() {
    vec2 st = v_texCoord;
    vec4 blankColor = vec4(u_blankColor, 1.);


    //adjust for perceived brightness of rgb, where blue stays the same, red and green decrease
    blankColor.rgb *= vec3(.9, 0.6, 1.0);

    float bgFreq = PI * 2. * 128.;

    blankColor.rgb = sin(vec3(st.y + 0.00, st.y + .6666, st.y + 0.3333) * bgFreq) * blankColor.rgb;
    // blankColor.rgb -= cos(vec3(st.x + 0.6666, st.x + .3333, st.x + 0.) * bgFreq) * blankColor.rgb * 0.5;

    bool useGlobalFreeze = u_globalFreeze > 0.5;

    // Global freeze: stop all movement but keep color cycling
    if (useGlobalFreeze) {

      vec4 color = texture(u_texture, st);
      bool isBgColor = color == blankColor;

      if(u_useColorCycle && !isBgColor) {
        // Apply time-based color animation with wrapping to colors (other than bg)
        color = cycleColorHue(color, u_cycleColorHueSpeed);
      }

      fragColor = color;
      return;
    }

    vec2 orgSt = st; // Store original texture coordinates for later use

    float densityAdjustment = ceil(2. / u_pixelDensity);

    float time = u_time; //in seconds
    float baseChunkSize = u_baseChunkSize;

    bool useBlocking = u_blocking > 0.0;

    vec2 blockingSt = useBlocking ? floor(st * u_blocking) : st;

    float blockTime = floor(time * u_blockTimeMult);

    float moveTime = time * (u_targetFps / 30.);
    // Freeze structural time in manual mode so reset shape doesn't move
    float structuralMoveTime = u_manualMode > 0.5 ? 0.0 : moveTime * u_structuralTimeMult;


    // baseChunkSize is in CSS pixels, u_resolution is in actual pixels (already scaled by pixel density)
    // Scale baseChunkSize to actual pixels to match the resolution coordinate space
    float scaledChunkSize = baseChunkSize * u_pixelDensity;

    // Create normalized block sizes that account for aspect ratio to maintain square chunks
    vec2 blockSize = vec2(
      scaledChunkSize / u_resolution.x,  // Width component
      scaledChunkSize / u_resolution.y   // Height component
    );

    // Calculate the maximum valid texture coordinate (right/bottom boundary)
    vec2 maxValidCoord = vec2(1.);

    vec2 moveShapeSt = u_fxWithBlocking ? blockingSt : st;

    if (u_shapeNoiseMode != SHAPE_NOISE_BLOCK_NOISE) {
      moveShapeSt *= u_moveShapeScale;

      float moveContourTime = moveTime * u_moveShapeSpeed * u_contourTimeMult;
      mediump float moveContourNoise = noise(vec2(moveContourTime, moveShapeSt.y * .05));
      float moveShapeContourMult = 5. + moveContourNoise * 5.;
      float moveShapeContourStrength = (1.-moveContourNoise) * 0.2;
      float moveShapeContour = noise(vec2(moveShapeSt.y * moveShapeContourMult, moveContourTime)) * moveShapeContourStrength;
      moveShapeSt.x += moveShapeContour;
    }

    float moveShapeTime = moveTime * u_moveShapeSpeed;

    bool moveMovementNoisePatterns = true;

    if(moveMovementNoisePatterns) {
      //move left/right
      moveShapeSt += vec2(moveShapeTime, 100.);
    }

    mediump float moveNoise = shapeNoise(moveShapeSt, moveShapeTime * 0.25);
    float direction = moveNoise < 0.5 ? -1.0 : 1.0;

    // Sample drawing buffer at actual pixel position (not block-snapped)
    // This allows sub-block brush sizes while the visual blocking still applies
    vec2 drawSt = orgSt;
    // Sample movement buffer (persistent: move, waterfall, freeze)
    vec4 movementColor = texture(u_movementTexture, drawSt);

    // Decode R channel (move/shuffle) from movement buffer
    bool shuffleMode = false;
    bool moveMode = false;
    float moveDirectionOverride = 0.0;

    if (movementColor.a >= DRAW_ACTIVE_THRESHOLD && movementColor.r >= DRAW_ACTIVE_THRESHOLD) {
      if (movementColor.r < DRAW_SHIFT_THRESHOLD) {
        shuffleMode = true;
      } else if (movementColor.r < DRAW_DIRECTION_THRESHOLD) {
        moveMode = true;
        moveDirectionOverride = -1.0;
      } else {
        moveMode = true;
        moveDirectionOverride = 1.0;
      }
    }

    // Decode G channel (waterfall/trickle) from movement buffer
    bool trickleMode = false;
    bool waterfallMode = false;
    bool straightFallMode = false;
    float fallDirectionOverride = 1.0;

    if (movementColor.a >= DRAW_ACTIVE_THRESHOLD && movementColor.g >= DRAW_ACTIVE_THRESHOLD) {
      if (movementColor.g < G_TRICKLE_MAX) {
        trickleMode = true;
      } else if (movementColor.g < G_STRAIGHT_DOWN_MAX) {
        straightFallMode = true;
        fallDirectionOverride = 1.0;
      } else if (movementColor.g < G_WATERFALL_DOWN_MAX) {
        waterfallMode = true;
        fallDirectionOverride = 1.0;
      } else if (movementColor.g < G_STRAIGHT_UP_MAX) {
        straightFallMode = true;
        fallDirectionOverride = -1.0;
      } else {
        waterfallMode = true;
        fallDirectionOverride = -1.0;
      }
    }

    // Decode B channel (freeze) from movement buffer
    bool freezeMode = false;
    if (movementColor.a >= DRAW_ACTIVE_THRESHOLD && movementColor.b >= DRAW_ACTIVE_THRESHOLD) {
      freezeMode = true;
    }

    // Sample paint buffer (persistent: empty/static/gem)
    bool resetMode = false;
    int resetVariant = 0;
    vec4 paintColor = texture(u_paintTexture, drawSt);

    if (paintColor.a >= DRAW_ACTIVE_THRESHOLD && paintColor.r >= DRAW_ACTIVE_THRESHOLD) {
      resetMode = true;
      if (paintColor.r < 0.625) {
        resetVariant = 1; // empty
      } else if (paintColor.r < 0.875) {
        resetVariant = 2; // static
      } else {
        resetVariant = 3; // gem
      }
    }

    // Override direction if move mode is active from drawing
    if (moveDirectionOverride != 0.0) {
      direction = moveDirectionOverride;
    }

    float shouldMoveThreshold = u_shouldMoveThreshold;
    float shouldFallThreshold = u_shouldFallThreshold;

    // if (u_shapeNoiseMode == SHAPE_NOISE_BLOCK_NOISE) {
    //   float blockNoiseShapeThreshAdjust = 0.1;
    //   shouldMoveThreshold += blockNoiseShapeThreshAdjust;
    //   shouldFallThreshold += blockNoiseShapeThreshAdjust;
    // }

    bool shouldMove = moveNoise < shouldMoveThreshold || moveNoise > 1. - shouldMoveThreshold;
    shouldMove = shouldMove || moveMode;

    // Calculate movement offset for the row, if it should move
    float moveSpeed = u_moveSpeed; // Adjust for faster/slower movement

    float moveAmount = 0.0;


    //FALL
    vec2 shouldFallSt = u_fxWithBlocking ? blockingSt : st;

    if (u_shapeNoiseMode != SHAPE_NOISE_BLOCK_NOISE) {
      shouldFallSt *= u_shouldFallScale;

      float fallContourTime = moveTime * u_fallShapeSpeed * u_contourTimeMult;
      mediump float fallContourNoise = noise(vec2(shouldFallSt.x * .2, -fallContourTime));
      float fallShapeContourMult = 5. + fallContourNoise * 5.;
      float fallShapeContourStrength = (1. - fallContourNoise) * 0.3;
      float fallShapeContour = noise(vec2(shouldFallSt.x * fallShapeContourMult, fallContourTime)) * fallShapeContourStrength;
      shouldFallSt.y += fallShapeContour;
    }

    float fallShapeTime = moveTime * u_fallShapeSpeed;

    if(moveMovementNoisePatterns) {
      //move down
      shouldFallSt += vec2(0.268, fallShapeTime);
    }

    mediump float shouldFallNoise  = shapeNoise(shouldFallSt, fallShapeTime * 0.25);


    bool shouldFall =  shouldFallNoise  < shouldFallThreshold || shouldFallNoise > 1. - shouldFallThreshold;
    shouldFall = shouldFall || waterfallMode || straightFallMode;

    float fallDirection = shouldFallNoise  < 0.5 ? -1.0 : 1.0; //1.0 if hard code down;
    // Override fall direction if vertical brush mode is active
    if (waterfallMode || straightFallMode) {
      fallDirection = fallDirectionOverride;
    }
      

    vec2 resetNoiseSt = blockingSt * u_resetNoiseScale;
    mediump float resetNoise = structuralNoise(resetNoiseSt + 678.543, structuralMoveTime);

    bool willReset = resetNoise < u_resetThreshold + u_resetThresholdVariance;

    //EXTRA MOVES

    vec2 extraMoveShapeSt = u_fxWithBlocking ? blockingSt : st;
    float extraMoveTime = moveTime * u_moveShapeSpeed ;

    if (u_shapeNoiseMode != SHAPE_NOISE_BLOCK_NOISE)
      extraMoveShapeSt *= u_extraMoveShapeScale;

    if(moveMovementNoisePatterns) {
      //extra move left/right
      extraMoveShapeSt += vec2(extraMoveTime * direction, 0.952);
    }

    mediump float extraMoveShape = shapeNoise(extraMoveShapeSt - 1.345, extraMoveTime);

    bool extraMoveStutter = random(floor(st * u_extraMoveStutterScale) + moveTime + 1.49) < u_extraMoveStutterThreshold;
    bool inExtraMove = extraMoveShape < u_extraMoveShapeThreshold;
    inExtraMove = inExtraMove || shuffleMode;
    bool extraMoves = extraMoveStutter && inExtraMove;

    shouldMove = shouldMove || extraMoves;

    if (shouldMove) {
      moveAmount = direction * moveSpeed * blockSize.x;
    }

    float fallAmount = 0.0;

    float yFall = moveSpeed * blockSize.y;

    //EXTRA FALL
    vec2 extraFallShapeSt = u_fxWithBlocking ? blockingSt : st;
    
    if (u_shapeNoiseMode != SHAPE_NOISE_BLOCK_NOISE)
      extraFallShapeSt *= u_extraFallShapeScale;

    float extraFallTime = moveTime * u_fallShapeSpeed;

    if(moveMovementNoisePatterns) {
      //extra move down
      extraFallShapeSt += vec2(0.268, extraFallTime);
    }

    mediump float extraFallShape = shapeNoise(extraFallShapeSt + 1.529, extraFallTime * 0.25);
    bool extraFallStutter = random(floor(st * u_extraFallStutterScale) + moveTime + 2.) < u_extraFallStutterThreshold;
    bool inExtraFall = extraFallShape < u_extraFallShapeThreshold;
    inExtraFall = inExtraFall || trickleMode;
    bool extraFall = extraFallStutter && inExtraFall;

    shouldFall = shouldFall || extraFall;

    if(shouldFall) {
      // Determine if this pixel uses waterfall variance:
      // - brush stroke: waterfallMode = variance, straightFallMode = no variance
      // - organic fall: use u_defaultWaterfallMode
      bool useWaterfallVariance = waterfallMode ||
        (!straightFallMode && !waterfallMode && u_defaultWaterfallMode > 0.5);

      float waterFallSpeedMult = 0.0;

      if (useWaterfallVariance && u_fallWaterfallMult > 0.) {
        float waterX = u_fxWithBlocking ? blockingSt.x : floor(st.x * (u_resolution.x / 2.));
        vec2 waterFallSt = vec2(waterX, floor(moveTime * .5));
        float waterFallVariance = random(waterFallSt) * u_fallWaterfallMult;
        waterFallSpeedMult = (u_fallWaterfallMult / 2.) * waterFallVariance;
      }

      fallAmount = yFall + yFall * waterFallSpeedMult;
      fallAmount *= fallDirection;
    }

    // Apply freeze mode (zeros out movement)
    if (freezeMode) {
      moveAmount = 0.0;
      fallAmount = 0.0;
    }

    // Apply the horizontal offset to the texture coordinate
    st.x += moveAmount * densityAdjustment;
    st.y += fallAmount * densityAdjustment;

    //one pixel margin for the blocks
    vec2 margin = (1.0 / u_resolution) * 2.;
    // Check if we're outside the valid area (beyond complete blocks)
    bool isOutOfXBounds = (st.x >= maxValidCoord.x - margin.x || st.x <= margin.x);
    bool isOutOfYBounds = st.y >= maxValidCoord.y - margin.y || st.y <= margin.y;
    bool isOutOfBounds = isOutOfXBounds || isOutOfYBounds;

    bool isOutOfXFrame = st.x < 0.0 || st.x > maxValidCoord.x;
    bool isOutOfYFrame = st.y < 0.0 || st.y > maxValidCoord.y;

    bool resetting = true;

    //Allows for wrapping — sample pre-computed block noise (R=wrapping, G=black, B=ribbon)
    // Use orgSt (pre-movement coordinates) to match original wrappingSt = blockingSt behavior
    vec2 blockNoiseUV = (floor(orgSt * u_blocking) + 0.5) / u_blocking;
    vec4 blockNoiseVal = texture(u_blockNoiseTex, blockNoiseUV);

    bool isWrapping = (blockNoiseVal.r < 0.5)
      ? (direction < 0.)
      : (direction > 0.);

    isWrapping = isWrapping || moveMode;

    if(isWrapping) {
      resetting = false;
    }

    bool useReset = false;

    if(isOutOfXBounds) {
      if(shouldMove) {
        if(resetting) {
          float xSpeed =  (150. * blockSize.x) * moveSpeed;

          if(direction < 0. && st.x < margin.x) {
              st.x -= xSpeed * moveTime;
              useReset = true;
          }
          if(direction > 0. && st.x > maxValidCoord.x - margin.x) {
              st.x += xSpeed * moveTime;
              useReset = true;
          }
        } else {
          if (direction < 0. && st.x < margin.x) {
              st.x = maxValidCoord.x - st.x;
          }
          if (direction > 0. && st.x > maxValidCoord.x - margin.x) {
              st.x = mod(st.x + margin.x, maxValidCoord.x);
          }
        }
      }
    }



    if (isOutOfYBounds) {
        if (shouldFall) {
            // Wrap around the y coordinate
            if (fallDirection < 0. && st.y < margin.y) {
                st.y = maxValidCoord.y - st.y;
            }
            if (fallDirection > 0. && st.y > maxValidCoord.y - margin.y) {
                st.y = mod(st.y + margin.y, maxValidCoord.y);
            }
        }
    }

    // Calculate block coordinates and fractional position within block
    vec2 blockFloor = floor(st / blockSize);
    vec2 blockFract = fract(st / blockSize);

    vec4 initColor = vec4(1.);

    mediump float blackNoiseEdge = random(st.y + vec2(10.45)) * u_blackNoiseEdgeMult;

    // Sample block noise at post-movement position
    vec2 blockNoiseUV2 = (blockingSt + 0.5) / u_blocking;
    vec4 blockNoiseVal2 = texture(u_blockNoiseTex, blockNoiseUV2);

    mediump float blackNoise = blockNoiseVal2.g + blackNoiseEdge;

    bool useBlack = blackNoise < u_blackNoiseThreshold;

    mediump float ribbonNoise = blockNoiseVal2.b - blackNoiseEdge;
    bool useRibbon = ribbonNoise < u_useRibbonThreshold;

    // Apply reset variant overrides (must happen before useBlank calculation)
    if (resetMode) {
      if (resetVariant == 1) {
        // empty: override useBlack = true
        useBlack = true;
      } else if (resetVariant == 2) {
        // static: override useBlack = false and useRibbon = false
        useBlack = false;
        useRibbon = false;
      } else if (resetVariant == 3) {
        // gem: override useBlack = false and useRibbon = true
        useBlack = false;
        useRibbon = true;
      }
      // resetVariant == 0: no paint active (erased or never painted)
    }

    bool useBlankStatic = random(st * u_blankStaticScale + floor(
      cos(moveTime * 10.123) * u_blankStaticTimeMult +
      sin(moveTime * 1.05) * u_blankStaticTimeMult) + 1.) < u_blankStaticThreshold;

    bool useBlank = (useBlankStatic && !useRibbon) || useBlack;

    if (u_useCamera > 0.5) {
      // Cover-fit camera into canvas, flipping Y (video = top-left, canvas = bottom-left).
      // Flip X too → mirror the user (selfie-cam convention).
      vec2 camUV = v_texCoord;
      camUV.x = 1.0 - camUV.x;
      camUV.y = 1.0 - camUV.y;
      float canvasAspect = u_resolution.x / u_resolution.y;
      float camAspect = u_cameraSize.x / max(u_cameraSize.y, 1.0);
      if (camAspect > canvasAspect) {
        float scale = canvasAspect / camAspect;
        camUV.x = camUV.x * scale + (1.0 - scale) * 0.5;
      } else {
        float scale = camAspect / canvasAspect;
        camUV.y = camUV.y * scale + (1.0 - scale) * 0.5;
      }
      initColor = texture(u_cameraTex, clamp(camUV, 0.0, 1.0));
    } else if (useBlank) {
      initColor = blankColor;
    } else {

      vec2 dirtNoiseSt = floor(st * u_dirtNoiseScale);
      float rnd = random(dirtNoiseSt + blockTime);
      float blockRnd = random(dirtNoiseSt + blockTime + 10.24);

      bool useBlock = useRibbon && blockRnd < u_ribbonDirtThreshold;

      vec2 stPlus = ((st) / blockSize);
      if(useBlock) {
        initColor = createGradientBlock(stPlus, isWrapping);
      } else {
        if (rnd < .25) {
          initColor = createGradientBlock(stPlus, isWrapping);
        } else if(rnd < .5) {
          initColor = vec4(u_staticColor1, 1.);
        } else if(rnd < 0.75) {
          initColor = vec4(u_staticColor2, 1.);
        } else {
          initColor = vec4(u_staticColor3, 1.);
        }
      }

      if(u_useColorCycle) {
        initColor = createWithHueCycle(initColor, u_frameCount + PI);
      }
    }

    // Apply reset mode override (after all other useReset logic)
    if (resetMode) {
      willReset = true;
    }


    float resetEdgeThreshold = u_resetEdgeThreshold;
    bool resetEdge = random(2. * st + fract(moveTime)) < resetEdgeThreshold;

    bool naturalReset = !shouldMove && !shouldFall && willReset;


    if((naturalReset || resetMode) && resetEdge) {
      useReset = true;
    }

    // Force reset override (from clear operation)
    if (u_forceReset > 0.5) {
      useReset = true;
    }

    // Apply freeze mode (blocks natural resets, but paint overrides)
    if (freezeMode && !resetMode) {
      useReset = false;
    }


    // Sample from the previous state with the calculated coordinates
    vec4 color = texture(u_texture, st);
    // During the first 0.05 seconds after resize, show the gradient
    if (color.a < .025 || useReset) {
        // Generate the original gradient (red from x, blue from y)
        fragColor = initColor;
        return;
    }

    bool isBgColor = color == blankColor;

    if((u_useColorCycle) && !isBgColor) {
      // Apply time-based color animation with wrapping to colors (other than bg)
      color = cycleColorHue(color, u_cycleColorHueSpeed);
    }

    // Convert to gray scale weight
    if(u_useGrayscale) {
      color.rgb = vec3(0.299 * color.r + 0.587 * color.g + 0.114 * color.b);
    }

    // Use the color with time-based animation applied
    fragColor = color;
}
