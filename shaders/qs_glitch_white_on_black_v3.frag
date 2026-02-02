/* qs_glitch_white_on_black_v3.frag  (GLSL 1.20 compatible)
   This version adds a robust texture binding fallback, because glslViewer can bind the
   first input texture under different uniform names depending on mode/build.

   It will try (in order):
     1) iChannel0  (Shadertoy-style)
     2) u_tex0     (common glslViewer default)
   and pick whichever looks "non-blank".

   Also includes a "texture missing" debug output (magenta) if both look blank.

   Run:
     glslViewer qs_glitch_white_on_black_v3.frag qs_sign_bw_shader.jpg -f -w 640 -h 480 --fps 60

   If needed, force Shadertoy uniforms mode:
     glslViewer qs_glitch_white_on_black_v3.frag qs_sign_bw_shader.jpg --shadertoy -f -w 640 -h 480 --fps 60
*/

#ifdef GL_ES
precision mediump float;
#endif

uniform vec3  iResolution;
uniform float iTime;

// Try both common texture uniform names:
uniform sampler2D iChannel0;
uniform sampler2D u_tex0;

// -------------------- TUNE ME --------------------
#define GRID              220.0
#define THRESHOLD         0.55
#define INVERT_MASK       0       // 1: dark->design (your posted image is black design on white)

#define SOFT_EDGE         0.10    // increase if edges get "eaten"
#define DILATE            1
#define DILATE_CELLS      1.25

#define DEBUG_VIEW        3       // 0 final, 1 luminance, 2 mask, 3 show chosen texture

#define GLITCH_INTERVAL   4.0
#define GLITCH_PROB       0.35
#define GLITCH_DURATION   0.22
#define GLITCH_STRENGTH   1.0

#define TEAR_MAX_SHIFT    0.28
#define JITTER_PIXELS     2.0
#define DROPOUT_AMOUNT    0.30
#define SPARKLE_AMOUNT    0.15
// -------------------------------------------------

float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 345.45));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
}
float lum(vec3 c){ return dot(c, vec3(0.299,0.587,0.114)); }

float bump(float x){
    x = clamp(x, 0.0, 1.0);
    float a = smoothstep(0.0, 1.0, x);
    float b = 1.0 - smoothstep(0.0, 1.0, x);
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

// Choose between iChannel0 and u_tex0 by detecting which is "less blank".
// Many toolchains bind missing textures to solid black or solid white.
vec3 sampleTex(vec2 uv, out float texOk) {
    vec3 a = texture2D(iChannel0, uv).rgb;
    vec3 b = texture2D(u_tex0,    uv).rgb;

    // "blankness" scores vs pure black and pure white
    float a_to_black = length(a - vec3(0.0));
    float a_to_white = length(a - vec3(1.0));
    float b_to_black = length(b - vec3(0.0));
    float b_to_white = length(b - vec3(1.0));

    float a_blank = min(a_to_black, a_to_white);
    float b_blank = min(b_to_black, b_to_white);

    // pick the one that is less blank
    vec3 c = (a_blank <= b_blank) ? a : b;
    float c_blank = min(length(c - vec3(0.0)), length(c - vec3(1.0)));

    // consider texture "ok" if not extremely close to solid black/white
    texOk = step(0.02, c_blank);
    return c;
}

float maskFromLum(float L, float th){
    // soft threshold around th: bright->1
    float mBright = smoothstep(th - SOFT_EDGE, th + SOFT_EDGE, L);
    float mDark   = 1.0 - mBright;
    return (INVERT_MASK == 0) ? mBright : mDark;
}

float sampleMask(vec2 uv, vec2 gridSize, float th){
    // sample at pixelated cell center
    vec2 cell = floor(uv * gridSize);
    vec2 puv  = (cell + 0.5) / gridSize;

    float ok;
    vec3 src = sampleTex(puv, ok);
    if (ok < 0.5) return -1.0; // signal texture missing

    return maskFromLum(lum(src), th);
}

float dilateMask(vec2 uv, vec2 gridSize, float th){
    float m = sampleMask(uv, gridSize, th);
    if (m < -0.5) return m;

    if (DILATE == 0) return m;

    vec2 du = (DILATE_CELLS / gridSize);

    // 8-neighborhood max
    float mm = m;
    mm = max(mm, sampleMask(clamp(uv + vec2( du.x, 0.0), vec2(0.001), vec2(0.999)), gridSize, th));
    mm = max(mm, sampleMask(clamp(uv + vec2(-du.x, 0.0), vec2(0.001), vec2(0.999)), gridSize, th));
    mm = max(mm, sampleMask(clamp(uv + vec2(0.0,  du.y), vec2(0.001), vec2(0.999)), gridSize, th));
    mm = max(mm, sampleMask(clamp(uv + vec2(0.0, -du.y), vec2(0.001), vec2(0.999)), gridSize, th));

    mm = max(mm, sampleMask(clamp(uv + vec2( du.x,  du.y), vec2(0.001), vec2(0.999)), gridSize, th));
    mm = max(mm, sampleMask(clamp(uv + vec2(-du.x,  du.y), vec2(0.001), vec2(0.999)), gridSize, th));
    mm = max(mm, sampleMask(clamp(uv + vec2( du.x, -du.y), vec2(0.001), vec2(0.999)), gridSize, th));
    mm = max(mm, sampleMask(clamp(uv + vec2(-du.x, -du.y), vec2(0.001), vec2(0.999)), gridSize, th));

    return mm;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord.xy / iResolution.xy;
    vec2 gridSize = vec2(GRID, GRID);

    // quick debug: show which texture we're sampling
    if (DEBUG_VIEW == 3) {
        float ok;
        vec3 c = sampleTex(uv, ok);
        fragColor = (ok > 0.5) ? vec4(c, 1.0) : vec4(1.0, 0.0, 1.0, 1.0);
        return;
    }

    // glitch state
    float gActive, gT, gSeed;
    glitchState(gActive, gT, gSeed);

    vec2 uvSample = uv;

    if (gActive > 0.5) {
        float env = clamp(bump(gT) * 4.0, 0.0, 1.0) * GLITCH_STRENGTH;

        float bandCenter = fract(gSeed * 0.71 + iTime * 0.15);
        float bandHalfH  = 0.06 + 0.04 * hash21(vec2(gSeed, 2.0));
        float band = smoothstep(bandHalfH, 0.0, abs(uv.y - bandCenter));

        float rowGroup = floor(uv.y * GRID / 6.0);
        float rowR = hash21(vec2(rowGroup, gSeed));
        float tearShiftCells = (rowR - 0.5) * TEAR_MAX_SHIFT * env * band;
        uvSample.x += tearShiftCells / GRID;

        vec2 block = floor(uv * gridSize / 10.0);
        vec2 jitterDir = vec2(hash21(block + 1.3 + gSeed), hash21(block + 7.7 + gSeed)) - 0.5;
        vec2 jitterCells = jitterDir * (JITTER_PIXELS * env);
        uvSample += jitterCells / GRID;

        uvSample.y += (hash21(vec2(gSeed, uv.x)) - 0.5) * (6.0 / GRID) * env;

        uvSample = clamp(uvSample, vec2(0.001), vec2(0.999));
    }

    // Mask threshold (fixed; tune THRESHOLD + SOFT_EDGE)
    float th = THRESHOLD;

    // Make mask blocky by sampling at cell centers
    vec2 cell = floor(uv * gridSize);
    vec2 cellCenter = (cell + 0.5) / gridSize;

    float m = dilateMask(cellCenter + (uvSample - uv), gridSize, th);

    // Texture missing? show magenta so it's obvious.
    if (m < -0.5) {
        fragColor = vec4(1.0, 0.0, 1.0, 1.0);
        return;
    }

    if (gActive > 0.5) {
        float env = clamp(bump(gT) * 4.0, 0.0, 1.0);

        float r = hash21(cell + vec2(floor(iTime * 120.0), gSeed * 100.0));
        float dropout = step(1.0 - (DROPOUT_AMOUNT * env), r);
        m *= (1.0 - dropout);

        float s = hash21(cell + vec2(floor(iTime * 90.0) + 17.0, gSeed * 44.0));
        float sparkle = step(1.0 - (SPARKLE_AMOUNT * env), s);
        m = clamp(m + sparkle * 0.7 * env, 0.0, 1.0);
    }

    if (DEBUG_VIEW == 1) {
        float ok;
        vec3 c = sampleTex(uv, ok);
        float L = ok > 0.5 ? lum(c) : 1.0;
        fragColor = vec4(vec3(L), 1.0);
        return;
    }
    if (DEBUG_VIEW == 2) {
        fragColor = vec4(vec3(m), 1.0);
        return;
    }

    fragColor = vec4(vec3(m), 1.0);
}

void main() {
    vec4 c;
    mainImage(c, gl_FragCoord.xy);
    gl_FragColor = c;
}
