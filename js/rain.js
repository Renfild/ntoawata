import * as THREE from "three";

// Rain outside the window and drops running down the glass. Both are one instanced quad per drop whose
// position is computed from the clock in the vertex shader, so a frame costs one draw call and no CPU work.

// Height of the drawing buffer in pixels: streaks never get thinner than about a pixel, or they shimmer.
const viewport = { value: 800 };

export function setRainViewport(heightPx) {
  viewport.value = Math.max(1, heightPx);
}

const QUAD_INDEX = [0, 1, 2, 2, 1, 3];
// Corner: x across the quad (-1..1), y along it (0 at the head, 1 at the tail).
const QUAD_CORNERS = [-1, 0, 1, 0, -1, 1, 1, 1];

function instancedQuads(count, fill) {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setIndex(QUAD_INDEX);
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(12), 3));
  geometry.setAttribute("aCorner", new THREE.BufferAttribute(new Float32Array(QUAD_CORNERS), 2));
  const seeds = new Float32Array(count * 4);
  fill(seeds);
  geometry.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seeds, 4));
  geometry.instanceCount = count;
  return geometry;
}

/**
 * Streaks of rain beyond the window.
 * @param {{ count: number, fogDensity: number, random: () => number }} options
 */
export function createRain({ count, fogDensity, random }) {
  const top = 7;
  const bottom = -3;
  const geometry = instancedQuads(count, (seeds) => {
    for (let i = 0; i < count; i += 1) {
      seeds.set([(random() - 0.5) * 16, random(), -2.2 - random() * 8, random()], i * 4);
    }
  });
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uTop: { value: top },
      uBottom: { value: bottom },
      uWind: { value: 0.12 },
      uColor: { value: new THREE.Color(0xa8c8ff) },
      uFogDensity: { value: fogDensity },
      uViewportHeight: viewport,
    },
    vertexShader: /* glsl */ `
      attribute vec2 aCorner;
      attribute vec4 aSeed;
      uniform float uTime;
      uniform float uTop;
      uniform float uBottom;
      uniform float uWind;
      uniform float uFogDensity;
      uniform float uViewportHeight;
      varying vec2 vCorner;
      varying float vAlpha;

      void main() {
        float range = uTop - uBottom;
        float speed = 7.0 + aSeed.w * 3.0;
        float fall = mod(aSeed.y * range + uTime * speed, range);
        vec3 center = vec3(aSeed.x - fall * uWind, uTop - fall, aSeed.z);
        float len = 0.2 + aSeed.w * 0.16;
        vec3 along = normalize(vec3(uWind, 1.0, 0.0));
        vec3 toCam = cameraPosition - center;
        float dist = length(toCam);
        vec3 side = normalize(cross(along, toCam));
        // World size of one device pixel at this distance; the streak is never thinner than that.
        float pixel = dist * 2.0 / (projectionMatrix[1][1] * uViewportHeight);
        float width = max(0.009, pixel * 1.7);
        vec3 pos = center + along * ((aCorner.y - 0.5) * len) + side * (aCorner.x * width * 0.5);
        vCorner = aCorner;
        // Thin streaks carry less light, and distant ones fade into the haze like everything else.
        float fog = exp(-uFogDensity * uFogDensity * dist * dist);
        vAlpha = (0.34 + 0.3 * aSeed.w) * clamp(0.009 / width, 0.4, 1.0) * fog;
        gl_Position = projectionMatrix * viewMatrix * vec4(pos, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying vec2 vCorner;
      varying float vAlpha;

      void main() {
        float across = pow(1.0 - abs(vCorner.x), 1.4);
        // Brightest just behind the head, fading to nothing at the tail.
        float along = pow(1.0 - vCorner.y, 1.2) * smoothstep(0.0, 0.1, vCorner.y);
        gl_FragColor = vec4(uColor, vAlpha * across * along);
      }
    `,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  // Behind the glass layers (see addRoom), in front of the signs and the city.
  mesh.renderOrder = 1;
  return {
    mesh,
    tick: (dt, t) => {
      material.uniforms.uTime.value = t;
    },
  };
}

/**
 * Drops that run down the window glass, slowly and unevenly, each with a trail.
 * @param {{ width: number, height: number, count: number, random: () => number }} options
 */
export function createGlassDrops({ width, height, count, random }) {
  const geometry = instancedQuads(count, (seeds) => {
    for (let i = 0; i < count; i += 1) {
      // Lane across the glass, phase in the cycle, speed in metres per second, size 0..1.
      seeds.set([random(), random(), 0.03 + random() * 0.07, random() ** 1.6], i * 4);
    }
  });
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uWidth: { value: width },
      uHeight: { value: height },
    },
    vertexShader: /* glsl */ `
      attribute vec2 aCorner;
      attribute vec4 aSeed;
      uniform float uTime;
      uniform float uWidth;
      uniform float uHeight;
      varying vec2 vLocal;
      varying float vRadius;
      varying float vTail;
      varying float vLane;
      varying float vLife;
      varying float vY;

      void main() {
        float radius = 0.008 + aSeed.w * 0.011;
        float tail = 0.1 + aSeed.w * 0.5;
        float cycle = uHeight + tail + 0.5;
        // Drops stall and slip: a slow wobble rides on the steady fall.
        float travel = mod(aSeed.y * cycle + uTime * aSeed.z + 0.04 * sin(uTime * 1.3 + aSeed.y * 31.0), cycle);
        float headY = uHeight * 0.5 + 0.25 - travel;
        float sway = sin(travel * 5.0 + aSeed.y * 20.0) * 0.004;
        float x = (aSeed.x - 0.5) * uWidth + sway;
        float halfWidth = radius * 1.35;
        vec3 pos = vec3(x + aCorner.x * halfWidth, headY - radius * 1.4 + aCorner.y * (tail + radius * 1.4), 0.0);
        vLocal = vec2(aCorner.x * halfWidth, aCorner.y * (tail + radius * 1.4) - radius * 1.4);
        vRadius = radius;
        vTail = tail;
        vLane = aSeed.x;
        vLife = travel / cycle;
        vY = pos.y;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uHeight;
      varying vec2 vLocal;
      varying float vRadius;
      varying float vTail;
      varying float vLane;
      varying float vLife;
      varying float vY;

      void main() {
        if (abs(vY) > uHeight * 0.5) discard;
        float fade = smoothstep(0.0, 0.04, vLife) * (1.0 - smoothstep(0.94, 1.0, vLife));
        // Neon from the street leans cyan on the left of the window and pink on the right.
        vec3 neon = mix(vec3(0.35, 0.9, 1.0), vec3(1.0, 0.4, 0.85), vLane);
        vec3 water = mix(vec3(0.6, 0.76, 1.0), neon, 0.35);

        // The bead: an ellipse with a dark body, a bright lower rim and a small highlight, like a lens.
        vec2 q = vec2(vLocal.x / (vRadius * 0.95), vLocal.y / (vRadius * 1.25));
        float d = length(q);
        float body = 1.0 - smoothstep(0.82, 1.0, d);
        float rim = smoothstep(0.55, 0.95, d) * body;
        float lower = 0.5 + 0.5 * clamp(-q.y * 0.9 + q.x * 0.35, -1.0, 1.0);
        vec2 hl = q - vec2(-0.32, 0.42);
        float spot = 1.0 - smoothstep(0.0, 0.34, length(hl));
        float a = body * 0.1 + rim * (0.22 + 0.4 * lower) + spot * 0.7 * body;
        vec3 colour = mix(water * 0.55, water, rim * lower) + vec3(1.0) * spot * 0.6;

        // The trail: a thin wet line that thins out and fades towards the tail.
        float along = clamp((vLocal.y - vRadius * 0.6) / vTail, 0.0, 1.0);
        float line = (1.0 - smoothstep(0.0, vRadius * (0.34 - 0.2 * along), abs(vLocal.x)))
          * (1.0 - along) * (1.0 - along) * step(0.0, vLocal.y - vRadius * 0.6);
        a = max(a, line * 0.2);
        colour = mix(colour, water, line * (1.0 - body));

        gl_FragColor = vec4(colour, a * fade);
      }
    `,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  return {
    mesh,
    tick: (dt, t) => {
      material.uniforms.uTime.value = t;
    },
  };
}

/** A faint mist that gathers on the lower part of the glass. */
export function createGlassHaze({ width, height }) {
  const canvas = document.createElement("canvas");
  canvas.width = 4;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createLinearGradient(0, 0, 0, 128);
  gradient.addColorStop(0, "rgba(0,0,0,1)");
  gradient.addColorStop(0.55, "rgba(0,0,0,0.22)");
  gradient.addColorStop(1, "rgba(255,255,255,1)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 4, 128);
  const alphaMap = new THREE.CanvasTexture(canvas);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({
      color: 0x9fb2ff,
      alphaMap,
      transparent: true,
      opacity: 0.1,
      depthWrite: false,
      fog: false,
    }),
  );
  mesh.renderOrder = 2;
  return mesh;
}
