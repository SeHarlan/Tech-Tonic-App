#version 300 es
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
