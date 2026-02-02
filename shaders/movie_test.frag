#ifdef GL_ES
precision mediump float;
#endif

uniform vec3  iResolution;
uniform float iTime;
uniform sampler2D iChannel0;

/* ===================== TUNABLE PARAMETERS ===================== */

// Masking (THIS is the key part for your video)
#define SAT_MIN        0.04   // lower bound of saturation
#define SAT_MAX        0.12   // upper bound of saturation
#define EDGE_SOFTNESS  0.08   // smooth edge thickness

// Pixelation (for glitch blocks)
#define GRID           180.0  // higher = smaller pixels

// Glitch timing
#define GLITCH_INTERVAL 4.0  // seconds between glitch chances
#define GLITCH_PROB     0.35 // chance per interval
#define GLITCH_DURATION 0.25 // seconds glitch lasts

// Glitch strength
#define TEAR_STRENGTH   0.30 // horizontal tear magnitude
#define JITTER_STRENGTH 2.0  // block jitter in pixel cells

/* =============================================================== */

// Hash (stable, cheap)
float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 345.45));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
}

// Saturation (HSV-style, no conversion)
float saturation(vec3 c) {
    float mx = max(c.r, max(c.g, c.b));
    float mn = min(c.r, min(c.g, c.b));
    return (mx - mn) / max(mx, 1e-5);
}

// Decide if a glitch is active
void glitchState(out float active, out float t, out float seed) {
    float idx   = floor(iTime / GLITCH_INTERVAL);
    seed        = hash21(vec2(idx, 17.0));
    float will  = step(1.0 - GLITCH_PROB, seed);
    float phase = fract(iTime / GLITCH_INTERVAL);
    float win   = GLITCH_DURATION / GLITCH_INTERVAL;

    active = (will > 0.5 && phase < win) ? 1.0 : 0.0;
    t      = active * (phase / max(win, 1e-5));
}

void main() {
    vec2 uv = gl_FragCoord.xy / iResolution.xy;

    // -------------------------------------------------------------
    // Glitch state
    float gActive, gT, gSeed;
    glitchState(gActive, gT, gSeed);

    // -------------------------------------------------------------
    // Pixel grid
    vec2 gridSize = vec2(GRID);
    vec2 cell     = floor(uv * gridSize);
    vec2 cellUV   = (cell + 0.5) / gridSize;

    // -------------------------------------------------------------
    // Apply glitch UV distortion (ONLY during glitch)
    vec2 sampleUV = cellUV;

    if (gActive > 0.5) {
        // Envelope (0 at edges, 1 mid-glitch)
        float env = smoothstep(0.0, 0.5, gT) * (1.0 - smoothstep(0.5, 1.0, gT));
        env *= 4.0;

        // Horizontal tear band
        float bandY   = fract(gSeed + iTime * 0.12);
        float band    = smoothstep(0.12, 0.0, abs(uv.y - bandY));
        float rowRand = hash21(vec2(cell.y, gSeed));

        sampleUV.x += (rowRand - 0.5) * TEAR_STRENGTH * env * band;

        // Block jitter
        vec2 block = floor(cell / 8.0);
        vec2 jitter =
            vec2(hash21(block + 1.7), hash21(block + 9.2)) - 0.5;

        sampleUV += jitter * (JITTER_STRENGTH * env) / gridSize;
    }

    sampleUV = clamp(sampleUV, vec2(0.001), vec2(0.999));

    // -------------------------------------------------------------
    // Sample video
    vec3 src = texture2D(iChannel0, sampleUV).rgb;

    // -------------------------------------------------------------
    // SATURATION-BASED MASK (THIS IS THE IMPORTANT PART)
    float sat = saturation(src);

    float mask = smoothstep(
        SAT_MIN - EDGE_SOFTNESS,
        SAT_MAX + EDGE_SOFTNESS,
        sat
    );

    // -------------------------------------------------------------
    // Output: white subject, black background
    // gl_FragColor = vec4(vec3(mask), 1.0);
    gl_FragColor = vec4(src, 1.0);

}
