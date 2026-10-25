import { el } from "../ui.js";
import {
  signInGoogle,
  signInEmail,
  resetPassword,
  authErrorMessage,
} from "../auth.js";

export function renderLogin(root, { configured, initialError }) {
  root.replaceChildren();

  const msgBox = el("p", { hidden: true });
  const showMessage = (text, isError = true) => {
    msgBox.textContent = text;
    msgBox.className = isError ? "error" : "notice";
    msgBox.setAttribute("role", isError ? "alert" : "status");
    msgBox.hidden = !text;
  };
  if (initialError) showMessage(initialError);

  const buttons = [];
  const setBusy = (busy) => buttons.forEach((b) => (b.disabled = busy));

  // 処理中は全ボタンを無効化(二重送信防止)し、押したボタンの文言を変える
  const run = (button, busyLabel, fn) => async () => {
    showMessage("");
    const label = button.textContent;
    setBusy(true);
    button.textContent = busyLabel;
    try {
      await fn();
    } catch (e) {
      // ユーザー自身のキャンセルはエラー表示しない
      const cancelled = ["auth/popup-closed-by-user", "auth/cancelled-popup-request"];
      if (!cancelled.includes(e.code)) showMessage(authErrorMessage(e));
    } finally {
      button.textContent = label;
      setBusy(false);
    }
  };

  const googleBtn = el("button", { class: "btn btn-big", type: "button" }, "Googleでログイン");
  googleBtn.addEventListener("click", run(googleBtn, "ログイン中…", signInGoogle));

  const email = el("input", {
    type: "email", autocomplete: "username", autocapitalize: "off", autocorrect: "off",
    enterkeyhint: "next", placeholder: "メールアドレス", "aria-label": "メールアドレス",
  });
  const password = el("input", {
    type: "password", autocomplete: "current-password", enterkeyhint: "go",
    placeholder: "パスワード", "aria-label": "パスワード",
  });

  const loginBtn = el("button", { class: "btn btn-big btn-primary", type: "submit" }, "メールでログイン");
  const resetBtn = el("button", { class: "btn btn-link", type: "button" }, "パスワードを忘れた");
  buttons.push(googleBtn, loginBtn, resetBtn);

  const doLogin = run(loginBtn, "ログイン中…", () => signInEmail(email.value.trim(), password.value));
  resetBtn.addEventListener(
    "click",
    run(resetBtn, "送信中…", async () => {
      if (!email.value.trim()) throw { code: "auth/invalid-email" };
      await resetPassword(email.value.trim());
      showMessage("再設定用のメールを送信しました。", false);
    })
  );

  // フォームで包み、キーボードのEnter(開始)でもログインできるようにする
  const form = el("form", { class: "card" },
    el("p", { class: "hint" }, "メールでログイン(登録済みのアカウントのみ。この画面からは新しく登録できません)"),
    email, password, loginBtn, resetBtn);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    doLogin();
  });

  // append に null を渡すと「null」という文字が出るため、存在するものだけ渡す
  root.append(...[
    el("h1", {}, "NutriLift"),
    el("p", { class: "sub" }, "たんぱく質を中心に、毎日の栄養を記録します"),
    configured ? null : el("p", { class: "error" },
      "Firebaseの設定が未入力です。js/firebase-config.js を編集してください。"),
    msgBox,
    el("section", { class: "card" }, googleBtn,
      el("p", { class: "hint" }, "ホーム画面から開いてGoogleログインに失敗する場合は、下のメールログイン(登録済みの方のみ)を使ってください。")),
    form,
  ].filter(Boolean));
}
