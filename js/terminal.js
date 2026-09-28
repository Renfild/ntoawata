import { bootBlocks, complete, createHistory, promptFor, resolveProject, run } from "./engine.js";

const HIST_KEY = "renfild.terminal.history";
const CHIPS = [
  ["help", "help", ""],
  ["whoami", "whoami", ""],
  ["ls projects", "ls projects", ""],
  ["skills", "skills", ""],
  ["contact", "contact", ""],
  ["clear", "clear", ""],
  ["close", "close", ""],
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

const session = {
  cwd: null,
  history: createHistory(loadHistory()),
};

let snapshot = null;
let lastTab = null;

buildChips();
bindViewport();
bindInput();
output.replaceChildren();
renderBlocks(bootBlocks());
updateChrome();
paint();

const hashed = projectFromHash();
if (hashed) execute(`open ${hashed.id}`, { record: false, hash: false });
input.focus();

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

  app.addEventListener("pointerup", (event) => {
    if (event.target.closest("a, button, input")) return;
    if (window.matchMedia("(pointer: coarse)").matches) return;
    if (window.getSelection()?.toString()) return;
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
    if (session.cwd) {
      event.preventDefault();
      execute("close");
    } else if (input.value) {
      input.value = "";
      paint();
    }
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

  const result = run(line, { cwd: session.cwd, history: session.history.items });
  session.cwd = result.state.cwd;

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
  promptEl.textContent = promptFor(session.cwd);
  statusEl.textContent = session.cwd ? `${promptPath(session.cwd)}  ·  Esc закрывает кейс` : "~  ·  help — список команд";
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
