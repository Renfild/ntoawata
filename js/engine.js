import { profile, projects, skills } from "./data.js";

export const PUBLIC_COMMANDS = [
  "help",
  "whoami",
  "ls",
  "open",
  "skills",
  "contact",
  "clear",
  "close",
  "cd",
  "pwd",
  "history",
  "sound",
];

const COMMAND_ALIASES = {
  "?": "help",
  q: "close",
  exit: "close",
  quit: "close",
  back: "close",
};

const SUGGEST = {
  man: "help",
  about: "whoami",
  email: "contact",
  mail: "contact",
  github: "contact",
  project: "ls projects",
  projects: "ls projects",
  repo: "ls projects",
  repos: "ls projects",
  skill: "skills",
};

const LS_PATHS = new Set(["projects", "~/projects", "./projects"]);

export function promptFor(cwd) {
  return cwd ? `renfild@github:~/projects/${cwd}$` : "renfild@github:~$";
}

export function pathFor(cwd) {
  return cwd ? `~/projects/${cwd}` : "~";
}

export function parse(raw) {
  const line = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (!line) return { cmd: "", args: [], line: "" };
  const parts = line.split(" ");
  return { cmd: parts[0].toLowerCase(), args: parts.slice(1), line };
}

export function resolveProject(token) {
  const cleaned = String(token ?? "")
    .trim()
    .toLowerCase()
    .replace(/^#/, "")
    .replace(/^open-/, "")
    .replace(/^~\/projects\//, "")
    .replace(/^\.\/projects\//, "")
    .replace(/^projects\//, "")
    .replace(/^\.\//, "")
    .replace(/\/+$/, "");
  if (!cleaned || cleaned === ".." || cleaned === "~" || cleaned === "projects") return null;
  return (
    projects.find((project) => {
      const names = [project.id, project.name.toLowerCase(), ...(project.aliases ?? [])];
      return names.includes(cleaned);
    }) ?? null
  );
}

export function createHistory(initial = []) {
  const items = initial.filter((item) => typeof item === "string" && item.trim()).slice(-100);
  let cursor = items.length;
  let draft = "";

  return {
    get items() {
      return items.slice();
    },
    push(line) {
      const value = String(line ?? "").trim();
      if (!value) return;
      items.push(value);
      while (items.length > 100) items.shift();
      cursor = items.length;
      draft = "";
    },
    up(current) {
      if (!items.length) return current;
      if (cursor === items.length) draft = current;
      if (cursor > 0) cursor -= 1;
      return items[cursor];
    },
    down(current) {
      if (cursor >= items.length) return current;
      cursor += 1;
      if (cursor >= items.length) return draft;
      return items[cursor];
    },
  };
}

export function complete(input) {
  const source = String(input ?? "");
  const trailingSpace = /\s$/.test(source);
  const tokens = source.trim() === "" ? [] : source.trim().split(/\s+/);

  if (tokens.length === 0) {
    return { input: source, matches: [...PUBLIC_COMMANDS], applied: false };
  }

  if (!trailingSpace && tokens.length === 1) {
    const token = tokens[0].toLowerCase();
    const matches = PUBLIC_COMMANDS.filter((command) => command.startsWith(token));
    return applyCompletion(source, matches, { append: false });
  }

  const command = tokens[0].toLowerCase();
  const startingArg = trailingSpace && tokens.length === 1;
  const editingArg = !trailingSpace && tokens.length === 2;
  if (!startingArg && !editingArg) {
    return { input: source, matches: [], applied: false };
  }

  const partial = startingArg ? "" : tokens[1].toLowerCase();
  let pool = null;
  if (command === "open") pool = projects.map((project) => project.id);
  else if (command === "cd") pool = ["..", "~", ...projects.map((project) => project.id)];
  else if (command === "ls") pool = ["projects"];
  else if (command === "sound") pool = ["on", "off"];
  if (!pool) return { input: source, matches: [], applied: false };

  const matches = pool.filter((item) => item.startsWith(partial));
  return applyCompletion(source, matches, { append: startingArg });
}

export function run(raw, state = {}) {
  const cwd = state.cwd ?? null;
  const history = Array.isArray(state.history) ? state.history : [];
  const parsed = parse(raw);
  if (!parsed.cmd) return finish(cwd, []);

  parsed.cmd = COMMAND_ALIASES[parsed.cmd] ?? parsed.cmd;

  switch (parsed.cmd) {
    case "help":
      return rejectExtra(parsed, cwd) ?? finish(cwd, helpBlocks());
    case "whoami":
      return rejectExtra(parsed, cwd) ?? finish(cwd, whoamiBlocks());
    case "skills":
      return rejectExtra(parsed, cwd) ?? finish(cwd, skillsBlocks());
    case "contact":
      return rejectExtra(parsed, cwd) ?? finish(cwd, contactBlocks());
    case "pwd":
      return rejectExtra(parsed, cwd) ?? finish(cwd, [{ t: "p", text: pathFor(cwd) }]);
    case "history":
      return rejectExtra(parsed, cwd) ?? finish(cwd, historyBlocks(history));
    case "clear":
      return rejectExtra(parsed, cwd) ?? finish(null, [], { clear: true, alt: "exit" });
    case "close":
      return rejectExtra(parsed, cwd) ?? closeCase(cwd);
    case "ls":
      return list(cwd, parsed.args);
    case "open":
      return openProject(cwd, parsed.args);
    case "cd":
      return changeDir(cwd, parsed.args);
    case "sound":
      return soundCommand(cwd, parsed.args, state.sound === true);
    default:
      return unknown(cwd, parsed);
  }
}

export function blocksText(blocks) {
  return blocks
    .map((block) =>
      [block.text, block.k, block.v, block.name, block.lang, block.blurb, block.cmd, block.label, block.hint, block.href]
        .filter(Boolean)
        .join(" "),
    )
    .join("\n");
}

export function bootBlocks() {
  return [
    { t: "h", text: "Renfild — личный терминал" },
    { t: "p", text: "Python, Telegram-боты, RAG, Minecraft-инфраструктура, десктоп на OpenCV." },
    {
      t: "dim",
      text: `Публичные репозитории GitHub · срез ${profile.snapshotLabel}. Пустые заглушки скрыты.`,
    },
    { t: "gap" },
    { t: "p", text: "Интерфейс — командная строка внизу экрана." },
    { t: "run", cmd: "help", label: "help", hint: "список команд" },
    { t: "run", cmd: "ls projects", label: "ls projects", hint: "карточки репозиториев" },
    { t: "run", cmd: "whoami", label: "whoami", hint: "коротко обо мне" },
  ];
}

export function contactBlocks(person = profile) {
  const blocks = [
    { t: "h", text: "контакт" },
    { t: "linkrow", k: "GitHub", href: person.url, text: person.url },
  ];
  const email = String(person.email ?? "").trim();
  if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    blocks.push({ t: "linkrow", k: "почта", href: `mailto:${email}`, text: email });
  } else {
    blocks.push({ t: "p", text: "Почта не указана." });
  }
  return blocks;
}

function helpBlocks() {
  const commands = [
    ["help", "список команд"],
    ["whoami", "кто я"],
    ["ls", "каталог ~"],
    ["ls projects", "карточки репозиториев"],
    ["open <repo>", "кейс на весь экран"],
    ["skills", "навыки по репозиториям"],
    ["contact", "GitHub и почта"],
    ["clear", "очистить экран"],
    ["close", "закрыть кейс. то же: q, Esc, cd .."],
    ["cd <repo>", "то же, что open"],
    ["pwd", "текущий путь"],
    ["history", "прошлые команды"],
    ["sound", "включить или выключить звук"],
  ];
  const keys = [
    ["↑ ↓", "история ввода"],
    ["Tab", "дополнить команду или имя репозитория"],
    ["Esc", "закрыть кейс"],
    ["Ctrl+L", "очистить экран"],
    ["Ctrl+C", "сбросить строку"],
  ];
  return [
    { t: "h", text: "команды" },
    ...commands.map(([label, hint]) => ({
      t: "run",
      cmd: runnable(label),
      label,
      hint,
    })),
    { t: "label", text: "клавиши" },
    ...keys.map(([k, v]) => ({ t: "kv", k, v })),
    { t: "gap" },
    {
      t: "dim",
      text: `репозитории: ${projects.map((project) => project.id).join(", ")}`,
    },
  ];
}

function whoamiBlocks() {
  return [
    { t: "h", text: profile.login.toLowerCase() },
    { t: "p", text: "Python, Telegram-боты, RAG, Minecraft-инфраструктура, десктоп на OpenCV." },
    { t: "p", text: "Имя и биография в профиле GitHub не заполнены. Здесь только то, что видно в публичных репозиториях." },
    { t: "linkrow", k: "GitHub", href: profile.url, text: profile.url },
  ];
}

function skillsBlocks() {
  return [
    { t: "h", text: "навыки" },
    { t: "p", text: "Собраны по файлам публичных репозиториев. Без стажа и грейдов." },
    ...skills.flatMap((skill) => [
      { t: "label", text: skill.name },
      { t: "p", text: skill.detail },
    ]),
  ];
}

function historyBlocks(history) {
  if (!history.length) return [{ t: "dim", text: "история пуста" }];
  return history.map((line, index) => ({
    t: "kv",
    k: String(index + 1),
    v: line,
  }));
}

function list(cwd, args) {
  if (args.length > 1) return finish(cwd, [{ t: "err", text: "ls: лишние аргументы" }]);
  if (args.length === 0) {
    return finish(cwd, [
      { t: "dim", text: "~" },
      { t: "run", cmd: "ls projects", label: "projects", hint: "репозитории" },
    ]);
  }

  const arg = args[0].trim().toLowerCase().replace(/\\/g, "/").replace(/\/+$/, "").replace(/^\.\//, "");
  if (arg.startsWith("-")) {
    return finish(cwd, [{ t: "err", text: "ls: флаги не поддерживаются. используйте ls projects" }]);
  }
  if (LS_PATHS.has(arg)) return finish(cwd, projectCards());

  const project = resolveProject(arg);
  if (project) {
    return finish(cwd, [
      { t: "dim", text: `${project.name} — кейс, не каталог с файлами` },
      { t: "run", cmd: `open ${project.id}`, label: `open ${project.id}`, hint: "открыть кейс" },
    ]);
  }
  return finish(cwd, [
    { t: "err", text: `ls: нет такого каталога: ${args[0]}` },
    { t: "run", cmd: "ls projects", label: "ls projects", hint: "показать репозитории" },
  ]);
}

function projectCards() {
  return [
    { t: "dim", text: `репозитории · срез ${profile.snapshotLabel}` },
    ...projects.map((project) => ({
      t: "card",
      name: project.name,
      lang: project.lang,
      blurb: project.blurb,
      cmd: `open ${project.id}`,
    })),
    { t: "dim", text: "Репозитории без описания и языка не показаны." },
    { t: "dim", text: "Дальше: open <имя> или cd <имя>." },
  ];
}

function openProject(cwd, args) {
  if (args.length > 1) return finish(cwd, [{ t: "err", text: "open: лишние аргументы" }]);
  if (args.length === 0) {
    return finish(cwd, [
      { t: "err", text: "open: укажите репозиторий" },
      ...projects.map((project) => ({
        t: "run",
        cmd: `open ${project.id}`,
        label: project.id,
        hint: project.blurb,
      })),
    ]);
  }
  const project = resolveProject(args[0]);
  if (!project) {
    return finish(cwd, [
      { t: "err", text: `open: нет репозитория «${args[0]}»` },
      { t: "dim", text: `доступны: ${projects.map((item) => item.id).join(", ")}` },
    ]);
  }
  return finish(project.id, caseBlocks(project), { alt: "enter", scroll: "top" });
}

function changeDir(cwd, args) {
  if (args.length > 1) return finish(cwd, [{ t: "err", text: "cd: лишние аргументы" }]);
  if (args.length === 0) return finish(cwd, [{ t: "p", text: pathFor(cwd) }]);

  const arg = args[0].trim().toLowerCase().replace(/\/+$/, "");
  if (arg === "~") {
    if (!cwd) return finish(null, [{ t: "p", text: "~" }]);
    return finish(null, [{ t: "dim", text: "кейс закрыт" }], { alt: "exit" });
  }
  if (arg === "..") return closeCase(cwd, "cd");
  const project = resolveProject(args[0]);
  if (!project) {
    return finish(cwd, [
      { t: "err", text: `cd: нет такого каталога: ${args[0]}` },
      { t: "run", cmd: "ls projects", label: "ls projects", hint: "показать репозитории" },
    ]);
  }
  return finish(project.id, caseBlocks(project), { alt: "enter", scroll: "top" });
}

function soundCommand(cwd, args, current) {
  if (args.length > 1) return finish(cwd, [{ t: "err", text: "sound: лишние аргументы" }]);
  const arg = (args[0] ?? "").toLowerCase();
  let next;
  if (!arg) next = !current;
  else if (arg === "on" || arg === "вкл") next = true;
  else if (arg === "off" || arg === "выкл") next = false;
  else return finish(cwd, [{ t: "err", text: `sound: не понимаю «${args[0]}». используйте sound on или sound off` }]);
  const text = next ? "звук включён: дождь, клавиши, лампа и кот" : "звук выключен";
  return finish(cwd, [{ t: "p", text }], { sound: next });
}

function runnable(label) {
  if (label.startsWith("open")) return "open";
  if (label.startsWith("cd")) return "cd";
  return label;
}

function closeCase(cwd, command = "close") {
  if (!cwd) return finish(cwd, [{ t: "err", text: `${command}: нет открытого кейса` }]);
  return finish(null, [{ t: "dim", text: "кейс закрыт" }], { alt: "exit" });
}

function caseBlocks(project) {
  const back = { t: "dim", text: "Esc, close или cd .. — вернуться к предыдущему экрану" };
  if (project.summary && !project.role) {
    return [
      { t: "h", text: project.name },
      { t: "p", text: project.summary },
      ...project.links.map((link) => ({ t: "linkrow", k: link.label, href: link.href, text: link.href })),
      back,
    ];
  }

  return [
    { t: "h", text: project.name },
    { t: "label", text: "роль" },
    { t: "p", text: project.role },
    { t: "label", text: "стек" },
    { t: "p", text: project.stack },
    { t: "label", text: "сделано" },
    ...project.done.map((text) => ({ t: "p", text })),
    { t: "label", text: "ссылки" },
    ...project.links.map((link) => ({ t: "linkrow", k: link.label, href: link.href, text: link.href })),
    back,
  ];
}

function unknown(cwd, parsed) {
  const command = parsed.cmd.slice(0, 80);
  const project = parsed.args.length === 0 ? resolveProject(command) : null;
  if (project) {
    return finish(cwd, [
      { t: "err", text: `${command}: команда не найдена` },
      { t: "run", cmd: `open ${project.id}`, label: `open ${project.id}`, hint: "это репозиторий" },
    ]);
  }

  const hint = SUGGEST[command] ?? closestCommand(command);
  const blocks = [{ t: "err", text: `${command}: команда не найдена` }];
  if (hint) blocks.push({ t: "run", cmd: hint, label: hint, hint: "ближайшая команда" });
  return finish(cwd, blocks);
}

function closestCommand(command) {
  if (command.length < 2) return null;
  let best = null;
  let bestDistance = 3;
  for (const name of PUBLIC_COMMANDS) {
    const distance = levenshtein(command, name);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = name;
    }
  }
  return bestDistance <= 2 ? best : null;
}

function rejectExtra(parsed, cwd) {
  if (parsed.args.length === 0) return null;
  return finish(cwd, [{ t: "err", text: `${parsed.cmd}: лишние аргументы` }]);
}

function finish(cwd, blocks, extra = {}) {
  const alt = extra.alt ?? "stay";
  return {
    state: { cwd },
    blocks,
    clear: extra.clear ?? false,
    alt,
    scroll: extra.scroll ?? (alt === "enter" ? "top" : "bottom"),
    sound: extra.sound ?? null,
  };
}

function applyCompletion(source, matches, { append }) {
  if (!matches.length) return { input: source, matches, applied: false };
  if (matches.length === 1) {
    const next = append ? `${source}${matches[0]} ` : replaceLast(source, `${matches[0]} `);
    if (next.trim() === source.trim()) return { input: source, matches, applied: false };
    return { input: next, matches, applied: true };
  }

  const prefix = commonPrefix(matches);
  const partial = append ? "" : lastToken(source).toLowerCase();
  if (prefix && prefix.length > partial.length) {
    const next = append ? `${source}${prefix}` : replaceLast(source, prefix);
    return { input: next, matches, applied: next !== source };
  }
  return { input: source, matches, applied: false };
}

function lastToken(source) {
  const parts = source.trimEnd().split(/\s+/);
  return parts[parts.length - 1] ?? "";
}

function replaceLast(source, replacement) {
  const match = source.match(/^(.*\s)?(\S*)$/);
  return `${match?.[1] ?? ""}${replacement}`;
}

function commonPrefix(list) {
  return list.reduce((prefix, item) => {
    let index = 0;
    while (index < prefix.length && index < item.length && prefix[index] === item[index]) index += 1;
    return prefix.slice(0, index);
  });
}

function levenshtein(a, b) {
  const rows = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i += 1) rows[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) rows[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
    }
  }
  return rows[a.length][b.length];
}
