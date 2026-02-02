/* animated_pixels_3d_rotation.frag
   EXPERIMENTAL: Same as animated_pixels.frag but only a central "hand" region
   rotates in pseudo-3D; the rest (e.g. text) stays static.

   Hand region: ellipse in image space (configurable center/radius). Only inside
   that ellipse do we use rotated UV; outside we use normal UV.

   Usage (glslViewer): MUST pass an image.
     glslViewer animated_pixels_3d_rotation.frag your_image.png --fps 60 -f -w 640 -h 480
     # Rotation speed: -e "u_rotation_speed,0.4"
     # Hand region: -e "u_hand_center_x,0.5" -e "u_hand_center_y,0.5" -e "u_hand_radius_x,0.22" -e "u_hand_radius_y,0.22" -e "u_hand_zoom,2.0"
*/

#ifdef GL_ES
precision mediump float;
#endif

uniform vec2      u_resolution;
uniform float     u_time;
uniform float     u_threshold;
uniform float     u_rotation_speed;
uniform float     u_hand_center_x;    // hand ellipse center (0-1); default 0.5
uniform float     u_hand_center_y;
uniform float     u_hand_radius_x;    // hand ellipse radius (0-1); default smaller
uniform float     u_hand_radius_y;
uniform float     u_hand_zoom;        // zoom into hand (1=no zoom, 2=2x); default 2.0
uniform sampler2D u_tex0;

#define iResolution u_resolution
#define iTime       u_time
#define iChannel0   u_tex0

// ---- Parameters (same as animated_pixels.frag) ----
#define GRID        1000.0
#define SPEED       1.0
#define TWINKLE_MIX 0.2
#define INVERT_MASK 1
#define INVERT_COLORS 1

// ---- 3D rotation: tilt range +/- 30 degrees from center ----
#define TILT_MAX_DEG  30.0
#define ROTATION_SPEED_DEFAULT 0.4
#define CAMERA_DIST  2.0
// Hand region (ellipse): only this part rotates; rest stays static
#define HAND_CENTER_X 0.5
#define HAND_CENTER_Y 0.5
#define HAND_RADIUS_X 0.22   // smaller radius = smaller rotating region
#define HAND_RADIUS_Y 0.22
#define HAND_ZOOM_DEFAULT 2.0  // zoom into hand (2 = 2x zoomed in)
#define HAND_SOFT     0.03

// degrees to radians
float deg2rad(float d) { return d * 0.01745329252; }

// Inverse project: given screen position (ndc -1..1), find (u,v) on rotated plane.
// Plane at z=0, rotated by Rx(tilt_x) * Ry(tilt_y). Camera at (0,0,CAMERA_DIST).
// Returns uv in 0..1 or out-of-range if fragment doesn't hit the front of the plane.
vec2 invProjectPlane(vec2 screenNdc, float tiltX, float tiltY) {
    float cx = cos(tiltX), sx = sin(tiltX);
    float cy = cos(tiltY), sy = sin(tiltY);
    // R = Ry(tiltY) * Rx(tiltX). Third row for P.z:
    float r20 = -sy;
    float r21 = cy * sx;
    float r22 = cy * cx;
    // First two rows for P.xy
    float r00 = cy;
    float r01 = sx * sy;
    float r10 = 0.0;
    float r11 = cx;
    float d = CAMERA_DIST;
    // P = R * (u', v', 0). P.z = r20*u' + r21*v'. P.xy = (r00*u'+r01*v', r10*u'+r11*v').
    // screenNdc = P.xy / (d + P.z)  =>  P.xy = screenNdc * (d + P.z).
    // So: (r00*u'+r01*v') = sx_ndc * (d + r20*u'+r21*v')
    //     (r10*u'+r11*v') = sy_ndc * (d + r20*u'+r21*v')
    // Rearr: r00*u'+r01*v' - sx*(r20*u'+r21*v') = sx*d
    //        r10*u'+r11*v' - sy*(r20*u'+r21*v') = sy*d
    float px = screenNdc.x, py = screenNdc.y;
    float A = r00 - px * r20;
    float B = r01 - px * r21;
    float C = r10 - py * r20;
    float D = r11 - py * r21;
    float det = A * D - B * C;
    float rhs0 = px * d;
    float rhs1 = py * d;
    vec2 uvp;
    uvp.x = (D * rhs0 - B * rhs1) / det;
    uvp.y = (-C * rhs0 + A * rhs1) / det;
    return uvp + 0.5;  // center was 0.5,0.5
}

float hash21(vec2 p) {
    p = fract(p * vec2(0.12334, 0.34545));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord)
{
    vec2 res = iResolution.xy;
    vec2 uvStatic = fragCoord / res;  // 0..1, static (text stays here)
    vec2 ndc = (uvStatic - 0.5) * 2.0;  // -1..1

    // Rotation speed and tilt
    float rotSpeed = (abs(u_rotation_speed) > 0.001) ? u_rotation_speed : ROTATION_SPEED_DEFAULT;
    float tiltX = deg2rad(TILT_MAX_DEG) * sin(iTime * rotSpeed);
    float tiltY = deg2rad(TILT_MAX_DEG) * sin(iTime * rotSpeed * 1.1 + 1.0);

    vec2 uvRotated = invProjectPlane(ndc, tiltX, tiltY);

    // Zoom into hand: sample a smaller portion of the texture (zoomed in)
    float handZoom = u_hand_zoom > 0.001 ? u_hand_zoom : HAND_ZOOM_DEFAULT;
    vec2 uvRotatedZoomed = clamp((uvRotated - 0.5) * handZoom + 0.5, 0.0, 1.0);

    // Hand region: ellipse in image space (0-1). Only inside this does the image rotate.
    float hcx = (u_hand_center_x == 0.0 && u_hand_center_y == 0.0) ? HAND_CENTER_X : u_hand_center_x;
    float hcy = (u_hand_center_x == 0.0 && u_hand_center_y == 0.0) ? HAND_CENTER_Y : u_hand_center_y;
    float hrx = u_hand_radius_x > 0.001 ? u_hand_radius_x : HAND_RADIUS_X;
    float hry = u_hand_radius_y > 0.001 ? u_hand_radius_y : HAND_RADIUS_Y;
    vec2 toCenter = (uvStatic - vec2(hcx, hcy)) / vec2(hrx, hry);
    float ell = length(toCenter);
    float handMask = 1.0 - smoothstep(1.0 - HAND_SOFT, 1.0, ell);  // 1 inside ellipse, 0 outside

    // Composite: hand region uses rotated+zoomed UV, rest uses static UV
    vec2 uv = mix(uvStatic, uvRotatedZoomed, handMask);
    uv = clamp(uv, 0.0, 1.0);

    // Off-plane: only in hand region do we fade to bg when rotated UV is off [0,1]
    float onPlaneRot = step(0.0, uvRotated.x) * step(uvRotated.x, 1.0) * step(0.0, uvRotated.y) * step(uvRotated.y, 1.0);
    float visible = (1.0 - handMask) + handMask * onPlaneRot;  // static always visible; hand visible when on plane

    // --- Pixel grid (same as animated_pixels) ---
    vec2 gridSize = vec2(GRID, GRID);
    vec2 cell     = floor(uv * gridSize);
    vec2 puv      = clamp((cell + 0.5) / gridSize, 0.0, 1.0);

    vec3 src = texture2D(iChannel0, puv).rgb;
    float lum  = dot(src, vec3(0.299, 0.587, 0.114));
    float mask = 1.0 * float(INVERT_MASK) - step(u_threshold, lum);
    float r = hash21(cell);

    float phase   = iTime * SPEED + r * 10.0;
    float gate    = step(0.35, fract(phase));
    float twinkle = smoothstep(0.2, 1.0, sin(phase) * 0.5 + 0.5);
    float anim = mix(gate, twinkle, TWINKLE_MIX);
    float pixOn = mask * anim;

    vec3 bg  = vec3(1.0 - float(INVERT_COLORS));
    vec3 ink = vec3(float(INVERT_COLORS));
    vec3 col = mix(bg, ink, pixOn);

    // Fade to background where hand is off the visible plane
    col = mix(bg, col, visible);

    fragColor = vec4(col, 1.0);
}

void main() {
    mainImage(gl_FragColor, gl_FragCoord.xy);
}
