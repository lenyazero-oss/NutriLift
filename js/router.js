// ハッシュルーティング。routes: { name: { render(container, params), tab?, followsToday? } }
// followsToday: 「今日」を初期値に使う画面。日付をまたいだら描画し直す。
import { dateStr } from "./util.js";

const routes = {};
let container = null;
let tabbar = null;

export function registerRoute(name, route) {
  routes[name] = route;
}

export function initRouter(viewEl, tabbarEl) {
  container = viewEl;
  tabbar = tabbarEl;
  window.addEventListener("hashchange", onHashChange);
  // ホーム画面のアプリは開いたままになりやすいので、復帰時と1分ごとに日付の変化を確認する
  document.addEventListener("visibilitychange", refreshIfNewDay);
  setInterval(refreshIfNewDay, 60 * 1000);
}

// 画面を描画した日。これと今日が違えば、日付に依存する画面の初期値(今日・区分)が古い。
let renderedDay = "";

function refreshIfNewDay() {
  const day = dateStr();
  if (document.hidden || !enabled || restoring || day === renderedDay) return;
  const { name, query } = parse();
  // 日付(date)や週の終わり(end)を指定して開いている画面、編集中の画面、入力欄にフォーカスがある間は触らない(次の確認で再試行)
  const route = Object.hasOwn(routes, name) ? routes[name] : routes.today;
  if (!route?.followsToday || query.date || query.end || leaveGuard) {
    if (!leaveGuard) renderedDay = day;
    return;
  }
  if (["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName)) return;
  if (refreshBlocker?.()) return; // 食材を選択中など、画面が保持している途中の状態を捨てない
  render();
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

// 画面を離れる前の確認。fn() が false を返したら遷移を取り消して今の画面に留まる。
// 遷移が確定すると自動で解除されるので、画面ごとに設定し直す。
let leaveGuard = null;
export function setLeaveGuard(fn) {
  leaveGuard = fn;
}

// 日付またぎの再描画を保留したい間、true を返す関数を画面が設定する(離脱確認までは不要な途中状態用)。
let refreshBlocker = null;
export function setRefreshBlocker(fn) {
  refreshBlocker = fn;
}

// 表示中の画面の履歴番号。各履歴エントリに history.state = { i } として持たせ、
// 遷移を取り消すときに「戻る/進む」の操作か「新しい遷移」かを見分けて、履歴を壊さずに元へ戻す。
let shownIdx = 0;
// 取り消しのための履歴移動で起きる hashchange は、画面の再描画に使わない
let restoring = false;

let restoringTimer = null;

function undoNavigation() {
  const i = history.state?.i;
  restoring = true;
  clearTimeout(restoringTimer);
  // 同じハッシュの履歴同士だと hashchange が来ないため、フラグが残らないようにする
  restoringTimer = setTimeout(() => (restoring = false), 800);
  if (typeof i === "number" && i !== shownIdx) history.go(shownIdx - i); // 戻る/進む操作を元に戻す
  else history.back(); // リンク・タブ・navigate() で積まれた新しい履歴を取り消す
}

function onHashChange() {
  if (restoring) {
    restoring = false;
    clearTimeout(restoringTimer);
    return;
  }
  render();
}

export function resetView() {
  if (cleanup) cleanup();
  cleanup = null;
  leaveGuard = null;
  refreshBlocker = null;
  if (container) container.replaceChildren();
}

// ログイン中のみ画面を描画する(未ログイン時の hashchange で Firestore を触らないため)
let enabled = false;
export function setRouterEnabled(value) {
  enabled = value;
}

export function render() {
  if (!container || !enabled) return;
  if (leaveGuard && !leaveGuard()) {
    undoNavigation(); // 再描画はしない(入力途中の内容を残す)
    return;
  }
  leaveGuard = null;
  refreshBlocker = null;
  renderedDay = dateStr();
  const stamped = history.state?.i;
  shownIdx = typeof stamped === "number" ? stamped : shownIdx + 1;
  if (typeof stamped !== "number") history.replaceState({ i: shownIdx }, "");
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
