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

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const desktop = window.matchMedia("(min-width: 900px)").matches;
let maxAniso = 8;
let cachedWood = null;
let cachedChassis = null;
let sharedKeyMaterial = null;
const keyGeometryCache = new Map();

const canvas = document.querySelector("#webgl");
const crt = document.querySelector("#crt");
const input = document.querySelector("#cmd");
const form = document.querySelector("#form");

const HERO = desktop
  ? { pos: [1.62, 1.52, 2.72], target: [0.02, 1.02, 0.02] }
  : { pos: [1.7, 2.15, 3.15], target: [0, 1.25, 0.05] };
const ARRIVE = { pos: [3.05, 2.15, 4.55], target: [0.12, 1.22, -0.55] };

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
  renderer.setClearColor(0x071018, 1);
  maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x071018);
  scene.fog = new THREE.FogExp2(0x071018, 0.032);

  const camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.08, 40);
  const intro = desktop && !reduceMotion;
  camera.position.set(...(intro ? ARRIVE.pos : HERO.pos));

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = !reduceMotion;
  controls.dampingFactor = 0.08;
  controls.target.set(...(intro ? ARRIVE.target : HERO.target));
  controls.maxPolarAngle = Math.PI / 2 - 0.06;
  controls.minDistance = 1.35;
  controls.maxDistance = 8.5;
  controls.update();

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    reduceMotion ? 0.22 : 0.4,
    0.5,
    0.86,
  );
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const pickables = [];
  const screenAnchor = buildRoom(scene, pickables);

  let cssRenderer = null;
  let crtObject = null;
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
  let pointer = null;
  let hovered = null;

  controls.addEventListener("start", () => {
    anim.t = 1;
  });
  bindPicking(canvas, camera, pickables);

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
    cssRenderer?.setSize(window.innerWidth, window.innerHeight);
  });

  renderer.setAnimationLoop(() => {
    const dt = clock.getDelta();
    stepCamera(anim, camera, controls, dt);
    controls.update();
    if (!reduceMotion) drift(scene, clock.elapsedTime);
    if (crtObject) {
      screenAnchor.updateWorldMatrix(true, false);
      screenAnchor.matrixWorld.decompose(crtObject.position, crtObject.quaternion, crtObject.scale);
      screenAnchor.getWorldQuaternion(quat);
      face.set(0, 0, 1).applyQuaternion(quat);
      toCam.copy(camera.position).sub(crtObject.position);
      crtObject.visible = face.dot(toCam) > 0.2;
    }
    composer.render();
    cssRenderer?.render(cssRenderer.userData.scene, camera);
  });

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
      if (!pointer) return;
      const dx = event.clientX - pointer.x;
      const dy = event.clientY - pointer.y;
      pointer = null;
      if (dx * dx + dy * dy > 25) return;
      const hit = cast(event, dom, cam, raycaster, mouse, objects);
      if (!hit) return;
      press(hit.object);
      const data = hit.object.userData;
      if (data.command) {
        document.dispatchEvent(new CustomEvent("terminal:command", { detail: data.command }));
      } else if (data.char != null) {
        insertText(data.char);
      } else if (data.key) {
        sendKey(data.key);
      }
    });
    dom.addEventListener("pointermove", (event) => {
      const hit = cast(event, dom, cam, raycaster, mouse, objects);
      const mesh = hit?.object ?? null;
      dom.style.cursor = mesh ? "pointer" : "";
      if (hovered === mesh) return;
      if (hovered?.userData.homeY != null) hovered.position.y = hovered.userData.homeY;
      hovered = mesh?.userData.homeY != null ? mesh : null;
      if (hovered) hovered.position.y = hovered.userData.homeY + 0.008;
    });
    dom.addEventListener("pointerleave", () => {
      if (hovered?.userData.homeY != null) hovered.position.y = hovered.userData.homeY;
      hovered = null;
    });
  }
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

function press(mesh) {
  const home = mesh.userData.homeY;
  if (home == null) return;
  mesh.position.y = home - 0.02;
  window.setTimeout(() => {
    mesh.position.y = home;
  }, 90);
}

function insertText(text) {
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  input.value = (input.value.slice(0, start) + text + input.value.slice(end)).slice(0, 240);
  const caret = Math.min(start + text.length, input.value.length);
  input.setSelectionRange(caret, caret);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  if (!window.matchMedia("(pointer: coarse)").matches) input.focus({ preventScroll: true });
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
  if (!window.matchMedia("(pointer: coarse)").matches) input.focus({ preventScroll: true });
}

function buildRoom(scene, pickables) {
  scene.add(new THREE.AmbientLight(0x243044, 0.72));

  const sun = new THREE.DirectionalLight(0xeef3ff, 1.45);
  sun.position.set(4.2, 6.4, 3.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 18;
  sun.shadow.camera.left = -6;
  sun.shadow.camera.right = 6;
  sun.shadow.camera.top = 6;
  sun.shadow.camera.bottom = -6;
  sun.shadow.bias = -0.00035;
  scene.add(sun);

  const cyan = new THREE.PointLight(0x49e7ff, 5.5, 10, 1.8);
  cyan.position.set(-2.8, 2.7, -1.8);
  scene.add(cyan);
  const pink = new THREE.PointLight(0xff4fd8, 4.2, 9, 1.8);
  pink.position.set(3.1, 2.35, -2.1);
  scene.add(pink);
  const fill = new THREE.PointLight(0xfff1d4, 8, 8, 1.6);
  fill.position.set(0.35, 2.15, 2.55);
  scene.add(fill);
  const phosphor = new THREE.PointLight(0x7cff6b, 1.35, 2.4, 1.4);
  phosphor.position.set(0, 1.28, 0.95);
  phosphor.name = "phosphor";
  scene.add(phosphor);

  addDesk(scene);
  const anchor = addMonitor(scene);
  addKeyboard(scene, pickables);
  addMug(scene);
  addBoard(scene);
  addCable(scene);
  addWindow(scene);
  addCity(scene);
  addSigns(scene, pickables);
  addCars(scene);
  addRain(scene);
  return anchor;
}

function addDesk(scene) {
  const material = woodMaterial();
  for (let i = 0; i < 7; i += 1) {
    const plank = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.12, 0.42), material);
    plank.position.set(0, -0.06, -1.15 + i * 0.44);
    plank.receiveShadow = true;
    plank.castShadow = true;
    scene.add(plank);
  }
  const apron = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.36, 0.1), material);
  apron.position.set(0, -0.28, 1.55);
  apron.castShadow = true;
  scene.add(apron);
}

function addMonitor(scene) {
  const group = new THREE.Group();
  group.position.set(0, 1.16, -0.08);
  scene.add(group);

  const shell = chassisMaterial();
  const dark = new THREE.MeshStandardMaterial({ color: 0x14181a, roughness: 0.4, metalness: 0.35 });
  const body = new THREE.Mesh(new RoundedBoxGeometry(2.08, 1.58, 0.78, 2, 0.1), shell);
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  const taper = new THREE.Mesh(new RoundedBoxGeometry(1.72, 1.28, 0.28, 1, 0.04), shell);
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
  const chin = new THREE.Mesh(
    new RoundedBoxGeometry(0.52, 0.055, 0.03, 1, 0.008),
    new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.88, roughness: 0.26 }),
  );
  chin.position.set(0, -0.68, 0.42);
  group.add(chin);

  const led = new THREE.Mesh(
    new THREE.BoxGeometry(0.045, 0.045, 0.04),
    new THREE.MeshStandardMaterial({ color: 0x7cff6b, emissive: 0x7cff6b, emissiveIntensity: 1.6 }),
  );
  led.position.set(0.72, -0.68, 0.42);
  led.name = "led";
  group.add(led);

  const stand = new THREE.Mesh(new RoundedBoxGeometry(0.46, 0.36, 0.32, 1, 0.03), shell);
  stand.position.set(0, -0.96, 0.02);
  stand.castShadow = true;
  group.add(stand);

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

function addKeyboard(scene, pickables) {
  const group = new THREE.Group();
  group.position.set(0, 0.08, 1.02);
  scene.add(group);
  const deck = new THREE.Mesh(new RoundedBoxGeometry(1.86, 0.08, 0.78, 2, 0.018), chassisMaterial());
  deck.castShadow = true;
  deck.receiveShadow = true;
  group.add(deck);
  const rest = new THREE.Mesh(
    new RoundedBoxGeometry(1.72, 0.04, 0.14, 1, 0.012),
    new THREE.MeshStandardMaterial({ color: 0x161a18, roughness: 0.74, metalness: 0.02 }),
  );
  rest.position.set(0, 0.02, 0.4);
  group.add(rest);

  const rows = [
    ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
    ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
    ["a", "s", "d", "f", "g", "h", "j", "k", "l"],
    ["z", "x", "c", "v", "b", "n", "m", ".", "/"],
  ];
  rows.forEach((keys, row) => {
    keys.forEach((char, col) => {
      const mesh = keyMesh(0.09, char);
      mesh.position.set((col - (keys.length - 1) / 2) * 0.105, 0.046, -0.24 + row * 0.12);
      mesh.userData.char = char;
      mesh.userData.homeY = mesh.position.y;
      group.add(mesh);
      pickables.push(mesh);
    });
  });

  const actions = [
    ["Escape", "esc", 0.16],
    ["Tab", "tab", 0.16],
    [" ", "", 0.62],
    ["Backspace", "bksp", 0.2],
    ["Enter", "enter", 0.24],
  ];
  let x = -0.78;
  actions.forEach(([key, label, width]) => {
    const mesh = keyMesh(width, label);
    mesh.position.set(x + width / 2, 0.046, 0.24);
    mesh.userData.homeY = mesh.position.y;
    if (key === " ") mesh.userData.char = " ";
    else mesh.userData.key = key;
    mesh.name = label || "space";
    group.add(mesh);
    pickables.push(mesh);
    x += width + 0.03;
  });
}

function keyMesh(width, label) {
  const mesh = new THREE.Mesh(keycapGeometry(width), keycapMaterial());
  mesh.castShadow = true;
  addLegend(mesh, label, width);
  return mesh;
}

function keycapGeometry(width) {
  const key = width.toFixed(3);
  const cached = keyGeometryCache.get(key);
  if (cached) return cached;
  const geo = buildKeycap(width, 0.086);
  keyGeometryCache.set(key, geo);
  return geo;
}

function keycapRing(hw, hd, cut) {
  const c = Math.min(cut, hw * 0.42, hd * 0.42);
  return [
    [-hw + c, -hd],
    [hw - c, -hd],
    [hw, -hd + c],
    [hw, hd - c],
    [hw - c, hd],
    [-hw + c, hd],
    [-hw, hd - c],
    [-hw, -hd + c],
  ];
}

function buildKeycap(width, depth) {
  const hw = width / 2;
  const hd = depth / 2;
  const cut = Math.min(0.014, hw * 0.3, hd * 0.3);
  const layers = [
    { y: 0, pts: keycapRing(hw, hd, cut) },
    { y: 0.014, pts: keycapRing(hw * 0.96, hd * 0.96, cut * 0.85) },
    { y: 0.038, pts: keycapRing(hw * 0.82, hd * 0.8, cut * 0.6) },
    { y: 0.05, pts: keycapRing(hw * 0.72, hd * 0.68, cut * 0.4) },
  ];
  const positions = [];
  const index = [];
  const add = (x, y, z) => {
    positions.push(x, y, z);
    return positions.length / 3 - 1;
  };
  const ids = layers.map((layer) => layer.pts.map(([x, z]) => add(x, layer.y, z)));
  const count = 8;
  for (let layer = 0; layer < layers.length - 1; layer += 1) {
    for (let i = 0; i < count; i += 1) {
      const next = (i + 1) % count;
      const a = ids[layer][i];
      const b = ids[layer][next];
      const c = ids[layer + 1][next];
      const d = ids[layer + 1][i];
      index.push(a, d, b, b, d, c);
    }
  }
  const bottom = add(0, 0, 0);
  for (let i = 0; i < count; i += 1) index.push(bottom, ids[0][i], ids[0][(i + 1) % count]);
  const inner = keycapRing(hw * 0.4, hd * 0.36, cut * 0.2).map(([x, z]) => add(x, 0.044, z));
  for (let i = 0; i < count; i += 1) {
    const next = (i + 1) % count;
    index.push(ids[3][i], inner[i], ids[3][next], ids[3][next], inner[i], inner[next]);
  }
  const crown = add(0, 0.037, 0);
  for (let i = 0; i < count; i += 1) index.push(inner[i], crown, inner[(i + 1) % count]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}

function keycapMaterial() {
  if (sharedKeyMaterial) return sharedKeyMaterial;
  sharedKeyMaterial = new THREE.MeshStandardMaterial({
    map: proceduralTexture(512, drawPlastic, { srgb: true }),
    roughnessMap: proceduralTexture(512, drawPlasticRough, { srgb: false }),
    bumpMap: proceduralTexture(512, drawPlasticBump, { srgb: false }),
    bumpScale: 0.0025,
    roughness: 1,
    metalness: 0.07,
  });
  return sharedKeyMaterial;
}

function addLegend(mesh, label, width) {
  if (!label) return;
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, 256, 128);
  ctx.fillStyle = "#c2c6be";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const size = label.length > 3 ? 52 : label.length > 1 ? 64 : 96;
  ctx.font = `600 ${size}px ui-monospace, monospace`;
  ctx.fillText(label, 128, 68);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = maxAniso;
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(Math.min(width * 0.76, 0.18), 0.04),
    new THREE.MeshStandardMaterial({
      map,
      transparent: true,
      alphaTest: 0.35,
      roughness: 0.62,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }),
  );
  plane.rotation.x = -Math.PI / 2;
  mesh.geometry.computeBoundingBox();
  plane.position.y = mesh.geometry.boundingBox.max.y + 0.001;
  plane.raycast = () => {};
  mesh.add(plane);
}

function addMug(scene) {
  const group = new THREE.Group();
  group.position.set(1.55, 0.16, 0.72);
  scene.add(group);
  const clay = new THREE.MeshStandardMaterial({
    map: proceduralTexture(256, drawCeramic, { srgb: true }),
    roughness: 0.46,
    metalness: 0.04,
  });
  const outer = new THREE.Mesh(new THREE.CylinderGeometry(0.112, 0.1, 0.28, 28, 1, true), clay);
  outer.castShadow = true;
  group.add(outer);
  const inner = new THREE.Mesh(
    new THREE.CylinderGeometry(0.098, 0.088, 0.26, 20, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x141c18, roughness: 0.62, side: THREE.BackSide }),
  );
  group.add(inner);
  const bottom = new THREE.Mesh(new THREE.CircleGeometry(0.1, 28), clay);
  bottom.rotation.x = Math.PI / 2;
  bottom.position.y = -0.14;
  group.add(bottom);
  const coffee = new THREE.Mesh(
    new THREE.CircleGeometry(0.092, 22),
    new THREE.MeshStandardMaterial({ color: 0x2a1c12, roughness: 0.28, metalness: 0.08 }),
  );
  coffee.rotation.x = -Math.PI / 2;
  coffee.position.y = 0.085;
  group.add(coffee);
  const handleCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.09, 0.06, 0),
    new THREE.Vector3(0.175, 0.045, 0),
    new THREE.Vector3(0.175, -0.045, 0),
    new THREE.Vector3(0.09, -0.06, 0),
  ]);
  const handle = new THREE.Mesh(new THREE.TubeGeometry(handleCurve, 14, 0.014, 8, false), clay);
  handle.position.set(0, 0.01, 0);
  handle.castShadow = true;
  group.add(handle);
  const mark = new THREE.Mesh(
    new THREE.CircleGeometry(0.04, 18),
    new THREE.MeshBasicMaterial({ color: 0x7cff6b }),
  );
  mark.position.set(0, 0.02, 0.113);
  group.add(mark);
}

function addBoard(scene) {
  const group = new THREE.Group();
  group.position.set(-1.55, 0.05, 0.62);
  scene.add(group);
  const board = new THREE.Mesh(
    new THREE.BoxGeometry(0.55, 0.03, 0.4),
    new THREE.MeshStandardMaterial({ color: 0x0c3a22, roughness: 0.55, metalness: 0.2 }),
  );
  board.castShadow = true;
  group.add(board);
  const chip = new THREE.Mesh(
    new THREE.BoxGeometry(0.18, 0.04, 0.12),
    new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.35 }),
  );
  chip.position.set(-0.08, 0.03, 0);
  group.add(chip);
  const led = new THREE.Mesh(
    new THREE.BoxGeometry(0.04, 0.04, 0.04),
    new THREE.MeshStandardMaterial({ color: 0x49e7ff, emissive: 0x49e7ff, emissiveIntensity: 2 }),
  );
  led.position.set(0.16, 0.035, 0.1);
  led.name = "board-led";
  group.add(led);
}

function addCable(scene) {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.7, 0.12, 1.15),
    new THREE.Vector3(-1.05, 0.1, 0.7),
    new THREE.Vector3(-0.85, 0.18, 0.25),
    new THREE.Vector3(-0.55, 0.45, -0.05),
  ]);
  const cable = new THREE.Mesh(
    new THREE.TubeGeometry(curve, 28, 0.02, 7, false),
    new THREE.MeshStandardMaterial({ color: 0x141816, roughness: 0.7 }),
  );
  cable.castShadow = true;
  scene.add(cable);
}

function addWindow(scene) {
  const frame = new THREE.MeshStandardMaterial({ color: 0x10161c, roughness: 0.85 });
  const sill = new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.16, 0.28), frame);
  sill.position.set(0, 0.35, -1.72);
  scene.add(sill);
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.1, 3.4, 0.12), frame);
  bar.position.set(0, 2.05, -1.7);
  scene.add(bar);
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(6.2, 3.5),
    new THREE.MeshStandardMaterial({ color: 0x123044, transparent: true, opacity: 0.18, roughness: 0.15 }),
  );
  glass.position.set(0, 2.15, -1.78);
  scene.add(glass);
}

function addCity(scene) {
  const group = new THREE.Group();
  group.position.set(0, -0.4, -6.2);
  group.name = "city";
  scene.add(group);
  const paints = [facadeMaterial(0x9aa8b4), facadeMaterial(0x8898a4), facadeMaterial(0xa8b0b8)];
  for (let i = 0; i < 16; i += 1) {
    const height = 2.4 + ((i * 37) % 50) / 12;
    const block = new THREE.Mesh(
      new THREE.BoxGeometry(0.7 + (i % 3) * 0.25, height, 0.7 + (i % 4) * 0.15),
      paints[i % paints.length],
    );
    block.position.set((i - 8) * 0.85, height / 2, -((i * 13) % 5) * 0.35);
    group.add(block);
  }
}

function addSigns(scene, pickables) {
  const signs = [
    ["RENFILD", "whoami", "#ff4fd8", -2.35, 2.55, -2.15],
    ["AQUA", "open aquateche", "#49e7ff", -2.35, 1.85, -2.05],
    ["RAG", "open pcai", "#7CFF6B", -1.15, 2.85, -2.35],
    ["SHOP", "open tgbotshop", "#ffc14a", 1.35, 2.7, -2.3],
    ["PET", "open tamagotchi-bot", "#d9a0ff", 2.35, 2.15, -2.1],
    ["GIT", "contact", "#d7f6ff", 2.35, 1.5, -2.05],
  ];
  const group = new THREE.Group();
  group.name = "signs";
  scene.add(group);
  signs.forEach(([title, command, color, x, y, z], index) => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.42), signMaterial(title, color));
    mesh.position.set(x, y, z);
    mesh.userData.command = command;
    mesh.userData.baseY = y;
    mesh.userData.phase = index * 0.7;
    group.add(mesh);
    pickables.push(mesh);
  });
}

function addCars(scene) {
  const group = new THREE.Group();
  group.name = "cars";
  scene.add(group);
  for (let i = 0; i < 3; i += 1) {
    const car = new THREE.Group();
    car.position.set(-4 + i * 3.1, 1.5 + i * 0.55, -3.4 - i * 0.4);
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 0.16, 0.28),
      new THREE.MeshStandardMaterial({ color: 0x101820, roughness: 0.45 }),
    );
    car.add(body);
    const lamp = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.06, 0.22),
      new THREE.MeshBasicMaterial({ color: i % 2 ? 0xff4fd8 : 0x49e7ff }),
    );
    lamp.position.set(0.36, 0, 0);
    car.add(lamp);
    car.userData.speed = 0.35 + i * 0.12;
    car.userData.baseY = car.position.y;
    group.add(car);
  }
}

function addRain(scene) {
  const count = 900;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    positions[i * 3] = (Math.random() - 0.5) * 10;
    positions[i * 3 + 1] = Math.random() * 6;
    positions[i * 3 + 2] = -1.9 - Math.random() * 5;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const rain = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({ color: 0x9fd7ff, size: 0.035, transparent: true, opacity: 0.7 }),
  );
  rain.name = "rain";
  scene.add(rain);
}

function drift(scene, time) {
  const rain = scene.getObjectByName("rain");
  if (rain) {
    const positions = rain.geometry.attributes.position;
    for (let i = 1; i < positions.count * 3; i += 3) {
      positions.array[i] -= 0.08;
      if (positions.array[i] < -0.2) positions.array[i] = 6;
    }
    positions.needsUpdate = true;
  }
  const cars = scene.getObjectByName("cars");
  cars?.children.forEach((car, index) => {
    car.position.x += car.userData.speed * 0.016;
    car.position.y = car.userData.baseY + Math.sin(time * 2 + index) * 0.05;
    if (car.position.x > 6) car.position.x = -6;
  });
  const led = scene.getObjectByName("led");
  if (led) led.material.emissiveIntensity = 1.2 + Math.sin(time * 4) * 0.5;
  const boardLed = scene.getObjectByName("board-led");
  if (boardLed) boardLed.material.emissiveIntensity = 1.4 + Math.sin(time * 8) * 0.8;
  const phosphor = scene.getObjectByName("phosphor");
  if (phosphor) phosphor.intensity = 1.2 + Math.sin(time * 7) * 0.18;
  scene.getObjectByName("signs")?.children.forEach((sign) => {
    sign.position.y = sign.userData.baseY + Math.sin(time * 0.8 + sign.userData.phase) * 0.03;
  });
}

function woodMaterial() {
  if (cachedWood) return cachedWood;
  const maps = materialMaps(1024, paintWood, [2, 1]);
  cachedWood = new THREE.MeshStandardMaterial({
    ...maps,
    bumpScale: 0.02,
    roughness: 1,
    metalness: 0.02,
  });
  return cachedWood;
}

function chassisMaterial() {
  if (cachedChassis) return cachedChassis;
  const maps = materialMaps(1024, paintChassis, null);
  cachedChassis = new THREE.MeshStandardMaterial({
    ...maps,
    bumpScale: 0.012,
    roughness: 1,
    metalness: 0.18,
  });
  return cachedChassis;
}

function proceduralTexture(size, fill, { srgb = true, repeat = null } = {}) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const image = ctx.createImageData(size, size);
  fill(image.data, size);
  ctx.putImageData(image, 0, 0);
  return canvasTexture(canvas, { srgb, repeat });
}

function materialMaps(size, paint, repeat) {
  const albedo = new Uint8ClampedArray(size * size * 4);
  const rough = new Uint8ClampedArray(size * size * 4);
  const bump = new Uint8ClampedArray(size * size * 4);
  paint(albedo, rough, bump, size);
  return {
    map: canvasTexture(imageCanvas(albedo, size), { srgb: true, repeat }),
    roughnessMap: canvasTexture(imageCanvas(rough, size), { srgb: false, repeat }),
    bumpMap: canvasTexture(imageCanvas(bump, size), { srgb: false, repeat }),
  };
}

function imageCanvas(data, size) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const image = ctx.createImageData(size, size);
  image.data.set(data);
  ctx.putImageData(image, 0, 0);
  return canvas;
}

function canvasTexture(canvas, { srgb = true, repeat = null } = {}) {
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  map.anisotropy = maxAniso;
  if (repeat) {
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.repeat.set(repeat[0], repeat[1]);
  }
  return map;
}

function hash2(x, y) {
  let n = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

const WOOD_KNOTS = [
  [0.18, 0.32, 0.07],
  [0.74, 0.58, 0.055],
  [0.46, 0.82, 0.04],
];

function woodSample(x, y, size) {
  const nx = x / size;
  const ny = y / size;
  let gx = nx * 1.6;
  let gy = ny;
  WOOD_KNOTS.forEach(([kx, ky, kr]) => {
    const dx = nx - kx;
    const dy = ny - ky;
    const d2 = dx * dx + dy * dy;
    const influence = Math.exp(-d2 / (kr * kr));
    const d = Math.sqrt(d2) + 0.0001;
    gx += (dx / d) * influence * 0.18;
    gy += (dy / d) * influence * 0.18;
  });
  const rings = Math.sin(gy * 52 + Math.sin(gx * 3.4) * 1.5 + Math.sin(gy * 8 + gx * 2) * 0.55);
  const fine = Math.sin(gy * 160 + gx * 8);
  const pore = hash2(x, y);
  return 0.52 + rings * 0.3 + fine * 0.05 + (pore - 0.5) * 0.08;
}

function paintWood(albedo, rough, bump, size) {
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const t = Math.min(1, Math.max(0, woodSample(x, y, size)));
      const i = (y * size + x) * 4;
      albedo[i] = 36 + t * 78;
      albedo[i + 1] = 22 + t * 42;
      albedo[i + 2] = 14 + t * 24;
      albedo[i + 3] = 255;
      const grain = 150 + (1 - t) * 70;
      rough[i] = rough[i + 1] = rough[i + 2] = grain;
      rough[i + 3] = 255;
      const height = 70 + t * 160;
      bump[i] = bump[i + 1] = bump[i + 2] = height;
      bump[i + 3] = 255;
    }
  }
}

function chassisSample(x, y, size) {
  const nx = x / size;
  const ny = y / size;
  const n = hash2(x, y);
  const speck = hash2(x + 17, y * 3 + 9);
  const streak = Math.sin(nx * 48 + ny * 3.2) * 0.5 + 0.5;
  const scratch = Math.abs(((nx * 13 + ny * 1.7) % 1) - 0.5) < 0.0015 && hash2(y, 4) > 0.62 ? 0.22 : 0;
  let v = 0.78 + n * 0.14 + streak * 0.06 - scratch;
  if (speck > 0.988) v -= 0.18;
  return Math.min(1, Math.max(0, v));
}

function paintChassis(albedo, rough, bump, size) {
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const v = chassisSample(x, y, size);
      const i = (y * size + x) * 4;
      albedo[i] = 46 + v * 36;
      albedo[i + 1] = 56 + v * 40;
      albedo[i + 2] = 48 + v * 32;
      albedo[i + 3] = 255;
      const grain = 120 + (1 - v) * 80;
      rough[i] = rough[i + 1] = rough[i + 2] = grain;
      rough[i + 3] = 255;
      const height = 110 + v * 40;
      bump[i] = bump[i + 1] = bump[i + 2] = height;
      bump[i + 3] = 255;
    }
  }
}

function drawPlastic(data, size) {
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const n = hash2(x, y);
      const i = (y * size + x) * 4;
      const v = 44 + n * 12;
      data[i] = v;
      data[i + 1] = v + 2;
      data[i + 2] = v + 5;
      data[i + 3] = 255;
    }
  }
}

function drawPlasticRough(data, size) {
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const shade = 108 + hash2(x, y) * 36;
      const i = (y * size + x) * 4;
      data[i] = shade;
      data[i + 1] = shade;
      data[i + 2] = shade;
      data[i + 3] = 255;
    }
  }
}

function drawPlasticBump(data, size) {
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const shade = 124 + (hash2(x, y) - 0.5) * 36;
      const i = (y * size + x) * 4;
      data[i] = shade;
      data[i + 1] = shade;
      data[i + 2] = shade;
      data[i + 3] = 255;
    }
  }
}

function drawCeramic(data, size) {
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const n = hash2(x, y);
      const speck = n > 0.97 ? 16 : 0;
      const i = (y * size + x) * 4;
      data[i] = 40 + n * 10 + speck;
      data[i + 1] = 60 + n * 12;
      data[i + 2] = 48 + n * 8;
      data[i + 3] = 255;
    }
  }
}

function facadeMaterial(tint) {
  const size = 256;
  const albedo = document.createElement("canvas");
  const glow = document.createElement("canvas");
  albedo.width = glow.width = size;
  albedo.height = glow.height = size;
  const actx = albedo.getContext("2d");
  const gctx = glow.getContext("2d");
  actx.fillStyle = "#121820";
  actx.fillRect(0, 0, size, size);
  gctx.fillStyle = "#000";
  gctx.fillRect(0, 0, size, size);
  const cell = 18;
  for (let y = 3; y < size; y += cell) {
    for (let x = 3; x < size; x += cell) {
      const h = hash2(x, y);
      if (h < 0.28) continue;
      const lit = h > 0.78;
      actx.fillStyle = lit ? (h > 0.93 ? "#d7e7f2" : "#c8d4c4") : "#1c2832";
      actx.fillRect(x, y, 8, 11);
      if (!lit) continue;
      gctx.fillStyle = h > 0.93 ? "#9fd4ff" : "#e6c98a";
      gctx.fillRect(x, y, 8, 11);
    }
  }
  const map = new THREE.CanvasTexture(albedo);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(1, 2);
  map.anisotropy = maxAniso;
  const emissiveMap = new THREE.CanvasTexture(glow);
  emissiveMap.colorSpace = THREE.SRGBColorSpace;
  emissiveMap.wrapS = emissiveMap.wrapT = THREE.RepeatWrapping;
  emissiveMap.repeat.set(1, 2);
  return new THREE.MeshStandardMaterial({
    color: tint,
    map,
    emissive: 0xffffff,
    emissiveMap,
    emissiveIntensity: 0.7,
    roughness: 0.92,
    metalness: 0.04,
  });
}

function signMaterial(title, color) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 220;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "rgba(4, 8, 12, 0.92)";
  ctx.fillRect(0, 0, 512, 220);
  ctx.strokeStyle = color;
  ctx.lineWidth = 14;
  ctx.strokeRect(12, 12, 488, 196);
  ctx.fillStyle = color;
  ctx.font = "700 92px ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(title, 256, 116);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshBasicMaterial({ map, toneMapped: false });
}

boot();
