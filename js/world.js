import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { CSS3DObject, CSS3DRenderer } from "three/addons/renderers/CSS3DRenderer.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";

const CRT_W = 980;
const CRT_H = 660;
const SCALE = 0.0017;
const SCREEN_W = CRT_W * SCALE;
const SCREEN_H = CRT_H * SCALE;

const KEY_U = 0.1;
const KEY_GAP = 0.012;
const KEY_H = 0.046;
const KEY_TRAVEL = 0.014;
const KEY_BASE = 0.012;

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const desktop = window.matchMedia("(min-width: 900px)").matches;
const coarse = window.matchMedia("(pointer: coarse)").matches;
// Ambient motion (rain, cars, breathing) scales by this; direct feedback such as key presses does not.
const motion = reduceMotion ? 0 : 1;
let maxAniso = 8;

// Every per-frame update registers here and receives (dt, elapsed) in seconds.
const tickers = [];
const keyByCode = new Map();
const keyMeshes = [];
const legendCache = new Map();
let cachedChassis = null;

const canvas = document.querySelector("#webgl");
const crt = document.querySelector("#crt");
const input = document.querySelector("#cmd");
const form = document.querySelector("#form");

const HERO = desktop
  ? { pos: [1.62, 1.52, 2.72], target: [0.02, 1.02, 0.02] }
  : { pos: [1.7, 2.15, 3.15], target: [0, 1.25, 0.05] };
const ARRIVE = { pos: [3.05, 2.15, 4.55], target: [0.12, 1.22, -0.55] };

const digits = [..."1234567890"].map((d) => [`Digit${d}`, d, 1, d]);
const letters = (row) => [...row].map((c) => [`Key${c.toUpperCase()}`, c, 1, c]);

// A 60% board: [event.code, legend, width in key units, character typed on click, key sent on click].
const KEY_ROWS = [
  [["Escape", "esc", 1, null, "Escape"], ...digits, ["Minus", "-", 1, "-"], ["Equal", "=", 1, "="], ["Backspace", "bksp", 2, null, "Backspace"]],
  [["Tab", "tab", 1.5, null, "Tab"], ...letters("qwertyuiop"), ["BracketLeft", "[", 1, "["], ["BracketRight", "]", 1, "]"], ["Backslash", "\\", 1.5, "\\"]],
  [["CapsLock", "caps", 1.75], ...letters("asdfghjkl"), ["Semicolon", ";", 1, ";"], ["Quote", "'", 1, "'"], ["Enter", "enter", 2.25, null, "Enter"]],
  [["ShiftLeft", "shift", 2.25], ...letters("zxcvbnm"), ["Comma", ",", 1, ","], ["Period", ".", 1, "."], ["Slash", "/", 1, "/"], ["ShiftRight", "shift", 2.75]],
  [
    ["ControlLeft", "ctrl", 1.25],
    ["MetaLeft", "win", 1.25],
    ["AltLeft", "alt", 1.25],
    ["Space", "", 6.25, " "],
    ["AltRight", "alt", 1.25],
    ["Fn", "fn", 1.25],
    ["ContextMenu", "menu", 1.25],
    ["ControlRight", "ctrl", 1.25],
  ],
];

const SIGNS = [
  ["RENFILD", "whoami", "#ff4fd8", -2.35, 2.55, -2.15],
  ["AQUA", "open aquateche", "#49e7ff", -2.35, 1.85, -2.05],
  ["RAG", "open pcai", "#7CFF6B", -1.15, 2.85, -2.35],
  ["FISH", "open fisherman", "#ff9a3d", 0.15, 3.3, -2.4],
  ["SHOP", "open tgbotshop", "#ffc14a", 1.35, 2.7, -2.3],
  ["PET", "open tamagotchi-bot", "#d9a0ff", 2.35, 2.15, -2.1],
  ["GIT", "contact", "#d7f6ff", 2.35, 1.5, -2.05],
];

function boot() {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
  } catch {
    return;
  }
  if (!renderer.getContext()) return;

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.setClearColor(0x05060f, 1);
  maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05060f);
  scene.fog = new THREE.FogExp2(0x120c22, 0.026);

  const camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.08, 60);
  const intro = desktop && !reduceMotion;
  camera.position.set(...(intro ? ARRIVE.pos : HERO.pos));

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = !reduceMotion;
  controls.dampingFactor = 0.08;
  controls.target.set(...(intro ? ARRIVE.target : HERO.target));
  controls.maxPolarAngle = Math.PI / 2 - 0.06;
  controls.minDistance = 1.2;
  controls.maxDistance = 8.5;
  controls.update();

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    reduceMotion ? 0.25 : 0.5,
    0.55,
    0.82,
  );
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const pickables = [];
  const screenAnchor = buildWorld(scene, pickables);

  let cssRenderer = null;
  let crtObject = null;
  let screenPlaced = false;
  if (desktop) mountScreen(screenAnchor);
  document.body.classList.add("has-world");

  const clock = new THREE.Clock();
  const anim = {
    t: intro ? 0 : 1,
    duration: 2.8,
    from: new THREE.Vector3(...(intro ? ARRIVE.pos : HERO.pos)),
    to: new THREE.Vector3(...HERO.pos),
    targetFrom: new THREE.Vector3(...(intro ? ARRIVE.target : HERO.target)),
    targetTo: new THREE.Vector3(...HERO.target),
  };
  const face = new THREE.Vector3();
  const toCam = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const corner = new THREE.Vector3();
  const screenBox = new THREE.Box3();
  const frustum = new THREE.Frustum();
  const viewProj = new THREE.Matrix4();
  let pointer = null;
  let hovered = null;

  controls.addEventListener("start", () => {
    anim.t = 1;
  });
  bindPicking(canvas, camera, pickables);
  bindPhysicalKeys();

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
    cssRenderer?.setSize(window.innerWidth, window.innerHeight);
  });

  renderer.setAnimationLoop(() => {
    // Clamp so a backgrounded tab does not teleport cars and rain when it resumes.
    const dt = Math.min(clock.getDelta(), 0.1);
    const elapsed = clock.elapsedTime;
    stepCamera(anim, camera, controls, dt);
    controls.update();
    for (const tick of tickers) tick(dt, elapsed);
    if (crtObject) {
      screenAnchor.updateWorldMatrix(true, false);
      screenAnchor.matrixWorld.decompose(crtObject.position, crtObject.quaternion, crtObject.scale);
      screenAnchor.getWorldQuaternion(quat);
      face.set(0, 0, 1).applyQuaternion(quat);
      toCam.copy(camera.position).sub(crtObject.position);
      crtObject.visible = face.dot(toCam) > 0.2 && screenInView();
    }
    composer.render();
    if (cssRenderer) {
      cssRenderer.render(cssRenderer.userData.scene, camera);
      // The first CSS3D render moves #crt into the renderer's DOM, which drops focus from the command field.
      if (!screenPlaced) {
        screenPlaced = true;
        focusTerminal();
      }
    }
  });

  // A CSS3D element that crosses the camera plane or sits off-frame is not drawn,
  // yet the browser still hit-tests it and it swallows clicks meant for the desk.
  function screenInView() {
    camera.updateMatrixWorld();
    screenBox.makeEmpty();
    for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      corner.set((x * CRT_W) / 2, (y * CRT_H) / 2, 0).applyMatrix4(screenAnchor.matrixWorld);
      screenBox.expandByPoint(corner);
      if (corner.applyMatrix4(camera.matrixWorldInverse).z > -camera.near * 2) return false;
    }
    viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    return frustum.setFromProjectionMatrix(viewProj).intersectsBox(screenBox);
  }

  function mountScreen(anchor) {
    cssRenderer = new CSS3DRenderer();
    cssRenderer.setSize(window.innerWidth, window.innerHeight);
    cssRenderer.domElement.className = "css3d";
    cssRenderer.domElement.style.pointerEvents = "none";
    document.body.append(cssRenderer.domElement);
    const cssScene = new THREE.Scene();
    cssRenderer.userData = { scene: cssScene };
    crt.classList.add("is-crt");
    document.body.classList.add("has-crt");
    crt.style.userSelect = "text";
    crtObject = new CSS3DObject(crt);
    cssScene.add(crtObject);
    anchor.updateWorldMatrix(true, false);
  }

  function bindPicking(dom, cam, objects) {
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    dom.addEventListener("pointerdown", (event) => {
      pointer = { x: event.clientX, y: event.clientY };
    });
    dom.addEventListener("pointerup", (event) => {
      focusTerminal();
      if (!pointer) return;
      const dx = event.clientX - pointer.x;
      const dy = event.clientY - pointer.y;
      pointer = null;
      if (dx * dx + dy * dy > 25) return;
      const hit = cast(event, dom, cam, raycaster, mouse, objects);
      if (!hit) return;
      const data = hit.object.userData;
      if (data.onPick) {
        data.onPick();
        return;
      }
      if (data.command) {
        document.dispatchEvent(new CustomEvent("terminal:command", { detail: data.command }));
        return;
      }
      if (data.code) tapKey(hit.object);
      if (data.char != null) insertText(data.char);
      else if (data.key) sendKey(data.key);
    });
    dom.addEventListener("pointermove", (event) => {
      if (event.buttons) return;
      const hit = cast(event, dom, cam, raycaster, mouse, objects);
      const mesh = hit?.object ?? null;
      dom.style.cursor = mesh ? "pointer" : "";
      if (hovered === mesh) return;
      hovered?.userData.onHover?.(false);
      hovered = mesh;
      hovered?.userData.onHover?.(true);
    });
    dom.addEventListener("pointerleave", () => {
      hovered?.userData.onHover?.(false);
      hovered = null;
    });
  }
}

function focusTerminal() {
  if (coarse) return;
  const active = document.activeElement;
  if (active && active !== document.body && active !== input && active !== canvas) return;
  input.focus({ preventScroll: true });
}

function bindPhysicalKeys() {
  // Capture phase: the terminal handler calls preventDefault on some keys, the desk still has to move.
  window.addEventListener(
    "keydown",
    (event) => {
      const mesh = keyByCode.get(event.code);
      if (mesh) mesh.userData.down = true;
    },
    true,
  );
  window.addEventListener(
    "keyup",
    (event) => {
      const mesh = keyByCode.get(event.code);
      if (mesh) mesh.userData.down = false;
    },
    true,
  );
  window.addEventListener("blur", () => {
    for (const mesh of keyMeshes) mesh.userData.down = false;
  });
}

function tapKey(mesh) {
  mesh.userData.down = true;
  window.setTimeout(() => {
    mesh.userData.down = false;
  }, 110);
}

function stepCamera(anim, camera, controls, dt) {
  if (anim.t >= 1) return;
  anim.t = Math.min(1, anim.t + dt / anim.duration);
  const k = 1 - (1 - anim.t) ** 3;
  camera.position.lerpVectors(anim.from, anim.to, k);
  controls.target.lerpVectors(anim.targetFrom, anim.targetTo, k);
}

function cast(event, dom, camera, raycaster, mouse, objects) {
  const rect = dom.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  return raycaster.intersectObjects(objects, false)[0] || null;
}

function insertText(text) {
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  input.value = (input.value.slice(0, start) + text + input.value.slice(end)).slice(0, 240);
  const caret = Math.min(start + text.length, input.value.length);
  input.setSelectionRange(caret, caret);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  if (!coarse) input.focus({ preventScroll: true });
}

function sendKey(key) {
  if (key === "Enter") {
    form.requestSubmit();
    return;
  }
  if (key === "Backspace") {
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;
    if (start === end && start > 0) {
      input.value = input.value.slice(0, start - 1) + input.value.slice(end);
      input.setSelectionRange(start - 1, start - 1);
    } else {
      input.value = input.value.slice(0, start) + input.value.slice(end);
      input.setSelectionRange(start, start);
    }
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return;
  }
  input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  if (!coarse) input.focus({ preventScroll: true });
}

function buildWorld(scene, pickables) {
  addLights(scene);
  addSky(scene);
  addRoom(scene);
  addDesk(scene);
  const anchor = addMonitor(scene);
  addMat(scene);
  addKeyboard(scene, pickables);
  addMouse(scene);
  addCable(scene);
  addLamp(scene, pickables);
  addCat(scene, pickables);
  addCity(scene);
  addSearchlights(scene);
  addSigns(scene, pickables);
  addCars(scene);
  addRain(scene);
  return anchor;
}

function addLights(scene) {
  scene.add(new THREE.AmbientLight(0x2a3050, 0.55));
  scene.add(new THREE.HemisphereLight(0x5a5c9a, 0x1a1008, 0.35));

  const moon = new THREE.DirectionalLight(0xb4c2ff, 1.25);
  moon.position.set(-2.6, 5.6, -3.8);
  moon.castShadow = true;
  moon.shadow.mapSize.set(2048, 2048);
  moon.shadow.camera.near = 0.5;
  moon.shadow.camera.far = 14;
  moon.shadow.camera.left = -3.5;
  moon.shadow.camera.right = 3.5;
  moon.shadow.camera.top = 3.5;
  moon.shadow.camera.bottom = -3.5;
  moon.shadow.bias = -0.0004;
  moon.shadow.normalBias = 0.01;
  scene.add(moon);

  const cyan = new THREE.PointLight(0x49e7ff, 3.2, 9, 1.8);
  cyan.position.set(-2.8, 2.7, -1.6);
  scene.add(cyan);
  const pink = new THREE.PointLight(0xff4fd8, 2.4, 8, 1.8);
  pink.position.set(3.0, 2.4, -1.7);
  scene.add(pink);
  const fill = new THREE.PointLight(0x9aa6d8, 3.2, 8, 1.6);
  fill.position.set(0.6, 2.4, 2.8);
  scene.add(fill);
  const phosphor = new THREE.PointLight(0x7cff6b, 1.2, 2.4, 1.4);
  phosphor.position.set(0, 1.28, 0.95);
  scene.add(phosphor);
  tickers.push((dt, t) => {
    phosphor.intensity = 1.1 + Math.sin(t * 7) * 0.12 * motion;
  });
}

function addSky(scene) {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vDir;
      uniform float uTime;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 horizon = vec3(0.13, 0.035, 0.12);
        vec3 mid = vec3(0.018, 0.014, 0.055);
        vec3 zenith = vec3(0.003, 0.004, 0.016);
        vec3 col = mix(horizon, mid, smoothstep(-0.08, 0.22, h));
        col = mix(col, zenith, smoothstep(0.22, 0.8, h));
        vec2 uv = vec2(atan(d.z, d.x), asin(clamp(d.y, -1.0, 1.0))) * 110.0;
        vec2 cell = floor(uv);
        float r = hash(cell);
        vec2 f = fract(uv) - 0.5 - (vec2(hash(cell + 1.7), hash(cell + 3.1)) - 0.5) * 0.6;
        float star = step(0.991, r) * smoothstep(0.13, 0.0, length(f));
        star *= 0.55 + 0.45 * sin(uTime * (1.2 + r * 2.0) + r * 90.0);
        col += vec3(0.85, 0.9, 1.0) * star * smoothstep(0.06, 0.35, h) * 1.4;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(40, 48, 24), material);
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  scene.add(sky);
  tickers.push((dt, t) => {
    material.uniforms.uTime.value = t * motion;
  });

  const moon = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: moonTexture(), fog: false, depthWrite: false, transparent: true }),
  );
  moon.position.set(-8, 10, -30);
  moon.scale.setScalar(6);
  scene.add(moon);
}

function addRoom(scene) {
  const wall = new THREE.MeshStandardMaterial({ color: 0x191b24, roughness: 0.94, metalness: 0 });
  const z = -1.95;
  const t = 0.2;
  const open = { left: -3.1, right: 3.1, bottom: 0.35, top: 3.85 };
  const pieces = [
    [9, 9, open.left - 4.5, 1.5],
    [9, 9, open.right + 4.5, 1.5],
    [open.right - open.left, 3, 0, open.top + 1.5],
    [open.right - open.left, 3, 0, open.bottom - 1.5],
  ];
  for (const [w, h, x, y] of pieces) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, t), wall);
    mesh.position.set(x, y, z);
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  const trim = new THREE.MeshStandardMaterial({ color: 0x2a2e38, roughness: 0.6, metalness: 0.4 });
  const sill = new THREE.Mesh(new RoundedBoxGeometry(6.5, 0.06, 0.4, 2, 0.015), trim);
  sill.position.set(0, open.bottom + 0.03, z + 0.14);
  sill.receiveShadow = true;
  scene.add(sill);
  const frame = [
    [6.3, 0.07, 0, open.top],
    [0.07, open.top - open.bottom, open.left, (open.top + open.bottom) / 2],
    [0.07, open.top - open.bottom, open.right, (open.top + open.bottom) / 2],
    [0.06, open.top - open.bottom, 0, (open.top + open.bottom) / 2],
    [6.2, 0.05, 0, 2.95],
  ];
  for (const [w, h, x, y] of frame) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.08), trim);
    bar.position.set(x, y, z);
    scene.add(bar);
  }
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(open.right - open.left, open.top - open.bottom),
    new THREE.MeshStandardMaterial({
      color: 0x9cc4ff,
      transparent: true,
      opacity: 0.06,
      roughness: 0.05,
      metalness: 0.6,
      depthWrite: false,
    }),
  );
  glass.position.set(0, (open.top + open.bottom) / 2, z - 0.02);
  scene.add(glass);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 12),
    new THREE.MeshStandardMaterial({ color: 0x0c0d12, roughness: 0.8 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, -0.9, 2);
  floor.receiveShadow = true;
  scene.add(floor);
}

function addDesk(scene) {
  const top = new THREE.Mesh(new RoundedBoxGeometry(4.6, 0.07, 2.9, 4, 0.02), woodMaterial());
  top.position.set(0, -0.035, 0.2);
  top.receiveShadow = true;
  top.castShadow = true;
  scene.add(top);

  const steel = new THREE.MeshStandardMaterial({ color: 0x16181d, roughness: 0.38, metalness: 0.75 });
  for (const x of [-2.12, 2.12]) {
    for (const z of [-1.0, 1.4]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.83, 0.07), steel);
      leg.position.set(x, -0.485, z);
      leg.castShadow = true;
      scene.add(leg);
    }
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 2.4), steel);
    rail.position.set(x, -0.1, 0.2);
    scene.add(rail);
  }
  const apron = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.06, 0.05), steel);
  apron.position.set(0, -0.1, 1.4);
  scene.add(apron);
}

function addMonitor(scene) {
  const group = new THREE.Group();
  group.position.set(0, 1.16, -0.08);
  scene.add(group);

  const shell = chassisMaterial();
  const dark = new THREE.MeshStandardMaterial({ color: 0x121518, roughness: 0.42, metalness: 0.35 });
  const body = new THREE.Mesh(new RoundedBoxGeometry(2.08, 1.58, 0.78, 3, 0.1), shell);
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  const taper = new THREE.Mesh(new RoundedBoxGeometry(1.72, 1.28, 0.28, 2, 0.05), shell);
  taper.position.set(0, 0, -0.5);
  taper.castShadow = true;
  group.add(taper);

  const vent = new THREE.MeshStandardMaterial({ color: 0x070a09, roughness: 0.9 });
  for (let i = 0; i < 7; i += 1) {
    const slot = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.018, 0.04), vent);
    slot.position.set(0, 0.782, -0.22 + i * 0.055);
    group.add(slot);
  }

  frameAround(group, dark);
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(SCREEN_W, SCREEN_H),
    new THREE.MeshStandardMaterial({ color: 0x031208, emissive: 0x10341c, emissiveIntensity: 0.55, roughness: 0.4 }),
  );
  glass.position.set(0, 0.04, 0.392);
  group.add(glass);

  const badge = new THREE.Mesh(
    new THREE.PlaneGeometry(0.34, 0.06),
    new THREE.MeshStandardMaterial({
      map: labelTexture("RENFILD·80", "#9aa39a", 512, 90, 54),
      transparent: true,
      roughness: 0.5,
      metalness: 0.4,
    }),
  );
  badge.position.set(-0.62, -0.68, 0.393);
  group.add(badge);

  const button = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03, 0.03, 0.03, 24),
    new THREE.MeshStandardMaterial({ color: 0x1b1f22, roughness: 0.5, metalness: 0.3 }),
  );
  button.rotation.x = Math.PI / 2;
  button.position.set(0.62, -0.68, 0.395);
  group.add(button);

  const led = new THREE.Mesh(
    new THREE.CylinderGeometry(0.012, 0.012, 0.01, 12),
    new THREE.MeshStandardMaterial({ color: 0x7cff6b, emissive: 0x7cff6b, emissiveIntensity: 2 }),
  );
  led.rotation.x = Math.PI / 2;
  led.position.set(0.72, -0.68, 0.395);
  group.add(led);
  tickers.push((dt, t) => {
    led.material.emissiveIntensity = 1.6 + Math.sin(t * 2.2) * 0.5 * motion;
  });

  const neck = new THREE.Mesh(new RoundedBoxGeometry(0.34, 0.3, 0.26, 2, 0.03), shell);
  neck.position.set(0, -0.93, -0.02);
  neck.castShadow = true;
  group.add(neck);
  const foot = new THREE.Mesh(new RoundedBoxGeometry(0.9, 0.05, 0.62, 2, 0.02), shell);
  foot.position.set(0, -1.135, 0.02);
  foot.castShadow = true;
  foot.receiveShadow = true;
  group.add(foot);

  const anchor = new THREE.Object3D();
  anchor.position.set(0, 0.04, 0.43);
  anchor.scale.setScalar(SCALE);
  group.add(anchor);
  return anchor;
}

function frameAround(group, material) {
  const t = 0.09;
  const z = 0.4;
  const w = SCREEN_W;
  const h = SCREEN_H;
  const top = new THREE.Mesh(new THREE.BoxGeometry(w + t * 2, t, 0.08), material);
  top.position.set(0, h / 2 + t / 2 + 0.04, z);
  const bottom = top.clone();
  bottom.position.y = -(h / 2 + t / 2) + 0.04;
  const sideGeo = new THREE.BoxGeometry(t, h, 0.08);
  const left = new THREE.Mesh(sideGeo, material);
  left.position.set(-(w / 2 + t / 2), 0.04, z);
  const right = left.clone();
  right.position.x *= -1;
  group.add(top, bottom, left, right);
}

function addMat(scene) {
  const mat = new THREE.Mesh(
    new RoundedBoxGeometry(2.3, 0.008, 0.86, 2, 0.004),
    new THREE.MeshStandardMaterial({ map: feltTexture(), roughness: 0.96, metalness: 0 }),
  );
  mat.position.set(0.2, 0.004, 1.02);
  mat.receiveShadow = true;
  scene.add(mat);
}

function addKeyboard(scene, pickables) {
  const group = new THREE.Group();
  // The board sits on its front edge and on two feet at the back, tilted towards the typist.
  group.position.set(0, 0.048, 1.0);
  group.rotation.x = 0.055;
  scene.add(group);

  const width = 15 * KEY_U + 0.08;
  const depth = 5 * KEY_U + 0.08;
  const shell = new THREE.MeshStandardMaterial({
    map: brushedTexture(),
    color: 0x7a818c,
    roughness: 0.42,
    metalness: 0.7,
  });
  const tray = new THREE.Mesh(new RoundedBoxGeometry(width, 0.05, depth, 3, 0.016), shell);
  tray.castShadow = true;
  tray.receiveShadow = true;
  group.add(tray);

  const plate = new THREE.Mesh(
    new THREE.BoxGeometry(15 * KEY_U + 0.012, 0.004, 5 * KEY_U + 0.012),
    new THREE.MeshStandardMaterial({ color: 0x0b0d10, roughness: 0.7, metalness: 0.2 }),
  );
  plate.position.y = 0.025;
  plate.receiveShadow = true;
  group.add(plate);

  const rubber = new THREE.MeshStandardMaterial({ color: 0x0a0b0c, roughness: 0.95 });
  for (const x of [-0.62, 0.62]) {
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.04, 0.05), rubber);
    foot.position.set(x, -0.04, -0.26);
    group.add(foot);
  }

  const materials = {
    alpha: new THREE.MeshStandardMaterial({ color: 0x2b2f35, roughness: 0.58, metalness: 0.05 }),
    mod: new THREE.MeshStandardMaterial({ color: 0x40464e, roughness: 0.58, metalness: 0.05 }),
    accent: new THREE.MeshStandardMaterial({ color: 0x3f9f4c, roughness: 0.5, metalness: 0.05 }),
  };

  KEY_ROWS.forEach((row, r) => {
    let acc = 0;
    for (const [code, label, units, char, key] of row) {
      const kind = code === "Escape" || code === "Enter" ? "accent" : char != null ? "alpha" : "mod";
      const mesh = new THREE.Mesh(keycapGeometry(units), materials[kind]);
      mesh.position.set(-7.5 * KEY_U + (acc + units / 2) * KEY_U, KEY_BASE, (r - 2) * KEY_U);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData = { code, char, key, homeY: KEY_BASE, down: false };
      addLegend(mesh, label, kind === "accent" ? "#08140a" : "#c3c9c0");
      group.add(mesh);
      pickables.push(mesh);
      keyMeshes.push(mesh);
      keyByCode.set(code, mesh);
      acc += units;
    }
  });

  const plug = new THREE.Mesh(
    new RoundedBoxGeometry(0.08, 0.03, 0.05, 1, 0.008),
    new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.5 }),
  );
  plug.position.set(-0.45, 0.0, -depth / 2 - 0.02);
  group.add(plug);

  tickers.push((dt) => {
    const k = reduceMotion ? 1 : Math.min(1, dt * 38);
    for (const mesh of keyMeshes) {
      const target = mesh.userData.homeY - (mesh.userData.down ? KEY_TRAVEL : 0);
      mesh.position.y += (target - mesh.position.y) * k;
    }
  });
}

function keycapGeometry(units) {
  const w = units * KEY_U - KEY_GAP;
  const d = KEY_U - KEY_GAP;
  const geo = new RoundedBoxGeometry(w, KEY_H, d, 3, 0.009);
  geo.translate(0, KEY_H / 2, 0);
  // Sculpt the cap: the top face is narrower than the skirt, like a real OEM keycap.
  const inset = 0.011;
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i += 1) {
    const t = pos.getY(i) / KEY_H;
    pos.setX(i, pos.getX(i) * (1 - (inset * t) / (w / 2)));
    pos.setZ(i, pos.getZ(i) * (1 - (inset * t) / (d / 2)));
  }
  geo.computeBoundingBox();
  return geo;
}

function addLegend(mesh, label, color) {
  if (!label) return;
  const key = `${label}|${color}`;
  let map = legendCache.get(key);
  if (!map) {
    const size = label.length > 3 ? 44 : label.length > 1 ? 52 : 72;
    map = labelTexture(label, color, 256, 128, size);
    legendCache.set(key, map);
  }
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(0.064, 0.032),
    new THREE.MeshStandardMaterial({
      map,
      transparent: true,
      alphaTest: 0.3,
      roughness: 0.6,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }),
  );
  plane.rotation.x = -Math.PI / 2;
  plane.position.y = KEY_H + 0.0008;
  plane.raycast = () => {};
  mesh.add(plane);
}

function addMouse(scene) {
  const group = new THREE.Group();
  group.position.set(1.05, 0.008, 1.05);
  group.rotation.y = 0.12;
  scene.add(group);
  const shell = new THREE.Mesh(
    ellipsoid(0.055, 0.038, 0.085, 32, 20),
    new THREE.MeshStandardMaterial({ color: 0x1c1f24, roughness: 0.42, metalness: 0.1 }),
  );
  shell.castShadow = true;
  group.add(shell);
  const seam = new THREE.Mesh(
    new THREE.BoxGeometry(0.002, 0.004, 0.06),
    new THREE.MeshBasicMaterial({ color: 0x050607 }),
  );
  seam.position.set(0, 0.037, -0.035);
  group.add(seam);
  const wheel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.009, 0.009, 0.01, 16),
    new THREE.MeshStandardMaterial({ color: 0x3a3f46, roughness: 0.6 }),
  );
  wheel.rotation.z = Math.PI / 2;
  wheel.position.set(0, 0.038, -0.03);
  group.add(wheel);
}

function addCable(scene) {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.45, 0.04, 0.68),
    new THREE.Vector3(-0.5, 0.02, 0.56),
    new THREE.Vector3(-0.72, 0.014, 0.28),
    new THREE.Vector3(-0.8, 0.014, -0.18),
    new THREE.Vector3(-0.58, 0.014, -0.55),
    new THREE.Vector3(-0.42, 0.2, -0.76),
    new THREE.Vector3(-0.32, 0.6, -0.72),
  ]);
  const cable = new THREE.Mesh(
    new THREE.TubeGeometry(curve, 64, 0.013, 8, false),
    new THREE.MeshStandardMaterial({ color: 0x121416, roughness: 0.62 }),
  );
  cable.castShadow = true;
  scene.add(cable);
}

function addLamp(scene, pickables) {
  const group = new THREE.Group();
  group.position.set(-1.62, 0, 0.08);
  scene.add(group);

  const metal = new THREE.MeshStandardMaterial({ color: 0x3a4048, roughness: 0.38, metalness: 0.75 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xb08a4a, roughness: 0.3, metalness: 0.9 });
  const parts = [];

  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.17, 0.04, 40), metal);
  base.position.y = 0.02;
  base.castShadow = true;
  parts.push(base);

  const p0 = new THREE.Vector3(0, 0.04, 0);
  const p1 = new THREE.Vector3(-0.06, 0.66, -0.2);
  const p2 = new THREE.Vector3(0.3, 0.92, 0.22);
  parts.push(rod(p0, p1, 0.016, metal), rod(p1, p2, 0.014, metal));
  for (const p of [p0, p1, p2]) {
    const joint = new THREE.Mesh(new THREE.SphereGeometry(0.03, 20, 12), brass);
    joint.position.copy(p);
    parts.push(joint);
  }

  const aim = new THREE.Vector3(1.2, 0, 0.82);
  const dir = aim.clone().sub(p2).normalize();
  const turn = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);

  const shadeGeo = new THREE.ConeGeometry(0.115, 0.24, 40, 1, true);
  const outer = new THREE.Mesh(shadeGeo, metal);
  outer.position.copy(p2).addScaledVector(dir, 0.11);
  outer.quaternion.copy(turn);
  outer.castShadow = true;
  parts.push(outer);
  const innerMat = new THREE.MeshStandardMaterial({
    color: 0x3a3226,
    emissive: 0xffd9a0,
    emissiveIntensity: 0.6,
    side: THREE.BackSide,
    roughness: 0.8,
  });
  const inner = new THREE.Mesh(shadeGeo, innerMat);
  inner.position.copy(outer.position);
  inner.quaternion.copy(turn);
  inner.scale.setScalar(0.97);
  parts.push(inner);

  const bulbMat = new THREE.MeshStandardMaterial({ color: 0xfff1d6, emissive: 0xffe2b0, emissiveIntensity: 3 });
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.045, 20, 14), bulbMat);
  bulb.position.copy(p2).addScaledVector(dir, 0.17);
  parts.push(bulb);

  const spot = new THREE.SpotLight(0xffd6a0, 0, 5, 0.62, 0.65, 1.5);
  spot.position.copy(bulb.position);
  spot.castShadow = true;
  spot.shadow.mapSize.set(1024, 1024);
  spot.shadow.bias = -0.0006;
  spot.shadow.normalBias = 0.01;
  const target = new THREE.Object3D();
  target.position.copy(aim);
  group.add(spot, target);
  spot.target = target;

  const hit = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.22, 1.05, 12),
    new THREE.MeshBasicMaterial({ visible: false }),
  );
  hit.position.set(0.1, 0.52, 0.02);
  group.add(hit);
  pickables.push(hit);

  for (const part of parts) group.add(part);

  const state = { on: true, level: reduceMotion ? 1 : 0 };
  hit.userData.onPick = () => {
    state.on = !state.on;
  };
  tickers.push((dt) => {
    const goal = state.on ? 1 : 0;
    state.level += (goal - state.level) * (reduceMotion ? 1 : Math.min(1, dt * 9));
    spot.intensity = 14 * state.level;
    bulbMat.emissiveIntensity = 0.05 + 3 * state.level;
    innerMat.emissiveIntensity = 0.02 + 0.6 * state.level;
  });
}

function rod(a, b, radius, material) {
  const dir = b.clone().sub(a);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, dir.length(), 16), material);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  mesh.castShadow = true;
  return mesh;
}

function addCat(scene, pickables) {
  const root = new THREE.Group();
  root.position.set(1.72, 0, 0.4);
  root.rotation.y = -0.35;
  scene.add(root);

  const fabric = new THREE.MeshStandardMaterial({ map: feltTexture("#3b2d5c"), roughness: 0.95 });
  const cushion = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.35, 0.07, 48), fabric);
  cushion.position.y = 0.035;
  cushion.receiveShadow = true;
  cushion.castShadow = true;
  root.add(cushion);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.31, 0.055, 16, 60), fabric);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.075;
  rim.receiveShadow = true;
  rim.castShadow = true;
  root.add(rim);

  const layers = desktop ? 22 : 12;
  const ginger = coatTexture(["#e0924a", "#a9582a", "#f2c08c"]);
  const cream = coatTexture(["#f3dcc0", "#e2bf98", "#fff2e0"]);
  const face = coatTexture(["#e39a52", "#b8672f", "#f6caa0"], 0.3);

  // A soft warm key so the cat reads in the dark corner of the desk.
  const glow = new THREE.PointLight(0xffc89a, 1.6, 1.6, 1.6);
  glow.position.set(0.25, 0.75, 0.55);
  root.add(glow);

  const cat = new THREE.Group();
  cat.position.y = 0.07;
  root.add(cat);

  const body = new THREE.Group();
  body.position.set(-0.02, 0.1, 0);
  cat.add(body);
  addFur(body, ellipsoid(0.2, 0.115, 0.155, 56, 36, "x"), { coat: ginger, length: 0.05, layers, repeat: [7, 5] });

  const tail = new THREE.Group();
  tail.position.set(-0.02, 0, 0);
  cat.add(tail);
  const tailCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.2, 0.08, -0.04),
    new THREE.Vector3(-0.25, 0.05, 0.1),
    new THREE.Vector3(-0.12, 0.045, 0.2),
    new THREE.Vector3(0.05, 0.045, 0.21),
    new THREE.Vector3(0.14, 0.05, 0.17),
  ]);
  addFur(tail, taperedTube(tailCurve, 48, 16, 0.036, 0.018), { coat: ginger, length: 0.045, layers, repeat: [6, 2] });

  for (const x of [0.12, 0.2]) {
    const paw = new THREE.Group();
    paw.position.set(x + 0.06, 0.035, 0.16);
    paw.rotation.y = 0.3;
    cat.add(paw);
    addFur(paw, ellipsoid(0.034, 0.026, 0.05, 20, 14), { coat: cream, length: 0.018, layers: Math.ceil(layers / 2), repeat: [2, 2] });
  }

  const head = new THREE.Group();
  head.position.set(0.28, 0.2, 0.13);
  head.rotation.set(0.1, 0.7, 0.12);
  cat.add(head);
  addFur(head, ellipsoid(0.1, 0.088, 0.09, 40, 28), { coat: face, length: 0.024, layers, repeat: [4, 3] });
  const muzzle = new THREE.Group();
  muzzle.position.set(0, -0.032, 0.062);
  head.add(muzzle);
  addFur(muzzle, ellipsoid(0.05, 0.034, 0.04, 20, 14), { coat: cream, length: 0.012, layers: Math.ceil(layers / 2), repeat: [2, 2] });

  const ears = [];
  const earMat = new THREE.MeshStandardMaterial({ map: ginger, roughness: 0.9 });
  const earInner = new THREE.MeshStandardMaterial({ color: 0xe8a4a0, roughness: 0.8 });
  for (const side of [-1, 1]) {
    const ear = new THREE.Group();
    ear.position.set(side * 0.052, 0.076, -0.005);
    ear.rotation.set(-0.15, 0, -side * 0.32);
    const outerEar = new THREE.Mesh(new THREE.ConeGeometry(0.042, 0.08, 16), earMat);
    outerEar.position.y = 0.035;
    outerEar.scale.z = 0.55;
    outerEar.castShadow = true;
    const innerEar = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.062, 16), earInner);
    innerEar.position.set(0, 0.03, 0.009);
    innerEar.scale.z = 0.35;
    ear.add(outerEar, innerEar);
    head.add(ear);
    ears.push({ group: ear, side, twitch: 0 });
  }

  const faceZ = 0.108;
  const lidMat = new THREE.MeshBasicMaterial({ color: 0x2a1408 });
  const closed = new THREE.Group();
  const open = new THREE.Group();
  open.visible = false;
  const irisMat = new THREE.MeshStandardMaterial({ color: 0x9adf4a, emissive: 0x4c8a18, emissiveIntensity: 0.6, roughness: 0.2 });
  const pupilMat = new THREE.MeshBasicMaterial({ color: 0x050505 });
  for (const side of [-1, 1]) {
    const lid = new THREE.Mesh(new THREE.TorusGeometry(0.017, 0.0035, 6, 16, Math.PI), lidMat);
    lid.position.set(side * 0.042, 0.012, faceZ - 0.008);
    lid.rotation.set(-0.25, side * 0.35, Math.PI);
    closed.add(lid);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.019, 16, 12), irisMat);
    eye.position.set(side * 0.042, 0.014, faceZ - 0.012);
    eye.scale.z = 0.6;
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.019, 12, 8), pupilMat);
    pupil.scale.set(0.25, 0.85, 0.3);
    pupil.position.set(side * 0.042, 0.014, faceZ - 0.004);
    open.add(eye, pupil);
  }
  head.add(closed, open);

  const nose = new THREE.Mesh(
    new THREE.SphereGeometry(0.012, 12, 8),
    new THREE.MeshStandardMaterial({ color: 0xd9777a, roughness: 0.4 }),
  );
  nose.scale.set(1.2, 0.7, 0.7);
  nose.position.set(0, -0.018, faceZ + 0.004);
  head.add(nose);

  const whiskerPts = [];
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i += 1) {
      const y = -0.028 - i * 0.008;
      whiskerPts.push(side * 0.03, y, faceZ - 0.01, side * 0.14, y + 0.012 - i * 0.012, faceZ - 0.05);
    }
  }
  const whiskerGeo = new THREE.BufferGeometry();
  whiskerGeo.setAttribute("position", new THREE.Float32BufferAttribute(whiskerPts, 3));
  head.add(
    new THREE.LineSegments(whiskerGeo, new THREE.LineBasicMaterial({ color: 0xf5efe6, transparent: true, opacity: 0.7 })),
  );

  const zTexture = labelTexture("z", "#cfe7ff", 128, 128, 96);
  const heartTexture = labelTexture("♥", "#ff6fae", 128, 128, 100);
  const zs = [0, 1, 2].map((i) => {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: zTexture, transparent: true, depthWrite: false }));
    sprite.userData.phase = i / 3;
    root.add(sprite);
    return sprite;
  });
  const heart = new THREE.Sprite(new THREE.SpriteMaterial({ map: heartTexture, transparent: true, depthWrite: false }));
  heart.visible = false;
  root.add(heart);

  const hit = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 8), new THREE.MeshBasicMaterial({ visible: false }));
  hit.position.set(0.02, 0.18, 0.05);
  hit.scale.y = 0.7;
  root.add(hit);
  pickables.push(hit);

  const state = { awake: 0, lift: 0, heart: 1, nextTwitch: 3 };
  hit.userData.onPick = () => {
    state.awake = 4.5;
    state.heart = 0;
  };

  tickers.push((dt, t) => {
    state.awake = Math.max(0, state.awake - dt);
    const awake = state.awake > 0;
    state.lift += ((awake ? 1 : 0) - state.lift) * (reduceMotion ? 1 : Math.min(1, dt * 5));
    closed.visible = !awake;
    open.visible = awake;

    body.scale.set(1, 1 + Math.sin(t * 1.7) * 0.035 * motion, 1 + Math.sin(t * 1.7) * 0.015 * motion);
    head.rotation.x = 0.1 - state.lift * 0.4;
    head.rotation.y = 0.7 - state.lift * 0.2;
    head.position.y = 0.2 + state.lift * 0.05;
    tail.rotation.y = Math.sin(t * (awake ? 3.2 : 0.9)) * (awake ? 0.08 : 0.03) * motion;

    state.nextTwitch -= dt;
    if (state.nextTwitch <= 0 && motion) {
      ears[Math.floor(Math.random() * ears.length)].twitch = 1;
      state.nextTwitch = 2.5 + Math.random() * 5;
    }
    for (const ear of ears) {
      ear.twitch = Math.max(0, ear.twitch - dt * 5);
      ear.group.rotation.z = -ear.side * (0.32 - state.lift * 0.12) - ear.side * Math.sin(ear.twitch * Math.PI) * 0.35;
    }

    zs.forEach((sprite) => {
      const p = (t * 0.28 * motion + sprite.userData.phase) % 1;
      sprite.visible = !awake && motion > 0;
      sprite.position.set(0.2 + p * 0.12, 0.34 + p * 0.32, 0.06);
      sprite.scale.setScalar(0.05 + p * 0.05);
      sprite.material.opacity = Math.sin(p * Math.PI) * 0.85;
    });

    if (state.heart < 1) {
      state.heart = Math.min(1, state.heart + dt / 1.4);
      heart.visible = true;
      heart.position.set(0.18, 0.36 + state.heart * 0.22, 0.08);
      heart.scale.setScalar(0.08 + state.heart * 0.04);
      heart.material.opacity = Math.sin(state.heart * Math.PI);
    } else {
      heart.visible = false;
    }
  });
}

// Shell fur: the skin plus stacked offset copies that keep fewer and fewer strands, so hairs taper to tips.
function addFur(parent, geometry, { coat, length, layers, repeat }) {
  const strands = furNoise().clone();
  strands.repeat.set(repeat[0], repeat[1]);
  strands.needsUpdate = true;
  const skin = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ map: coat, color: 0x5e5e5e, roughness: 1 }),
  );
  skin.castShadow = true;
  skin.receiveShadow = true;
  parent.add(skin);

  const base = geometry.attributes.position;
  const normal = geometry.attributes.normal;
  for (let i = 1; i <= layers; i += 1) {
    const h = i / layers;
    const shell = geometry.clone();
    const pos = shell.attributes.position;
    for (let v = 0; v < pos.count; v += 1) {
      pos.setXYZ(
        v,
        base.getX(v) + normal.getX(v) * length * h,
        base.getY(v) + normal.getY(v) * length * h - length * 0.25 * h * h,
        base.getZ(v) + normal.getZ(v) * length * h,
      );
    }
    const shade = 0.45 + 0.55 * h;
    const mesh = new THREE.Mesh(
      shell,
      new THREE.MeshStandardMaterial({
        map: coat,
        alphaMap: strands,
        alphaTest: Math.min(0.96, 0.06 + h * 0.9),
        color: new THREE.Color(shade, shade, shade),
        roughness: 1,
      }),
    );
    mesh.receiveShadow = true;
    parent.add(mesh);
  }
}

function ellipsoid(rx, ry, rz, ws = 32, hs = 20, poles = "y") {
  const geo = new THREE.SphereGeometry(1, ws, hs);
  if (poles === "x") geo.rotateZ(-Math.PI / 2);
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  const n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    pos.setXYZ(i, x * rx, y * ry, z * rz);
    // Analytic normals keep the UV seam closed, so fur shells do not split along it.
    n.set(x / rx, y / ry, z / rz).normalize();
    nor.setXYZ(i, n.x, n.y, n.z);
  }
  return geo;
}

function taperedTube(curve, segments, radial, r0, r1) {
  const frames = curve.computeFrenetFrames(segments, false);
  const positions = [];
  const normals = [];
  const uvs = [];
  const index = [];
  const point = new THREE.Vector3();
  const dir = new THREE.Vector3();
  for (let i = 0; i <= segments; i += 1) {
    const u = i / segments;
    curve.getPointAt(u, point);
    // Round the tip off over the last few rings.
    const tip = u > 0.85 ? Math.sqrt(Math.max(0, 1 - ((u - 0.85) / 0.15) ** 2)) : 1;
    const radius = (r0 + (r1 - r0) * u) * Math.max(tip, 0.05);
    for (let j = 0; j <= radial; j += 1) {
      const a = (j / radial) * Math.PI * 2;
      dir.set(0, 0, 0).addScaledVector(frames.normals[i], Math.cos(a)).addScaledVector(frames.binormals[i], Math.sin(a));
      positions.push(point.x + dir.x * radius, point.y + dir.y * radius, point.z + dir.z * radius);
      normals.push(dir.x, dir.y, dir.z);
      uvs.push(u, j / radial);
    }
  }
  for (let i = 0; i < segments; i += 1) {
    for (let j = 0; j < radial; j += 1) {
      const a = i * (radial + 1) + j;
      const b = a + radial + 1;
      index.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(index);
  return geo;
}

function addCity(scene) {
  const rand = seeded(11);
  const blink = [];
  const layers = [
    { z: -8, depth: 1.4, count: 8, spread: 24, base: -9, top: [-0.6, 1.6], width: [1.4, 2.4], glow: 0.8, neon: 0.6 },
    { z: -13, depth: 2, count: 15, spread: 36, base: -9, top: [0.2, 3.4], width: [1.3, 2.6], glow: 0.65, neon: 0.35 },
    { z: -21, depth: 3, count: 24, spread: 54, base: -9, top: [1, 6.5], width: [1.4, 3], glow: 0.5, neon: 0.2 },
  ];
  const neonColors = [0x49e7ff, 0xff4fd8, 0xffc14a, 0x7cff6b, 0xa27dff];
  const antennaMat = new THREE.MeshStandardMaterial({ color: 0x1a1e26, roughness: 0.6, metalness: 0.5 });
  const facades = [0x7c889c, 0x6d7a90, 0x8d97a8, 0x7a7090].map((tint) => facadeMaterial(tint));

  for (const layer of layers) {
    for (let i = 0; i < layer.count; i += 1) {
      const x = -layer.spread / 2 + ((i + 0.5 + (rand() - 0.5) * 0.6) / layer.count) * layer.spread;
      // Keep the view straight through the window from being walled off by a near tower.
      if (layer.z > -9 && Math.abs(x) < 2.6) continue;
      const top = lerp(layer.top[0], layer.top[1], rand());
      const w = lerp(layer.width[0], layer.width[1], rand());
      const d = layer.depth * (0.7 + rand() * 0.6);
      const h = top - layer.base;
      const geo = new THREE.BoxGeometry(w, h, d);
      worldUV(geo, w, h, d, 2.6);
      const material = facades[Math.floor(rand() * facades.length)].clone();
      material.emissiveIntensity = layer.glow * (0.6 + rand() * 0.6);
      const building = new THREE.Mesh(geo, material);
      const z = layer.z - rand() * 1.5;
      building.position.set(x, layer.base + h / 2, z);
      scene.add(building);

      if (rand() < layer.neon) {
        const color = neonColors[Math.floor(rand() * neonColors.length)];
        const strip = new THREE.Mesh(
          new THREE.BoxGeometry(0.07, Math.min(h * 0.5, 3.4), 0.03),
          new THREE.MeshBasicMaterial({ color, toneMapped: false }),
        );
        strip.position.set(x + (rand() - 0.5) * w * 0.7, top - Math.min(h * 0.25, 1.9) - 0.2, z + d / 2 + 0.03);
        scene.add(strip);
        const crown = new THREE.Mesh(
          new THREE.BoxGeometry(w * 0.98, 0.05, 0.03),
          new THREE.MeshBasicMaterial({ color, toneMapped: false }),
        );
        crown.position.set(x, top - 0.08, z + d / 2 + 0.03);
        scene.add(crown);
      }
      if (rand() < 0.45) {
        const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.9, 6), antennaMat);
        mast.position.set(x + (rand() - 0.5) * w * 0.5, top + 0.45, z);
        scene.add(mast);
        const light = new THREE.Mesh(
          new THREE.SphereGeometry(0.05, 8, 6),
          new THREE.MeshBasicMaterial({ color: 0xff2a2a, toneMapped: false }),
        );
        light.position.set(mast.position.x, top + 0.92, z);
        light.userData.phase = rand() * Math.PI * 2;
        scene.add(light);
        blink.push(light);
      }
    }
  }
  tickers.push((dt, t) => {
    for (const light of blink) {
      const on = motion ? Math.sin(t * 2.2 + light.userData.phase) > 0.2 : true;
      light.visible = on;
    }
  });
}

function addSearchlights(scene) {
  const texture = gradientTexture();
  const beams = [
    { x: -6, z: -16, color: 0x9fdcff, speed: 0.18, phase: 0 },
    { x: 7, z: -18, color: 0xff9fe6, speed: 0.13, phase: 2.2 },
  ];
  for (const beam of beams) {
    const geo = new THREE.ConeGeometry(1.5, 20, 32, 1, true);
    geo.translate(0, -10, 0);
    geo.rotateX(Math.PI);
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({
        color: beam.color,
        map: texture,
        transparent: true,
        opacity: 0.16,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: false,
      }),
    );
    mesh.position.set(beam.x, -8, beam.z);
    scene.add(mesh);
    tickers.push((dt, t) => {
      const s = t * beam.speed * motion + beam.phase;
      mesh.rotation.z = Math.sin(s) * 0.55;
      mesh.rotation.x = -0.12 + Math.cos(s * 0.7) * 0.1;
    });
  }
}

function addSigns(scene, pickables) {
  const group = new THREE.Group();
  scene.add(group);
  const signs = SIGNS.map(([title, command, color, x, y, z], index) => {
    const material = signMaterial(title, color);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.42), material);
    mesh.position.set(x, y, z);
    mesh.userData = {
      command,
      baseY: y,
      phase: index * 0.7,
      onHover: (on) => mesh.scale.setScalar(on ? 1.07 : 1),
    };
    group.add(mesh);
    pickables.push(mesh);
    return mesh;
  });
  let flicker = { sign: null, left: 0, wait: 4 };
  tickers.push((dt, t) => {
    for (const sign of signs) {
      sign.position.y = sign.userData.baseY + Math.sin(t * 0.8 + sign.userData.phase) * 0.03 * motion;
    }
    if (!motion) return;
    flicker.wait -= dt;
    if (flicker.wait <= 0 && !flicker.sign) {
      flicker = { sign: signs[Math.floor(Math.random() * signs.length)], left: 0.6, wait: 5 + Math.random() * 6 };
    }
    if (flicker.sign) {
      flicker.left -= dt;
      const dim = flicker.left > 0 && Math.sin(flicker.left * 60) > 0;
      flicker.sign.material.opacity = dim ? 0.35 : 1;
      if (flicker.left <= 0) flicker.sign = null;
    }
  });
}

function addCars(scene) {
  const rand = seeded(5);
  const lanes = [
    { y: 2.2, z: -4.2, dir: 1, speed: 1.3 },
    { y: 3.1, z: -5.5, dir: -1, speed: 1.0 },
    { y: 1.4, z: -6.5, dir: 1, speed: 1.6 },
    { y: 4.2, z: -8.5, dir: -1, speed: 1.2 },
    { y: 2.6, z: -10, dir: 1, speed: 0.9 },
    { y: 5.2, z: -12, dir: -1, speed: 1.1 },
  ];
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x151a22, roughness: 0.35, metalness: 0.7 });
  const cabinMat = new THREE.MeshStandardMaterial({ color: 0x0a1420, emissive: 0x2a6aa8, emissiveIntensity: 0.6, roughness: 0.2 });
  const head = new THREE.MeshBasicMaterial({ color: 0xfff4dc, toneMapped: false });
  const tail = new THREE.MeshBasicMaterial({ color: 0xff2b4a, toneMapped: false });
  const trailTex = gradientTexture(true);
  const cars = [];
  for (const lane of lanes) {
    for (let n = 0; n < 2; n += 1) {
      const car = new THREE.Group();
      const body = new THREE.Mesh(new RoundedBoxGeometry(0.62, 0.12, 0.26, 2, 0.04), bodyMat);
      const cabin = new THREE.Mesh(new RoundedBoxGeometry(0.3, 0.08, 0.2, 2, 0.03), cabinMat);
      cabin.position.set(-0.03 * lane.dir, 0.08, 0);
      const front = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.2), head);
      front.position.set(0.31 * lane.dir, 0, 0);
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.035, 0.22), tail);
      back.position.set(-0.31 * lane.dir, 0.01, 0);
      const trail = new THREE.Mesh(
        new THREE.PlaneGeometry(1.4, 0.035),
        new THREE.MeshBasicMaterial({
          color: 0xff2b4a,
          map: trailTex,
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
        }),
      );
      trail.position.set(-1.0 * lane.dir, 0.01, 0);
      if (lane.dir < 0) trail.rotation.z = Math.PI;
      car.add(body, cabin, front, back, trail);
      car.position.set(-14 + rand() * 28, lane.y, lane.z);
      car.userData = { ...lane, baseY: lane.y, speed: lane.speed * (0.8 + rand() * 0.4), phase: rand() * 6 };
      scene.add(car);
      cars.push(car);
    }
  }
  tickers.push((dt, t) => {
    for (const car of cars) {
      const data = car.userData;
      car.position.x += data.dir * data.speed * dt * motion;
      car.position.y = data.baseY + Math.sin(t * 1.4 + data.phase) * 0.05 * motion;
      if (car.position.x > 14) car.position.x = -14;
      if (car.position.x < -14) car.position.x = 14;
    }
  });
}

function addRain(scene) {
  const count = desktop ? 1100 : 500;
  const length = 0.22;
  const positions = new Float32Array(count * 6);
  for (let i = 0; i < count; i += 1) {
    const x = (Math.random() - 0.5) * 16;
    const y = -3 + Math.random() * 10;
    const z = -2.2 - Math.random() * 8;
    positions.set([x, y, z, x + 0.03, y + length, z], i * 6);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const rain = new THREE.LineSegments(
    geometry,
    new THREE.LineBasicMaterial({ color: 0xa8c8ff, transparent: true, opacity: 0.32, depthWrite: false }),
  );
  rain.frustumCulled = false;
  scene.add(rain);
  const attr = geometry.attributes.position;
  tickers.push((dt) => {
    if (!motion) return;
    const fall = 7.5 * dt;
    const drift = 0.9 * dt;
    const array = attr.array;
    for (let i = 0; i < count; i += 1) {
      const o = i * 6;
      array[o] -= drift;
      array[o + 3] -= drift;
      array[o + 1] -= fall;
      array[o + 4] -= fall;
      if (array[o + 1] < -3) {
        const x = (Math.random() - 0.5) * 16;
        array[o] = x;
        array[o + 3] = x + 0.03;
        array[o + 1] = 7;
        array[o + 4] = 7 + length;
      }
    }
    attr.needsUpdate = true;
  });
}

// ---------- materials and procedural textures ----------

function woodMaterial() {
  const size = 1024;
  const albedo = new Uint8ClampedArray(size * size * 4);
  const rough = new Uint8ClampedArray(size * size * 4);
  const bump = new Uint8ClampedArray(size * size * 4);
  const noise = valueNoise(3);
  const fbm = (x, y, octaves) => {
    let sum = 0;
    let amp = 0.5;
    let freq = 1;
    for (let o = 0; o < octaves; o += 1) {
      sum += noise(x * freq, y * freq) * amp;
      freq *= 2;
      amp *= 0.5;
    }
    return sum;
  };
  for (let y = 0; y < size; y += 1) {
    const v = y / size;
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      // Grain runs along the long edge of the desk: rings follow v and are warped by low-frequency noise.
      const warp = fbm(u * 2.2, v * 5, 4);
      const grain = v * 11 + warp * 4.5 + Math.sin(u * 4.1 + v * 2) * 0.5;
      const ring = grain - Math.floor(grain);
      const late = smoothstep(0.62, 0.96, ring) * (1 - smoothstep(0.96, 1, ring));
      const fibre = noise(u * 7, v * 380);
      const figure = fbm(u * 1.4 + 7, v * 3 + 3, 3);
      const pore = hash2(x, y);
      const t = clamp01(0.52 + (figure - 0.5) * 0.5 - late * 0.34 + (fibre - 0.5) * 0.16 + (pore - 0.5) * 0.05);
      const i = (y * size + x) * 4;
      albedo[i] = 44 + t * 104;
      albedo[i + 1] = 26 + t * 64;
      albedo[i + 2] = 15 + t * 36;
      albedo[i + 3] = 255;
      const r = 92 + late * 50 + (fibre - 0.5) * 24;
      rough[i] = rough[i + 1] = rough[i + 2] = r;
      rough[i + 3] = 255;
      const b = 150 - late * 40 + (fibre - 0.5) * 30;
      bump[i] = bump[i + 1] = bump[i + 2] = b;
      bump[i + 3] = 255;
    }
  }
  return new THREE.MeshStandardMaterial({
    map: canvasTexture(imageCanvas(albedo, size), { srgb: true }),
    roughnessMap: canvasTexture(imageCanvas(rough, size), { srgb: false }),
    bumpMap: canvasTexture(imageCanvas(bump, size), { srgb: false }),
    bumpScale: 0.25,
    roughness: 1,
    metalness: 0,
  });
}

function chassisMaterial() {
  if (cachedChassis) return cachedChassis;
  const size = 512;
  const albedo = new Uint8ClampedArray(size * size * 4);
  const rough = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const n = hash2(x, y);
      const speck = hash2(x + 17, y * 3 + 9) > 0.992 ? -14 : 0;
      const v = 0.8 + n * 0.12;
      const i = (y * size + x) * 4;
      albedo[i] = 44 * v + 22 + speck;
      albedo[i + 1] = 50 * v + 24 + speck;
      albedo[i + 2] = 46 * v + 22 + speck;
      albedo[i + 3] = 255;
      rough[i] = rough[i + 1] = rough[i + 2] = 130 + n * 40;
      rough[i + 3] = 255;
    }
  }
  cachedChassis = new THREE.MeshStandardMaterial({
    map: canvasTexture(imageCanvas(albedo, size), { srgb: true }),
    roughnessMap: canvasTexture(imageCanvas(rough, size), { srgb: false }),
    roughness: 1,
    metalness: 0.2,
  });
  return cachedChassis;
}

function brushedTexture() {
  const size = 512;
  const data = new Uint8ClampedArray(size * size * 4);
  const lines = new Float32Array(size);
  for (let y = 0; y < size; y += 1) lines[y] = hash2(3, y);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const v = 150 + lines[y] * 40 + hash2(x, y) * 12;
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return canvasTexture(imageCanvas(data, size), { srgb: true });
}

function feltTexture(base = "#17191f") {
  const size = 256;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  const image = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < image.data.length; i += 4) {
    const n = (hash2(i, 7) - 0.5) * 18;
    image.data[i] += n;
    image.data[i + 1] += n;
    image.data[i + 2] += n;
  }
  ctx.putImageData(image, 0, 0);
  return canvasTexture(c, { srgb: true, repeat: [4, 2] });
}

function coatTexture([base, stripe, light], stripes = 0.75) {
  const w = 512;
  const h = 256;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  const image = ctx.createImageData(w, h);
  const noise = valueNoise(9);
  const a = hexRgb(base);
  const b = hexRgb(stripe);
  const l = hexRgb(light);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const u = x / w;
      const v = y / h;
      const wobble = Math.sin(u * Math.PI * 6) * 0.5 + (noise(u * 10, v * 10) - 0.5) * 2.2;
      const band = Math.sin(v * Math.PI * 18 + wobble);
      const s = smoothstep(0.3, 0.85, band);
      const glow = smoothstep(0.55, 0.9, noise(u * 4 + 5, v * 4)) * 0.5;
      const n = (noise(u * 60, v * 60) - 0.5) * 0.12;
      const i = (y * w + x) * 4;
      for (let k = 0; k < 3; k += 1) {
        const mixed = a[k] + (b[k] - a[k]) * s * stripes + (l[k] - a[k]) * glow * (1 - s);
        image.data[i + k] = mixed * (1 + n);
      }
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

let cachedFur = null;
function furNoise() {
  if (cachedFur) return cachedFur;
  const size = 256;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  const image = ctx.createImageData(size, size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      // Mostly per-strand randomness with a little clumping so the coat reads as tufts.
      const clump = hash2(x >> 3, (y >> 3) + 101);
      const v = Math.min(1, hash2(x, y) * 0.8 + clump * 0.28);
      const i = (y * size + x) * 4;
      image.data[i] = image.data[i + 1] = image.data[i + 2] = v * 255;
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  cachedFur = new THREE.CanvasTexture(c);
  cachedFur.colorSpace = THREE.NoColorSpace;
  cachedFur.wrapS = cachedFur.wrapT = THREE.RepeatWrapping;
  cachedFur.generateMipmaps = false;
  cachedFur.minFilter = THREE.LinearFilter;
  return cachedFur;
}

function facadeMaterial(tint) {
  const size = 256;
  const albedo = document.createElement("canvas");
  const glow = document.createElement("canvas");
  albedo.width = glow.width = size;
  albedo.height = glow.height = size;
  const actx = albedo.getContext("2d");
  const gctx = glow.getContext("2d");
  actx.fillStyle = "#11151d";
  actx.fillRect(0, 0, size, size);
  gctx.fillStyle = "#000";
  gctx.fillRect(0, 0, size, size);
  const cell = 32;
  const lit = ["#ffd9a0", "#ffe7c2", "#f3c77e", "#bfe3ff"];
  for (let y = 4; y < size; y += cell) {
    for (let x = 4; x < size; x += cell) {
      const h = hash2(x + tint, y);
      actx.fillStyle = h > 0.5 ? "#1a222c" : "#151b24";
      actx.fillRect(x, y, 20, 22);
      if (h < 0.8) continue;
      const color = lit[Math.floor(hash2(y, x) * lit.length)];
      actx.fillStyle = color;
      actx.fillRect(x, y, 20, 22);
      gctx.fillStyle = color;
      gctx.globalAlpha = 0.45 + hash2(x * 3, y) * 0.55;
      gctx.fillRect(x, y, 20, 22);
      gctx.globalAlpha = 1;
    }
  }
  const map = canvasTexture(albedo, { srgb: true, repeat: [1, 1] });
  const emissiveMap = canvasTexture(glow, { srgb: true, repeat: [1, 1] });
  return new THREE.MeshStandardMaterial({
    color: tint,
    map,
    emissive: 0xffffff,
    emissiveMap,
    emissiveIntensity: 0.7,
    roughness: 0.9,
    metalness: 0.05,
  });
}

function signMaterial(title, color) {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 224;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "rgba(6, 8, 14, 0.9)";
  roundRect(ctx, 6, 6, 500, 212, 26);
  ctx.fill();
  ctx.shadowColor = color;
  ctx.shadowBlur = 28;
  ctx.strokeStyle = color;
  ctx.lineWidth = 9;
  roundRect(ctx, 20, 20, 472, 184, 20);
  ctx.stroke();
  ctx.font = "700 94px ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 6;
  ctx.strokeText(title, 256, 116);
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#ffffff";
  ctx.globalAlpha = 0.85;
  ctx.fillText(title, 256, 116);
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = maxAniso;
  return new THREE.MeshBasicMaterial({ map, toneMapped: false, transparent: true });
}

function labelTexture(text, color, w, h, size) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `600 ${size}px ui-monospace, "SFMono-Regular", Menlo, monospace`;
  ctx.fillText(text, w / 2, h / 2 + size * 0.04);
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = maxAniso;
  return map;
}

function moonTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const ctx = c.getContext("2d");
  const halo = ctx.createRadialGradient(128, 128, 10, 128, 128, 128);
  halo.addColorStop(0, "rgba(220,230,255,0.9)");
  halo.addColorStop(0.18, "rgba(200,210,255,0.35)");
  halo.addColorStop(1, "rgba(120,90,200,0)");
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = "#eef2ff";
  ctx.beginPath();
  ctx.arc(128, 128, 26, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(160,170,200,0.35)";
  for (const [x, y, r] of [[118, 120, 6], [136, 134, 4], [124, 140, 3]]) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  return map;
}

// Brightest at uv.y = 1 fading to nothing at uv.y = 0 (horizontal when `across`).
function gradientTexture(across = false) {
  const c = document.createElement("canvas");
  c.width = across ? 256 : 4;
  c.height = across ? 4 : 256;
  const ctx = c.getContext("2d");
  const g = across ? ctx.createLinearGradient(256, 0, 0, 0) : ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, "#ffffff");
  g.addColorStop(0.35, "#6a6a6a");
  g.addColorStop(1, "#000000");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, c.width, c.height);
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  return map;
}

// Box UVs in world units so every building gets windows of the same size.
function worldUV(geo, w, h, d, cell) {
  const uv = geo.attributes.uv;
  const nor = geo.attributes.normal;
  const pos = geo.attributes.position;
  for (let i = 0; i < uv.count; i += 1) {
    const nx = Math.abs(nor.getX(i));
    const ny = Math.abs(nor.getY(i));
    const x = pos.getX(i) + w / 2;
    const y = pos.getY(i) + h / 2;
    const z = pos.getZ(i) + d / 2;
    if (ny > 0.5) uv.setXY(i, 0, 0);
    else if (nx > 0.5) uv.setXY(i, z / cell, y / cell);
    else uv.setXY(i, x / cell, y / cell);
  }
}

function imageCanvas(data, size) {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d");
  const image = ctx.createImageData(size, size);
  image.data.set(data);
  ctx.putImageData(image, 0, 0);
  return c;
}

function canvasTexture(source, { srgb = true, repeat = null } = {}) {
  const map = new THREE.CanvasTexture(source);
  map.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  map.anisotropy = maxAniso;
  if (repeat) {
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.repeat.set(repeat[0], repeat[1]);
  }
  return map;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function hash2(x, y) {
  let n = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

function valueNoise(seed) {
  return (x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const a = hash2(xi + seed * 131, yi);
    const b = hash2(xi + 1 + seed * 131, yi);
    const c = hash2(xi + seed * 131, yi + 1);
    const d = hash2(xi + 1 + seed * 131, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}

function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function hexRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function smoothstep(a, b, x) {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

function clamp01(x) {
  return Math.min(1, Math.max(0, x));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

boot();
