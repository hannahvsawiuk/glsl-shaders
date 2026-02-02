/* glitched_pixels.frag
   Glitched animated-pixels shader (GLSL 1.20-compatible)
   - Pixelates an input (iChannel0) and normally shows static pixels
   - Occasionally triggers a "TV glitch" event with:
       * per-cell jitter / displacement
       * horizontal tear (row offset)
       * color-channel bleed / shift
       * brief noise flicker
   - Designed for glslViewer / similar (use texture2D)
   Usage:
     glslViewer glitched_pixels.frag your_image.png -f -w 640 -h 480 --fps 60
   Tweak parameters below: GRID, THRESHOLD, EVENT_FREQ, EVENT_DUR, EVENT_PROB, INTENSITY
*/

#ifdef GL_ES
precision mediump float;
#endif

uniform vec3 iResolution;
uniform float iTime;
uniform sampler2D iChannel0;

// ---------- Parameters ----------
#define GRID           160.0   // pixel grid resolution
#define THRESHOLD      0.72    // luminance threshold for mask
#define EVENT_FREQ     6.0     // average seconds between glitch checks
#define EVENT_DUR      0.9     // duration (secs) of a glitch when it occurs
#define EVENT_PROB     0.35    // probability a check spawns a glitch
#define INTENSITY      1.0     // global intensity multiplier (0..1)

// ---------- helpers ----------
float hash21(vec2 p){
    p = fract(p * vec2(123.34, 345.45));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
}
float rand(float x){ return hash21(vec2(x, x*1.234)); }
float pulse(float t){ return smoothstep(0.0, 1.0, t) * (1.0 - smoothstep(0.0, 1.0, t)); }

// ease in-out
float ease(float x){ return x*x*(3.0-2.0*x); }

// 2D rotate (used for jitter direction variety)
vec2 rot(vec2 v, float a){ float c=cos(a), s=sin(a); return vec2(c*v.x - s*v.y, s*v.x + c*v.y); }

// ---------- glitch event control ----------
// Decide if the current interval (floor(iTime / EVENT_FREQ)) produces a glitch,
// then check whether current time is within the glitch window.
void glitchState(out float active, out float progress, out float seed) {
    float idx = floor(iTime / EVENT_FREQ);
    seed = hash21(vec2(idx, 12.34));            // deterministic seed per interval
    float will = step(1.0 - EVENT_PROB, seed);  // 1 if this interval will glitch
    float phase = fract(iTime / EVENT_FREQ);    // 0..1 through the interval
    float window = clamp(EVENT_DUR / EVENT_FREQ, 0.0, 1.0);
    active = (will > 0.5 && phase < window) ? 1.0 : 0.0;
    // progress through the glitch event 0..1
    progress = active * (phase / max(window, 1e-6));
    // add a small per-event jitter to seed so visuals vary between events
    seed += hash21(vec2(seed, floor(iTime)));
}

// ---------- main ----------
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord.xy / iResolution.xy;

    // grid cell and sampling uv (center of cell)
    vec2 gridSize = vec2(GRID, GRID);
    vec2 cell = floor(uv * gridSize);
    vec2 cellCenter = (cell + 0.5) / gridSize;

    // sample original at cell center
    vec3 src = texture2D(iChannel0, cellCenter).rgb;

    // build mask (invert by changing this line if desired)
    float lum = dot(src, vec3(0.299,0.587,0.114));
    float mask = 1.0 - step(THRESHOLD, lum);

    // compute glitch state
    float gActive, gProg, gSeed;
    glitchState(gActive, gProg, gSeed);

    // base (non-glitched) pixel on/off (use mask * 1)
    float baseOn = mask;

    // If no glitch active, animate subtly per-cell (small flicker)
    float r = hash21(cell);
    float subtle = 0.85 + 0.15 * sin(iTime * 3.0 + r * 31.0);

    // Prepare final pixel color holder
    vec3 color = vec3(1.0); // white background default

    // When glitch active, apply several layered effects:
    // 1) per-cell jitter: shift sample uv by a per-cell offset that eases in/out
    // 2) horizontal tear: shift whole rows by an offset band (smooth envelope)
    // 3) color bleed: sample neighboring pixels for each channel separately
    // 4) flicker: random on/off bursts

    if (gActive > 0.5) {
        // ------- per-cell jitter -------
        float jseed = hash21(cell + floor(iTime));
        // jitter magnitude varies across cells and over event progress
        float jitterAmt = 0.015 * INTENSITY * (0.5 + 0.5 * sin(gSeed * 12.34));
        // ease the effect in/out using progress
        float env = ease(gProg) * (1.0 - ease(gProg)); // peaks mid-event
        vec2 jitterDir = rot(vec2(1.0, 0.0), hash21(cell + 7.0) * 6.28318);
        vec2 jitter = jitterDir * (jitterAmt * (hash21(cell + 3.0) - 0.5)) * (1.0 + env * 6.0);

        // Apply jitter to sample coordinates (normalized); clamp to avoid OOB sampling
        vec2 jitteredUV = clamp(cellCenter + jitter / gridSize, 0.0, 1.0);

        // ------- horizontal tear -------
        // compute a tear band that moves vertically across screen during event
        float bandPos = fract(gSeed * 0.73 + iTime * 0.3);
        float bandHeight = 0.08 * (0.4 + 0.6 * sin(gSeed * 4.0));
        float bandCenter = bandPos;
        float dist = abs(uv.y - bandCenter);
        float bandEnv = smoothstep(bandHeight * 0.0, bandHeight, 1.0 - dist); // 0..1 in band
        // row shift amount (in normalized UV)
        float rowShift = (hash21(vec2(cell.y, gSeed)) - 0.5) * 0.25 * INTENSITY * env;
        // shift only within band
        jitteredUV.x += rowShift * bandEnv;

        // ------- color bleed / channel offset -------
        // sample nearby texels and offset color channels differently
        vec2 chromaOffsetR = vec2( 1.0, 0.0) / gridSize * (0.6 * env);
        vec2 chromaOffsetG = vec2(-0.6, 0.0) / gridSize * (0.5 * env);
        vec2 chromaOffsetB = vec2( 0.0, 1.0) / gridSize * (0.4 * env);

        vec2 uvR = clamp(jitteredUV + chromaOffsetR, 0.0, 1.0);
        vec2 uvG = clamp(jitteredUV + chromaOffsetG, 0.0, 1.0);
        vec2 uvB = clamp(jitteredUV + chromaOffsetB, 0.0, 1.0);
        vec3 sampR = texture2D(iChannel0, uvR).rgb;
        vec3 sampG = texture2D(iChannel0, uvG).rgb;
        vec3 sampB = texture2D(iChannel0, uvB).rgb;

        // combine channels (creates chromatic aberration)
        vec3 glitched = vec3(sampR.r, sampG.g, sampB.b);

        // ------- noise flicker (random per-cell) -------
        float flick = step(0.9, hash21(cell + floor(iTime * 50.0)));
        // occasional full-dropouts in the band
        float dropout = mix(0.0, 1.0, smoothstep(0.6, 1.0, bandEnv) * step(0.98, hash21(vec2(cell.x, iTime))));
        float on = clamp(baseOn * (1.0 - dropout) + (1.0 - baseOn) * 0.0, 0.0, 1.0);

        // final color mixes glitched color with background depending on mask and flicker
        color = mix(vec3(1.0), glitched, on * (0.5 + 0.5 * env));

        // add brief bright scanline artifact
        color += bandEnv * 0.15 * vec3(1.0);

    } else {
        // non-glitch: normal pixelated rendering with subtle per-cell flicker
        vec3 sampled = texture2D(iChannel0, cellCenter).rgb;
        color = mix(vec3(1.0), sampled, baseOn * subtle);
    }

    fragColor = vec4(color, 1.0);
}

void main() {
    vec4 c;
    mainImage(c, gl_FragCoord.xy);
    gl_FragColor = c;
}
