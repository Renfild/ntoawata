import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { CSS3DObject, CSS3DRenderer } from "three/addons/renderers/CSS3DRenderer.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { sound } from "./audio.js";
import { loadLatestCommits } from "./commits.js";

const CRT_W = 1120;
const CRT_H = 630;
const SCALE = 0.0019;
const SCREEN_W = CRT_W * SCALE;
const SCREEN_H = CRT_H * SCALE;

const PHONE_W = 390;
const PHONE_H = 844;
const PHONE_SCALE = 0.37 / PHONE_W;

const KEY_U = 0.1;
const KEY_GAP = 0.012;
const KEY_H = 0.046;
const KEY_TRAVEL = 0.014;
const KEY_BASE = 0.012;

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
// Wide enough and tall enough for the terminal to live on the monitor; a phone on its side is neither.
const wideQuery = window.matchMedia("(min-width: 900px) and (min-height: 560px)");
const desktop = wideQuery.matches;
const coarse = window.matchMedia("(pointer: coarse)").matches;
// Ambient motion (rain, cars, breathing) scales by this; direct feedback such as key presses does not.
const motion = reduceMotion ? 0 : 1;
let maxAniso = 8;

// Every per-frame update registers here and receives (dt, elapsed) in seconds.
const tickers = [];
// Things the party mode recolours; filled while the scene is built.
const party = { left: 0, signs: [], lights: [] };
const keyByCode = new Map();
const keyMeshes = [];
const legendCache = new Map();

const canvas = document.querySelector("#webgl");
const crt = document.querySelector("#crt");
const input = document.querySelector("#cmd");
const form = document.querySelector("#form");

// Opening shot per layout: wide windows put the terminal on the monitor, narrow ones dock it below the scene.
const HEROES = {
  wide: { pos: [2.0, 2.3, 4.3], target: [0.05, 0.9, 0.45] },
  narrow: { pos: [1.8, 2.35, 4.1], target: [0.1, 1.2, 0.3] },
};
let HERO = desktop ? HEROES.wide : HEROES.narrow;
const ARRIVE = { pos: [2.9, 2.9, 5.3], target: [0.1, 1.3, -0.2] };
// The room is only built towards the window: keep the free camera in the arc that shows it.
const LIMITS = {
  minAzimuthAngle: -0.55,
  maxAzimuthAngle: 0.95,
  minPolarAngle: 1.0,
  maxPolarAngle: 1.52,
  minDistance: 1.4,
  maxDistance: 5.2,
};
// Inner faces of the room's side walls, ceiling and open back edge.
const ROOM = { left: -3.7, right: 3.7, floor: -0.9, ceiling: 4.6, back: 6 };
const FREE = {
  minAzimuthAngle: -Infinity,
  maxAzimuthAngle: Infinity,
  minPolarAngle: 0,
  maxPolarAngle: Math.PI,
  minDistance: 0.05,
  maxDistance: Infinity,
};

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

  // Phones have dense screens and small GPUs: render below native resolution there.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, coarse ? 1.25 : 1.5));
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
  controls.enablePan = false;
  // Scripted flights (intro, zoom) pass outside the limits, so they are lifted until the flight lands.
  Object.assign(controls, intro ? FREE : LIMITS);
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
  const { screen: screenAnchor, phone: phoneAnchor } = buildWorld(scene, pickables);

  let cssRenderer = null;
  let crtObject = null;
  let phoneObject = null;
  const phoneEl = document.querySelector("#phone");
  let screenPlaced = false;
  const hintEl = document.querySelector("#hint");
  // Share of the page height the docked terminal covers in the narrow layout (see frameLayout).
  let dockShare = 0.68;
  if (desktop) mountScreen(screenAnchor);
  frameLayout(desktop);
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

  const view = { focus: null, free: intro };
  const zoomButton = document.querySelector("#zoom-toggle");
  // What the camera can fly up to: CSS3D surfaces pinned to anchors, sized in CSS pixels.
  const surfaces = {
    screen: { anchor: screenAnchor, w: CRT_W, h: CRT_H, margin: 1.08 },
    phone: { anchor: phoneAnchor, w: PHONE_W, h: PHONE_H, margin: 1.15 },
  };

  controls.addEventListener("start", () => {
    anim.t = 1;
  });
  bindPicking(canvas, camera, pickables);
  bindPhysicalKeys();
  bindZoom();
  document.dispatchEvent(new CustomEvent("desk:ready"));

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
    cssRenderer?.setSize(window.innerWidth, window.innerHeight);
    frameLayout(wideQuery.matches);
    if (view.focus) {
      const pose = zoomPose(view.focus);
      camera.position.copy(pose.pos);
      controls.target.copy(pose.target);
      anim.t = 1;
    }
  });

  function flyTo(pos, target, duration) {
    anim.from.copy(camera.position);
    anim.targetFrom.copy(controls.target);
    anim.to.copy(pos);
    anim.targetTo.copy(target);
    anim.duration = reduceMotion ? 0.001 : duration;
    anim.t = 0;
    Object.assign(controls, FREE);
    view.free = true;
  }

  // Straight in front of a surface, far enough back that it fills the view with a thin margin.
  function zoomPose(name) {
    const { anchor, w, h, margin } = surfaces[name];
    anchor.updateWorldMatrix(true, false);
    const target = new THREE.Vector3().setFromMatrixPosition(anchor.matrixWorld);
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(anchor.getWorldQuaternion(new THREE.Quaternion()));
    const scale = anchor.getWorldScale(new THREE.Vector3()).x;
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const fitH = (h * scale * margin) / 2 / tanHalf;
    const fitW = (w * scale * margin) / 2 / (tanHalf * camera.aspect);
    return { pos: target.clone().addScaledVector(normal, Math.max(fitH, fitW)), target };
  }

  function setFocus(name) {
    if (name === "screen" && !crtObject) return;
    if (name === "phone" && !phoneObject) return;
    if (name === view.focus) return;
    view.focus = name;
    controls.enabled = !name;
    if (name) {
      const pose = zoomPose(name);
      flyTo(pose.pos, pose.target, 1.1);
    } else {
      flyTo(new THREE.Vector3(...HERO.pos), new THREE.Vector3(...HERO.target), 1.1);
    }
    document.body.classList.toggle("is-zoomed", Boolean(name));
    document.dispatchEvent(new CustomEvent("desk:zoomed", { detail: Boolean(name) }));
    if (zoomButton) {
      zoomButton.setAttribute("aria-pressed", String(Boolean(name)));
      zoomButton.querySelector(".zoom-label").textContent = name ? "Esc — отдалить" : "приблизить экран";
    }
    if (name === "phone") phoneEl.querySelector("button")?.focus({ preventScroll: true });
    else focusTerminal();
  }

  function bindZoom() {
    document.addEventListener("desk:zoom", (event) => setFocus(event.detail !== false ? "screen" : null));
    zoomButton?.addEventListener("click", () => setFocus(view.focus ? null : "screen"));
    // The terminal's `shop` command asks for the phone; the desk takes it whenever the phone is in 3D.
    document.addEventListener("desk:shop", (event) => {
      if (!phoneObject) return;
      event.preventDefault();
      setFocus("phone");
    });
    phoneEl.addEventListener("shop:close", () => {
      if (view.focus === "phone") setFocus(null);
    });
    // Until the camera is on the phone, a click on it only brings the phone up instead of pressing a button.
    phoneEl.addEventListener(
      "click",
      (event) => {
        if (!phoneObject || view.focus === "phone") return;
        event.preventDefault();
        event.stopImmediatePropagation();
        setFocus("phone");
      },
      true,
    );
    // Capture phase, ahead of the terminal: while zoomed, Esc only pulls the camera back.
    window.addEventListener(
      "keydown",
      (event) => {
        if (event.key !== "Escape" || !view.focus) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        setFocus(null);
      },
      true,
    );
    let press = null;
    crt.addEventListener("pointerdown", (event) => {
      press = { x: event.clientX, y: event.clientY };
    });
    crt.addEventListener("pointerup", (event) => {
      if (!press || view.focus === "screen" || !crtObject) return;
      if (document.body.classList.contains("is-off") || document.body.classList.contains("is-booting")) return;
      const moved = Math.hypot(event.clientX - press.x, event.clientY - press.y) > 5;
      press = null;
      if (moved || event.target.closest("a, button")) return;
      if (window.getSelection()?.toString()) return;
      setFocus("screen");
    });
  }

  renderer.setAnimationLoop(() => {
    // Clamp so a backgrounded tab does not teleport cars and rain when it resumes.
    const dt = Math.min(clock.getDelta(), 0.1);
    const elapsed = clock.elapsedTime;
    stepCamera(anim, camera, controls, dt);
    if (view.free && anim.t >= 1 && !view.focus) {
      Object.assign(controls, LIMITS);
      view.free = false;
    }
    controls.update();
    if (!view.free) keepInsideRoom(camera.position);
    for (const tick of tickers) tick(dt, elapsed);
    // CSS3D surfaces do not depth-sort against each other reliably, so a close-up shows only its own.
    if (crtObject) placeSurface(crtObject, surfaces.screen, view.focus !== "phone");
    if (phoneObject) placeSurface(phoneObject, surfaces.phone, view.focus !== "screen");
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

  function placeSurface(object, { anchor, w, h }, allowed) {
    anchor.updateWorldMatrix(true, false);
    anchor.matrixWorld.decompose(object.position, object.quaternion, object.scale);
    face.set(0, 0, 1).applyQuaternion(object.quaternion);
    toCam.copy(camera.position).sub(object.position);
    object.visible = allowed && face.dot(toCam) > 0.2 && surfaceInView(anchor, w, h);
  }

  // A CSS3D element that crosses the camera plane or sits off-frame is not drawn,
  // yet the browser still hit-tests it and it swallows clicks meant for the desk.
  function surfaceInView(anchor, w, h) {
    camera.updateMatrixWorld();
    screenBox.makeEmpty();
    for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      corner.set((x * w) / 2, (y * h) / 2, 0).applyMatrix4(anchor.matrixWorld);
      screenBox.expandByPoint(corner);
      if (corner.applyMatrix4(camera.matrixWorldInverse).z > -camera.near * 2) return false;
    }
    viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    return frustum.setFromProjectionMatrix(viewProj).intersectsBox(screenBox);
  }

  // The layout follows the window width live: an artifact panel or a browser window can be
  // opened narrow and widened later, and the terminal has to move onto the monitor then.
  wideQuery.addEventListener("change", (event) => {
    if (event.matches) mountScreen(screenAnchor);
    else unmountScreen();
    frameLayout(event.matches);
    HERO = event.matches ? HEROES.wide : HEROES.narrow;
    flyTo(new THREE.Vector3(...HERO.pos), new THREE.Vector3(...HERO.target), 0.9);
  });

  // Narrow layout docks the terminal over the lower 68% of the page. Shift the projection so the
  // desk sits in the middle of the strip left above it, and widen the lens so the whole desk fits.
  // Narrow layouts dock the terminal over part of the page. Shift the projection so the desk sits in
  // the middle of whatever is left for it, and widen the lens when that area is small.
  document.addEventListener("desk:dock", (event) => {
    if (Number.isFinite(event.detail)) dockShare = event.detail;
    frameLayout(wideQuery.matches);
  });

  function frameLayout(isWide) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.clearViewOffset();
    if (isWide) {
      camera.fov = 38;
    } else if (h <= 520 && w > h) {
      // Landscape phone: the terminal takes the right 58%, the desk the left 42%.
      camera.fov = 58;
      camera.setViewOffset(w, h, w * 0.29, 0, w, h);
    } else if (h <= 520) {
      camera.fov = 50;
    } else {
      const share = 1 - dockShare;
      // A tall portrait strip has little horizontal view; a wider lens keeps the phone and the cat in frame.
      camera.fov = share < 0.45 ? 68 : 72;
      camera.setViewOffset(w, h, 0, h * (0.5 - share / 2), w, h);
    }
    camera.updateProjectionMatrix();
  }

  function unmountScreen() {
    if (!crtObject) return;
    if (view.focus) setFocus(null);
    // Removing an object also detaches its element from the CSS3D layer; put both back in the page flow.
    const cssScene = cssRenderer.userData.scene;
    cssScene.remove(crtObject);
    cssScene.remove(phoneObject);
    crtObject = null;
    phoneObject = null;
    crt.removeAttribute("style");
    crt.classList.remove("is-crt");
    phoneEl.removeAttribute("style");
    phoneEl.classList.remove("is-3d");
    phoneEl.classList.add("is-sheet");
    document.body.classList.remove("has-crt");
    document.body.insertBefore(crt, hintEl);
    document.body.insertBefore(phoneEl, hintEl);
    cssRenderer.domElement.style.display = "none";
    focusTerminal();
  }

  function mountScreen(anchor) {
    if (crtObject) return;
    if (!cssRenderer) {
      cssRenderer = new CSS3DRenderer();
      cssRenderer.setSize(window.innerWidth, window.innerHeight);
      cssRenderer.domElement.className = "css3d";
      cssRenderer.domElement.style.pointerEvents = "none";
      document.body.append(cssRenderer.domElement);
      cssRenderer.userData = { scene: new THREE.Scene() };
    }
    cssRenderer.domElement.style.display = "";
    const cssScene = cssRenderer.userData.scene;
    screenPlaced = false;
    crt.classList.add("is-crt");
    document.body.classList.add("has-crt");
    crt.style.userSelect = "text";
    crtObject = new CSS3DObject(crt);
    cssScene.add(crtObject);
    phoneEl.classList.remove("is-sheet", "is-open");
    phoneEl.classList.add("is-3d");
    phoneObject = new CSS3DObject(phoneEl);
    cssScene.add(phoneObject);
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
        sound.sign();
        document.dispatchEvent(new CustomEvent("terminal:command", { detail: data.command }));
        return;
      }
      if (data.code) tapKey(hit.object);
      if (data.char != null) insertText(data.char);
      else if (data.key) sendKey(data.key);
    });
    dom.addEventListener("pointermove", (event) => {
      if (event.buttons) {
        showTip(null);
        return;
      }
      const hit = cast(event, dom, cam, raycaster, mouse, objects);
      const mesh = hit?.object ?? null;
      dom.style.cursor = mesh ? "pointer" : "";
      if (event.pointerType === "mouse") showTip(mesh?.userData.tip, event.clientX, event.clientY);
      if (hovered === mesh) return;
      hovered?.userData.onHover?.(false);
      hovered = mesh;
      hovered?.userData.onHover?.(true);
    });
    dom.addEventListener("pointerleave", () => {
      showTip(null);
      hovered?.userData.onHover?.(false);
      hovered = null;
    });
  }
}

// A small label that follows the mouse over things on the desk that do something when clicked.
const tipEl = document.createElement("div");
tipEl.className = "desk-tip";
tipEl.setAttribute("aria-hidden", "true");
document.body.append(tipEl);

function showTip(text, x = 0, y = 0) {
  if (!text) {
    tipEl.classList.remove("on");
    return;
  }
  tipEl.textContent = text;
  const left = Math.min(x + 16, window.innerWidth - tipEl.offsetWidth - 8);
  tipEl.style.transform = `translate(${Math.max(8, left)}px, ${y + 18}px)`;
  tipEl.classList.add("on");
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
      if (!mesh) return;
      if (!mesh.userData.down && !event.repeat) sound.key();
      mesh.userData.down = true;
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
  sound.key();
  mesh.userData.down = true;
  window.setTimeout(() => {
    mesh.userData.down = false;
  }, 110);
}

// Orbit limits alone let a zoomed-out camera at the edge of its arc slip through a side wall and
// see only the wall's dark outside; hold it a little inside the room instead.
function keepInsideRoom(position) {
  const pad = 0.3;
  position.x = Math.min(ROOM.right - pad, Math.max(ROOM.left + pad, position.x));
  position.y = Math.min(ROOM.ceiling - pad, position.y);
  position.z = Math.min(ROOM.back - pad, position.z);
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
  const anchor = addMac(scene, pickables);
  const phone = addPhone(scene, pickables);
  addMat(scene);
  addKeyboard(scene, pickables);
  addMouse(scene, pickables);
  addCable(scene);
  addLamp(scene, pickables);
  addCat(scene, pickables);
  addCity(scene);
  addClouds(scene);
  addSearchlights(scene);
  addCoffee(scene);
  addParty();
  const screen = adScreen();
  addBillboard(scene, screen);
  addBlimp(scene, screen);
  addTraffic(scene);
  addSigns(scene, pickables);
  addCars(scene);
  addRain(scene);
  return { screen: anchor, phone };
}

function addLights(scene) {
  scene.add(new THREE.AmbientLight(0x2a3050, 0.55));
  scene.add(new THREE.HemisphereLight(0x5a5c9a, 0x1a1008, 0.35));

  const moon = new THREE.DirectionalLight(0xb4c2ff, 1.25);
  moon.position.set(-2.6, 5.6, -3.8);
  moon.castShadow = true;
  moon.shadow.mapSize.set(coarse ? 1024 : 2048, coarse ? 1024 : 2048);
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
  const phosphor = new THREE.PointLight(0xcfe4ff, 1.2, 2.6, 1.4);
  phosphor.position.set(0, 1.3, 0.7);
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
  const wall = new THREE.MeshStandardMaterial({ map: plasterTexture(), color: 0x2a2d3a, roughness: 0.95, metalness: 0 });
  const z = -1.95;
  const t = 0.2;
  const open = { left: -3.1, right: 3.1, bottom: 0.35, top: 3.85 };
  const room = ROOM;
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
  // Close the room so no angle the camera allows can look into empty space.
  const depth = room.back - z;
  const height = room.ceiling - room.floor;
  for (const x of [room.left, room.right]) {
    const side = new THREE.Mesh(new THREE.BoxGeometry(t, height, depth), wall);
    side.position.set(x, room.floor + height / 2, z + depth / 2);
    side.receiveShadow = true;
    scene.add(side);
  }
  const ceiling = new THREE.Mesh(
    new THREE.BoxGeometry(room.right - room.left, t, depth),
    new THREE.MeshStandardMaterial({ color: 0x14151c, roughness: 0.95 }),
  );
  ceiling.position.set(0, room.ceiling, z + depth / 2);
  scene.add(ceiling);

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
  const drops = new THREE.Mesh(
    new THREE.PlaneGeometry(open.right - open.left, open.top - open.bottom),
    new THREE.MeshBasicMaterial({ map: dropsTexture(), transparent: true, opacity: 0.8, depthWrite: false }),
  );
  drops.position.set(0, (open.top + open.bottom) / 2, z - 0.005);
  scene.add(drops);

  // LED strips: magenta along the ceiling edge, cyan under the sill.
  const strips = [
    [6.6, 0x7a2cff, 0, open.top + 0.14, z + 0.12],
    [6.2, 0x49e7ff, 0, open.bottom - 0.03, z + 0.3],
  ];
  for (const [w, color, x, y, zz] of strips) {
    const strip = new THREE.Mesh(
      new THREE.BoxGeometry(w, 0.02, 0.02),
      new THREE.MeshBasicMaterial({ color, toneMapped: false }),
    );
    strip.position.set(x, y, zz);
    scene.add(strip);
  }
  const wash = new THREE.PointLight(0x7a2cff, 2.2, 5, 1.6);
  wash.position.set(0, open.top - 0.1, z + 0.6);
  scene.add(wash);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 12),
    new THREE.MeshStandardMaterial({ color: 0x0c0d12, roughness: 0.8 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, room.floor, 2);
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

// An iMac-style all-in-one: thin coloured body, white bezel, pale chin and a bent aluminium stand.
function addMac(scene, pickables) {
  const group = new THREE.Group();
  group.position.set(0, 0, 0.02);
  scene.add(group);

  // Body proportions follow the screen, so a larger SCALE grows the whole computer.
  const k = SCALE / 0.0017;
  const W = 2.1 * k;
  const H = 1.5 * k;
  const D = 0.05;
  const bottom = 0.44;
  const chinH = 0.3 * k;
  const cy = bottom + H / 2;

  const back = new THREE.MeshStandardMaterial({ color: 0x4f78b0, roughness: 0.32, metalness: 0.65 });
  const chin = new THREE.MeshStandardMaterial({ color: 0xb9cff0, roughness: 0.4, metalness: 0.3 });
  const bezel = new THREE.MeshStandardMaterial({ color: 0xeef1f4, roughness: 0.3, metalness: 0.05 });
  const alu = new THREE.MeshStandardMaterial({ map: brushedTexture(), color: 0x9fb6d4, roughness: 0.3, metalness: 0.85 });

  const body = new THREE.Mesh(new RoundedBoxGeometry(W, H, D, 4, 0.024), back);
  body.position.set(0, cy, 0);
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  const front = D / 2 + 0.0015;
  const chinPlate = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.03, chinH), chin);
  chinPlate.position.set(0, bottom + chinH / 2 + 0.012, front);
  group.add(chinPlate);
  const bezelH = H - chinH - 0.024;
  const bezelPlate = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.03, bezelH), bezel);
  bezelPlate.position.set(0, bottom + chinH + 0.012 + bezelH / 2, front);
  group.add(bezelPlate);

  const screenY = bottom + chinH + 0.012 + bezelH / 2;
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(SCREEN_W + 0.02, SCREEN_H + 0.02),
    // What the glass shows when the live terminal is docked below the scene instead of mapped onto it.
    new THREE.MeshStandardMaterial({
      color: 0x020604,
      emissive: 0xffffff,
      emissiveMap: idleScreenTexture(),
      emissiveIntensity: 0.85,
      roughness: 0.45,
      metalness: 0.1,
    }),
  );
  glass.position.set(0, screenY, front + 0.001);
  group.add(glass);

  // Tiny camera dot in the top bezel.
  const cam = new THREE.Mesh(
    new THREE.CircleGeometry(0.007, 16),
    new THREE.MeshBasicMaterial({ color: 0x1a1d22 }),
  );
  cam.position.set(0, screenY + SCREEN_H / 2 + (bezelH - SCREEN_H) / 4, front + 0.001);
  group.add(cam);

  // Stand: a foot plate on the desk and a riser bent up into the back of the body.
  const foot = new THREE.Mesh(new RoundedBoxGeometry(0.66, 0.018, 0.5, 2, 0.008), alu);
  foot.position.set(0, 0.009, -0.06);
  foot.castShadow = true;
  foot.receiveShadow = true;
  group.add(foot);
  const riseFrom = new THREE.Vector3(0, 0.012, -0.3);
  const riseTo = new THREE.Vector3(0, bottom + 0.26, -D / 2 - 0.012);
  const riserLen = riseFrom.distanceTo(riseTo);
  const riser = new THREE.Mesh(new RoundedBoxGeometry(0.66, riserLen, 0.02, 2, 0.008), alu);
  riser.position.copy(riseFrom).add(riseTo).multiplyScalar(0.5);
  riser.rotation.x = Math.atan2(riseTo.z - riseFrom.z, riseTo.y - riseFrom.y);
  riser.castShadow = true;
  group.add(riser);
  const hinge = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.66, 20), alu);
  hinge.rotation.z = Math.PI / 2;
  hinge.position.copy(riseFrom);
  group.add(hinge);

  const logo = new THREE.Mesh(
    new THREE.PlaneGeometry(0.2, 0.2),
    new THREE.MeshStandardMaterial({ map: appleTexture(), transparent: true, roughness: 0.2, metalness: 0.9, color: 0x6d8fc0 }),
  );
  logo.position.set(0, cy + 0.2 * k, -D / 2 - 0.0015);
  logo.rotation.y = Math.PI;
  group.add(logo);

  // The CSS3D screen takes clicks on the glass; this catches the bezel and chin around it.
  const hit = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshBasicMaterial({ visible: false }));
  hit.position.set(0, cy, front + 0.001);
  hit.userData.onPick = () => document.dispatchEvent(new CustomEvent("desk:zoom", { detail: true }));
  hit.userData.tip = "экран · приблизить";
  group.add(hit);
  pickables.push(hit);

  const anchor = new THREE.Object3D();
  anchor.position.set(0, screenY, front + 0.003);
  anchor.scale.setScalar(SCALE);
  group.add(anchor);
  return anchor;
}

function idleScreenTexture() {
  const c = document.createElement("canvas");
  c.width = 1120;
  c.height = 630;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#050a06";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.font = "600 30px ui-monospace, monospace";
  ctx.textBaseline = "top";
  const lines = [
    ["#7CFF6B", "renfild@github"],
    ["", ""],
    ["#7CFF6B", "Renfild — личный терминал"],
    ["#b9c4ad", "Python, Telegram-боты, RAG, Minecraft, OpenCV"],
    ["", ""],
    ["#7CFF6B", "renfild@github:~$ ls projects"],
    ["#d7e0c8", "aquateche   pcai   tgbotshop"],
    ["#d7e0c8", "tamagotchi-bot   fisherman"],
    ["", ""],
    ["#7CFF6B", "renfild@github:~$ █"],
  ];
  lines.forEach(([color, text], i) => {
    ctx.fillStyle = color || "#000";
    ctx.fillText(text, 70, 60 + i * 50);
  });
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = maxAniso;
  return map;
}

function appleTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.moveTo(128, 78);
  ctx.bezierCurveTo(150, 60, 196, 62, 206, 104);
  ctx.bezierCurveTo(178, 118, 180, 162, 212, 172);
  ctx.bezierCurveTo(198, 212, 176, 236, 156, 234);
  ctx.bezierCurveTo(140, 232, 136, 224, 128, 224);
  ctx.bezierCurveTo(120, 224, 114, 232, 100, 234);
  ctx.bezierCurveTo(74, 236, 44, 190, 44, 146);
  ctx.bezierCurveTo(44, 96, 84, 66, 128, 78);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(130, 70);
  ctx.bezierCurveTo(128, 44, 146, 24, 170, 20);
  ctx.bezierCurveTo(172, 46, 154, 66, 130, 70);
  ctx.fill();
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  return map;
}

// A phone leaning on a small aluminium stand left of the keyboard; the shop Mini App lives on its screen.
function addPhone(scene, pickables) {
  const group = new THREE.Group();
  // Kept square to the room: Chromium mis-composites a CSS3D surface that is turned on two axes
  // once the camera is close to it, so the phone only leans back a little.
  group.position.set(-1.15, 0.008, 0.74);
  scene.add(group);

  const alu = new THREE.MeshStandardMaterial({ map: brushedTexture(), color: 0x9fa7b3, roughness: 0.3, metalness: 0.85 });
  const base = new THREE.Mesh(new RoundedBoxGeometry(0.34, 0.018, 0.3, 2, 0.008), alu);
  base.position.y = 0.009;
  base.castShadow = true;
  base.receiveShadow = true;
  group.add(base);
  const lip = new THREE.Mesh(new RoundedBoxGeometry(0.34, 0.035, 0.03, 2, 0.01), alu);
  lip.position.set(0, 0.03, 0.12);
  group.add(lip);
  const rest = new THREE.Mesh(new RoundedBoxGeometry(0.22, 0.5, 0.018, 2, 0.008), alu);
  rest.position.set(0, 0.25, -0.02);
  rest.rotation.x = -0.12;
  rest.castShadow = true;
  group.add(rest);

  const screenW = PHONE_W * PHONE_SCALE;
  const screenH = PHONE_H * PHONE_SCALE;
  const bw = screenW + 0.03;
  const bh = screenH + 0.03;
  const phone = new THREE.Group();
  phone.position.set(0, 0.022, 0.105);
  phone.rotation.x = -0.12;
  group.add(phone);

  const body = new THREE.Mesh(
    new RoundedBoxGeometry(bw, bh, 0.036, 4, 0.03),
    new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 0.28, metalness: 0.9 }),
  );
  body.position.set(0, bh / 2, -0.018);
  body.castShadow = true;
  phone.add(body);
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(screenW + 0.012, screenH + 0.012),
    new THREE.MeshStandardMaterial({
      color: 0x000000,
      emissive: 0xffffff,
      emissiveMap: shopIdleTexture(),
      emissiveIntensity: 0.9,
      roughness: 0.2,
      metalness: 0.1,
    }),
  );
  glass.position.set(0, bh / 2, 0.0005);
  phone.add(glass);
  const button = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.07, 0.012), body.material);
  button.position.set(bw / 2 + 0.002, bh * 0.7, -0.018);
  phone.add(button);

  const hit = new THREE.Mesh(new THREE.PlaneGeometry(bw, bh), new THREE.MeshBasicMaterial({ visible: false }));
  hit.position.set(0, bh / 2, 0.002);
  hit.userData.onPick = () => document.dispatchEvent(new CustomEvent("terminal:command", { detail: "shop" }));
  hit.userData.tip = "телефон · демо Telegram-магазина";
  phone.add(hit);
  pickables.push(hit);

  const anchor = new THREE.Object3D();
  anchor.position.set(0, bh / 2, 0.0015);
  anchor.scale.setScalar(PHONE_SCALE);
  phone.add(anchor);
  return anchor;
}

// What the phone shows when the live app is not mapped onto it (narrow layout).
function shopIdleTexture() {
  const c = document.createElement("canvas");
  c.width = 390;
  c.height = 844;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, 390, 844);
  ctx.fillStyle = "#17212b";
  ctx.fillRect(0, 40, 390, 56);
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.font = "700 20px sans-serif";
  ctx.fillText("VEXSOULS", 195, 76);
  ctx.font = "800 40px sans-serif";
  ctx.fillText("VEXSOULS", 195, 170);
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.font = "500 13px sans-serif";
  ctx.fillText("H A N D M A D E   A R C H I V E", 195, 198);
  const tones = ["#1d2a44", "#3a1d2e", "#2c2a1a", "#3b1c22"];
  tones.forEach((tone, i) => {
    const x = 16 + (i % 2) * 187;
    const y = 230 + Math.floor(i / 2) * 270;
    ctx.fillStyle = tone;
    roundRect(ctx, x, y, 171, 250, 20);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(x + 145, y + 225, 15, 0, Math.PI * 2);
    ctx.fill();
  });
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = maxAniso;
  return map;
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

// A low, glossy mouse in the iMac's colours, sized to the keyboard (one key unit is about 19 mm).
function addMouse(scene, pickables) {
  const group = new THREE.Group();
  group.position.set(1.12, 0.008, 1.04);
  group.rotation.y = 0.1;
  scene.add(group);

  const geo = ellipsoid(0.135, 0.05, 0.25, 48, 28);
  // Narrow the front a little and keep the highest point towards the palm.
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i += 1) {
    const z = pos.getZ(i);
    const front = Math.max(0, -z / 0.25);
    pos.setX(i, pos.getX(i) * (1 - front * 0.12));
    // Flatten the crown into the long, low arch of a touch mouse.
    const y = pos.getY(i);
    if (y > 0) pos.setY(i, y * (0.75 + 0.25 * Math.abs(z / 0.25)) * (1 - front * 0.2));
  }
  geo.computeVertexNormals();
  weldNormals(geo);
  // The top shell rocks on a pivot at its back edge, like a real button press.
  const clicker = new THREE.Group();
  clicker.position.z = 0.22;
  group.add(clicker);
  const shell = new THREE.Mesh(
    geo,
    new THREE.MeshPhysicalMaterial({ color: 0xf4f6f8, roughness: 0.18, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.08 }),
  );
  shell.position.z = -0.22;
  shell.castShadow = true;
  clicker.add(shell);

  const base = new THREE.Mesh(
    ellipsoid(0.137, 0.016, 0.252, 48, 12),
    new THREE.MeshStandardMaterial({ color: 0xa9c2e2, roughness: 0.35, metalness: 0.5 }),
  );
  base.position.y = 0.004;
  group.add(base);

  const seam = new THREE.Mesh(
    new THREE.BoxGeometry(0.003, 0.004, 0.14),
    new THREE.MeshBasicMaterial({ color: 0xc9cdd2 }),
  );
  seam.position.set(0, 0.042, -0.35);
  seam.rotation.x = -0.2;
  clicker.add(seam);

  const hit = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.08, 0.5), new THREE.MeshBasicMaterial({ visible: false }));
  hit.position.y = 0.04;
  // The press itself comes from the window listener below; picking only keeps the pointer cursor.
  hit.userData.onPick = () => {};
  hit.userData.tip = "мышь · повторяет вашу";
  group.add(hit);
  pickables.push(hit);

  // Mirror the visitor's real mouse: buttons rock the shell, movement slides it around the mat.
  const home = group.position.clone();
  const state = { left: false, right: false, nx: 0, ny: 0, tiltX: 0, tiltZ: 0 };
  window.addEventListener(
    "pointerdown",
    (event) => {
      if (event.pointerType !== "mouse") return;
      if (event.button === 0) state.left = true;
      else if (event.button === 2) state.right = true;
      else return;
      sound.mouse(false);
    },
    true,
  );
  const release = (event) => {
    if (event.pointerType && event.pointerType !== "mouse") return;
    if (!state.left && !state.right) return;
    state.left = false;
    state.right = false;
    sound.mouse(true);
  };
  window.addEventListener("pointerup", release, true);
  window.addEventListener("blur", release);
  // A context menu can swallow the right button's pointerup.
  window.addEventListener("contextmenu", () => window.setTimeout(() => release({}), 160));
  window.addEventListener(
    "pointermove",
    (event) => {
      if (event.pointerType !== "mouse") return;
      state.nx = (event.clientX / window.innerWidth) * 2 - 1;
      state.ny = (event.clientY / window.innerHeight) * 2 - 1;
    },
    true,
  );
  tickers.push((dt) => {
    const k = reduceMotion ? 1 : Math.min(1, dt * 30);
    const down = state.left || state.right;
    const goalX = down ? -0.05 : 0;
    const goalZ = state.left && !state.right ? 0.035 : state.right && !state.left ? -0.035 : 0;
    state.tiltX += (goalX - state.tiltX) * k;
    state.tiltZ += (goalZ - state.tiltZ) * k;
    clicker.rotation.set(state.tiltX, 0, state.tiltZ);
    const slide = Math.min(1, dt * 6) * motion;
    group.position.x += (home.x + state.nx * 0.1 - group.position.x) * slide;
    group.position.z += (home.z + state.ny * 0.07 - group.position.z) * slide;
  });
}

function addCable(scene) {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.45, 0.04, 0.68),
    new THREE.Vector3(-0.52, 0.02, 0.54),
    new THREE.Vector3(-0.66, 0.014, 0.28),
    new THREE.Vector3(-0.62, 0.014, -0.08),
    new THREE.Vector3(-0.44, 0.014, -0.3),
    new THREE.Vector3(-0.3, 0.08, -0.34),
    new THREE.Vector3(-0.22, 0.46, -0.06),
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
  spot.castShadow = !coarse;
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
    sound.lamp(state.on);
  };
  hit.userData.tip = "лампа · включить или выключить";
  party.lights.push(spot);
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

  const layers = desktop ? 22 : coarse ? 9 : 12;
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

  // Props for the tamagotchi actions: a bowl for feed, a ball of yarn for play, a bubble when hungry.
  const bowl = new THREE.Group();
  bowl.position.set(0.44, 0, 0.3);
  bowl.visible = false;
  root.add(bowl);
  const bowlShape = [[0, 0], [0.07, 0], [0.085, 0.01], [0.1, 0.05], [0.094, 0.052], [0.078, 0.014], [0, 0.012]].map(
    ([x, y]) => new THREE.Vector2(x, y),
  );
  const dish = new THREE.Mesh(
    new THREE.LatheGeometry(bowlShape, 32),
    new THREE.MeshStandardMaterial({ color: 0x3fb6a8, roughness: 0.35, side: THREE.DoubleSide }),
  );
  dish.castShadow = true;
  bowl.add(dish);
  const kibble = new THREE.Group();
  const kibbleMat = new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 0.8 });
  for (let i = 0; i < 14; i += 1) {
    const bit = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), kibbleMat);
    const a = (i / 14) * Math.PI * 2 * 2.3;
    const r = 0.015 + (i % 5) * 0.012;
    bit.position.set(Math.cos(a) * r, 0.03 + (i % 3) * 0.006, Math.sin(a) * r);
    kibble.add(bit);
  }
  bowl.add(kibble);

  const ball = new THREE.Group();
  ball.visible = false;
  root.add(ball);
  const yarn = new THREE.MeshStandardMaterial({ color: 0xd8344f, roughness: 0.9 });
  ball.add(new THREE.Mesh(new THREE.SphereGeometry(0.05, 20, 14), yarn));
  for (let i = 0; i < 3; i += 1) {
    const wrap = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.004, 6, 28), new THREE.MeshStandardMaterial({ color: 0xf06a80, roughness: 0.9 }));
    wrap.rotation.set(i * 1.1, i * 0.7, 0);
    ball.add(wrap);
  }

  const bubble = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: bubbleTexture("мяу? feed"), transparent: true, depthWrite: false }),
  );
  bubble.scale.set(0.34, 0.14, 1);
  bubble.position.set(0.3, 0.52, 0.1);
  bubble.visible = false;
  root.add(bubble);

  const state = { awake: 0, lift: 0, heart: 1, nextTwitch: 3, mode: null, modeTime: 0, food: 70, nag: 4 };
  hit.userData.onPick = () => document.dispatchEvent(new CustomEvent("terminal:command", { detail: "pet" }));
  hit.userData.tip = "кот · погладить";
  document.addEventListener("desk:pet", (event) => {
    const { action, food } = event.detail ?? {};
    if (Number.isFinite(food)) state.food = food;
    if (action === "status") return;
    // A new action replaces the previous one, props included.
    bowl.visible = false;
    ball.visible = false;
    state.awake = action === "pet" ? 4.5 : 5;
    state.mode = action;
    state.modeTime = 0;
    if (action === "pet") {
      state.heart = 0;
      sound.cat();
    } else if (action === "feed") {
      bowl.visible = true;
      bowl.scale.setScalar(0.01);
      kibble.scale.setScalar(1);
      sound.eat();
    } else if (action === "play") {
      ball.visible = true;
      sound.meow();
    }
  });

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

    if (state.mode) state.modeTime += dt;
    const m = state.modeTime;
    if (state.mode === "feed") {
      // The bowl pops in, the cat dips its head and nods while the kibble disappears.
      bowl.scale.setScalar(Math.min(1, m * 4));
      kibble.scale.setScalar(Math.max(0.01, 1 - Math.max(0, m - 0.6) / 3));
      if (m > 0.4 && m < 3.8) {
        head.rotation.x = 0.55 + Math.sin(m * 10) * 0.12 * (motion || 0.3);
        head.rotation.y = 1.1;
      }
      if (m > 4.2) bowl.scale.setScalar(Math.max(0.01, 1 - (m - 4.2) * 3));
      if (m > 4.6) {
        bowl.visible = false;
        state.mode = null;
      }
    } else if (state.mode === "play") {
      // The yarn ball bounces across in front of the cushion and the head follows it.
      const p = Math.min(1, m / 3.6);
      const x = -0.35 + Math.sin(p * Math.PI * 2.5) * 0.45;
      ball.position.set(x, 0.05 + Math.abs(Math.sin(m * 6)) * 0.14 * (motion || 0.2), 0.52);
      ball.rotation.z -= dt * 8 * motion;
      head.rotation.y = 0.2 + x * 0.9;
      if (p >= 1) {
        ball.visible = false;
        state.mode = null;
      }
    } else if (state.mode === "pet" && m > 4.5) {
      state.mode = null;
    }

    // A hungry cat asks for food every so often while it dozes.
    state.nag -= dt;
    if (state.nag <= 0) state.nag = 11;
    bubble.visible = state.food < 30 && !awake && state.nag < 3.5;
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

// Average normals of vertices that share a position, so a UV seam does not show as a crease.
function weldNormals(geo) {
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  const groups = new Map();
  for (let i = 0; i < pos.count; i += 1) {
    const key = `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`;
    const list = groups.get(key);
    if (list) list.push(i);
    else groups.set(key, [i]);
  }
  const n = new THREE.Vector3();
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    n.set(0, 0, 0);
    for (const i of list) n.add({ x: nor.getX(i), y: nor.getY(i), z: nor.getZ(i) });
    n.normalize();
    for (const i of list) nor.setXYZ(i, n.x, n.y, n.z);
  }
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

function addClouds(scene) {
  const texture = cloudTexture();
  const rand = seeded(23);
  const clouds = [];
  for (let i = 0; i < 7; i += 1) {
    const w = 11 + rand() * 7;
    const cloud = new THREE.Mesh(
      new THREE.PlaneGeometry(w, w * 0.32),
      new THREE.MeshBasicMaterial({
        map: texture,
        color: i % 2 ? 0x55366e : 0x3a2c5c,
        transparent: true,
        opacity: 0.5 + rand() * 0.25,
        depthWrite: false,
        fog: false,
      }),
    );
    cloud.position.set(-22 + rand() * 44, 7.5 + rand() * 6, -27 + rand() * 3);
    cloud.userData.speed = 0.08 + rand() * 0.1;
    scene.add(cloud);
    clouds.push(cloud);
  }
  tickers.push((dt) => {
    for (const cloud of clouds) {
      cloud.position.x += cloud.userData.speed * dt * motion;
      if (cloud.position.x > 24) cloud.position.x = -24;
    }
  });
}

// One animated ad feed, shown on a billboard tower and on the side of a blimp.
function adScreen() {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 256;
  const ctx = c.getContext("2d");
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = maxAniso;
  let words = "RENFILD ▸ PYTHON ▸ RAG ▸ TELEGRAM ▸ MINECRAFT ▸ OPENCV ▸ ";
  let caption = "github.com/Renfild";
  let acc = 1;
  // Swap the slogan for the latest public commits when GitHub answers; keep the slogan otherwise.
  loadLatestCommits().then((commits) => {
    if (!commits.length) return;
    words = commits.map((c) => `${c.repo}: ${c.message} ▸ `).join("");
    caption = "live · последние коммиты на GitHub";
  });
  const draw = (t) => {
    const hue = (t * 18) % 360;
    const bg = ctx.createLinearGradient(0, 0, 512, 256);
    bg.addColorStop(0, `hsl(${hue}, 85%, 22%)`);
    bg.addColorStop(1, `hsl(${(hue + 70) % 360}, 90%, 12%)`);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 512, 256);
    ctx.font = "700 92px ui-monospace, monospace";
    ctx.textBaseline = "middle";
    const width = ctx.measureText(words).width;
    const x = -((t * 90) % width);
    ctx.fillStyle = `hsl(${(hue + 180) % 360}, 100%, 72%)`;
    ctx.fillText(words + words, x, 110);
    ctx.font = "500 30px ui-monospace, monospace";
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.fillText(caption, 22, 212);
    ctx.fillStyle = "rgba(0,0,0,0.22)";
    for (let y = 0; y < 256; y += 4) ctx.fillRect(0, y, 512, 1);
    texture.needsUpdate = true;
  };
  draw(0);
  tickers.push((dt, t) => {
    if (!motion) return;
    acc += dt;
    if (acc < 1 / 24) return;
    acc = 0;
    draw(t);
  });
  return texture;
}

function addBillboard(scene, screen) {
  const tower = new THREE.Mesh(new THREE.BoxGeometry(2.8, 12, 2), facadeMaterial(0x6c7890));
  worldUV(tower.geometry, 2.8, 12, 2, 2.6);
  tower.material.emissiveIntensity = 0.5;
  tower.position.set(3.6, -3.1, -14.3);
  scene.add(tower);
  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(3.3, 1.75, 0.12),
    new THREE.MeshStandardMaterial({ color: 0x0d1016, roughness: 0.5, metalness: 0.6 }),
  );
  frame.position.set(3.4, 4.2, -13.1);
  frame.rotation.y = -0.18;
  scene.add(frame);
  const panel = new THREE.Mesh(
    new THREE.PlaneGeometry(3.1, 1.55),
    new THREE.MeshBasicMaterial({ map: screen, color: 0xa0a0a0, toneMapped: false }),
  );
  panel.position.set(0, 0, 0.065);
  frame.add(panel);
  for (const x of [-1.1, 1.1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.9, 0.06), frame.material);
    leg.position.set(x, -1.2, -0.05);
    frame.add(leg);
  }
}

function addBlimp(scene, screen) {
  const blimp = new THREE.Group();
  blimp.position.set(-10, 7.2, -18);
  scene.add(blimp);
  const hull = new THREE.Mesh(
    ellipsoid(1.9, 0.52, 0.52, 40, 20, "x"),
    new THREE.MeshStandardMaterial({ color: 0x2a2f3a, roughness: 0.5, metalness: 0.4 }),
  );
  blimp.add(hull);
  const finMat = new THREE.MeshStandardMaterial({ color: 0x1b1f27, roughness: 0.6 });
  for (const [ry, rz] of [[0, 0], [0, Math.PI / 2]]) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.9, 0.04), finMat);
    fin.position.set(-1.75, 0, 0);
    fin.rotation.set(0, ry, rz);
    blimp.add(fin);
  }
  const gondola = new THREE.Mesh(new RoundedBoxGeometry(0.6, 0.16, 0.22, 2, 0.05), finMat);
  gondola.position.set(0.2, -0.55, 0);
  blimp.add(gondola);
  const side = new THREE.Mesh(
    new THREE.PlaneGeometry(1.9, 0.62),
    new THREE.MeshBasicMaterial({ map: screen, color: 0x8a8a8a, toneMapped: false }),
  );
  side.position.set(0.1, 0.02, 0.5);
  blimp.add(side);
  const lights = [0xff3040, 0x40ff70].map((color, i) => {
    const light = new THREE.Mesh(
      new THREE.SphereGeometry(0.05, 8, 6),
      new THREE.MeshBasicMaterial({ color, toneMapped: false }),
    );
    light.position.set(i ? 1.85 : -2.0, 0.1, 0);
    blimp.add(light);
    return light;
  });
  tickers.push((dt, t) => {
    blimp.position.x += 0.35 * dt * motion;
    if (blimp.position.x > 18) blimp.position.x = -18;
    blimp.position.y = 7.2 + Math.sin(t * 0.4) * 0.15 * motion;
    const on = !motion || Math.sin(t * 3) > 0.6;
    for (const light of lights) light.visible = on;
  });
}

// Far-off elevated highway: two streams of head- and tail-lights crossing the skyline.
function addTraffic(scene) {
  const road = new THREE.Mesh(
    new THREE.BoxGeometry(60, 0.12, 1.4),
    new THREE.MeshStandardMaterial({ color: 0x0e1118, roughness: 0.7 }),
  );
  road.position.set(0, -1.35, -15.3);
  scene.add(road);
  const rail = new THREE.Mesh(
    new THREE.BoxGeometry(60, 0.03, 0.03),
    new THREE.MeshBasicMaterial({ color: 0xffb347, toneMapped: false }),
  );
  rail.position.set(0, -1.18, -14.6);
  scene.add(rail);
  const dot = dotTexture();
  const lanes = [
    { z: -14.9, dir: 1, color: 0xfff1d0, count: 70 },
    { z: -15.7, dir: -1, color: 0xff3048, count: 70 },
  ];
  for (const lane of lanes) {
    const positions = new Float32Array(lane.count * 3);
    for (let i = 0; i < lane.count; i += 1) {
      positions[i * 3] = -30 + Math.random() * 60;
      positions[i * 3 + 1] = -1.2;
      positions[i * 3 + 2] = lane.z;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const points = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        color: lane.color,
        map: dot,
        size: 0.2,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    );
    points.frustumCulled = false;
    scene.add(points);
    const speeds = Array.from({ length: lane.count }, () => 2.2 + Math.random() * 1.6);
    tickers.push((dt) => {
      if (!motion) return;
      const array = geometry.attributes.position.array;
      for (let i = 0; i < lane.count; i += 1) {
        let x = array[i * 3] + lane.dir * speeds[i] * dt;
        if (x > 30) x = -30;
        if (x < -30) x = 30;
        array[i * 3] = x;
      }
      geometry.attributes.position.needsUpdate = true;
    });
  }
}

// `coffee`: a mug appears between the iMac and the cat and steams for a while.
function addCoffee(scene) {
  const mug = new THREE.Group();
  mug.position.set(0.82, 0, 0.36);
  mug.visible = false;
  scene.add(mug);
  const ceramic = new THREE.MeshStandardMaterial({ color: 0xeeeae2, roughness: 0.35 });
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.065, 0.17, 32, 1, true), ceramic);
  cup.position.y = 0.085;
  cup.castShadow = true;
  const inside = new THREE.Mesh(
    new THREE.CylinderGeometry(0.068, 0.06, 0.16, 32, 1, true),
    new THREE.MeshStandardMaterial({ color: 0xd9d4ca, roughness: 0.4, side: THREE.BackSide }),
  );
  inside.position.y = 0.09;
  const bottom = new THREE.Mesh(new THREE.CircleGeometry(0.065, 32), ceramic);
  bottom.rotation.x = -Math.PI / 2;
  bottom.position.y = 0.002;
  const coffee = new THREE.Mesh(
    new THREE.CircleGeometry(0.066, 32),
    new THREE.MeshStandardMaterial({ color: 0x3b2314, roughness: 0.2 }),
  );
  coffee.rotation.x = -Math.PI / 2;
  coffee.position.y = 0.15;
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.011, 10, 24, Math.PI), ceramic);
  handle.rotation.z = -Math.PI / 2;
  handle.position.set(0.075, 0.09, 0);
  const logo = new THREE.Mesh(
    new THREE.PlaneGeometry(0.07, 0.035),
    new THREE.MeshBasicMaterial({ map: labelTexture("~$", "#3fa34d", 128, 64, 44), transparent: true }),
  );
  logo.position.set(0, 0.09, 0.0755);
  mug.add(cup, inside, bottom, coffee, handle, logo);

  const steamTex = gradientDot();
  const puffs = Array.from({ length: 5 }, (_, i) => {
    const puff = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: steamTex, color: 0xdfe8ff, transparent: true, depthWrite: false, opacity: 0 }),
    );
    puff.userData.phase = i / 5;
    mug.add(puff);
    return puff;
  });

  const state = { pop: 0, steam: 0 };
  document.addEventListener("desk:effect", (event) => {
    if (event.detail !== "coffee") return;
    if (!mug.visible) {
      mug.visible = true;
      state.pop = 0;
    }
    state.steam = 45;
  });
  tickers.push((dt, t) => {
    if (!mug.visible) return;
    state.pop = Math.min(1, state.pop + dt * 3);
    mug.scale.setScalar(reduceMotion ? 1 : 0.2 + 0.8 * (1 - (1 - state.pop) ** 3));
    state.steam = Math.max(0, state.steam - dt);
    const strength = Math.min(1, state.steam / 5);
    for (const puff of puffs) {
      const p = (t * 0.35 * (motion || 0.2) + puff.userData.phase) % 1;
      puff.position.set(Math.sin(p * 6 + puff.userData.phase * 9) * 0.03, 0.17 + p * 0.35, 0);
      puff.scale.setScalar(0.05 + p * 0.12);
      puff.material.opacity = Math.sin(p * Math.PI) * 0.35 * strength;
    }
  });
}

// `party` and the Konami code: neon signs and the desk lamp cycle through colours for a few seconds.
function addParty() {
  const white = new THREE.Color(0xffffff);
  const lampColor = new THREE.Color(0xffd6a0);
  document.addEventListener("desk:effect", (event) => {
    if (event.detail === "party") party.left = 8;
  });
  tickers.push((dt, t) => {
    if (party.left <= 0) return;
    party.left = Math.max(0, party.left - dt);
    const done = party.left === 0;
    const speed = reduceMotion ? 0.2 : 1.6;
    party.signs.forEach((sign, i) => {
      if (done) sign.material.color.copy(white);
      else sign.material.color.setHSL((t * speed * 0.3 + i * 0.15) % 1, 1, 0.65);
    });
    for (const light of party.lights) {
      if (done) light.color.copy(lampColor);
      else light.color.setHSL((t * speed * 0.3 + 0.5) % 1, 1, 0.6);
    }
  });
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
      tip: `${title} → ${command}`,
    };
    group.add(mesh);
    pickables.push(mesh);
    party.signs.push(mesh);
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

function plasterTexture() {
  const size = 512;
  const data = new Uint8ClampedArray(size * size * 4);
  const noise = valueNoise(17);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const v = 150 + (noise(x / 40, y / 40) - 0.5) * 50 + (noise(x / 6, y / 6) - 0.5) * 20 + (hash2(x, y) - 0.5) * 14;
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return canvasTexture(imageCanvas(data, size), { srgb: true, repeat: [3, 3] });
}

function dropsTexture() {
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 576;
  const ctx = c.getContext("2d");
  const rand = seeded(31);
  for (let i = 0; i < 900; i += 1) {
    const x = rand() * 1024;
    const y = rand() * 576;
    const r = 0.6 + rand() ** 3 * 2.4;
    ctx.fillStyle = "rgba(170, 200, 255, 0.07)";
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 1.15, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.arc(x, y, r * 0.8, Math.PI * 1.1, Math.PI * 1.6);
    ctx.stroke();
  }
  // A few drops that already ran down the glass.
  for (let i = 0; i < 12; i += 1) {
    const x = rand() * 1024;
    const y = rand() * 300;
    const len = 60 + rand() * 220;
    const g = ctx.createLinearGradient(x, y, x, y + len);
    g.addColorStop(0, "rgba(190, 215, 255, 0)");
    g.addColorStop(1, "rgba(200, 225, 255, 0.14)");
    ctx.strokeStyle = g;
    ctx.lineWidth = 0.8 + rand() * 0.8;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.bezierCurveTo(x + (rand() - 0.5) * 8, y + len * 0.4, x + (rand() - 0.5) * 8, y + len * 0.7, x, y + len);
    ctx.stroke();
    ctx.fillStyle = "rgba(210, 230, 255, 0.18)";
    ctx.beginPath();
    ctx.arc(x, y + len, 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = maxAniso;
  return map;
}

function cloudTexture() {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 160;
  const ctx = c.getContext("2d");
  const rand = seeded(41);
  for (let i = 0; i < 70; i += 1) {
    const x = 60 + rand() * 392;
    const y = 50 + rand() * 60;
    const r = 18 + rand() * 46;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, "rgba(255,255,255,0.22)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  return map;
}

function dotTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.3, "rgba(255,255,255,0.6)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  return map;
}


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
  const cell = 20;
  const lit = ["#ffd9a0", "#ffe7c2", "#f3c77e", "#bfe3ff"];
  for (let y = 4; y < size; y += cell) {
    for (let x = 4; x < size; x += cell) {
      const h = hash2(x + tint, y);
      actx.fillStyle = h > 0.5 ? "#1a222c" : "#151b24";
      actx.fillRect(x, y, 12, 14);
      if (h < 0.84) continue;
      const color = lit[Math.floor(hash2(y, x) * lit.length)];
      actx.fillStyle = color;
      actx.fillRect(x, y, 12, 14);
      gctx.fillStyle = color;
      gctx.globalAlpha = 0.45 + hash2(x * 3, y) * 0.55;
      gctx.fillRect(x, y, 12, 14);
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

function bubbleTexture(text) {
  const c = document.createElement("canvas");
  c.width = 340;
  c.height = 140;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "rgba(245, 247, 255, 0.95)";
  roundRect(ctx, 6, 6, 328, 100, 40);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(70, 100);
  ctx.lineTo(56, 134);
  ctx.lineTo(104, 100);
  ctx.fill();
  ctx.fillStyle = "#1b1f2a";
  ctx.font = "600 42px ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 170, 58);
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  return map;
}

function gradientDot() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,0.9)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
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
