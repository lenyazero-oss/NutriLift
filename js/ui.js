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
// action: { label, onClick } を渡すと「元に戻す」などのボタンを表示する
export function toast(message, { action, duration = 2500, error = false } = {}) {
  const t = document.getElementById("toast");
  t.replaceChildren(el("span", {}, message));
  t.classList.toggle("toast-error", error);
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
