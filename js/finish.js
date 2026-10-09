import * as THREE from "three";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";

// The last pass of the frame, after tone mapping, so every value here is display-referred sRGB:
//  - FXAA for devices that render without multisampling (phones), off where MSAA already ran;
//  - a light colour grade: violet in the shadows, warmth in the highlights, a touch more contrast;
//  - chromatic aberration that grows towards the edges, like a real lens (desktop only, see createFinishPass);
//  - fine grain, which also dithers the long dark gradients that otherwise band on 8-bit panels.
export const FinishShader = {
  name: "FinishShader",
  uniforms: {
    tDiffuse: { value: null },
    uTexel: { value: new THREE.Vector2(1 / 1280, 1 / 800) },
    uTime: { value: 0 },
    uFxaa: { value: 0 },
    uGrade: { value: 1 },
    uAberration: { value: 0.0016 },
    uGrain: { value: 0.03 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uTexel;
    uniform float uTime;
    uniform float uFxaa;
    uniform float uGrade;
    uniform float uAberration;
    uniform float uGrain;
    varying vec2 vUv;

    float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

    // Interleaved gradient noise: cheap, even, and free of the visible tiling of a hash texture.
    float noise(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }

    // The classic three-tap-pair FXAA (Lottes), trimmed to what a 60 fps budget on a phone can afford.
    vec3 fxaa(vec2 uv) {
      vec3 nw = texture2D(tDiffuse, uv + vec2(-1.0, -1.0) * uTexel).rgb;
      vec3 ne = texture2D(tDiffuse, uv + vec2( 1.0, -1.0) * uTexel).rgb;
      vec3 sw = texture2D(tDiffuse, uv + vec2(-1.0,  1.0) * uTexel).rgb;
      vec3 se = texture2D(tDiffuse, uv + vec2( 1.0,  1.0) * uTexel).rgb;
      vec3 m  = texture2D(tDiffuse, uv).rgb;
      float lNW = luma(nw), lNE = luma(ne), lSW = luma(sw), lSE = luma(se), lM = luma(m);
      float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));
      float lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
      vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), (lNW + lSW) - (lNE + lSE));
      float reduce = max((lNW + lNE + lSW + lSE) * (0.25 * 0.125), 1.0 / 128.0);
      float rcp = 1.0 / (min(abs(dir.x), abs(dir.y)) + reduce);
      dir = clamp(dir * rcp, vec2(-8.0), vec2(8.0)) * uTexel;
      vec3 a = 0.5 * (texture2D(tDiffuse, uv + dir * (1.0 / 3.0 - 0.5)).rgb + texture2D(tDiffuse, uv + dir * (2.0 / 3.0 - 0.5)).rgb);
      vec3 b = a * 0.5 + 0.25 * (texture2D(tDiffuse, uv + dir * -0.5).rgb + texture2D(tDiffuse, uv + dir * 0.5).rgb);
      float lB = luma(b);
      return (lB < lMin || lB > lMax) ? a : b;
    }

    void main() {
      vec2 uv = vUv;
      vec3 col;
      if (uFxaa > 0.5) {
        // Already nine taps; the aberration below would overwrite the filtered channels, so it is skipped here.
        col = fxaa(uv);
      } else {
        col = texture2D(tDiffuse, uv).rgb;
        // Aberration pushes red and blue apart along the line from the centre; green stays put.
        vec2 off = (uv - 0.5) * uAberration * dot(uv - 0.5, uv - 0.5) * 4.0;
        col.r = texture2D(tDiffuse, uv + off).r;
        col.b = texture2D(tDiffuse, uv - off).b;
      }

      float l = luma(col);
      // Grade: lift the shadows towards violet, warm the highlights, ease in contrast and colour.
      col += vec3(0.018, 0.010, 0.042) * (1.0 - smoothstep(0.0, 0.42, l)) * uGrade;
      col *= mix(vec3(1.0), vec3(1.025, 1.0, 0.965), smoothstep(0.55, 1.0, l) * uGrade);
      col = mix(col, col * col * (3.0 - 2.0 * col), 0.16 * uGrade);
      col = mix(vec3(luma(col)), col, 1.0 + 0.07 * uGrade);

      // Grain is strongest in the shadows, where banding shows, and never below one 8-bit step of dither.
      float g = noise(gl_FragCoord.xy + fract(uTime * 0.37) * 211.0) - 0.5;
      col += g * max(uGrain * (1.0 - l * 0.7), 1.5 / 255.0);

      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }
  `,
};

/**
 * @param {{ fxaa?: boolean, grain?: number, aberration?: number }} options
 */
export function createFinishPass({ fxaa = false, grain = 0.03, aberration = 0.0016 } = {}) {
  const pass = new ShaderPass(FinishShader);
  pass.uniforms.uFxaa.value = fxaa ? 1 : 0;
  pass.uniforms.uGrain.value = grain;
  // FXAA and the aberration both resample the frame; phones that need the first skip the second.
  pass.uniforms.uAberration.value = fxaa ? 0 : aberration;
  // The composer passes the size in device pixels; one texel is what FXAA steps by.
  pass.setSize = (width, height) => pass.uniforms.uTexel.value.set(1 / Math.max(1, width), 1 / Math.max(1, height));
  return pass;
}
