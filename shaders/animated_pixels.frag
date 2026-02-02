/* animated_pixels.frag
   Pixelates a black/white (or thresholded) graphic and animates per-cell pixels.

   Compatible with:
   - glslViewer (Patricio Gonzalez Vivo) using Shadertoy-style uniforms
   - Shadertoy (minor: remove the wrapper main at bottom)

   Usage (glslViewer):
     glslViewer animated_pixels.frag your_image.png --fps 60 -f -w 640 -h 480
     # Pass threshold (0..1) from command line, e.g. default 0.7:
     glslViewer animated_pixels.frag your_image.png -e "u_threshold,0.7" -f -w 640 -h 480

   Letterboxing: -e "u_image_aspect,0.6667" (image width/height) so full image fits; 0 = no letterbox.
   Margin: -e "u_margin_top,0.05" -e "u_margin_bottom,0.05" (fraction of height, 0-1) for space above/below.

   Notes:
   - The shader creates an "ink mask" from the input texture by thresholding luminance.
   - Increase GRID for smaller pixels; decrease for chunkier pixels.
   - u_threshold: luminance threshold (0..1); higher keeps only darker ink. Set via -e u_threshold,0.7
*/

#ifdef GL_ES
precision mediump float;
#endif

uniform vec2      u_resolution;
uniform float     u_time;
uniform float     u_threshold;   // luminance threshold (0..1); set via -e u_threshold,0.7
uniform float     u_image_aspect;   // image width/height for letterbox (e.g. 0.6667); 0 = no letterbox
uniform float     u_margin_top;     // space above image (fraction of height, 0-1); e.g. 0.05
uniform float     u_margin_bottom; // space below image (fraction of height, 0-1); e.g. 0.05
uniform sampler2D u_tex0;

#define iResolution u_resolution
#define iTime       u_time
#define iChannel0   u_tex0

// glslViewer animated_pixels.frag quicksand_square2.png -e "u_threshold,0.2" -f -w 640 -h 480 --fps 60
// glslViewer animated_pixels.frag qs_sign_bw_crop.png -e "u_threshold,0.7" -f -w 640 -h 480 --fps 60
// glslViewer animated_pixels.frag qs_sign_bw_wrn.png -e "u_threshold,0.7" -f -w 640 -h 480 --fps 60

// ---- Parameters you can tweak ----
#define GRID        1000.0   // pixels-per-axis in the pixel grid (try 80..300)
#define SPEED       1.0     // animation speed
#define TWINKLE_MIX 0.2    // 0 = hard flicker, 1 = smooth twinkle
#define INVERT_MASK 1    // 0 = black, 1 = white
#define INVERT_COLORS 1    // 0 = black ink on white bg, 1 = white ink on black bg

// Stable hash: cell -> [0,1)
float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 345.45));
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

    // --- Pixel grid ---
    vec2 gridSize = vec2(GRID, GRID);
    vec2 cell     = floor(uv * gridSize);
    vec2 puv      = (cell + 0.5) / gridSize;    // sample at cell center

    // sample source at pixelated UV
    vec3 src = texture2D(iChannel0, puv).rgb;

    // --- Build an ink mask from luminance (ink=1, background=0) ---
    float lum  = dot(src, vec3(0.299, 0.587, 0.114));
    float mask = 1.0 * float(INVERT_MASK) - step(u_threshold, lum);

    // --- Per-cell randomness ---
    float r = hash21(cell);

    // --- Animation: mix of hard flicker and smooth twinkle ---
    float phase   = iTime * SPEED + r * 10.0;
    float gate    = step(0.35, fract(phase));                      // hard on/off
    float twinkle = smoothstep(0.2, 1.0, sin(phase) * 0.5 + 0.5);   // smoother

    float anim = mix(gate, twinkle, TWINKLE_MIX);

    // Only animate where the ink exists
    float pixOn = mask * anim;

    // --- Output: bg/ink driven by INVERT_COLORS ---
    vec3 bg  = vec3(1.0 - float(INVERT_COLORS));
    vec3 ink = vec3(float(INVERT_COLORS));

    vec3 col = mix(bg, ink, pixOn);
    fragColor = vec4(col, 1.0);
}

void main() {
    mainImage(gl_FragColor, gl_FragCoord.xy);
}
