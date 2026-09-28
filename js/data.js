// Public GitHub snapshot for Renfild, 2026-09-28.
// Repos without a description and a language are omitted.

export const profile = {
  login: "Renfild",
  url: "https://github.com/Renfild",
  email: "",
  snapshot: "2026-09-28",
  snapshotLabel: "28 сентября 2026",
};

export const projects = [
  {
    id: "aquateche",
    name: "AquaTeche",
    lang: "HTML",
    aliases: ["aqua", "aquatech"],
    blurb: "Сервер и лаунчер AquaTech, портал, пайплайн релизов.",
    role: "Репозиторий сервера и клиента AquaTech: мир, лаунчер, портал и выкладка.",
    stack: "HTML, Java, JavaScript, Python, C#, PowerShell.",
    done: [
      "В server/ хост Mohist. Контент лежит рядом: mods, kubejs, datapacks, config.",
      "Клиентский лаунчер — каталоги launcher, launcher_ui и bootstrap.",
      "Портал собран из docs, worker и functions. В tools есть пайплайн релизов, включая deploy_to_cloudflare.py.",
      "Адрес aquateche.store указан в README репозитория.",
    ],
    links: [
      { label: "код", href: "https://github.com/Renfild/AquaTeche" },
      { label: "сайт", href: "https://aquateche.store" },
    ],
  },
  {
    id: "pcai",
    name: "pcai",
    lang: "Python",
    aliases: [],
    blurb: "ИИ-поиск по ГОСТ, СТБ и СНиП: RAG, цитаты, OCR.",
    role: "ИИ-поиск по инженерным нормативам для инженерного факультета ГрГУ.",
    stack: "Python, LangChain, ChromaDB, Streamlit, pypdf, python-docx, pytesseract.",
    done: [
      "Код ассистента лежит в grsu-ai-assistant.",
      "Загрузка PDF и DOCX, OCR для сканов.",
      "Чанки нарезаются с учётом структуры ГОСТ, векторы хранятся в ChromaDB.",
      "Ответ приходит с цитатой источника. Интерфейс — Streamlit.",
      "В этом же репозитории есть каталог pixel-art. К поиску по нормативам он не относится.",
    ],
    links: [{ label: "код", href: "https://github.com/Renfild/pcai" }],
  },
  {
    id: "tgbotshop",
    name: "tgbotshop",
    lang: "Python",
    aliases: ["shop", "tgbot"],
    blurb: "Telegram-магазин: каталог Mini App, корзина, заказы, админка.",
    role: "Telegram-бот магазина: каталог, корзина, заказ и админка.",
    stack: "Python, aiogram 3, asyncpg, PostgreSQL, uvicorn, Docker, HTML Mini App.",
    done: [
      "Покупатель открывает каталог, корзину и избранное, оформляет заказ и проверяет статус.",
      "В сценарии заказа есть контакт, адрес, размер, доставка, оплата и промокод.",
      "В коде есть админские сценарии: товары, промокоды, рассылка, трек-номер, поддержка.",
      "Каталог — HTML-страница Telegram Mini App. Состав заказа приходит в бота через web_app_data.",
    ],
    links: [
      { label: "код", href: "https://github.com/Renfild/tgbotshop" },
      { label: "homepage", href: "https://vexsoulsbot.vercel.app" },
    ],
  },
  {
    id: "tamagotchi-bot",
    name: "tamagotchi-bot",
    lang: "Python",
    aliases: ["tamagotchi"],
    blurb: "Тамагочи в Telegram: бот, API и мини-приложение.",
    role: "Telegram-бот и мини-приложение с виртуальным питомцем.",
    stack: "Python, aiogram 3, FastAPI, PostgreSQL, Redis, Celery, MinIO, React, TypeScript.",
    done: [
      "У бота есть хендлеры питомца, инвентаря, магазина, квестов, друзей и арены.",
      "API на FastAPI отдаёт питомцев, магазин, игры, маркет и websocket.",
      "docker-compose поднимает PostgreSQL, Redis, MinIO и Celery.",
      "Мини-приложение написано на React 18 и TypeScript. В зависимостях Zustand, Framer Motion и Telegram WebApp.",
    ],
    links: [{ label: "код", href: "https://github.com/Renfild/tamagotchi-bot" }],
  },
  {
    id: "fisherman",
    name: "fisherman",
    lang: "Python",
    aliases: ["fish"],
    blurb: "Десктоп на Python: звук, OpenCV, DearPyGui.",
    summary: "Десктоп на Python: звук, OpenCV, DearPyGui.",
    links: [{ label: "код", href: "https://github.com/Renfild/fisherman" }],
  },
];

export const skills = [
  {
    name: "Python",
    detail: "pcai, tgbotshop, tamagotchi-bot, fisherman и скрипты AquaTeche.",
  },
  {
    name: "Telegram-боты (aiogram 3)",
    detail: "tgbotshop и tamagotchi-bot.",
  },
  {
    name: "Telegram Mini App",
    detail: "HTML WebApp в tgbotshop, React-приложение в tamagotchi-bot.",
  },
  {
    name: "PostgreSQL",
    detail: "asyncpg в tgbotshop, Postgres в docker-compose tamagotchi-bot.",
  },
  {
    name: "RAG",
    detail: "LangChain, ChromaDB, цитирование и Streamlit в pcai.",
  },
  {
    name: "Документы и OCR",
    detail: "PDF, DOCX и pytesseract в pcai.",
  },
  {
    name: "FastAPI и WebSocket",
    detail: "API мини-приложения в tamagotchi-bot.",
  },
  {
    name: "Redis и Celery",
    detail: "Кэш и фоновые задачи в tamagotchi-bot.",
  },
  {
    name: "React и TypeScript",
    detail: "Фронтенд tamagotchi-bot: Zustand, Framer Motion.",
  },
  {
    name: "Minecraft-инфраструктура",
    detail: "Сервер, моды на Java, лаунчер, портал и выкладка Cloudflare в AquaTeche.",
  },
  {
    name: "Десктоп",
    detail: "Звук, OpenCV и DearPyGui в fisherman.",
  },
  {
    name: "Docker",
    detail: "Образ tgbotshop и docker-compose tamagotchi-bot.",
  },
];
