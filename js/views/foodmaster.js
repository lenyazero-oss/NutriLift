// 食材マスタ: 食材を検索して単位を設定する / 自作食材の一覧と新規作成
import { el } from "../ui.js";
import { createFoodPicker } from "../food-picker.js";
import { listCustomFoods } from "../db.js";
import { navigate } from "../router.js";

export function renderFoodMaster(root) {
  let alive = true;
  const customBox = el("ul", { class: "list" }, el("li", { class: "empty" }, "読み込み中…"));

  const picker = createFoodPicker({
    placeholder: "食材を検索(例: 鶏むね、卵)",
    onPick: (food) => navigate(`#/foodedit/${food.source === "custom" ? "custom" : "table"}/${encodeURIComponent(food.id)}`),
  });

  root.append(
    el("a", { class: "back", href: "#/settings" }, "← 設定"),
    el("h1", {}, "食材マスタ"),
    el("section", { class: "card" },
      el("h2", {}, "食材の単位を設定"),
      el("p", { class: "hint" }, "食材を選ぶと、「1個=50g」のような単位を変更できます。"),
      picker.node),
    el("section", { class: "card" },
      el("h2", {}, "自作食材"),
      customBox,
      el("a", { class: "btn add-btn", href: "#/foodedit/new" }, "＋ 自作食材を作る")));

  listCustomFoods()
    .then((list) => {
      if (!alive) return;
      list.sort((a, b) => String(a.name).localeCompare(String(b.name), "ja"));
      customBox.replaceChildren(...(list.length
        ? list.map((f) => el("li", {}, el("a", { class: "list-item", href: `#/foodedit/custom/${encodeURIComponent(f.id)}` },
            el("span", { class: "name" }, f.name),
            el("span", { class: "meta" }, `たんぱく質 ${(f.n?.protein ?? 0).toFixed(1)}g / ${Math.round(f.n?.kcal ?? 0)}kcal(100g)`))))
        : [el("li", { class: "empty" }, "まだありません")]));
    })
    .catch(() => {
      if (alive) customBox.replaceChildren(el("li", { class: "error" }, "自作食材を読み込めませんでした。通信状況を確認してください。"));
    });

  return () => { alive = false; };
}
