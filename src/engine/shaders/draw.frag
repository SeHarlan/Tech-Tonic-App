#version 300 es
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
