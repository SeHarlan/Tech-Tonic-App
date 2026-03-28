#version 300 es
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
uniform float u_domainWarpAmount;
uniform int u_patternMode;       // 0=none, 1=radial, 2=diagonal, 3=ridged
uniform float u_patternStrength; // 0-1 blend with noise
uniform float u_patternFreq;     // repetitions across canvas (1-4)
uniform vec2 u_patternCenter;    // focal point for patterns (golden ratio positions)
uniform float u_mirrorAmount;    // 0-1 strength of corner mirroring
uniform int u_mirrorAxis;        // 0=TL↔BR, 1=TR↔BL

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

    // Corner mirror: blend coordinates toward their 180°-rotated counterpart
    // so ALL channels naturally mirror near opposite corners
    if (u_mirrorAmount > 0.0) {
      vec2 mirrorSt = vec2(u_blocking - 1.0) - blockingSt;
      // Mask: distance from the closer of the two corners on the chosen diagonal
      vec2 corner1 = u_mirrorAxis == 0 ? vec2(0.0, 0.0) : vec2(1.0, 0.0);
      vec2 corner2 = 1.0 - corner1;
      float nearCorner = min(length(v_texCoord - corner1), length(v_texCoord - corner2));
      // Blend: full mirror in corners, fades to original toward center
      float mask = smoothstep(1.5, 0.0, nearCorner) * u_mirrorAmount;
      blockingSt = mix(blockingSt, mirrorSt, mask);
    }

    // Normalized noise coordinates (consistent range ~0-10 regardless of blockingScale)
    vec2 noiseSt = blockingSt * u_blackNoiseScale;

    // R: wrappingNoise (scaled down for wider variation)
    float wrappingNoise = structuralNoise(noiseSt * 0.25 + 11.909, u_wrappingTime);

    // Pattern: compute a geometric bias that offsets noise coordinates
    vec2 patternOffset = vec2(0.0);
    if (u_patternMode > 0) {
      vec2 uv = v_texCoord - u_patternCenter;
      float pattern = 0.0;

      if (u_patternMode == 1) {
        pattern = sin(length(uv) * u_patternFreq * 6.2832) * 0.5 + 0.5;
      } else if (u_patternMode == 2) {
        pattern = sin((uv.x + uv.y) * u_patternFreq * 6.2832) * 0.5 + 0.5;
      } else if (u_patternMode == 3) {
        float ridgeNoise = structuralNoise(noiseSt * 0.8 + 333., u_structuralMoveTime);
        pattern = 1.0 - abs(2.0 * ridgeNoise - 1.0);
      }

      patternOffset = vec2(pattern) * u_patternStrength;
    }

    // Domain warp
    float warp = structuralNoise(noiseSt * .5 + 500., u_structuralMoveTime);
    vec2 warpOffset = vec2(warp) * u_domainWarpAmount;

    vec2 totalOffset = warpOffset + patternOffset;

    // G: blackNoise
    float blackNoise = structuralNoise(noiseSt + totalOffset + 1000., u_structuralMoveTime);
    // B: ribbonNoise
    float ribbonNoise = structuralNoise(noiseSt + totalOffset - 2000., u_structuralMoveTime);

    // Balanced fill: compress toward 0.5 and clamp to guarantee mix
    blackNoise = clamp(0.3 + blackNoise * 0.4, 0.3, 0.7);
    ribbonNoise = clamp(0.3 + ribbonNoise * 0.4, 0.3, 0.7);

    fragColor = vec4(wrappingNoise, blackNoise, ribbonNoise, 1.0);
}
