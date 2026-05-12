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
uniform float u_resetNoiseTimeMult;
uniform float u_domainWarpAmount;
uniform int u_patternMode;       // 0=none, 1=radial, 2=diagonal, 3=ridged
uniform float u_patternStrength; // 0-1 blend with noise
uniform float u_patternFreq;     // repetitions across canvas (1-4)
uniform vec2 u_patternCenter;    // focal point for patterns (golden ratio positions)
uniform float u_mirrorAmount;    // TODO deprecated, clean all mirror related stuff up
uniform int u_mirrorAxis;        // 0=TL↔BR, 1=TR↔BL

in vec2 v_texCoord;
out vec4 fragColor;

#include chunks/blockNoiseDomain.glsl;

void main() {
    vec2 noiseSt = blockNoiseDomain(v_texCoord);

    // R: resetNoise
    float resetNoise = structuralNoise(noiseSt, u_structuralMoveTime * u_resetNoiseTimeMult);
    // G: blackNoise
    float blackNoise = structuralNoise(noiseSt + 11.11, u_structuralMoveTime + 11.11);
    // B: ribbonNoise
    float ribbonNoise = structuralNoise(noiseSt + 22.22, u_structuralMoveTime * 0.5 + 22.22);

    fragColor = vec4(resetNoise, blackNoise, ribbonNoise, 1.0);
}
