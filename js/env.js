import * as THREE from "three";

// What the metals, varnish and glass on the desk reflect. The room is lit by a few coloured lights and a
// window full of neon, so a small scene of glowing panels stands in for them. PMREM blurs it once, at load,
// into the filtered cube that PBR materials sample. Nothing here is rendered on screen.

// Where the desk objects "look from": the monitor stands about here, so panels are placed by their
// direction from this point and keep the layout of the real window.
const EYE = new THREE.Vector3(0, 1.0, 0.5);
const DISTANCE = 12;

const ENV = {
  zenith: [0.004, 0.005, 0.02],
  mid: [0.018, 0.014, 0.06],
  horizon: [0.2, 0.05, 0.22],
  floor: [0.025, 0.017, 0.012],
  haze: { top: [0.1, 0.045, 0.26], bottom: [0.34, 0.11, 0.2] },
  neon: 2.4,
  strip: 1.3,
  cyanWall: 0.5,
  pinkWall: 0.45,
};

function gradientPanel(width, height, top, bottom) {
  const geometry = new THREE.PlaneGeometry(width, height);
  const colors = new Float32Array(12);
  [top, top, bottom, bottom].forEach((c, i) => colors.set(c, i * 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: false, toneMapped: false }),
  );
}

function place(mesh, direction, distance = DISTANCE) {
  mesh.position.copy(direction).normalize().multiplyScalar(distance);
  mesh.lookAt(0, 0, 0);
  return mesh;
}

function dome() {
  const geometry = new THREE.SphereGeometry(30, 32, 16);
  const pos = geometry.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  const smooth = (a, b, x) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  for (let i = 0; i < pos.count; i += 1) {
    const y = pos.getY(i) / 30;
    let c;
    if (y < 0) c = mix(ENV.horizon, ENV.floor, smooth(0, -0.25, y));
    else c = mix(mix(ENV.horizon, ENV.mid, smooth(0, 0.3, y)), ENV.zenith, smooth(0.25, 0.85, y));
    colors.set(c, i * 3);
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, toneMapped: false }),
  );
}

/**
 * @param {THREE.WebGLRenderer} renderer
 * @param {{ color: string, position: [number, number, number] }[]} signs neon signs: sRGB hex and world position
 * @returns {THREE.Texture | null} the prefiltered environment, or null when the GPU cannot render it
 */
export function buildEnvironment(renderer, signs = []) {
  const scene = new THREE.Scene();
  scene.add(dome());

  // The window: a wide haze of city glow, warm at the bottom and violet higher up.
  scene.add(place(gradientPanel(26, 9, ENV.haze.top, ENV.haze.bottom), new THREE.Vector3(0, 0.12, -1)));

  // Each neon sign becomes a bright panel in the direction it hangs in the window.
  for (const { color, position } of signs) {
    const panel = gradientPanel(4.2, 1.85, [1, 1, 1], [1, 1, 1]);
    const tint = new THREE.Color(color).multiplyScalar(ENV.neon);
    panel.geometry.setAttribute(
      "color",
      new THREE.BufferAttribute(new Float32Array([tint.r, tint.g, tint.b, tint.r, tint.g, tint.b, tint.r, tint.g, tint.b, tint.r, tint.g, tint.b]), 3),
    );
    scene.add(place(panel, new THREE.Vector3(...position).sub(EYE)));
  }

  // The violet strip along the top of the window and the cyan one under the sill.
  const violet = new THREE.Color(0x7a2cff).multiplyScalar(ENV.strip);
  // Paler than the real strip: a saturated cyan turns flat aluminium plates (the iMac stand) a hard mint green.
  const cyan = new THREE.Color(0x9fe6ff).multiplyScalar(ENV.strip * 0.7);
  const stripTop = gradientPanel(30, 0.5, [violet.r, violet.g, violet.b], [violet.r, violet.g, violet.b]);
  scene.add(place(stripTop, new THREE.Vector3(0, 1.45, -1.2)));
  const stripLow = gradientPanel(28, 0.4, [cyan.r, cyan.g, cyan.b], [cyan.r, cyan.g, cyan.b]);
  scene.add(place(stripLow, new THREE.Vector3(0, -0.5, -1.3)));

  // Cyan and pink wall washes at the sides, matching the two coloured point lights in the room.
  const left = new THREE.Color(0x49e7ff).multiplyScalar(ENV.cyanWall);
  const right = new THREE.Color(0xff4fd8).multiplyScalar(ENV.pinkWall);
  scene.add(place(gradientPanel(9, 8, [left.r, left.g, left.b], [left.r * 0.2, left.g * 0.2, left.b * 0.2]), new THREE.Vector3(-1, 0.1, 0.1), 9));
  scene.add(place(gradientPanel(9, 8, [right.r, right.g, right.b], [right.r * 0.2, right.g * 0.2, right.b * 0.2]), new THREE.Vector3(1, 0.1, 0.1), 9));

  // A dim cool fill from behind the camera, so nothing facing the room goes pitch black.
  const fill = new THREE.Color(0x6a78c0).multiplyScalar(0.12);
  scene.add(place(gradientPanel(14, 6, [fill.r, fill.g, fill.b], [fill.r * 0.4, fill.g * 0.4, fill.b * 0.4]), new THREE.Vector3(0.2, 0.2, 1), 10));

  let texture = null;
  try {
    const generator = new THREE.PMREMGenerator(renderer);
    texture = generator.fromScene(scene, 0.015).texture;
    generator.dispose();
  } catch {
    // No half-float render targets: the desk simply keeps the lights-only look it had before.
    texture = null;
  }
  scene.traverse((object) => {
    object.geometry?.dispose();
    object.material?.dispose();
  });
  return texture;
}
