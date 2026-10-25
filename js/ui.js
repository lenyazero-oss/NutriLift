// 共通UIヘルパー
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (v === true) node.setAttribute(k, "");
    else if (v !== false && v != null) node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(c));
  }
  return node;
}

let toastTimer = null;
// ログアウト時などに、取り消しボタン付きのトーストを残さない
export function hideToast() {
  const t = document.getElementById("toast");
  t.hidden = true;
  clearTimeout(toastTimer);
}

// 書き込みの失敗を知らせるハンドラを返す(done.catch(writeFailed("レシピ")) のように使う)。
// 失敗した書き込みは端末側でも取り消されるので、「反映されていません」と明示する。
// 画面遷移のあとに出ても何の失敗か分かるよう、対象(what)と操作(verb)を文言に入れる。
export function writeFailed(what, verb = "保存") {
  return () => toast(`${what}を${verb}できませんでした。変更は反映されていません。通信状況とログイン状態を確認して、もう一度お試しください。`,
    { error: true, duration: 8000 });
}

// action: { label, onClick } を渡すと「元に戻す」などのボタンを表示する
export function toast(message, { action, duration = 2500, error = false } = {}) {
  const t = document.getElementById("toast");
  t.replaceChildren(el("span", {}, message));
  t.classList.toggle("toast-error", error);
  // 入力中はキーボードに隠れないよう上部、それ以外は親指の届く下部に出す
  const typing = ["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName);
  t.classList.toggle("toast-top", typing);
  if (action) {
    t.append(el("button", {
      type: "button", class: "toast-action",
      onclick: () => { t.hidden = true; clearTimeout(toastTimer); action.onClick(); },
    }, action.label));
  }
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), action ? Math.max(duration, 6000) : duration);
}
