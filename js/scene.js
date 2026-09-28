const input = document.querySelector("#cmd");
const form = document.querySelector("#form");
const rig = document.querySelector("#rig");
const keyboard = document.querySelector("#keyboard");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const LETTERS = [
  ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
  ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
  ["a", "s", "d", "f", "g", "h", "j", "k", "l"],
  ["z", "x", "c", "v", "b", "n", "m", ".", "/"],
];

const MACROS = [
  ["help", "help"],
  ["ls projects", "ls projects"],
  ["whoami", "whoami"],
  ["skills", "skills"],
  ["contact", "contact"],
  ["clear", "clear"],
];

buildKeyboard();
bindLook();

function buildKeyboard() {
  keyboard.append(row(MACROS.map(([command, label]) => commandKey(command, label)), "macros"));
  LETTERS.forEach((keys, index) => {
    keyboard.append(row(keys.map((key, keyIndex) => charKey(key, (index + keyIndex) % 5))));
  });
  keyboard.append(
    row([
      actionKey("Escape", "esc", "key-c2"),
      actionKey("Tab", "tab", "key-c1"),
      actionKey("ArrowUp", "↑", "key-c3"),
      actionKey("ArrowDown", "↓", "key-c3"),
      charKey(" ", 0, "key-space"),
      actionKey("Backspace", "⌫", "key-c2 key-wide"),
      actionKey("Enter", "enter", "key-c0 key-wide"),
    ]),
  );
}

function row(keys, className) {
  const line = document.createElement("div");
  line.className = className ? `row ${className}` : "row";
  keys.forEach((key) => line.append(key));
  return line;
}

function commandKey(command, label) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "key key-wide key-c4";
  button.dataset.cmd = command;
  button.textContent = label;
  pressMotion(button);
  return button;
}

function charKey(char, color, extra = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `key key-c${color} ${extra}`.trim();
  button.textContent = char === " " ? "space" : char;
  button.setAttribute("aria-label", char === " " ? "пробел" : char);
  button.addEventListener("click", () => insertText(char));
  pressMotion(button);
  return button;
}

function actionKey(key, label, className) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `key ${className}`;
  button.textContent = label;
  button.setAttribute("aria-label", label);
  button.addEventListener("click", () => sendKey(key));
  pressMotion(button);
  return button;
}

function pressMotion(button) {
  button.addEventListener("pointerdown", () => button.classList.add("is-down"));
  button.addEventListener("pointerup", () => button.classList.remove("is-down"));
  button.addEventListener("pointerleave", () => button.classList.remove("is-down"));
}

function insertText(text) {
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  const next = input.value.slice(0, start) + text + input.value.slice(end);
  input.value = next.slice(0, 240);
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
}

function bindLook() {
  if (reduceMotion || !window.matchMedia("(min-width: 901px)").matches) return;
  const baseX = 3;
  const baseY = -6;
  window.addEventListener("pointermove", (event) => {
    if (event.pointerType !== "mouse") return;
    const dx = (event.clientX / window.innerWidth - 0.5) * 10;
    const dy = (event.clientY / window.innerHeight - 0.5) * -6;
    rig.style.transform = `rotateX(${baseX + dy}deg) rotateY(${baseY + dx}deg)`;
  });
}
