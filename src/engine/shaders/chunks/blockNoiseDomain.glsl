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

vec2 blockNoiseDomain(vec2 texCoord) {
    vec2 blockingSt = floor(texCoord * u_blocking);
    vec2 noiseSt = blockingSt * u_blackNoiseScale;

    vec2 patternOffset = vec2(0.0);
    if (u_patternMode > 0) {
        vec2 uv = texCoord - u_patternCenter;
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

    float warp = structuralNoise(noiseSt * 0.5 + 500.0, u_structuralMoveTime * 0.05);
    vec2 warpOffset = vec2(warp) * u_domainWarpAmount;
    return noiseSt + warpOffset + patternOffset;
}
