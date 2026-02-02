/* animated_pixels_glitch_random.frag
   EXPERIMENTAL: Same as animated_pixels_glitch.frag but with randomness:
   - Glitches at random intervals; long or complex (multi-phase) glitches.
   - Each glitch can be 2–4 sub-phases with different slice/shift/roll/break; GRID and
     SPEED vary over time during the glitch (pulse/wobble).
   - Variation in size and duration is fairly large.
   Use this to test; if stable, merge ideas back into animated_pixels_glitch.frag.

   Letterboxing: -e "u_image_aspect,0.6667" (image width/height) so full image fits; 0 = no letterbox.
   Margin: -e "u_margin_top,0.05" -e "u_margin_bottom,0.05" (fraction of height) for space above/below.

   Usage (glslViewer): MUST pass an image or glslViewer may crash.
     glslViewer animated_pixels_glitch_random.frag your_image.png --fps 60 -f -w 640 -h 480
   Command-line params (0 = use default): u_grid, u_speed, u_twinkle_mix; u_glitch_interval_min/max, u_glitch_duration_min/max, u_glitch_sub_min/max; u_glitch_slices_min/max, u_glitch_shift_min/max, u_glitch_roll_min/max, u_glitch_break_min/max; u_glitch_grid_min/max, u_glitch_speed_min/max, u_glitch_twinkle_min/max; u_glitch_grid_pulse, u_glitch_speed_pulse; u_glitch_enable, u_glitch_freeze (0.5=off); u_invert_colors (0.5=off).

   Threshold animation (sigmoid-style: slow start, fast middle, slow end, pause, then reverse):
     Default: no animation. Enable only when u_threshold_animate>=0.5 AND u_threshold_anim_period>0.
     Start/stop: u_threshold_anim_min, u_threshold_anim_max. Period: u_threshold_anim_period (sec per full cycle).
     Curve: u_threshold_anim_curve = steepness/slope (higher = sharper S); 0 = default.
     Env vars: THRESHOLD_ANIMATE (1=on), THRESHOLD_ANIM_MIN, THRESHOLD_ANIM_MAX, THRESHOLD_ANIM_PERIOD, THRESHOLD_ANIM_CURVE
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
// Base (0 = default): grid, speed, twinkle_mix, invert_colors (invert_mask is #define only)
uniform float     u_grid;
uniform float     u_speed;
uniform float     u_twinkle_mix;
uniform float     u_invert_colors;
// Glitch interval/duration (sec); 0 = default
uniform float     u_glitch_interval_min;
uniform float     u_glitch_interval_max;
uniform float     u_glitch_duration_min;
uniform float     u_glitch_duration_max;
uniform float     u_glitch_sub_min;
uniform float     u_glitch_sub_max;
// Glitch effect ranges; 0 = default
uniform float     u_glitch_slices_min;
uniform float     u_glitch_slices_max;
uniform float     u_glitch_shift_min;
uniform float     u_glitch_shift_max;
uniform float     u_glitch_roll_min;
uniform float     u_glitch_roll_max;
uniform float     u_glitch_break_min;
uniform float     u_glitch_break_max;
uniform float     u_glitch_grid_min;
uniform float     u_glitch_grid_max;
uniform float     u_glitch_speed_min;
uniform float     u_glitch_speed_max;
uniform float     u_glitch_twinkle_min;
uniform float     u_glitch_twinkle_max;
uniform float     u_glitch_grid_pulse;
uniform float     u_glitch_speed_pulse;
uniform float     u_glitch_enable;   // 0=default, <0.5=off, >=0.5=on
uniform float     u_glitch_freeze;   // 0=default, <0.5=off, >=0.5=on
// Threshold animation: only when u_threshold_animate>=0.5 AND u_threshold_anim_period>0 (else no animation)
uniform float     u_threshold_animate;     // 0=off, >=0.5=on
uniform float     u_threshold_anim_min;    // start threshold (0-1); 0=default 0.2
uniform float     u_threshold_anim_max;    // stop threshold (0-1); 0=default 0.9
uniform float     u_threshold_anim_period; // seconds per full cycle; 0=default 12
uniform float     u_threshold_anim_curve;  // sigmoid steepness/slope (higher=sharper); 0=default 4
uniform sampler2D u_tex0;

#define iResolution u_resolution
#define iTime       u_time
#define iChannel0   u_tex0

// ---- Base parameters (used when not in glitch) ----
#define GRID        1280.0
#define SPEED       2.5
#define TWINKLE_MIX 0.2
#define INVERT_MASK 1
#define INVERT_COLORS 1

// ---- Glitch: random interval + all params randomized per event (large variation) ----
#define GLITCH_ENABLE      1
#define GLITCH_INTERVAL_MIN 8.0
#define GLITCH_INTERVAL_MAX 25.0
#define GLITCH_DURATION_MIN 0.20   // min glitch duration (sec) — longer
#define GLITCH_DURATION_MAX 1.00  // max glitch duration (sec)
#define GLITCH_SUB_MIN      2.0   // min sub-phases per glitch (complex = multiple phases)
#define GLITCH_SUB_MAX      4.0
#define GLITCH_GRID_PULSE   0.25  // GRID wobble during glitch (0.85–1.15 of base)
#define GLITCH_SPEED_PULSE  0.35  // SPEED wobble during glitch
#define GLITCH_LOOP_MAX    64
#define GLITCH_SLICES_MIN  6.0    // min horizontal bands
#define GLITCH_SLICES_MAX  25.0
#define GLITCH_SHIFT_MIN   0.02
#define GLITCH_SHIFT_MAX   0.20
#define GLITCH_ROLL_MIN    0.005
#define GLITCH_ROLL_MAX    0.035
#define GLITCH_BREAK_MIN   0.01
#define GLITCH_BREAK_MAX   0.10
#define GLITCH_GRID_MIN    256.0  // pixel grid during glitch (coarser = bigger pixels)
#define GLITCH_GRID_MAX    896.0
#define GLITCH_SPEED_MIN   0.35
#define GLITCH_SPEED_MAX   2.5
#define GLITCH_TWINKLE_MIN 0.0
#define GLITCH_TWINKLE_MAX 0.8
#define GLITCH_FREEZE      1
#define THRESHOLD_ANIM_MIN_DEFAULT    0.2
#define THRESHOLD_ANIM_MAX_DEFAULT    0.9
#define THRESHOLD_ANIM_PERIOD_DEFAULT 12.0
#define THRESHOLD_ANIM_CURVE_DEFAULT  4.0   // sigmoid steepness (higher = faster in middle)

// Sigmoid S-curve: t in [0,1] -> output in [0,1]; k = steepness (higher = sharper transition in middle)
float sigmoid_01(float t, float k) {
    float x = (t - 0.5) * 2.0 * k;
    return 1.0 / (1.0 + exp(-x));
}

// Hash with small inputs only (mediump-safe).
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
    // Resolve params from uniforms (0 = use default)
    float GRID_R     = u_grid > 0.0 ? u_grid : GRID;
    float SPEED_R    = u_speed > 0.0 ? u_speed : SPEED;
    float twinkle_base = u_twinkle_mix != 0.0 ? u_twinkle_mix : TWINKLE_MIX;
    float INV_MASK_R = float(INVERT_MASK);
    float INV_COL_R  = u_invert_colors != 0.0 ? step(0.5, u_invert_colors) : float(INVERT_COLORS);
    float GLITCH_ON  = u_glitch_enable != 0.0 ? step(0.5, u_glitch_enable) : float(GLITCH_ENABLE);
    float GLITCH_FR  = u_glitch_freeze != 0.0 ? step(0.5, u_glitch_freeze) : float(GLITCH_FREEZE);
    float iv_min     = u_glitch_interval_min > 0.0 ? u_glitch_interval_min : GLITCH_INTERVAL_MIN;
    float iv_max     = u_glitch_interval_max > 0.0 ? u_glitch_interval_max : GLITCH_INTERVAL_MAX;
    float dur_min    = u_glitch_duration_min > 0.0 ? u_glitch_duration_min : GLITCH_DURATION_MIN;
    float dur_max    = u_glitch_duration_max > 0.0 ? u_glitch_duration_max : GLITCH_DURATION_MAX;
    float sub_min    = u_glitch_sub_min > 0.0 ? u_glitch_sub_min : GLITCH_SUB_MIN;
    float sub_max    = u_glitch_sub_max > 0.0 ? u_glitch_sub_max : GLITCH_SUB_MAX;
    float sl_min     = u_glitch_slices_min > 0.0 ? u_glitch_slices_min : GLITCH_SLICES_MIN;
    float sl_max     = u_glitch_slices_max > 0.0 ? u_glitch_slices_max : GLITCH_SLICES_MAX;
    float sh_min     = u_glitch_shift_min != 0.0 ? u_glitch_shift_min : GLITCH_SHIFT_MIN;
    float sh_max     = u_glitch_shift_max > 0.0 ? u_glitch_shift_max : GLITCH_SHIFT_MAX;
    float ro_min     = u_glitch_roll_min != 0.0 ? u_glitch_roll_min : GLITCH_ROLL_MIN;
    float ro_max     = u_glitch_roll_max > 0.0 ? u_glitch_roll_max : GLITCH_ROLL_MAX;
    float br_min     = u_glitch_break_min != 0.0 ? u_glitch_break_min : GLITCH_BREAK_MIN;
    float br_max     = u_glitch_break_max > 0.0 ? u_glitch_break_max : GLITCH_BREAK_MAX;
    float gd_min     = u_glitch_grid_min > 0.0 ? u_glitch_grid_min : GLITCH_GRID_MIN;
    float gd_max     = u_glitch_grid_max > 0.0 ? u_glitch_grid_max : GLITCH_GRID_MAX;
    float sp_min     = u_glitch_speed_min > 0.0 ? u_glitch_speed_min : GLITCH_SPEED_MIN;
    float sp_max     = u_glitch_speed_max > 0.0 ? u_glitch_speed_max : GLITCH_SPEED_MAX;
    float tw_min     = u_glitch_twinkle_min != 0.0 ? u_glitch_twinkle_min : GLITCH_TWINKLE_MIN;
    float tw_max     = u_glitch_twinkle_max > 0.0 ? u_glitch_twinkle_max : GLITCH_TWINKLE_MAX;
    float gpulse     = u_glitch_grid_pulse != 0.0 ? u_glitch_grid_pulse : GLITCH_GRID_PULSE;
    float spulse     = u_glitch_speed_pulse != 0.0 ? u_glitch_speed_pulse : GLITCH_SPEED_PULSE;

    // Effective threshold: sigmoid-style (slow start, fast middle, slow end), pause, reverse, pause
    float thresh_anim_min  = u_threshold_anim_min != 0.0 || u_threshold_anim_max != 0.0 ? u_threshold_anim_min : THRESHOLD_ANIM_MIN_DEFAULT;
    float thresh_anim_max  = u_threshold_anim_max > 0.0 ? u_threshold_anim_max : THRESHOLD_ANIM_MAX_DEFAULT;
    float thresh_anim_per  = u_threshold_anim_period > 0.0 ? u_threshold_anim_period : THRESHOLD_ANIM_PERIOD_DEFAULT;
    float curve            = u_threshold_anim_curve > 0.0 ? u_threshold_anim_curve : THRESHOLD_ANIM_CURVE_DEFAULT;
    curve = clamp(curve, 1.0, 12.0); // avoid exp overflow
    float phase = fract(iTime / thresh_anim_per);
    // Phase: [0, RISE]=rise, [RISE, RISE+PAUSE]=pause at stop, [0.5, 0.5+FALL]=fall, [1-PAUSE, 1]=pause at start
    float RISE  = 0.40;
    float PAUSE = 0.05;
    float FALL  = 0.40;
    float s_rise = phase < RISE ? sigmoid_01(phase / RISE, curve) : (phase < RISE + PAUSE ? 1.0 : -1.0);
    float s_fall = phase >= 0.5 && phase < 0.5 + FALL ? sigmoid_01((phase - 0.5) / FALL, curve) : -1.0;
    float thresh_effective;
    bool anim_on = u_threshold_animate >= 0.5 && thresh_anim_per > 0.0;
    if (!anim_on) {
        thresh_effective = u_threshold;
    } else if (s_rise >= 0.0) {
        thresh_effective = mix(thresh_anim_min, thresh_anim_max, s_rise);
    } else if (phase < 0.5) {
        thresh_effective = thresh_anim_max; // pause at stop
    } else if (s_fall >= 0.0) {
        thresh_effective = mix(thresh_anim_max, thresh_anim_min, s_fall);
    } else {
        thresh_effective = thresh_anim_min; // pause at start
    }

    vec2 res = iResolution.xy;
    vec2 uv;
    float inContent;
    letterbox(fragCoord, res, u_image_aspect, u_margin_top, u_margin_bottom, uv, inContent);
    if (inContent < 0.5) {
        vec3 bg = vec3(1.0 - INV_COL_R);
        fragColor = vec4(bg, 1.0);
        return;
    }

    // Find current glitch event: accumulate random intervals until we pass iTime
    float t = 0.0;
    float ev = 0.0;
    float interval_range = iv_max - iv_min;
    for (int i = 0; i < GLITCH_LOOP_MAX; i++) {
        float gseed_ev = fract(ev * 0.1347);
        float iv = iv_min + hash21(vec2(gseed_ev, 0.3)) * interval_range;
        if (t + iv > iTime) break;
        t += iv;
        ev += 1.0;
    }
    float t_into_event = iTime - t;
    float gseed = fract(ev * 0.1347);

    // Random duration for this event (longer range)
    float rnd_dur = hash21(vec2(gseed + 0.11, 0.6));
    float duration = dur_min + rnd_dur * (dur_max - dur_min);
    float glitch_active = GLITCH_ON * step(t_into_event, duration);
    float frozen_time = t;

    // Complex glitch: 2–4 sub-phases per event, each with different visual params
    float rnd_sub = hash21(vec2(gseed + 0.10, 0.5));
    float num_sub = floor(sub_min + rnd_sub * (sub_max - sub_min + 1.0));
    float sub_dur = duration / num_sub;
    float sub_index = min(floor(t_into_event / sub_dur), num_sub - 1.0);
    float gseed_sub = fract(ev * 0.1347 + sub_index * 0.271);

    // Per-sub-phase random: effect sizes (so each phase looks different)
    float rnd_shift = hash21(vec2(gseed_sub + 0.22, 0.7));
    float rnd_roll  = hash21(vec2(gseed_sub + 0.33, 0.8));
    float rnd_break = hash21(vec2(gseed_sub + 0.44, 0.9));
    float rnd_slices = hash21(vec2(gseed_sub + 0.55, 0.91));
    float shift_amt = sh_min + rnd_shift * (sh_max - sh_min);
    float roll_amt  = ro_min + rnd_roll  * (ro_max - ro_min);
    float break_amt = br_min + rnd_break * (br_max - br_min);
    float glitch_slices = floor(sl_min + rnd_slices * (sl_max - sl_min + 1.0));

    // Per-event base for GRID/SPEED/twinkle (same for whole glitch)
    float rnd_grid  = hash21(vec2(gseed + 0.66, 0.92));
    float rnd_speed  = hash21(vec2(gseed + 0.77, 0.93));
    float rnd_twinkle = hash21(vec2(gseed + 0.88, 0.94));
    float glitch_grid_base = gd_min + rnd_grid * (gd_max - gd_min);
    float glitch_speed_base = sp_min + rnd_speed * (sp_max - sp_min);
    float glitch_twinkle = tw_min + rnd_twinkle * (tw_max - tw_min);

    // GRID and SPEED vary over time during glitch (pulse/wobble)
    float grid_pulse = 1.0 - gpulse + gpulse * (1.0 + sin(t_into_event * 20.0));
    float speed_pulse = 1.0 - spulse + spulse * (1.0 + sin(t_into_event * 18.0));
    float glitch_grid = glitch_grid_base * grid_pulse;
    float glitch_speed = glitch_speed_base * speed_pulse;

    // Glitch UV: branchless (always compute, then mix) to avoid viewer crashes
    float slice_y   = floor(uv.y * glitch_slices);
    float slice_off = (hash21(vec2(gseed_sub, slice_y * 0.1)) - 0.5) * 2.0 * shift_amt;
    float roll_off  = sin(t_into_event * 30.0) * roll_amt;
    float break_off = (hash21(vec2(gseed_sub + 0.7, 0.0)) - 0.5) * 2.0 * break_amt;
    vec2 uv_glitch  = clamp(vec2(fract(uv.x + slice_off + break_off), fract(uv.y + roll_off)), 0.0, 1.0);
    vec2 uv_glitched = mix(uv, uv_glitch, glitch_active);

    // Grid size: base or per-event random during glitch (pixel size varies)
    vec2 gridSize = mix(vec2(GRID_R, GRID_R), vec2(glitch_grid, glitch_grid), glitch_active);
    vec2 cell     = floor(uv_glitched * gridSize);
    vec2 puv      = clamp((cell + 0.5) / gridSize, 0.0, 1.0);

    vec3 src = texture2D(iChannel0, puv).rgb;
    float lum  = dot(src, vec3(0.299, 0.587, 0.114));
    float mask = INV_MASK_R - step(thresh_effective, lum);
    float r = hash21(cell);

    float time_for_phase = mix(iTime, frozen_time, glitch_active * GLITCH_FR);
    float speed_used = mix(SPEED_R, glitch_speed, glitch_active);
    float twinkle_mix_used = mix(twinkle_base, glitch_twinkle, glitch_active);
    float twinkle_phase = time_for_phase * speed_used + r * 10.0;
    float gate    = step(0.35, fract(twinkle_phase));
    float twinkle = smoothstep(0.2, 1.0, sin(twinkle_phase) * 0.5 + 0.5);
    float anim = mix(gate, twinkle, twinkle_mix_used);
    float pixOn = mask * anim;

    vec3 bg  = vec3(1.0 - INV_COL_R);
    vec3 ink = vec3(INV_COL_R);
    vec3 col = mix(bg, ink, pixOn);
    fragColor = vec4(col, 1.0);
}

void main() {
    mainImage(gl_FragColor, gl_FragCoord.xy);
}
