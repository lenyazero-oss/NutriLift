// 設定: 食材マスタへの入口とログアウト
import { el, toast } from "../ui.js";
import { signOut } from "../auth.js";

export function renderSettings(root) {
  root.append(
    el("h1", {}, "設定"),
    el("ul", { class: "list" },
      el("li", {}, el("a", { class: "list-item", href: "#/foodmaster" },
        el("span", { class: "name" }, "食材マスタ"),
        el("span", { class: "meta" }, "食材の単位(個・杯など)の設定と、自作食材の登録")))),
    el("button", {
      type: "button", class: "btn btn-danger",
      onclick: () => {
        if (!confirm("ログアウトしますか?")) return;
        signOut().catch(() => toast("ログアウトできませんでした。", { error: true }));
      },
    }, "ログアウト"));
}
