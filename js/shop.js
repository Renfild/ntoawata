// A working replica of the tgbotshop Telegram Mini App (VEXSOULS catalogue), shown on the desk phone.
// Products, prices, sizes, currencies and delivery options follow the real bot; the order stays local.

export const SHOP_REPO = "https://github.com/Renfild/tgbotshop";

const PRODUCTS = [
  { id: 1, name: "JEANS", price: 5400, desc: "Джинсы ручной работы.", sizes: ["XS", "S", "M", "L", "XL", "XXL"], art: "jeans", tone: ["#1d2a44", "#0c111c"] },
  { id: 2, name: "DRESS", price: 4500, desc: "Платье.", sizes: ["XS", "S", "M", "L", "XL"], art: "dress", tone: ["#3a1d2e", "#140a10"] },
  { id: 3, name: "MICROBROS", price: 1800, desc: "Микробро.", sizes: ["ONE SIZE"], art: "pin", tone: ["#2c2a1a", "#11100a"] },
  { id: 4, name: "MICROROSPICKME", price: 2200, desc: "Пикми микробро.", sizes: ["ONE SIZE"], art: "heart", tone: ["#3b1c22", "#12090b"] },
  { id: 5, name: "THATSUS", price: 2500, desc: "Парные микробро.", sizes: ["ONE SIZE"], art: "pair", tone: ["#1c3230", "#0a1211"] },
];

const DELIVERY = ["СДЭК", "Почта России", "Курьер", "Самовывоз"];
const PAYMENT = ["Карта", "СБП", "Наличные"];
const PROMO = { code: "RENFILD", off: 0.1 };
const BYN_RATE = 0.035;

const ART = {
  jeans: '<path d="M34 18h32l4 64H56l-6-40-6 40H30z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><path d="M34 26h32M50 18v12" stroke="currentColor" stroke-width="2"/>',
  dress: '<path d="M42 16h16l-2 14 16 52H28l16-52z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><path d="M44 30h12" stroke="currentColor" stroke-width="2"/>',
  pin: '<circle cx="50" cy="46" r="16" fill="none" stroke="currentColor" stroke-width="3"/><circle cx="50" cy="46" r="5" fill="currentColor"/><path d="M28 72l12-12" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>',
  heart: '<path d="M50 74L26 50a13 13 0 0 1 24-16 13 13 0 0 1 24 16z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><circle cx="50" cy="50" r="4" fill="currentColor"/>',
  pair: '<circle cx="38" cy="46" r="13" fill="none" stroke="currentColor" stroke-width="3"/><circle cx="62" cy="54" r="13" fill="none" stroke="currentColor" stroke-width="3"/><path d="M38 46h0M62 54h0" stroke="currentColor" stroke-width="7" stroke-linecap="round"/>',
};

export function mountShop(root) {
  const state = {
    view: "catalog",
    theme: "dark",
    currency: "RUB",
    cart: [],
    favs: new Set(),
    picking: null,
    size: null,
    promo: false,
    delivery: DELIVERY[0],
    payment: PAYMENT[1],
    order: 1041,
  };

  root.classList.add("shop");
  root.replaceChildren();
  const status = el("div", "tg-status");
  status.append(el("span", null, "21:47"), el("span", "tg-status-icons", "▂▄▆ 5G ▮▮▮▯"));
  const bar = el("div", "tg-bar");
  const close = el("button", "tg-close", "Закрыть");
  close.type = "button";
  close.addEventListener("click", () => root.dispatchEvent(new CustomEvent("shop:close", { bubbles: true })));
  const title = el("div", "tg-title");
  title.append(el("strong", null, "VEXSOULS"), el("small", null, "бот"));
  bar.append(close, title, el("span", "tg-more", "⋯"));
  const body = el("div", "shop-body");
  const foot = el("div", "shop-foot");
  root.append(status, bar, body, foot);

  root.addEventListener("click", (event) => {
    const target = event.target.closest("[data-act]");
    if (!target || !root.contains(target)) return;
    const { act, id, value } = target.dataset;
    handle(act, id ? Number(id) : null, value);
  });
  root.addEventListener("input", (event) => {
    if (event.target.name === "promo") {
      state.promo = event.target.value.trim().toUpperCase() === PROMO.code;
      renderTotals();
    }
  });

  render();

  function handle(act, id, value) {
    if (act === "add") {
      const product = PRODUCTS.find((p) => p.id === id);
      if (product.sizes.length === 1) addToCart(product, product.sizes[0]);
      else {
        state.picking = product;
        state.size = null;
      }
    } else if (act === "size") state.size = value;
    else if (act === "size-ok" && state.picking && state.size) {
      addToCart(state.picking, state.size);
      state.picking = null;
    } else if (act === "size-cancel") state.picking = null;
    else if (act === "fav") state.favs.has(id) ? state.favs.delete(id) : state.favs.add(id);
    else if (act === "remove") state.cart.splice(Number(value), 1);
    else if (act === "view") state.view = value;
    else if (act === "theme") state.theme = state.theme === "dark" ? "light" : "dark";
    else if (act === "currency") state.currency = state.currency === "RUB" ? "BYN" : "RUB";
    else if (act === "delivery") state.delivery = value;
    else if (act === "payment") state.payment = value;
    else if (act === "checkout" && state.cart.length) state.view = "checkout";
    else if (act === "confirm") {
      state.order += 1;
      state.placed = { items: state.cart.slice(), total: total(), delivery: state.delivery, payment: state.payment, promo: state.promo };
      state.cart = [];
      state.promo = false;
      state.view = "done";
    }
    render();
  }

  function addToCart(product, size) {
    state.cart.push({ id: product.id, size });
    root.querySelector(".cart-fab")?.classList.remove("bump");
    requestAnimationFrame(() => root.querySelector(".cart-fab")?.classList.add("bump"));
  }

  function price(rub) {
    if (state.currency === "BYN") return `${Math.round(rub * BYN_RATE)} Br`;
    return `${rub.toLocaleString("ru-RU")} ₽`;
  }

  function total() {
    const sum = state.cart.reduce((acc, item) => acc + product(item.id).price, 0);
    return Math.round(state.promo ? sum * (1 - PROMO.off) : sum);
  }

  function render() {
    root.dataset.theme = state.theme;
    body.replaceChildren();
    if (state.view === "catalog") renderCatalog();
    else if (state.view === "cart") renderCart();
    else if (state.view === "fav") renderFavs();
    else if (state.view === "checkout") renderCheckout();
    else renderDone();
    renderFoot();
    if (state.picking) body.append(sizeModal());
  }

  function renderCatalog() {
    const head = el("div", "shop-head");
    head.append(el("h3", null, "VEXSOULS"), el("small", null, "HANDMADE ARCHIVE"));
    const grid = el("div", "shop-grid");
    for (const p of PRODUCTS) grid.append(card(p));
    const fab = button("cart-fab", "", { act: "view", value: "cart" });
    fab.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6h15l-1.5 9h-12z"/><circle cx="9" cy="20" r="1"/><circle cx="18" cy="20" r="1"/><path d="M6 6L5 3H2"/></svg>';
    fab.append(el("span", "badge", String(state.cart.length)));
    fab.setAttribute("aria-label", "Корзина");
    body.append(fab, head, grid);
  }

  function card(p) {
    const item = el("article", "shop-card");
    const art = el("div", "shop-art");
    art.style.background = `linear-gradient(145deg, ${p.tone[0]}, ${p.tone[1]})`;
    art.innerHTML = `<svg viewBox="0 0 100 100" aria-hidden="true">${ART[p.art]}</svg>`;
    const fav = button(`fav${state.favs.has(p.id) ? " on" : ""}`, "♥", { act: "fav", id: p.id });
    fav.setAttribute("aria-label", "В избранное");
    art.append(fav);
    const row = el("div", "shop-row");
    const info = el("div");
    info.append(el("div", "shop-name", p.name), el("div", "shop-price", price(p.price)));
    const add = button("shop-add", "+", { act: "add", id: p.id });
    add.setAttribute("aria-label", `Добавить ${p.name}`);
    row.append(info, add);
    item.append(art, row);
    return item;
  }

  function renderCart() {
    body.append(viewHead("CART"));
    if (!state.cart.length) {
      body.append(el("p", "shop-empty", "Корзина пуста"));
      return;
    }
    state.cart.forEach((item, index) => {
      const p = product(item.id);
      const row = el("div", "shop-line");
      const thumb = el("div", "shop-thumb");
      thumb.style.background = `linear-gradient(145deg, ${p.tone[0]}, ${p.tone[1]})`;
      thumb.innerHTML = `<svg viewBox="0 0 100 100" aria-hidden="true">${ART[p.art]}</svg>`;
      const info = el("div", "shop-line-info");
      info.append(el("div", "shop-name", p.name), el("div", "shop-muted", `размер ${item.size}`), el("div", "shop-price", price(p.price)));
      row.append(thumb, info, button("shop-remove", "×", { act: "remove", value: String(index) }));
      body.append(row);
    });
    const promo = document.createElement("input");
    promo.name = "promo";
    promo.className = "shop-promo";
    promo.placeholder = "ПРОМОКОД (попробуйте RENFILD)";
    promo.autocomplete = "off";
    promo.spellcheck = false;
    promo.value = state.promo ? PROMO.code : "";
    body.append(promo, el("div", "shop-total"), button("shop-cta", "Оформить заказ", { act: "checkout" }));
    renderTotals();
  }

  function renderTotals() {
    const box = root.querySelector(".shop-total");
    if (!box) return;
    box.replaceChildren(el("span", null, "Итого"), el("strong", null, price(total())));
    if (state.promo) box.append(el("span", "shop-off", "−10%"));
  }

  function renderFavs() {
    body.append(viewHead("FAVORITES"));
    const items = PRODUCTS.filter((p) => state.favs.has(p.id));
    if (!items.length) {
      body.append(el("p", "shop-empty", "Избранное пусто. Нажмите ♥ на товаре."));
      return;
    }
    const grid = el("div", "shop-grid");
    for (const p of items) grid.append(card(p));
    body.append(grid);
  }

  function renderCheckout() {
    body.append(viewHead("ЗАКАЗ", "cart"));
    body.append(el("div", "shop-label", "Доставка"), chips(DELIVERY, state.delivery, "delivery"));
    body.append(el("div", "shop-label", "Оплата"), chips(PAYMENT, state.payment, "payment"));
    const sum = el("div", "shop-total");
    sum.append(el("span", null, `${state.cart.length} шт.`), el("strong", null, price(total())));
    body.append(sum, button("shop-cta", "Подтвердить заказ", { act: "confirm" }));
    body.append(el("p", "shop-muted", "В настоящем боте дальше спрашиваются контакт, адрес и размер, а заказ уходит в бота через web_app_data."));
  }

  function renderDone() {
    const placed = state.placed;
    const done = el("div", "shop-done");
    done.append(el("div", "shop-check", "✓"), el("h4", null, `Заказ #${state.order} принят`));
    const chat = el("div", "tg-chat");
    const bubble = el("div", "tg-bubble");
    const lines = [`🛍 Новый заказ #${state.order}`];
    for (const item of placed.items) lines.push(`${product(item.id).name} (${item.size}) — ${price(product(item.id).price)}`);
    lines.push(`Доставка: ${placed.delivery} · Оплата: ${placed.payment}`);
    if (placed.promo) lines.push(`Промокод ${PROMO.code}: −10%`);
    lines.push(`Итого: ${price(placed.total)}`);
    for (const line of lines) bubble.append(el("div", null, line));
    bubble.append(el("time", null, "21:48 ✓✓"));
    chat.append(el("div", "shop-muted", "так это сообщение видит продавец в Telegram:"), bubble);
    done.append(chat, button("shop-cta", "В каталог", { act: "view", value: "catalog" }));
    body.append(done);
  }

  function renderFoot() {
    foot.replaceChildren(
      button("shop-icon", "◐", { act: "theme" }, "Тема"),
      button("shop-icon", state.currency === "RUB" ? "₽" : "Br", { act: "currency" }, "Валюта"),
      favButton(),
    );
    const link = document.createElement("a");
    link.href = SHOP_REPO;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.className = "shop-src";
    link.textContent = "демо · код tgbotshop";
    foot.append(link);
  }

  function favButton() {
    const fav = button("shop-icon", "♥", { act: "view", value: "fav" }, "Избранное");
    if (state.favs.size) fav.append(el("span", "badge", String(state.favs.size)));
    return fav;
  }

  function sizeModal() {
    const wrap = el("div", "shop-modal");
    const box = el("div", "shop-modal-box");
    box.append(el("div", "shop-label", `${state.picking.name}: выберите размер`));
    box.append(chips(state.picking.sizes, state.size, "size"));
    const row = el("div", "shop-modal-row");
    row.append(button("shop-ghost", "Отмена", { act: "size-cancel" }), button(`shop-cta${state.size ? "" : " off"}`, "В корзину", { act: "size-ok" }));
    box.append(row);
    wrap.append(box);
    return wrap;
  }

  function viewHead(text, back = "catalog") {
    const head = el("div", "shop-view-head");
    head.append(el("h3", null, text), button("shop-back", "← Назад", { act: "view", value: back }));
    return head;
  }

  function chips(options, current, act) {
    const row = el("div", "shop-chips");
    for (const option of options) row.append(button(`shop-chip${option === current ? " on" : ""}`, option, { act, value: option }));
    return row;
  }
}

function product(id) {
  return PRODUCTS.find((p) => p.id === id);
}

function button(className, text, data, label) {
  const node = el("button", className, text);
  node.type = "button";
  for (const [key, value] of Object.entries(data)) node.dataset[key] = String(value);
  if (label) node.setAttribute("aria-label", label);
  return node;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}
