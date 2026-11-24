#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

// Global glitch + always-on CRT layer (Phaser PostFX fragment shader).
// Readable Chaos: displacement is limited to a few thin bands / small blocks, the colour inversion only hits a band
// (or one 1/24 s tick of the whole frame at the highest intensities), static covers only some rows, and nothing ever
// blanks the screen. uSafe = 1 (reduced effects) scales everything down and removes the inversion / strobing.

uniform sampler2D uMainSampler;
uniform float uIntensity; // 0 = off, 1 = full glitch (already envelope-shaped by GlitchPipeline)
uniform float uTime;      // seconds
uniform float uKind;      // 0 none, 1 rgbSplit, 2 scanlineWobble, 3 stutter, 4 dropout, 5 static
uniform float uSeed;      // 0..1, derived from the event id (seed-bound pattern)
uniform float uSafe;      // 1 = reduced effects (no inversion, weaker)
uniform float uCrt;       // always-on scanline/CRT strength, 0..1
uniform vec3 uBg;        // clear colour showing through transparent camera pixels
uniform vec2 uResolution; // render size in px (set by Phaser PostFXPipeline)

varying vec2 outTexCoord;

float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Camera texture is premultiplied and transparent where nothing is drawn: composite over the clear colour so the
// effects act on what the player actually sees.
vec3 tex(vec2 p) {
  vec4 t = texture2D(uMainSampler, clamp(p, 0.0, 1.0));
  return t.rgb + uBg * (1.0 - t.a);
}

float kindIs(float n) {
  return step(abs(uKind - n), 0.5);
}

void main() {
  vec2 uv = outTexCoord;
  float I = uIntensity * mix(1.0, 0.4, uSafe);
  vec3 col;

  if (I > 0.003) {
    float wRgb = kindIs(1.0);
    float wWob = kindIs(2.0);
    float wStut = kindIs(3.0);
    float wDrop = kindIs(4.0);
    float wStat = kindIs(5.0);

    float tick = floor(uTime * 24.0);   // glitch animates at 24 steps per second
    float seed = uSeed * 97.0;

    // --- horizontal tearing: a handful of thin bands slide sideways
    float bandN = 10.0 + floor(hash11(seed + 1.0) * 14.0);
    float band = floor(uv.y * bandN);
    float bh = hash21(vec2(band, tick + seed));
    float tearProb = I * (0.16 + 0.24 * wStut + 0.14 * wWob + 0.08 * wStat);
    float tear = step(1.0 - tearProb, bh) * (hash21(vec2(band + 7.0, tick + seed)) * 2.0 - 1.0);
    uv.x += tear * 0.055 * I * (1.0 + wStut);

    // --- scanline wobble
    uv.x += sin(uv.y * uResolution.y * 0.3 + uTime * 46.0) * 0.0035 * I * (0.5 + 1.8 * wWob);

    // --- block displacement
    vec2 grid = vec2(7.0 + floor(hash11(seed + 3.0) * 8.0), 5.0 + floor(hash11(seed + 5.0) * 6.0));
    vec2 bid = floor(uv * grid);
    float blk = step(1.0 - I * (0.05 + 0.22 * (wStut + wStat + wDrop) + 0.06 * wRgb), hash21(bid + tick * 0.37 + seed));
    uv += vec2(hash21(bid + 3.1) - 0.5, (hash21(bid + 9.7) - 0.5) * 0.35) * 0.11 * blk * I;

    // --- stutter: briefly re-sample an earlier horizontal slice
    float hold = wStut * step(0.6, hash11(tick * 1.3 + seed)) * step(0.35, I);
    uv.y = mix(uv.y, fract(uv.y + 0.07 * (hash11(tick + seed) - 0.5) * 4.0), hold * 0.6);

    uv = clamp(uv, vec2(0.0), vec2(1.0));

    // --- RGB channel split
    float ang = hash11(seed + 11.0) * 6.2831853;
    float split = (0.003 + 0.011 * (0.4 + wRgb)) * I;
    vec2 dir = vec2(cos(ang), sin(ang) * 0.3);
    col = vec3(
      tex(uv + dir * split).r,
      tex(uv).g,
      tex(uv - dir * split).b
    );

    // --- dropout: signal-loss bands darken (never the whole frame)
    float dropBand = step(0.55, hash21(vec2(floor(uv.y * 18.0), tick + seed)));
    col *= 1.0 - 0.55 * wDrop * dropBand * I;

    // --- static: noise over some rows only
    float rowMask = step(0.6, hash21(vec2(floor(uv.y * uResolution.y * 0.5), tick + seed * 2.0)));
    float n = hash21(floor(uv * uResolution) + tick);
    col = mix(col, vec3(n), 0.45 * wStat * rowMask * I);

    // --- colour inversion flicker: a band, plus one whole-frame tick at high intensity
    float flick = step(0.55, hash11(tick * 1.7 + seed));
    float y0 = hash11(seed + tick);
    float inBand = step(y0, outTexCoord.y) * step(outTexCoord.y, y0 + 0.08 + 0.2 * I);
    float whole = step(0.9, hash11(tick * 2.3 + seed * 3.0)) * step(0.8, I);
    float inv = (1.0 - uSafe) * step(0.3, I) * max(flick * inBand * (0.4 + wStat + wDrop), whole * 0.8);
    col = mix(col, vec3(1.0) - col, clamp(inv, 0.0, 1.0));
  } else {
    col = tex(uv);
  }

  // --- always-on subtle CRT: faint scanlines + vignette
  float row = floor(outTexCoord.y * uResolution.y);
  col *= 1.0 - uCrt * 0.045 * mod(row, 2.0);
  vec2 q = outTexCoord - 0.5;
  col *= 1.0 - uCrt * 0.16 * smoothstep(0.35, 0.85, dot(q, q) * 2.0);

  gl_FragColor = vec4(col, 1.0);
}
