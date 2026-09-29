import { sound } from "./audio.js";
import { startBoot } from "./boot.js";
import { mountShop } from "./shop.js";
import { bootBlocks, complete, createHistory, promptFor, resolveProject, run } from "./engine.js";

const HIST_KEY = "renfild.terminal.history";
const PET_KEY = "renfild.pet";
const CHIPS = [
  ["help", "help", ""],
  ["whoami", "whoami", ""],
  ["ls projects", "ls projects", ""],
  ["skills", "skills", ""],
  ["contact", "contact", ""],
  ["clear", "clear", ""],
  ["close", "close", ""],
  ["sound", "sound", ""],
  ["shop", "shop", ""],
  ["cat", "cat", ""],
  ["feed", "feed", ""],
  ["play", "play", ""],
  ["open aquateche", "open aquateche", "repo"],
  ["open pcai", "open pcai", "repo"],
  ["open tgbotshop", "open tgbotshop", "repo"],
  ["open tamagotchi-bot", "open tamagotchi-bot", "repo"],
  ["open fisherman", "open fisherman", "repo"],
];

const output = document.querySelector("#output");
const form = document.querySelector("#form");
const input = document.querySelector("#cmd");
const promptEl = document.querySelector("#prompt");
const statusEl = document.querySelector("#status");
const quick = document.querySelector("#quick");
const beforeEl = document.querySelector("#before");
const afterEl = document.querySelector("#after");
const selectedEl = document.querySelector("#selected");
const caretEl = document.querySelector("#caret");
const ghostEl = document.querySelector("#ghost");
const app = document.querySelector(".app");
const soundToggle = document.querySelector("#sound-toggle");
const phone = document.querySelector("#phone");
const dockToggle = document.querySelector("#dock-toggle");
// Phones get a short prompt so the command field stays on the same line as it.
const compactQuery = window.matchMedia("(max-width: 640px)");

const session = {
  cwd: null,
  history: createHistory(loadHistory()),
  pet: loadJSON(PET_KEY),
};

let snapshot = null;
let zoomed = false;
let lastTab = null;

buildChips();
mountShop(document.querySelector("#shop"));
bindSound();
bindDesk();
bindKonami();
bindViewport();
bindInput();
output.replaceChildren();
renderBlocks(bootBlocks());
updateChrome();
paint();

const hashed = projectFromHash();
if (hashed) execute(`open ${hashed.id}`, { record: false, hash: false });
input.focus();
startBoot({
  onPower: () => sound.boot(),
  onDone: () => {
    if (!window.matchMedia("(pointer: coarse)").matches) input.focus({ preventScroll: true });
  },
});

function buildChips() {
  for (const [command, label, kind] of CHIPS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = kind ? `chip ${kind}` : "chip";
    button.dataset.cmd = command;
    button.textContent = label;
    button.setAttribute("aria-label", command);
    quick.append(button);
  }
}

// Talk to the 3D desk (world.js) through DOM events, so the terminal still works without WebGL.
function bindDesk() {
  document.addEventListener("desk:ready", () => {
    announcePet("status");
    announceDock();
  });
  dockToggle.addEventListener("click", () => setDockLow(!document.body.classList.contains("dock-low")));
  // Tapping the iMac in the docked layout brings the terminal back up.
  document.addEventListener("desk:zoom", () => {
    if (!document.body.classList.contains("has-crt")) setDockLow(false);
  });
  compactQuery.addEventListener("change", updateChrome);
  phone.addEventListener("shop:close", () => {
    if (phone.classList.contains("is-open")) closeShop();
  });
}

// Narrow layout: lower the terminal to give the desk most of the screen, or raise it back.
function setDockLow(low) {
  document.body.classList.toggle("dock-low", low);
  dockToggle.setAttribute("aria-pressed", String(low));
  dockToggle.querySelector(".dock-label").textContent = low ? "терминал" : "стол";
  dockToggle.querySelector(".dock-arrow").textContent = low ? "▾" : "▴";
  announceDock();
  if (!low) scrollOutput("bottom");
}

function announceDock() {
  const low = document.body.classList.contains("dock-low");
  document.dispatchEvent(new CustomEvent("desk:dock", { detail: low ? 0.28 : 0.68 }));
}

function openShop() {
  const event = new CustomEvent("desk:shop", { cancelable: true });
  document.dispatchEvent(event);
  // The desk takes it when the phone is on screen in 3D; otherwise show the app as a sheet.
  if (event.defaultPrevented) return;
  phone.classList.add("is-open");
  phone.querySelector("button")?.focus({ preventScroll: true });
}

function closeShop() {
  phone.classList.remove("is-open");
  if (!window.matchMedia("(pointer: coarse)").matches) input.focus({ preventScroll: true });
}

function announcePet(action) {
  const pet = session.pet;
  document.dispatchEvent(
    new CustomEvent("desk:pet", { detail: { action, food: pet?.food ?? 70, joy: pet?.joy ?? 60 } }),
  );
}

function bindSound() {
  sound.onChange((on) => {
    soundToggle.setAttribute("aria-pressed", String(on));
    soundToggle.querySelector(".sound-state").textContent = on ? "вкл" : "выкл";
  });
  soundToggle.addEventListener("click", () => sound.toggle());
}

function bindViewport() {
  const viewport = window.visualViewport;
  if (!viewport) return;
  const apply = () => {
    document.documentElement.style.setProperty("--app-top", `${viewport.offsetTop}px`);
    document.documentElement.style.setProperty("--app-height", `${viewport.height}px`);
  };
  apply();
  viewport.addEventListener("resize", apply);
  viewport.addEventListener("scroll", apply);
}

const KONAMI = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"];

// ↑↑↓↓←→←→BA anywhere on the page throws the party.
function bindKonami() {
  let step = 0;
  window.addEventListener("keydown", (event) => {
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    step = key === KONAMI[step] ? step + 1 : key === KONAMI[0] ? 1 : 0;
    if (step === KONAMI.length) {
      step = 0;
      // Let the "a" land first, then clear what the code typed into the field.
      window.setTimeout(() => {
        input.value = "";
        paint();
        execute("party");
      }, 0);
    }
  });
}

// Green digital rain over the terminal; any key, click or ~7 seconds ends it.
function startMatrix() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  if (app.querySelector(".matrix")) return;
  const canvas = document.createElement("canvas");
  canvas.className = "matrix";
  canvas.setAttribute("aria-hidden", "true");
  app.append(canvas);
  const scale = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.round(app.clientWidth * scale));
  canvas.height = Math.max(1, Math.round(app.clientHeight * scale));
  const ctx = canvas.getContext("2d");
  const size = 16 * scale;
  const glyphs = "アカサタナハマヤラワ0123456789RENFILDｦｱｳｴｵｶｷｹｺｻｼｽｾｿﾀﾂﾃﾅﾆﾇﾈﾊﾋﾎﾏﾐﾑﾒﾓﾔﾕﾗﾘﾜ";
  const drops = Array.from({ length: Math.ceil(canvas.width / size) }, () => Math.random() * -40);
  const started = performance.now();
  let frame = 0;
  let last = 0;
  const tick = () => {
    // About 22 steps a second whatever the refresh rate, so the rain reads instead of blurring.
    if (performance.now() - last < 45) {
      frame = requestAnimationFrame(tick);
      return;
    }
    last = performance.now();
    ctx.fillStyle = "rgba(0, 0, 0, 0.08)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.font = `${size}px monospace`;
    drops.forEach((y, i) => {
      const char = glyphs[Math.floor(Math.random() * glyphs.length)];
      ctx.fillStyle = Math.random() > 0.96 ? "#d7ffd1" : "#7CFF6B";
      ctx.fillText(char, i * size, y * size);
      drops[i] = y * size > canvas.height && Math.random() > 0.975 ? 0 : y + 1;
    });
    // rAF timestamps can run ahead of performance.now() when frames are slow; time it directly.
    if (performance.now() - started > 7000) stop();
    else frame = requestAnimationFrame(tick);
  };
  const stop = () => {
    cancelAnimationFrame(frame);
    window.removeEventListener("keydown", stop, true);
    canvas.removeEventListener("pointerdown", stop);
    canvas.classList.add("off");
    window.setTimeout(() => canvas.remove(), 400);
  };
  window.addEventListener("keydown", stop, true);
  canvas.addEventListener("pointerdown", stop);
  frame = requestAnimationFrame(tick);
}

function bindInput() {
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = input.value;
    input.value = "";
    lastTab = null;
    paint();
    execute(value);
  });

  input.addEventListener("input", () => {
    const clean = input.value.replace(/[\u0000-\u001F\u007F]/g, "");
    if (clean !== input.value) {
      const pos = input.selectionStart ?? clean.length;
      input.value = clean;
      input.setSelectionRange(pos, pos);
    }
    lastTab = null;
    paint();
  });

  input.addEventListener("keydown", onKeyDown);
  input.addEventListener("keyup", paint);
  input.addEventListener("click", paint);
  input.addEventListener("focus", paint);
  input.addEventListener("blur", paint);
  document.addEventListener("selectionchange", () => {
    if (document.activeElement === input) paint();
  });

  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-cmd]");
    if (!button) return;
    execute(button.dataset.cmd);
  });

  document.addEventListener("desk:zoomed", (event) => {
    zoomed = event.detail === true;
    updateChrome();
  });

  document.addEventListener("terminal:command", (event) => {
    if (typeof event.detail === "string" && event.detail) execute(event.detail);
  });

  app.addEventListener("pointerup", (event) => {
    if (event.target.closest("a, button, input")) return;
    if (window.matchMedia("(pointer: coarse)").matches) return;
    if (window.getSelection()?.toString()) return;
    input.focus({ preventScroll: true });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || event.repeat || event.target === input) return;
    closeFromEscape();
  });

  // Typing anywhere on the page lands in the command field: focusing during keydown
  // makes the browser deliver the character to the field.
  document.addEventListener("keydown", (event) => {
    if (event.target === input || event.defaultPrevented) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key.length !== 1 && event.key !== "Backspace") return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("input, textarea, select, [contenteditable]")) return;
    if (event.key === " " && target?.closest("button, a")) return;
    input.focus({ preventScroll: true });
  });

  window.addEventListener("hashchange", () => {
    const project = projectFromHash();
    if (project && session.cwd !== project.id) {
      execute(`open ${project.id}`, { record: false, hash: false });
    } else if (!project && session.cwd) {
      execute("close", { record: false, hash: false });
    }
  });
}

function onKeyDown(event) {
  if (event.key === "Tab" && !event.shiftKey) {
    event.preventDefault();
    onTab();
    return;
  }
  if (event.key === "ArrowUp") {
    event.preventDefault();
    input.value = session.history.up(input.value);
    moveCaretToEnd();
    lastTab = null;
    paint();
    return;
  }
  if (event.key === "ArrowDown") {
    event.preventDefault();
    input.value = session.history.down(input.value);
    moveCaretToEnd();
    lastTab = null;
    paint();
    return;
  }
  if (event.key === "ArrowRight" && ghostEl.textContent && input.selectionStart === input.value.length && input.selectionEnd === input.value.length) {
    event.preventDefault();
    const preview = complete(input.value);
    if (preview.applied) {
      input.value = preview.input;
      moveCaretToEnd();
      paint();
    }
    return;
  }
  if (event.key === "PageUp" || event.key === "PageDown") {
    event.preventDefault();
    const delta = output.clientHeight * 0.85 * (event.key === "PageUp" ? -1 : 1);
    output.scrollTop += delta;
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    closeFromEscape();
    return;
  }
  if (event.ctrlKey && event.key.toLowerCase() === "c") {
    event.preventDefault();
    appendEcho(session.cwd, input.value ? `${input.value}^C` : "^C");
    input.value = "";
    lastTab = null;
    paint();
    scrollOutput("bottom");
    return;
  }
  if (event.ctrlKey && event.key.toLowerCase() === "l") {
    event.preventDefault();
    execute("clear");
    return;
  }
  if (event.ctrlKey && event.key.toLowerCase() === "u") {
    event.preventDefault();
    input.value = "";
    lastTab = null;
    paint();
  }
}

function closeFromEscape() {
  if (phone.classList.contains("is-open")) {
    closeShop();
    return;
  }
  if (session.cwd) {
    execute("close");
    return;
  }
  if (document.activeElement === input && input.value) {
    input.value = "";
    lastTab = null;
    paint();
  }
}

function onTab() {
  const current = input.value;
  const result = complete(current);
  const repeat = lastTab === current;
  if (result.applied) {
    input.value = result.input;
    moveCaretToEnd();
    lastTab = null;
    paint();
    return;
  }
  const shouldList = result.matches.length > 1 && (repeat || current.trim() === "" || /\s$/.test(current));
  if (shouldList) {
    const row = el("div", "matches", result.matches.join("   "));
    output.append(row);
    scrollOutput("bottom");
    lastTab = null;
  } else {
    lastTab = current;
  }
  paint();
}

function execute(raw, options = {}) {
  const line = String(raw ?? "").replace(/\s+/g, " ").trim();
  const prevCwd = session.cwd;
  if (!line) {
    appendEcho(prevCwd, "");
    scrollOutput("bottom");
    return;
  }
  if (options.record !== false) {
    session.history.push(line);
    persistHistory();
  }

  const result = run(line, {
    cwd: session.cwd,
    history: session.history.items,
    sound: sound.enabled,
    pet: session.pet,
    now: Date.now(),
  });
  session.cwd = result.state.cwd;
  if (result.sound !== null) sound.set(result.sound);
  if (result.pet) {
    session.pet = result.pet;
    saveJSON(PET_KEY, result.pet);
    announcePet(result.petAction);
  }
  if (result.shop) openShop();
  if (result.effect === "matrix") startMatrix();
  else if (result.effect) {
    if (result.effect === "party") sound.party();
    document.dispatchEvent(new CustomEvent("desk:effect", { detail: result.effect }));
  }

  if (result.clear) {
    snapshot = null;
    output.replaceChildren();
    if (options.hash !== false) writeHash(null);
    updateChrome();
    return;
  }

  if (result.alt === "exit") {
    if (snapshot) {
      output.replaceChildren(...snapshot.map((node) => node.cloneNode(true)));
      snapshot = null;
    }
    appendEcho(prevCwd, line);
    renderBlocks(result.blocks);
    if (options.hash !== false) writeHash(null);
    updateChrome();
    scrollOutput("bottom");
    return;
  }

  if (result.alt === "enter") {
    if (!snapshot) snapshot = [...output.childNodes].map((node) => node.cloneNode(true));
    output.replaceChildren();
    appendEcho(prevCwd, line);
    renderBlocks(result.blocks);
    if (options.hash !== false) writeHash(session.cwd);
    updateChrome();
    scrollOutput("top");
    return;
  }

  appendEcho(prevCwd, line);
  renderBlocks(result.blocks);
  updateChrome();
  scrollOutput(result.scroll);
}

function renderBlocks(blocks) {
  for (const block of blocks) {
    const node = renderBlock(block);
    if (node) output.append(node);
  }
}

function renderBlock(block) {
  switch (block.t) {
    case "h":
      return el("h2", "h", block.text);
    case "p":
      return el("p", "p", block.text);
    case "dim":
      return el("p", "dim", block.text);
    case "err":
      return el("p", "err", block.text);
    case "label":
      return el("p", "label", block.text);
    case "gap":
      return el("div", "gap");
    case "kv": {
      const row = el("div", "kv");
      row.append(el("span", "k", block.k), el("span", "v", block.v));
      return row;
    }
    case "run": {
      const row = el("div", "runrow");
      const button = el("button", "run", block.label || block.cmd);
      button.type = "button";
      button.dataset.cmd = block.cmd;
      row.append(button);
      if (block.hint) row.append(el("span", "hint", block.hint));
      return row;
    }
    case "card": {
      const card = el("article", "card");
      const top = el("div", "card-top");
      top.append(el("span", "card-name", block.name), el("span", "card-lang", block.lang));
      card.append(top, el("p", "card-blurb", block.blurb));
      const button = el("button", "run", block.cmd);
      button.type = "button";
      button.dataset.cmd = block.cmd;
      card.append(button);
      return card;
    }
    case "linkrow": {
      const row = el("div", "linkrow");
      row.append(el("span", "linkkey", block.k));
      if (!isSafeHref(block.href)) {
        row.append(el("span", null, block.text || block.href || ""));
        return row;
      }
      const link = document.createElement("a");
      link.href = block.href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.referrerPolicy = "no-referrer";
      link.append(document.createTextNode(block.text || block.href), el("span", "sr", " (откроется в новой вкладке)"));
      row.append(link);
      return row;
    }
    default:
      return null;
  }
}

function appendEcho(cwd, command) {
  const row = el("div", "echo");
  row.append(el("span", "echo-prompt", promptFor(cwd)), document.createTextNode(" "), el("span", "echo-cmd", command));
  output.append(row);
}

function updateChrome() {
  promptEl.textContent = compactQuery.matches ? `${session.cwd ?? "~"}$` : promptFor(session.cwd);
  const esc = zoomed ? "Esc отдаляет экран" : session.cwd ? "Esc закрывает кейс" : "help — список команд";
  statusEl.textContent = `${session.cwd ? promptPath(session.cwd) : "~"}  ·  ${esc}`;
  document.title = session.cwd ? `${session.cwd} — Renfild` : "Renfild — терминал";
}

function promptPath(cwd) {
  return cwd ? `~/projects/${cwd}` : "~";
}

function paint() {
  const value = input.value;
  const start = input.selectionStart ?? value.length;
  const end = input.selectionEnd ?? value.length;
  beforeEl.textContent = value.slice(0, start);
  afterEl.textContent = value.slice(end);
  const collapsed = start === end;
  selectedEl.hidden = collapsed;
  selectedEl.textContent = collapsed ? "" : value.slice(start, end);
  caretEl.hidden = !collapsed;
  caretEl.classList.toggle("off", document.activeElement !== input);

  let ghost = "";
  if (collapsed && start === value.length) {
    const preview = complete(value);
    if (preview.applied && preview.input.startsWith(value)) {
      ghost = preview.input.slice(value.length).trimEnd();
    }
  }
  ghostEl.textContent = ghost;
  ghostEl.hidden = !ghost;
}

function moveCaretToEnd() {
  const end = input.value.length;
  input.setSelectionRange(end, end);
}

function scrollOutput(mode) {
  output.scrollTop = mode === "top" ? 0 : output.scrollHeight;
}

function projectFromHash() {
  try {
    const raw = decodeURIComponent(window.location.hash.replace(/^#/, ""));
    if (!raw) return null;
    return resolveProject(raw);
  } catch {
    return null;
  }
}

function writeHash(id) {
  const base = `${window.location.pathname}${window.location.search}`;
  const desired = id ? `${base}#${id}` : base;
  const current = `${base}${window.location.hash}`;
  if (current === desired) return;
  window.history.replaceState({ cwd: id }, "", desired);
}

function loadHistory() {
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(HIST_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => typeof item === "string").slice(-100);
  } catch {
    return [];
  }
}

function loadJSON(key) {
  try {
    return JSON.parse(window.localStorage.getItem(key) || "null");
  } catch {
    return null;
  }
}

function saveJSON(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be blocked; the cat simply forgets between visits.
  }
}

function persistHistory() {
  try {
    window.sessionStorage.setItem(HIST_KEY, JSON.stringify(session.history.items));
  } catch {
    // Private mode can reject storage. The session still keeps history in memory.
  }
}

function isSafeHref(href) {
  try {
    const url = new URL(href);
    if (url.protocol === "https:") return true;
    return url.protocol === "mailto:" && url.pathname.includes("@");
  } catch {
    return false;
  }
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}
