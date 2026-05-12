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
uniform vec2 u_movementNoiseXYTime;
uniform float u_domainWarpAmount;
uniform int u_patternMode;
uniform float u_patternStrength;
uniform float u_patternFreq;
uniform vec2 u_patternCenter;
uniform float u_mirrorAmount;
uniform int u_mirrorAxis;
uniform vec2 u_movementShapeScaling;

in vec2 v_texCoord;
out vec4 fragColor;

#include chunks/blockNoiseDomain.glsl;

void main() {
    float t = u_movementNoiseTime;

    vec2 leftDomain = blockNoiseDomain(fract(v_texCoord * u_movementShapeScaling + vec2(u_movementNoiseXYTime.x, 0.0)));
    vec2 rightDomain = blockNoiseDomain(fract(v_texCoord * u_movementShapeScaling + vec2(-u_movementNoiseXYTime.x, 0.0)));
    vec2 downDomain = blockNoiseDomain(fract(v_texCoord * u_movementShapeScaling + vec2(0.0, u_movementNoiseXYTime.y)));
    vec2 upDomain = blockNoiseDomain(fract(v_texCoord * u_movementShapeScaling + vec2(0.0, -u_movementNoiseXYTime.y)));

    float leftNoise = structuralNoise(leftDomain, t);
    float rightNoise = structuralNoise(rightDomain + vec2(11.31, 11.31), t);
    float downNoise = structuralNoise(downDomain + vec2(173.29, 173.29), 1.1 + t);
    float upNoise = structuralNoise(upDomain + vec2(111.11, 111.11), 1.1 + t);

    fragColor = vec4(leftNoise, rightNoise, upNoise, downNoise);
}
