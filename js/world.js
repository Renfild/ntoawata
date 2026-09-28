import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
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

const canvas = document.querySelector("#webgl");
const crt = document.querySelector("#crt");
const input = document.querySelector("#cmd");
const form = document.querySelector("#form");

const VIEWS = {
  iso: { pos: [2.15, 1.62, 2.55], target: [0, 1.08, 0.2] },
  screen: { pos: [0.02, 1.28, 1.92], target: [0, 1.22, 0.15] },
  keys: { pos: [0.1, 1.15, 1.72], target: [0, 0.18, 0.95] },
};

boot();

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
  renderer.toneMappingExposure = 1.15;
  renderer.setClearColor(0x071018, 1);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x071018);
  scene.fog = new THREE.FogExp2(0x071018, 0.045);

  const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.08, 40);
  const start = desktop ? VIEWS.iso : { pos: [1.7, 2.15, 3.15], target: [0, 1.25, 0.05] };
  camera.position.set(...start.pos);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = !reduceMotion;
  controls.dampingFactor = 0.08;
  controls.target.set(...start.target);
  controls.maxPolarAngle = Math.PI / 2 - 0.06;
  controls.minDistance = 1.35;
  controls.maxDistance = 8.5;
  controls.update();

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), reduceMotion ? 0.35 : 0.72, 0.38, 0.72);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const pickables = [];
  const screenAnchor = buildRoom(scene, pickables);

  let cssRenderer = null;
  let crtObject = null;
  if (desktop) mountScreen(screenAnchor);
  document.body.classList.add("has-world");

  const clock = new THREE.Clock();
  const anim = { t: 1, from: new THREE.Vector3(), to: new THREE.Vector3(), targetFrom: new THREE.Vector3(), targetTo: new THREE.Vector3() };
  const face = new THREE.Vector3();
  const toCam = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  let pointer = null;

  bindViews(anim, camera, controls);
  bindBloom(bloom);
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
      dom.style.cursor = hit ? "pointer" : "";
    });
  }
}

function stepCamera(anim, camera, controls, dt) {
  if (anim.t >= 1) return;
  anim.t = Math.min(1, anim.t + dt * (reduceMotion ? 4 : 1.5));
  const k = 1 - (1 - anim.t) ** 3;
  camera.position.lerpVectors(anim.from, anim.to, k);
  controls.target.lerpVectors(anim.targetFrom, anim.targetTo, k);
}

function bindViews(anim, camera, controls) {
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      const view = VIEWS[button.dataset.view];
      if (!view) return;
      anim.from.copy(camera.position);
      anim.to.set(...view.pos);
      anim.targetFrom.copy(controls.target);
      anim.targetTo.set(...view.target);
      anim.t = 0;
    });
  });
}

function bindBloom(bloom) {
  const levels = [0.72, 0.35, 0];
  const labels = ["Свечение: ярко", "Свечение: мягко", "Свечение: выкл"];
  let index = reduceMotion ? 1 : 0;
  bloom.strength = levels[index];
  const button = document.querySelector("#bloom-toggle");
  if (!button) return;
  button.textContent = labels[index];
  button.addEventListener("click", () => {
    index = (index + 1) % levels.length;
    bloom.strength = levels[index];
    button.textContent = labels[index];
  });
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
  scene.add(new THREE.AmbientLight(0x203044, 1.35));

  const sun = new THREE.DirectionalLight(0xd7e4ff, 1.15);
  sun.position.set(4.2, 6.4, 3.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 18;
  sun.shadow.camera.left = -6;
  sun.shadow.camera.right = 6;
  sun.shadow.camera.top = 6;
  sun.shadow.camera.bottom = -6;
  sun.shadow.bias = -0.00035;
  scene.add(sun);

  const cyan = new THREE.PointLight(0x49e7ff, 7, 14, 1.4);
  cyan.position.set(-3.2, 2.8, -0.4);
  scene.add(cyan);
  const pink = new THREE.PointLight(0xff4fd8, 6, 12, 1.5);
  pink.position.set(3.4, 2.4, -1.2);
  scene.add(pink);
  const phosphor = new THREE.PointLight(0x7cff6b, 2.4, 3.2, 1.2);
  phosphor.position.set(0, 1.25, 0.85);
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
  const dark = new THREE.MeshStandardMaterial({ color: 0x121816, roughness: 0.55, metalness: 0.25 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.08, 1.58, 0.78), shell);
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  const taper = new THREE.Mesh(new THREE.BoxGeometry(1.72, 1.28, 0.28), shell);
  taper.position.set(0, 0, -0.5);
  taper.castShadow = true;
  group.add(taper);

  const vent = new THREE.MeshStandardMaterial({ color: 0x070a09, roughness: 0.9 });
  for (let i = 0; i < 7; i += 1) {
    const slot = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.025, 0.05), vent);
    slot.position.set(0, 0.8, -0.22 + i * 0.07);
    group.add(slot);
  }

  frameAround(group, dark);
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(SCREEN_W, SCREEN_H),
    new THREE.MeshStandardMaterial({ color: 0x031208, emissive: 0x10341c, emissiveIntensity: 0.55, roughness: 0.4 }),
  );
  glass.position.set(0, 0.04, 0.392);
  group.add(glass);
  const chin = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.07, 0.04), new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.85, roughness: 0.28 }));
  chin.position.set(0, -0.68, 0.42);
  group.add(chin);

  const led = new THREE.Mesh(
    new THREE.BoxGeometry(0.045, 0.045, 0.04),
    new THREE.MeshStandardMaterial({ color: 0x7cff6b, emissive: 0x7cff6b, emissiveIntensity: 1.6 }),
  );
  led.position.set(0.72, -0.68, 0.42);
  led.name = "led";
  group.add(led);

  const stand = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.38, 0.36), shell);
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
  const deck = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.08, 0.78), chassisMaterial());
  deck.castShadow = true;
  deck.receiveShadow = true;
  group.add(deck);
  const rest = new THREE.Mesh(
    new THREE.BoxGeometry(1.85, 0.05, 0.16),
    new THREE.MeshStandardMaterial({ color: 0x1a201c, roughness: 0.6 }),
  );
  rest.position.set(0, 0.01, 0.36);
  group.add(rest);

  const rows = [
    ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
    ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
    ["a", "s", "d", "f", "g", "h", "j", "k", "l"],
    ["z", "x", "c", "v", "b", "n", "m", ".", "/"],
  ];
  const colors = [0x7cff6b, 0x49e7ff, 0xff4fd8, 0xffe14a, 0xd9a0ff, 0xd7e0c8];
  rows.forEach((keys, row) => {
    keys.forEach((char, col) => {
      const mesh = keyMesh(colors[(row + col) % colors.length], 0.09);
      mesh.position.set((col - (keys.length - 1) / 2) * 0.105, 0.07, -0.24 + row * 0.12);
      mesh.userData.char = char;
      mesh.userData.homeY = mesh.position.y;
      group.add(mesh);
      pickables.push(mesh);
    });
  });

  const actions = [
    ["Escape", "esc", 0xff4fd8, 0.16],
    ["Tab", "tab", 0x49e7ff, 0.16],
    [" ", "space", 0x1d3328, 0.62],
    ["Backspace", "⌫", 0xffc14a, 0.2],
    ["Enter", "enter", 0x7cff6b, 0.24],
  ];
  let x = -0.78;
  actions.forEach(([key, label, color, width]) => {
    const mesh = keyMesh(color, width);
    mesh.position.set(x + width / 2, 0.07, 0.24);
    mesh.userData.homeY = mesh.position.y;
    if (key === " ") mesh.userData.char = " ";
    else mesh.userData.key = key;
    mesh.name = label;
    group.add(mesh);
    pickables.push(mesh);
    x += width + 0.03;
  });
}

function keyMesh(color, width) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(width, 0.055, 0.09),
    new THREE.MeshStandardMaterial({ color, roughness: 0.42, metalness: 0.08 }),
  );
  mesh.castShadow = true;
  return mesh;
}

function addMug(scene) {
  const group = new THREE.Group();
  group.position.set(1.55, 0.2, 0.72);
  scene.add(group);
  const clay = new THREE.MeshStandardMaterial({ color: 0x2d4034, roughness: 0.4 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.3, 0.28), clay);
  body.castShadow = true;
  group.add(body);
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.16, 0.12), clay);
  handle.position.set(0.18, 0, 0);
  group.add(handle);
  const mark = new THREE.Mesh(
    new THREE.PlaneGeometry(0.12, 0.12),
    new THREE.MeshBasicMaterial({ color: 0x7cff6b }),
  );
  mark.position.set(0, 0.01, 0.142);
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
  const paints = [0x071018, 0x0c1824, 0x101c2a, 0x08141c];
  for (let i = 0; i < 16; i += 1) {
    const height = 2.4 + ((i * 37) % 50) / 12;
    const block = new THREE.Mesh(
      new THREE.BoxGeometry(0.7 + (i % 3) * 0.25, height, 0.7 + (i % 4) * 0.15),
      new THREE.MeshStandardMaterial({ color: paints[i % paints.length], roughness: 0.9 }),
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
  signs.forEach(([title, command, color, x, y, z]) => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.42), signMaterial(title, color));
    mesh.position.set(x, y, z);
    mesh.userData.command = command;
    scene.add(mesh);
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
  if (phosphor) phosphor.intensity = 2.2 + Math.sin(time * 7) * 0.25;
}

function woodMaterial() {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#3a2b20";
  ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 80; i += 1) {
    ctx.fillStyle = `rgba(20, 12, 8, ${0.15 + Math.random() * 0.35})`;
    ctx.fillRect(0, Math.random() * 512, 512, 1 + Math.random() * 3);
  }
  const map = new THREE.CanvasTexture(canvas);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({ map, roughness: 0.82, metalness: 0.05 });
}

function chassisMaterial() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#3d4c40";
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 400; i += 1) {
    const shade = 40 + Math.floor(Math.random() * 30);
    ctx.fillStyle = `rgb(${shade}, ${shade + 8}, ${shade})`;
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({ map, roughness: 0.68, metalness: 0.22 });
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
