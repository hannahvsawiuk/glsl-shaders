/* sand_settle.frag
   Sand falling from the top and settling into the shape of the PNG from the bottom up.
   Same PNG pipeline: pixelate, luminance mask, letterbox/margin. Shape fills with
   a grainy "sand" that rises from the bottom; optional falling-grain layer above the fill.

   Usage (glslViewer): pass an image.
     glslViewer sand_settle.frag your_image.png -f -w 640 -h 480
     # Fill speed: -e "u_speed,1.0"  (how fast the fill level rises; 0 = default)
     # Grain density: -e "u_grain_density,300"  (higher = finer sand; 0 = default)
     # Threshold and letterbox: -e "u_threshold,0.7" -e "u_image_aspect,0.6667"
*/

#ifdef GL_ES
precision mediump float;
#endif

uniform vec2      u_resolution;
uniform float     u_time;
uniform float     u_threshold;
uniform float     u_image_aspect;
uniform float     u_margin_top;
uniform float     u_margin_bottom;
uniform float     u_speed;         // fill speed (0 = default)
uniform float     u_grain_density; // grain density, higher = finer (0 = default)
uniform sampler2D u_tex0;

#define GRID           1000.0
#define SPEED_DEFAULT   0.15   // fill level per second (full shape in ~6–7 s)
#define GRAIN_DENSITY_DEFAULT 280.0
#define INVERT_COLORS   1      // 0 = light bg / dark ink, 1 = dark bg / light ink

float random(float x) { return fract(sin(x) * 1e4); }
float random(vec2 st) { return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123); }
float noise(float x) {
    float i = floor(x);
    float f = fract(x);
    float u = f * f * (3.0 - 2.0 * f);
    return mix(random(i), random(i + 1.0), u);
}
float noise(vec2 st) {
    vec2 i = floor(st);
    vec2 f = fract(st);
    float u = f.x * f.x * (3.0 - 2.0 * f.x);
    float v = f.y * f.y * (3.0 - 2.0 * f.y);
    float a = random(i);
    float b = random(i + vec2(1.0, 0.0));
    float c = random(i + vec2(0.0, 1.0));
    float d = random(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u), mix(c, d, u), v);
}

void letterbox(vec2 fragCoord, vec2 res, float imageAspect, float marginTop, float marginBottom, out vec2 uv, out float inContent) {
    float x = fragCoord.x / res.x;
    float y = fragCoord.y / res.y;
    float boxH = 1.0 - marginTop - marginBottom;
    if (boxH <= 0.001) { uv = vec2(x, y); inContent = 0.0; return; }
    if (y < marginBottom || y > 1.0 - marginTop) { uv = vec2(x, y); inContent = 0.0; return; }
    float yInBox = (y - marginBottom) / boxH;
    float vpAspect = res.x / res.y;
    float boxAspect = vpAspect / boxH;
    if (imageAspect <= 0.0 || imageAspect > 1e4) { uv = vec2(x, yInBox); inContent = 1.0; return; }
    if (boxAspect >= imageAspect) {
        float cw = imageAspect / boxAspect;
        float xMin = 0.5 - 0.5 * cw, xMax = 0.5 + 0.5 * cw;
        inContent = step(xMin, x) * step(x, xMax);
        uv = vec2((x - xMin) / cw, yInBox);
    } else {
        float ch = boxAspect / imageAspect;
        float yMin = 0.5 - 0.5 * ch, yMax = 0.5 + 0.5 * ch;
        inContent = step(yMin, yInBox) * step(yInBox, yMax);
        uv = vec2(x, (yInBox - yMin) / ch);
    }
}

void main() {
    vec2 res = u_resolution.xy;
    vec2 uv;
    float inContent;
    letterbox(gl_FragCoord.xy, res, u_image_aspect, u_margin_top, u_margin_bottom, uv, inContent);
    vec3 bg = vec3(1.0 - float(INVERT_COLORS));
    if (inContent < 0.5) {
        gl_FragColor = vec4(bg, 1.0);
        return;
    }

    vec2 gridSize = vec2(GRID, GRID);
    vec2 cell = floor(uv * gridSize);
    vec2 puv = (cell + 0.5) / gridSize;
    vec3 src = texture2D(u_tex0, puv).rgb;
    float lum = dot(src, vec3(0.299, 0.587, 0.114));
    float mask = 1.0 - step(u_threshold, lum);

    float speed = u_speed > 0.0 ? u_speed : SPEED_DEFAULT;
    float density = u_grain_density > 0.0 ? u_grain_density : GRAIN_DENSITY_DEFAULT;

    // Fill level rises from 0 (bottom) to 1 (top) over time; loop
    float fillLevel = mod(u_time * speed, 1.0);
    // Uneven fill: wobble the boundary so sand piles unevenly (like real sand). No time in wobble so the
    // boundary only ever moves up — fixed asymmetric shape (some spots higher), never dips down.
    // First term: horizontal variation (uv.x * freq) * amp. Second: 2D variation (uv * freq) * amp.
    // Increase the 0.06 / 0.04 for stronger unevenness; decrease for subtler.
    float wobble = noise(uv.x * 4.0) * 0.06 + noise(uv * 3.0) * 0.04;
    float effectiveFillLevel = clamp(fillLevel + wobble, 0.0, 1.0);
    // uv.y: 0 = bottom, 1 = top. Filled where uv.y <= effectiveFillLevel (bottom-up, wavy)
    float filled = mask * step(uv.y, effectiveFillLevel);

    // Settled sand: grain texture in the filled region (bottom-up)
    float grain = noise(uv * density + u_time * 0.05);
    float settled = filled * (0.5 + 0.5 * grain);

    // Sparkle in the fill: sparse bright dots in the settled sand (lower threshold = less sparse)
    float fillSparkle = filled * step(0.5, noise(uv * density * 0.4 + u_time * 0.2)) * 0.28;

    // Optional: falling grains above the fill line (inside shape) for a falling effect
    float aboveFill = mask * step(effectiveFillLevel, uv.y);
    float falling = aboveFill * step(0.7, noise(uv * density * 0.6 + vec2(0.0, u_time * 3.0)));
    float fallingDim = 0.4; // dimmer so it reads as "falling" not solid

    // Tiny sparkly grain in the background only (outside PNG); lower threshold = less sparse (e.g. 0.85, 0.8)
    float inBackground = inContent * (1.0 - mask);
    float sparkle = inBackground * step(0.88, noise(uv * density * 0.35 + u_time * 0.15)) * 0.18;

    float sand = settled + fillSparkle + falling * fallingDim + sparkle;
    sand = clamp(sand, 0.0, 1.0);

    vec3 ink = vec3(float(INVERT_COLORS));
    vec3 col = mix(bg, ink, sand);
    gl_FragColor = vec4(col, 1.0);
}
