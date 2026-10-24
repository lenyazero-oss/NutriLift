import { isConfigured } from "./firebase.js";
import { onAuth, checkRedirectResult, authErrorMessage } from "./auth.js";
import { registerRoute, initRouter, render, resetView, setRouterEnabled } from "./router.js";
import { renderToday } from "./views/today.js";
import { renderLogin } from "./views/login.js";
import { renderAdd } from "./views/add.js";
import { el, hideToast } from "./ui.js";

const $ = (id) => document.getElementById(id);

// 画面は順次実装する。未実装の画面は仮表示にしておく。
function placeholder(title, tab) {
  return {
    tab,
    render(root) {
      root.append(el("h1", {}, title), el("p", { class: "hint" }, "このあと実装します。"));
    },
  };
}
registerRoute("today", { tab: "today", render: renderToday });
registerRoute("add", { tab: "today", render: renderAdd });
registerRoute("recipes", placeholder("レシピ", "recipes"));
registerRoute("history", placeholder("履歴", "history"));
registerRoute("settings", placeholder("設定", "settings"));

function showScreen(name) {
  $("splash").hidden = name !== "splash";
  $("login-screen").hidden = name !== "login";
  $("app").hidden = name !== "app";
}

let currentUid = null;
let redirectError = "";

function handleAuthChange(user) {
  if (user) {
    // トークン更新などで同じユーザーに再通知されても再描画しない
    if (user.uid === currentUid) return;
    currentUid = user.uid;
    showScreen("app");
    setRouterEnabled(true);
    render();
  } else {
    currentUid = null;
    setRouterEnabled(false);
    hideToast();
    resetView(); // 前ユーザーの画面と監視を残さない
    renderLogin($("login-screen"), { configured: true, initialError: redirectError });
    redirectError = "";
    showScreen("login");
  }
}

function start() {
  initRouter($("view"), $("tabbar"));

  if (!isConfigured) {
    renderLogin($("login-screen"), { configured: false });
    showScreen("login");
    return;
  }

  // 認証状態が一定時間返らない場合(通信不良など)は、再読み込みを案内する
  const stuckTimer = setTimeout(() => {
    $("splash").replaceChildren(
      el("p", {}, "接続できません。通信状況を確認してください。"),
      el("button", { class: "btn", type: "button", onclick: () => location.reload() }, "再読み込み")
    );
  }, 8000);

  onAuth((user) => {
    clearTimeout(stuckTimer);
    handleAuthChange(user);
  });

  // リダイレクト方式のログインから戻った際のエラーのみ拾う(起動はブロックしない)
  checkRedirectResult().catch((e) => {
    redirectError = authErrorMessage(e);
    if (!currentUid) handleAuthChange(null);
  });
}

start();

// PWA: Service Worker 登録(失敗しても動作に影響しない)
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((e) => console.warn("SW登録失敗", e));
  });
}
