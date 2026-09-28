// First-visit power-on: the screen starts dark with a pulsing power glyph; a click or any key
// runs a short boot log, then hands over to the terminal. Shown once per browser session.

import { profile, projects } from "./data.js";

const SEEN_KEY = "renfild.booted";

export function startBoot({ onDone, onPower }) {
  const overlay = document.querySelector("#boot");
  if (!overlay) return;
  if (seen()) {
    overlay.remove();
    return;
  }
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const log = overlay.querySelector(".boot-log");
  const fill = overlay.querySelector(".boot-fill");
  let phase = "off";
  let timers = [];
  document.body.classList.add("is-off");

  const lines = [
    ["", `RENFILD OS 26.9 · ${profile.snapshotLabel}`],
    ["ok", "проверка памяти ............ 16 GB"],
    ["ok", `монтирую проекты ........... ${projects.length}`],
    ["", `     ${projects.map((p) => p.id).join("  ")}`],
    ["ok", "поднимаю Telegram-ботов .... 2"],
    ["ok", "кот ........................ спит"],
    ["ok", "дождь за окном ............. идёт"],
    ["ok", `сеть ....................... ${profile.url.replace("https://", "")}`],
    ["", "запуск терминала…"],
  ];

  overlay.addEventListener("click", () => power());
  document.addEventListener("desk:power", () => power());
  window.addEventListener("keydown", onKey, true);

  function onKey(event) {
    if (phase === "done") return;
    // Keep keystrokes away from the terminal until it is up.
    event.preventDefault();
    event.stopImmediatePropagation();
    if (phase === "off") power();
    else if (event.key === "Escape" || event.key === "Enter") finish();
  }

  function power() {
    if (phase !== "off") return;
    phase = "booting";
    onPower?.();
    document.body.classList.remove("is-off");
    document.body.classList.add("is-booting");
    overlay.classList.add("is-booting");
    const step = reduceMotion ? 0 : 230;
    lines.forEach(([tag, text], i) => {
      timers.push(
        window.setTimeout(() => {
          const row = document.createElement("div");
          if (tag) {
            const badge = document.createElement("span");
            badge.className = "boot-ok";
            badge.textContent = "[ ok ] ";
            row.append(badge);
          }
          row.append(document.createTextNode(text));
          log.append(row);
          fill.style.width = `${Math.round(((i + 1) / lines.length) * 100)}%`;
        }, 250 + i * step),
      );
    });
    timers.push(window.setTimeout(finish, 250 + lines.length * step + (reduceMotion ? 150 : 450)));
  }

  function finish() {
    if (phase === "done") return;
    phase = "done";
    timers.forEach((id) => window.clearTimeout(id));
    timers = [];
    window.removeEventListener("keydown", onKey, true);
    try {
      window.sessionStorage.setItem(SEEN_KEY, "1");
    } catch {
      // Without storage the boot simply plays again next visit.
    }
    overlay.classList.add("is-done");
    document.body.classList.remove("is-off", "is-booting");
    window.setTimeout(() => overlay.remove(), reduceMotion ? 0 : 420);
    onDone?.();
  }
}

function seen() {
  try {
    return window.sessionStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
}
