/* qs_glitch_white_on_black_v2.frag  (GLSL 1.20 compatible, texture2D)
   Fixes "all white / all black" + "design eaten" issues by:
   - Using smooth thresholding (SOFT_EDGE) instead of hard step
   - Optional adaptive threshold per-cell (AUTO_THRESHOLD)
   - Optional dilation (DILATE) to thicken the mask so thin strokes don't disappear
   - Mask is computed from the *original* UV (not pixelated), then optionally pixelated for blocky look

   Run:
     glslViewer qs_glitch_white_on_black_v2.frag qs_sign_bw_shader.jpg -f -w 640 -h 480 --fps 60

   If you want to debug what the shader thinks the luminance/mask is:
     set DEBUG_VIEW to 1 or 2 below.
*/

#ifdef GL_ES
precision mediump float;
#endif

uniform vec3  iResolution;
uniform float iTime;
uniform sampler2D iChannel0;

// -------------------- TUNE ME --------------------
#define GRID              220.0   // pixel grid for blockiness/glitch units
#define THRESHOLD         0.55    // base threshold (0..1)
#define INVERT_MASK       1       // 0: bright->design, 1: dark->design

#define SOFT_EDGE         0.08    // softness around threshold (0..0.2). Bigger = less "eaten"
#define AUTO_THRESHOLD    1       // 1: adapt per-cell using local min/max, 0: use THRESHOLD only
#define DILATE            1       // 1: thicken mask slightly, 0: off
#define DILATE_CELLS      1.0     // dilation radius in GRID cells (0..2)

#define DEBUG_VIEW        0       // 0: final, 1: show luminance, 2: show mask

#define GLITCH_INTERVAL   4.0
#define GLITCH_PROB       0.35
#define GLITCH_DURATION   0.22
#define GLITCH_STRENGTH   1.0

#define TEAR_MAX_SHIFT    0.28
#define JITTER_PIXELS     2.0
#define DROPOUT_AMOUNT    0.35
#define SPARKLE_AMOUNT    0.18
// -------------------------------------------------

float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 345.45));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
}
float lum(vec3 c){ return dot(c, vec3(0.299,0.587,0.114)); }

// Bump envelope for glitch intensity (0 at ends, 1 mid)
float bump(float x){
    x = clamp(x, 0.0, 1.0);
    float a = smoothstep(0.0, 1.0, x);
    float b = 1.0 - smoothstep(0.0, 1.0, x);
    // peak ~0.25, scale later
    return a*b;
}

void glitchState(out float active, out float t, out float seed) {
    float idx = floor(iTime / GLITCH_INTERVAL);
    seed = hash21(vec2(idx, 19.73));
    float will = step(1.0 - GLITCH_PROB, seed);
    float phase = fract(iTime / GLITCH_INTERVAL);
    float win = clamp(GLITCH_DURATION / GLITCH_INTERVAL, 0.0, 1.0);
    active = (will > 0.5 && phase < win) ? 1.0 : 0.0;
    t = active * (phase / max(win, 1e-6));
}

// Sample luminance at UV
float sampleLum(vec2 uv){
    return lum(texture2D(iChannel0, uv).rgb);
}

// Compute per-cell adaptive threshold (min/max in a small neighborhood)
float adaptiveThreshold(vec2 uv, vec2 gridSize){
    // center of this cell
    vec2 cell = floor(uv * gridSize);
    vec2 base = (cell + 0.5) / gridSize;

    // neighborhood offsets in UV
    vec2 du = vec2(1.0) / gridSize;
    float mn = 1.0;
    float mx = 0.0;

    // 3x3 neighborhood (cheap and effective)
    for(int y=-1; y<=1; y++){
        for(int x=-1; x<=1; x++){
            vec2 o = vec2(float(x), float(y)) * du;
            float L = sampleLum(clamp(base + o, vec2(0.001), vec2(0.999)));
            mn = min(mn, L);
            mx = max(mx, L);
        }
    }
    // midpoint between local min/max; blend with global THRESHOLD
    float mid = 0.5*(mn + mx);
    // If contrast is tiny, fall back to THRESHOLD
    float contrast = mx - mn;
    float w = smoothstep(0.05, 0.20, contrast);
    return mix(THRESHOLD, mid, w);
}

float maskFromLum(float L, float th){
    // soft threshold
    float mBright = smoothstep(th - SOFT_EDGE, th + SOFT_EDGE, L); // bright -> 1
    float mDark   = 1.0 - mBright;                                 // dark -> 1
    return (INVERT_MASK == 0) ? mBright : mDark;
}

// Optional dilation to prevent "eaten" design (takes max of nearby samples)
float dilateMask(vec2 uv, vec2 gridSize, float th){
    float m = maskFromLum(sampleLum(uv), th);
    if (DILATE == 0) return m;

    vec2 du = (DILATE_CELLS / gridSize);
    // cross + diagonals
    m = max(m, maskFromLum(sampleLum(clamp(uv + vec2( du.x, 0.0), vec2(0.001), vec2(0.999))), th));
    m = max(m, maskFromLum(sampleLum(clamp(uv + vec2(-du.x, 0.0), vec2(0.001), vec2(0.999))), th));
    m = max(m, maskFromLum(sampleLum(clamp(uv + vec2(0.0,  du.y), vec2(0.001), vec2(0.999))), th));
    m = max(m, maskFromLum(sampleLum(clamp(uv + vec2(0.0, -du.y), vec2(0.001), vec2(0.999))), th));

    m = max(m, maskFromLum(sampleLum(clamp(uv + vec2( du.x,  du.y), vec2(0.001), vec2(0.999))), th));
    m = max(m, maskFromLum(sampleLum(clamp(uv + vec2(-du.x,  du.y), vec2(0.001), vec2(0.999))), th));
    m = max(m, maskFromLum(sampleLum(clamp(uv + vec2( du.x, -du.y), vec2(0.001), vec2(0.999))), th));
    m = max(m, maskFromLum(sampleLum(clamp(uv + vec2(-du.x, -du.y), vec2(0.001), vec2(0.999))), th));

    return m;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord.xy / iResolution.xy;
    vec2 gridSize = vec2(GRID, GRID);

    // glitch state
    float gActive, gT, gSeed;
    glitchState(gActive, gT, gSeed);

    // UV used for sampling mask (glitch shifts this)
    vec2 uvSample = uv;

    if (gActive > 0.5) {
        float env = clamp(bump(gT) * 4.0, 0.0, 1.0) * GLITCH_STRENGTH;

        // Horizontal tear band
        float bandCenter = fract(gSeed * 0.71 + iTime * 0.15);
        float bandHalfH  = 0.06 + 0.04 * hash21(vec2(gSeed, 2.0));
        float band = smoothstep(bandHalfH, 0.0, abs(uv.y - bandCenter));

        float rowGroup = floor(uv.y * GRID / 6.0);
        float rowR = hash21(vec2(rowGroup, gSeed));
        float tearShiftCells = (rowR - 0.5) * TEAR_MAX_SHIFT * env * band;
        uvSample.x += tearShiftCells / GRID;

        // Chunk jitter
        vec2 block = floor(uv * gridSize / 10.0);
        vec2 jitterDir = vec2(hash21(block + 1.3 + gSeed), hash21(block + 7.7 + gSeed)) - 0.5;
        vec2 jitterCells = jitterDir * (JITTER_PIXELS * env);
        uvSample += jitterCells / GRID;

        // slight vertical wobble
        uvSample.y += (hash21(vec2(gSeed, uv.x)) - 0.5) * (6.0 / GRID) * env;

        uvSample = clamp(uvSample, vec2(0.001), vec2(0.999));
    }

    // choose threshold (adaptive or fixed)
    float th = (AUTO_THRESHOLD == 1) ? adaptiveThreshold(uvSample, gridSize) : THRESHOLD;

    // mask (with optional dilation)
    float m = dilateMask(uvSample, gridSize, th);

    // Optional: make output blocky by quantizing mask per cell (prevents speckle)
    vec2 cell = floor(uv * gridSize);
    vec2 cellCenter = (cell + 0.5) / gridSize;
    float mCell = dilateMask(cellCenter, gridSize, th);
    m = mCell;

    // Glitch-only dropout + sparkles (inside design)
    if (gActive > 0.5) {
        float env = clamp(bump(gT) * 4.0, 0.0, 1.0);

        float r = hash21(cell + vec2(floor(iTime * 120.0), gSeed * 100.0));
        float dropout = step(1.0 - (DROPOUT_AMOUNT * env), r);
        m *= (1.0 - dropout);

        float s = hash21(cell + vec2(floor(iTime * 90.0) + 17.0, gSeed * 44.0));
        float sparkle = step(1.0 - (SPARKLE_AMOUNT * env), s);
        m = clamp(m + sparkle * 0.7 * env, 0.0, 1.0);
    }

    // Debug views
    if (DEBUG_VIEW == 1) {
        float L = sampleLum(uv);
        fragColor = vec4(vec3(L), 1.0);
        return;
    }
    if (DEBUG_VIEW == 2) {
        fragColor = vec4(vec3(m), 1.0);
        return;
    }

    // Final: black bg, white design
    fragColor = vec4(vec3(m), 1.0);
}

void main() {
    vec4 c;
    mainImage(c, gl_FragCoord.xy);
    gl_FragColor = c;
}
