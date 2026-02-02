#ifdef GL_ES
precision mediump float;
#endif

uniform vec3 iResolution;
uniform float iTime;
uniform sampler2D iChannel0;

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;

    // GLSL 1.20-compatible texture sampling
    vec3 tex = texture2D(iChannel0, uv).rgb;

    // faint grid overlay so you can confirm UV mapping
    float gx = abs(fract(uv.x * 16.0) - 0.5);
    float gy = abs(fract(uv.y * 16.0) - 0.5);
    float grid = step(0.48, max(gx, gy));
    vec3 gridCol = vec3(grid) * 0.08;

    fragColor = vec4(tex + gridCol, 1.0);
}

void main() {
    vec4 c;
    mainImage(c, gl_FragCoord.xy);
    gl_FragColor = c;
}


