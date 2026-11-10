precision mediump float;

uniform sampler2D uMainSampler;
uniform float uIntensity; // 0 = off, 1 = full glitch
uniform float uTime;      // seconds

varying vec2 outTexCoord;

// STUB: pass-through. Input/audio/glitch engineer: implement RGB split + scanline wobble driven by uIntensity.
void main() {
  gl_FragColor = texture2D(uMainSampler, outTexCoord);
}
