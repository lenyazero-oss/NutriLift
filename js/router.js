// ハッシュルーティング。routes: { name: { render(container, params), tab? } }
const routes = {};
let container = null;
let tabbar = null;

export function registerRoute(name, route) {
  routes[name] = route;
}

export function initRouter(viewEl, tabbarEl) {
  container = viewEl;
  tabbar = tabbarEl;
  window.addEventListener("hashchange", render);
}

export function navigate(path) {
  location.hash = path;
}

function parse() {
  // 例: #/add?date=2026-10-24&slot=noon
  const hash = location.hash.replace(/^#\/?/, "");
  const [pathPart, query = ""] = hash.split("?");
  const parts = pathPart.split("/").filter(Boolean);
  const decode = (s) => {
    try { return decodeURIComponent(s); } catch { return s; }
  };
  return {
    name: parts[0] || "today",
    args: parts.slice(1).map(decode),
    query: Object.fromEntries(new URLSearchParams(query)),
  };
}

// 画面が返した後片付け関数(Firestoreの監視解除など)を保持する
let cleanup = null;

export function resetView() {
  if (cleanup) cleanup();
  cleanup = null;
  if (container) container.replaceChildren();
}

// ログイン中のみ画面を描画する(未ログイン時の hashchange で Firestore を触らないため)
let enabled = false;
export function setRouterEnabled(value) {
  enabled = value;
}

export function render() {
  if (!container || !enabled) return;
  if (cleanup) cleanup();
  cleanup = null;
  const { name, args, query } = parse();
  const known = name in routes;
  const route = known ? routes[name] : routes.today;
  const tab = route.tab || (known ? name : "today");
  tabbar.querySelectorAll("a").forEach((a) => {
    const active = a.dataset.tab === tab;
    a.classList.toggle("active", active);
    if (active) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  container.replaceChildren();
  window.scrollTo(0, 0);
  const result = route.render(container, { args, query });
  if (typeof result === "function") cleanup = result;
}
