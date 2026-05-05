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
uniform float u_movementNoiseTime;
uniform float u_domainWarpAmount;
uniform int u_patternMode;
uniform float u_patternStrength;
uniform float u_patternFreq;
uniform vec2 u_patternCenter;
uniform float u_mirrorAmount;
uniform int u_mirrorAxis;
uniform float u_moveThreshold;
uniform float u_fallThreshold;

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
    float fCorner = random3D(i + vec3(1.0, 0.0, 1.0));
    float g = random3D(i + vec3(0.0, 1.0, 1.0));
    float h = random3D(i + vec3(1.0, 1.0, 1.0));
    vec3 u = f * f * (3.0 - 2.0 * f);
    float ab = mix(a, b, u.x);
    float cd = mix(c, d, u.x);
    float ef = mix(e, fCorner, u.x);
    float gh = mix(g, h, u.x);
    float abcd = mix(ab, cd, u.y);
    float efgh = mix(ef, gh, u.y);
    return mix(abcd, efgh, u.z);
}

float structuralNoise(vec2 st, float t) {
    return noise3D(vec3(st, t));
}

vec2 movementDomain() {
    vec2 blockingSt = floor(v_texCoord * u_blocking);

    if (u_mirrorAmount > 0.0) {
        vec2 mirrorSt = vec2(u_blocking - 1.0) - blockingSt;
        vec2 corner1 = u_mirrorAxis == 0 ? vec2(0.0, 0.0) : vec2(1.0, 0.0);
        vec2 corner2 = 1.0 - corner1;
        float nearCorner = min(length(v_texCoord - corner1), length(v_texCoord - corner2));
        float mask = smoothstep(1.5, 0.0, nearCorner) * u_mirrorAmount;
        blockingSt = mix(blockingSt, mirrorSt, mask);
    }

    vec2 noiseSt = blockingSt * u_blackNoiseScale;
    vec2 patternOffset = vec2(0.0);

    if (u_patternMode > 0) {
        vec2 uv = v_texCoord - u_patternCenter;
        float pattern = 0.0;

        if (u_patternMode == 1) {
            pattern = sin(length(uv) * u_patternFreq * 6.2832) * 0.5 + 0.5;
        } else if (u_patternMode == 2) {
            pattern = sin((uv.x + uv.y) * u_patternFreq * 6.2832) * 0.5 + 0.5;
        } else if (u_patternMode == 3) {
            float ridgeNoise = structuralNoise(noiseSt * 0.8 + 333.0, u_structuralMoveTime);
            pattern = 1.0 - abs(2.0 * ridgeNoise - 1.0);
        }

        patternOffset = vec2(pattern) * u_patternStrength;
    }

    float warp = structuralNoise(noiseSt * 0.5 + 500.0, u_structuralMoveTime * 0.25);
    vec2 warpOffset = vec2(warp) * u_domainWarpAmount;
    return noiseSt + warpOffset + patternOffset;
}

void main() {
    vec2 domain = movementDomain();
    float t = u_movementNoiseTime;

    float leftNoise = structuralNoise(domain + vec2(0.00, 0.00), t);
    float rightNoise = structuralNoise(domain + vec2(37.17, 11.31), t);
    float upNoise = structuralNoise(domain + vec2(111.11, 19.73), t);
    float downNoise = structuralNoise(domain + vec2(173.29, 71.07), t);

    float left = leftNoise < u_moveThreshold ? 1.0 : 0.0;
    float right = rightNoise < u_moveThreshold ? 1.0 : 0.0;
    float up = upNoise < u_fallThreshold ? 1.0 : 0.0;
    float down = downNoise < u_fallThreshold ? 1.0 : 0.0;

    fragColor = vec4(left, right, up, down);
}
