import { isConfigured } from "./firebase.js";
import { onAuth, checkRedirectResult, authErrorMessage } from "./auth.js";
import { registerRoute, initRouter, render, resetView, setRouterEnabled } from "./router.js";
import { renderToday } from "./views/today.js";
import { renderRecipes } from "./views/recipes.js";
import { renderRecipeEdit } from "./views/recipe-edit.js";
import { renderHistory } from "./views/history.js";
import { renderSettings } from "./views/settings.js";
import { renderFoodMaster } from "./views/foodmaster.js";
import { renderFoodEdit } from "./views/foodedit.js";
import { renderLogin } from "./views/login.js";
import { renderAdd } from "./views/add.js";
import { el, hideToast } from "./ui.js";
import { invalidateUserData } from "./food-picker.js";
import { setUserData } from "./foods.js";

const $ = (id) => document.getElementById(id);

registerRoute("today", { tab: "today", render: renderToday });
registerRoute("add", { tab: "today", render: renderAdd });
registerRoute("recipes", { tab: "recipes", render: renderRecipes });
registerRoute("recipe", { tab: "recipes", render: renderRecipeEdit });
registerRoute("history", { tab: "history", render: renderHistory });
registerRoute("settings", { tab: "settings", render: renderSettings });
registerRoute("foodmaster", { tab: "settings", render: renderFoodMaster });
registerRoute("foodedit", { tab: "settings", render: renderFoodEdit });

function showScreen(name) {
  $("splash").hidden = name !== "splash";
  $("login-screen").hidden = name !== "login";
  $("app").hidden = name !== "app";
}

let currentUid = null;
let redirectError = "";

// ユーザーが変わったら、前ユーザーの自作食材・単位のキャッシュを捨てる
function resetUserCache() {
  invalidateUserData();
  setUserData({});
}

function handleAuthChange(user) {
  if (user) {
    // トークン更新などで同じユーザーに再通知されても再描画しない
    if (user.uid === currentUid) return;
    resetUserCache();
    currentUid = user.uid;
    showScreen("app");
    setRouterEnabled(true);
    render();
  } else {
    currentUid = null;
    resetUserCache();
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
