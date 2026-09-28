import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { projects } from "../js/data.js";
import {
  blocksText,
  bootBlocks,
  complete,
  contactBlocks,
  createHistory,
  resolveProject,
  run,
} from "../js/engine.js";

const BANNED = ["psychic-potato", "xiko", "aseprskill", "allawuateche", "ntoawata"];

test("lists the five real repositories in order", () => {
  assert.deepEqual(
    projects.map((project) => project.id),
    ["aquateche", "pcai", "tgbotshop", "tamagotchi-bot", "fisherman"],
  );
  const listed = blocksText(run("ls projects").blocks);
  for (const id of projects.map((project) => project.id)) assert.match(listed, new RegExp(id));
  for (const name of BANNED) assert.equal(listed.includes(name), false);
});

test("whoami stays inside the public repos", () => {
  const text = blocksText(run("whoami").blocks);
  assert.match(text, /Python, Telegram-боты, RAG, Minecraft-инфраструктура, десктоп на OpenCV/);
  assert.match(text, /https:\/\/github.com\/Renfild/);
  assert.doesNotMatch(text, /\d+\s*лет|senior|junior|клиентов/i);
});

test("skills cite the repositories and skip invented seniority", () => {
  const text = blocksText(run("skills").blocks);
  for (const id of ["pcai", "tgbotshop", "tamagotchi-bot", "fisherman", "AquaTeche"]) {
    assert.match(text, new RegExp(id));
  }
  assert.match(text, /Без стажа/);
  assert.doesNotMatch(text, /\d+\s*лет|senior|junior|клиентов/i);
});

test("help exposes the required commands and keys", () => {
  const text = blocksText(run("help").blocks);
  for (const command of ["help", "whoami", "ls projects", "open <repo>", "skills", "contact", "clear", "close"]) {
    assert.ok(text.includes(command), command);
  }
  assert.match(text, /Tab/);
  assert.match(text, /Ctrl\+L/);
});

test("opens a full case and restores cwd on close", () => {
  const opened = run("open AquaTeche");
  assert.equal(opened.alt, "enter");
  assert.equal(opened.state.cwd, "aquateche");
  assert.equal(opened.scroll, "top");
  const text = blocksText(opened.blocks);
  assert.match(text, /Mohist/);
  assert.match(text, /aquateche\.store/);
  assert.match(text, /https:\/\/github.com\/Renfild\/AquaTeche/);

  const closed = run("close", opened.state);
  assert.equal(closed.alt, "exit");
  assert.equal(closed.state.cwd, null);
  assert.match(blocksText(run("close").blocks), /нет открытого кейса/);
});

test("pcai and tamagotchi cases stay factual", () => {
  const pcai = blocksText(run("open pcai").blocks);
  assert.match(pcai, /ChromaDB/);
  assert.match(pcai, /Streamlit/);
  assert.match(pcai, /ГОСТ/);
  assert.match(pcai, /pixel-art/);

  const shop = blocksText(run("open shop").blocks);
  assert.match(shop, /web_app_data/);
  assert.match(shop, /https:\/\/vexsoulsbot\.vercel\.app/);

  const pet = blocksText(run("cd tamagotchi").blocks);
  assert.equal(pet && run("cd tamagotchi").state.cwd, "tamagotchi-bot");
  assert.match(blocksText(run("cd tamagotchi").blocks), /FastAPI/);
});

test("fisherman is one line and a link", () => {
  const fish = projects.find((project) => project.id === "fisherman");
  assert.equal(fish.summary, "Десктоп на Python: звук, OpenCV, DearPyGui.");
  assert.equal(fish.role, undefined);
  assert.equal(fish.stack, undefined);
  assert.equal(fish.done, undefined);

  const result = run("open fisherman");
  const text = blocksText(result.blocks);
  assert.match(text, /Десктоп на Python: звук, OpenCV, DearPyGui/);
  assert.match(text, /https:\/\/github.com\/Renfild\/fisherman/);
  assert.equal(result.blocks.some((block) => block.text && /роль|стек|сделано/.test(block.text)), false);
  assert.doesNotMatch(text, /Albion|поклев|установ|заброс|мини-игр|инжект|усталост|pip |settings/i);
});

test("unknown commands and bad repos do not change directory", () => {
  const missing = run("open nope", { cwd: "pcai" });
  assert.equal(missing.state.cwd, "pcai");
  assert.equal(missing.alt, "stay");
  assert.ok(missing.blocks.some((block) => block.t === "err"));

  const typo = blocksText(run("hepl").blocks);
  assert.match(typo, /команда не найдена/);
  assert.match(typo, /help/);

  const named = blocksText(run("aquateche").blocks);
  assert.match(named, /open aquateche/);
});

test("clear leaves the home directory", () => {
  const cleared = run("clear", { cwd: "pcai" });
  assert.equal(cleared.clear, true);
  assert.equal(cleared.state.cwd, null);
  assert.equal(cleared.alt, "exit");
});

test("cd .. closes a case and complains at home", () => {
  const back = run("cd ..", { cwd: "pcai" });
  assert.equal(back.alt, "exit");
  assert.equal(back.state.cwd, null);
  assert.match(blocksText(run("cd ..").blocks), /нет открытого кейса/);
  assert.match(blocksText(run("cd nowhere").blocks), /cd: нет такого каталога/);
});

test("tab completes commands and repository names", () => {
  assert.equal(complete("he").input, "help ");
  assert.equal(complete("help").applied, false);
  assert.equal(complete("ls p").input, "ls projects ");
  assert.equal(complete("ls ").input, "ls projects ");
  assert.equal(complete("open aqua").input, "open aquateche ");
  assert.equal(complete("open aquateche").applied, false);
  assert.equal(complete("cd .").input, "cd .. ");
  assert.equal(complete("cd ta").input, "cd tamagotchi-bot ");

  const options = complete("open ");
  assert.equal(options.applied, false);
  assert.deepEqual(options.matches, ["aquateche", "pcai", "tgbotshop", "tamagotchi-bot", "fisherman"]);

  const ambiguous = complete("c");
  assert.equal(ambiguous.applied, false);
  assert.ok(ambiguous.matches.includes("clear"));
  assert.ok(ambiguous.matches.includes("contact"));
});

test("history walks backward and restores the draft", () => {
  const history = createHistory();
  history.push("help");
  history.push("ls projects");
  assert.equal(history.up(""), "ls projects");
  assert.equal(history.up(""), "help");
  assert.equal(history.up("x"), "help");
  assert.equal(history.down(""), "ls projects");
  assert.equal(history.down(""), "");

  const draft = createHistory(["help"]);
  assert.equal(draft.up("who"), "help");
  assert.equal(draft.down(""), "who");
});

test("contact hides email until it is set", () => {
  assert.match(blocksText(run("contact").blocks), /Почта не указана/);
  const withMail = blocksText(contactBlocks({ url: "https://github.com/Renfild", email: "me@example.com" }));
  assert.match(withMail, /mailto:me@example.com/);
  assert.match(withMail, /me@example.com/);
});

test("boot and aliases resolve", () => {
  const boot = blocksText(bootBlocks());
  assert.match(boot, /help/);
  assert.match(boot, /ls projects/);
  assert.equal(resolveProject("#AquaTeche")?.id, "aquateche");
  assert.equal(resolveProject("fish")?.id, "fisherman");
  assert.equal(run("?").blocks[0].text, "команды");
  assert.equal(run("q", { cwd: "pcai" }).alt, "exit");
});

test("page keeps the terminal colors, motion guard, and keyboard viewport", () => {
  const css = readFileSync(new URL("../css/terminal.css", import.meta.url), "utf8");
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(css, /#0c0f0c/i);
  assert.match(css, /#d7e0c8/i);
  assert.match(css, /#7cff6b/i);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(html, /interactive-widget=resizes-content/);
  assert.match(html, /js\/terminal\.js/);
  assert.match(html, /js\/world\.js/);
  assert.match(html, /id="webgl"/);
  assert.doesNotMatch(html, /class="hud"/);
  assert.match(html, /three\.module\.min\.js/);
  const scene = readFileSync(new URL("../css/scene.css", import.meta.url), "utf8");
  const world = readFileSync(new URL("../js/world.js", import.meta.url), "utf8");
  assert.match(world, /open aquateche/);
  assert.match(scene, /prefers-reduced-motion/);
  assert.match(world, /OrbitControls/);
  assert.match(world, /prefers-reduced-motion/);
});
