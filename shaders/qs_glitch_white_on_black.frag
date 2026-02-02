/* qs_glitch_white_on_black.frag  (GLSL 1.20 compatible)
   Goal:
   - Black background
   - White design (derived from iChannel0 via luminance threshold)
   - Design is mostly stable, but "glitches" occasionally like an old TV:
       * horizontal tear band (row offset)
       * blocky pixel shift/jitter
       * brief dropout/sparkle noise
   - Glitch frequency is configurable with the #defines below.

   Run (glslViewer):
     glslViewer qs_glitch_white_on_black.frag qs_sign_bw_shader.jpg -f -w 640 -h 480 --fps 60

   Notes:
   - Uses texture2D() for older GLSL (macOS OpenGL + many Pi setups).
   - If your source image is inverted (white bg / black design), flip INVERT_MASK to 1.
*/

#ifdef GL_ES
precision mediump float;
#endif

uniform vec3  iResolution;
uniform float iTime;
uniform sampler2D iChannel0;

// -------------------- TUNE ME --------------------
#define GRID              200.0   // pixelation grid (higher = smaller pixels). Try 120..300
#define THRESHOLD         0.7    // luminance threshold for "design". Try 0.4..0.8
#define INVERT_MASK       0       // 0: dark->design, 1: bright->design  (your bw image looks bright->design)

#define GLITCH_INTERVAL   4.0     // seconds between "glitch opportunities"
#define GLITCH_PROB       0.35    // probability a glitch happens each interval (0..1)
#define GLITCH_DURATION   0.22    // seconds a glitch lasts once it starts
#define GLITCH_STRENGTH   1.0     // overall glitch strength multiplier (0..2)

// Visual flavor knobs
#define TEAR_MAX_SHIFT    0.22    // max horizontal shift during tear (in pixel-cells)
#define JITTER_PIXELS     2.0     // per-block jitter in pixel-cells
#define DROPOUT_AMOUNT    0.45    // how much of the design can drop out at peak glitch (0..1)
#define SPARKLE_AMOUNT    0.25    // random sparkles during glitch (0..1)
// -------------------------------------------------

float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 345.45));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
}

float luminance(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

// Eases in/out with a bump (0 at ends, 1 near middle)
float bump(float x) {
    x = clamp(x, 0.0, 1.0);
    return smoothstep(0.0, 1.0, x) * (1.0 - smoothstep(0.0, 1.0, x));
}

// Decide if we're currently in an active glitch window, deterministically per interval.
void glitchState(out float active, out float t, out float seed) {
    float idx = floor(iTime / GLITCH_INTERVAL);
    seed = hash21(vec2(idx, 19.73));                       // stable per interval
    float will = step(1.0 - GLITCH_PROB, seed);            // 1 if glitch will occur this interval
    float phase = fract(iTime / GLITCH_INTERVAL);          // 0..1 through interval
    float win = clamp(GLITCH_DURATION / GLITCH_INTERVAL, 0.0, 1.0);
    active = (will > 0.5 && phase < win) ? 1.0 : 0.0;
    t = active * (phase / max(win, 1e-6));                 // progress 0..1 within glitch
}

// Build a binary-ish mask from the source image at a given UV (pixelated).
float sampleMask(vec2 uv, vec2 gridSize) {
    // pixelate sampling to grid cell centers
    vec2 cell = floor(uv * gridSize);
    vec2 puv  = (cell + 0.5) / gridSize;

    vec3 src = texture2D(iChannel0, puv).rgb;
    float lum = luminance(src);

    float m;
    if (INVERT_MASK == 0) {
        // design is dark in the source
        m = 1.0 - step(THRESHOLD, lum);
    } else {
        // design is bright in the source
        m = step(THRESHOLD, lum);
    }
    return m;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord.xy / iResolution.xy;
    vec2 gridSize = vec2(GRID, GRID);

    // Current glitch state
    float gActive, gT, gSeed;
    glitchState(gActive, gT, gSeed);

    // Default: stable mask sampling UV
    vec2 uvSample = uv;

    // Apply glitch UV distortions only when active
    if (gActive > 0.5) {
        float env = clamp(bump(gT) * 4.0, 0.0, 1.0);

        // --- Horizontal tear band ---
        float bandCenter = fract(gSeed * 0.71 + iTime * 0.15);
        float bandHalfH  = 0.06 + 0.04 * hash21(vec2(gSeed, 2.0));
        float band = smoothstep(bandHalfH, 0.0, abs(uv.y - bandCenter)); // 1 in band

        // Row-group based shift (blocky)
        float rowGroup = floor(uv.y * GRID / 6.0);
        float rowR = hash21(vec2(rowGroup, gSeed));
        float tearShiftCells = (rowR - 0.5) * TEAR_MAX_SHIFT * GLITCH_STRENGTH * env * band;
        uvSample.x += tearShiftCells / GRID;

        // --- Block jitter (chunk displacement) ---
        vec2 block = floor(uv * gridSize / 10.0); // blocks of 10x10 cells
        vec2 jitterDir = vec2(hash21(block + 1.3 + gSeed), hash21(block + 7.7 + gSeed)) - 0.5;
        vec2 jitterCells = jitterDir * (JITTER_PIXELS * GLITCH_STRENGTH * env);
        uvSample += jitterCells / GRID;

        // subtle vertical wobble like sync drift
        uvSample.y += (hash21(vec2(gSeed, uv.x)) - 0.5) * (6.0 / GRID) * env * GLITCH_STRENGTH;

        uvSample = clamp(uvSample, vec2(0.001), vec2(0.999));
    }

    float m = sampleMask(uvSample, gridSize);

    // During glitch: add dropout and sparkles within the design for TV feel
    if (gActive > 0.5) {
        float env = clamp(bump(gT) * 4.0, 0.0, 1.0);
        vec2 cell = floor(uv * gridSize);

        // Dropout: randomly remove some design pixels
        float r = hash21(cell + vec2(floor(iTime * 120.0), gSeed * 100.0));
        float dropout = step(1.0 - (DROPOUT_AMOUNT * env), r); // 1 means "drop"
        m *= (1.0 - dropout);

        // Sparkles: random bright specks (still only where design is)
        float s = hash21(cell + vec2(floor(iTime * 90.0) + 17.0, gSeed * 44.0));
        float sparkle = step(1.0 - (SPARKLE_AMOUNT * env), s);
        m = clamp(m + sparkle * 0.6 * env, 0.0, 1.0);
    }

    // Output: black background, white design
    fragColor = vec4(vec3(m), 1.0);
}

void main() {
    vec4 c;
    mainImage(c, gl_FragCoord.xy);
    gl_FragColor = c;
}
