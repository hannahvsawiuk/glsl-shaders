/* animated_pixels_glitch.frag
   Same as animated_pixels.frag plus analog TV glitch (slice shifts, roll, freeze).
   Pixelates a black/white graphic, animates per-cell pixels, and adds low-frequency
   quick glitch bursts. Safe for mediump float (no overflow).

   Letterboxing: -e "u_image_aspect,0.6667" (image width/height) so full image fits; 0 = no letterbox.
   Margin: -e "u_margin_top,0.05" -e "u_margin_bottom,0.05" (fraction of height) for space above/below.

   Usage (glslViewer): MUST pass an image or glslViewer may crash.
     glslViewer animated_pixels_glitch.frag your_image.png --fps 60 -f -w 640 -h 480
*/

#ifdef GL_ES
precision mediump float;
#endif

uniform vec2      u_resolution;
uniform float     u_time;
uniform float     u_image_aspect;   // image width/height for letterbox (e.g. 0.6667); 0 = no letterbox
uniform float     u_margin_top;     // space above image (fraction of height, 0-1); e.g. 0.05
uniform float     u_margin_bottom;  // space below image (fraction of height, 0-1); e.g. 0.05
uniform sampler2D u_tex0;

#define iResolution u_resolution
#define iTime       u_time
#define iChannel0   u_tex0

// ---- Parameters (same as animated_pixels.frag) ----
#define GRID        1000.0   // pixels-per-axis in the pixel grid
#define THRESHOLD   0.7      // luminance threshold (0..1)
#define SPEED       1.0      // animation speed
#define TWINKLE_MIX 0.2      // 0 = hard flicker, 1 = smooth twinkle
#define INVERT_MASK 1        // 0 = black, 1 = white
#define INVERT_COLORS 1       // 0 = black ink on white bg, 1 = white ink on black bg

// ---- Analog TV glitch (low-frequency, quick, aggressive) ----
#define GLITCH_ENABLE     1       // 0 = off, 1 = on
#define GLITCH_INTERVAL   2.8     // seconds between glitch events (lower = more often)
#define GLITCH_DURATION   0.09    // glitch length in seconds (short = snappy)
#define GLITCH_SLICES     12      // horizontal bands that shift independently
#define GLITCH_SHIFT      0.06    // max horizontal slice shift in UV (0.03–0.12)
#define GLITCH_ROLL       0.015   // vertical roll wobble during glitch (0 = off)
#define GLITCH_BREAK      0.04    // full-frame horizontal break (0 = off)
#define GLITCH_FREEZE     1       // 1 = freeze frame during glitch (pause), 0 = keep animating

// Stable hash: [0,1). Small multipliers avoid mediump float overflow with large inputs.
float hash21(vec2 p) {
    p = fract(p * vec2(0.12334, 0.34545));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
}

// Letterbox: fit image aspect inside viewport (with optional top/bottom margin); return UV and inContent.
void letterbox(vec2 fragCoord, vec2 res, float imageAspect, float marginTop, float marginBottom, out vec2 uv, out float inContent) {
    float x = fragCoord.x / res.x;
    float y = fragCoord.y / res.y;
    float boxH = 1.0 - marginTop - marginBottom;
    if (boxH <= 0.001) {
        uv = vec2(x, y);
        inContent = 0.0;
        return;
    }
    if (y < marginBottom || y > 1.0 - marginTop) {
        uv = vec2(x, y);
        inContent = 0.0;
        return;
    }
    float yInBox = (y - marginBottom) / boxH;
    float vpAspect = res.x / res.y;
    float boxAspect = vpAspect / boxH;
    if (imageAspect <= 0.0 || imageAspect > 1e4) {
        uv = vec2(x, yInBox);
        inContent = 1.0;
        return;
    }
    if (boxAspect >= imageAspect) {
        float cw = imageAspect / boxAspect;
        float xMin = 0.5 - 0.5 * cw;
        float xMax = 0.5 + 0.5 * cw;
        inContent = step(xMin, x) * step(x, xMax);
        uv.x = (x - xMin) / cw;
        uv.y = yInBox;
    } else {
        float ch = boxAspect / imageAspect;
        float yMin = 0.5 - 0.5 * ch;
        float yMax = 0.5 + 0.5 * ch;
        inContent = step(yMin, yInBox) * step(yInBox, yMax);
        uv.x = x;
        uv.y = (yInBox - yMin) / ch;
    }
}

void mainImage(out vec4 fragColor, in vec2 fragCoord)
{
    vec2 res = iResolution.xy;
    vec2 uv;
    float inContent;
    letterbox(fragCoord, res, u_image_aspect, u_margin_top, u_margin_bottom, uv, inContent);
    if (inContent < 0.5) {
        vec3 bg = vec3(1.0 - float(INVERT_COLORS));
        fragColor = vec4(bg, 1.0);
        return;
    }

    // --- Analog TV glitch timing (low-frequency bursts) ---
    float glitch_id      = floor(iTime / GLITCH_INTERVAL);
    float t_in_interval  = fract(iTime / GLITCH_INTERVAL) * GLITCH_INTERVAL;
    float glitch_active  = float(GLITCH_ENABLE) * step(t_in_interval, GLITCH_DURATION);
    float t_into_glitch  = t_in_interval;
    float frozen_time    = glitch_id * GLITCH_INTERVAL;

    // --- Glitch UV: slice shifts + roll + full-frame break (branchless to avoid viewer bugs) ---
    float gseed     = fract(glitch_id * 0.1347);
    float slice_y   = floor(uv.y * float(GLITCH_SLICES));
    float slice_off = (hash21(vec2(gseed, slice_y * 0.1)) - 0.5) * 2.0 * GLITCH_SHIFT;
    float roll_off  = sin(t_into_glitch * 30.0) * GLITCH_ROLL;
    float break_off = (hash21(vec2(gseed + 0.7, 0.0)) - 0.5) * 2.0 * GLITCH_BREAK;
    vec2 uv_glitch  = clamp(vec2(fract(uv.x + slice_off + break_off), fract(uv.y + roll_off)), 0.0, 1.0);
    vec2 uv_glitched = mix(uv, uv_glitch, glitch_active);

    // --- Pixel grid (uses glitched UV so slices/roll appear) ---
    vec2 gridSize = vec2(GRID, GRID);
    vec2 cell     = floor(uv_glitched * gridSize);
    vec2 puv      = clamp((cell + 0.5) / gridSize, 0.0, 1.0);

    vec3 src = texture2D(iChannel0, puv).rgb;

    float lum  = dot(src, vec3(0.299, 0.587, 0.114));
    float mask = 1.0 * float(INVERT_MASK) - step(THRESHOLD, lum);

    float r = hash21(cell);

    // --- Animation: freeze during glitch if GLITCH_FREEZE, else twinkle (branchless) ---
    float time_for_phase = mix(iTime, frozen_time, glitch_active * float(GLITCH_FREEZE));
    float phase   = time_for_phase * SPEED + r * 10.0;
    float gate    = step(0.35, fract(phase));
    float twinkle = smoothstep(0.2, 1.0, sin(phase) * 0.5 + 0.5);

    float anim = mix(gate, twinkle, TWINKLE_MIX);
    float pixOn = mask * anim;

    vec3 bg  = vec3(1.0 - float(INVERT_COLORS));
    vec3 ink = vec3(float(INVERT_COLORS));
    vec3 col = mix(bg, ink, pixOn);
    fragColor = vec4(col, 1.0);
}

void main() {
    mainImage(gl_FragColor, gl_FragCoord.xy);
}
