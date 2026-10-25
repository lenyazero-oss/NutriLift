// レシピの作成・編集: 名前、できあがりの人前数、食材(グラム)の一覧
import { el, toast, writeFailed } from "../ui.js";
import { createFoodPicker } from "../food-picker.js";
import { unitsFor, displayName } from "../foods.js";
import { getRecipe, saveRecipe, deleteRecipe } from "../db.js";
import { navigate, setLeaveGuard } from "../router.js";
import { recipePortion } from "../nutrients.js";

export function renderRecipeEdit(root, { args }) {
  const id = args[0] && args[0] !== "new" ? args[0] : null;
  let alive = true;
  let leaving = false; // 保存・削除のあとは確認なしで移動する

  root.append(el("a", { class: "back", href: "#/recipes" }, "← レシピ一覧"), el("p", { class: "hint" }, "読み込み中…"));

  if (!id) {
    start({ name: "", servings: 1, items: [] });
  } else {
    getRecipe(id)
      .then((r) => {
        if (!alive) return;
        if (!r) return fail("レシピが見つかりません。");
        start(r);
      })
      .catch(() => alive && fail("レシピを読み込めませんでした。通信状況を確認してください。"));
  }

  function fail(message) {
    root.replaceChildren(
      el("a", { class: "back", href: "#/recipes" }, "← レシピ一覧"),
      el("p", { class: "error", role: "alert" }, message));
  }

  function start(recipe) {
    const items = (recipe.items || []).map((it) => ({ ...it }));

    const nameInput = el("input", {
      type: "text", value: recipe.name || "", placeholder: "レシピ名(例: 鶏むねのサラダ)",
      maxlength: "40", "aria-label": "レシピ名",
    });
    const servingsInput = el("input", {
      type: "number", inputmode: "decimal", min: "0", step: "any",
      value: String(recipe.servings || 1), "aria-label": "できあがりの人前数",
    });
    servingsInput.addEventListener("focus", () => servingsInput.select());

    const itemList = el("ul", { class: "meals" });
    const perServing = el("div", { class: "preview", "aria-live": "polite" });
    const error = el("p", { class: "error", role: "alert", hidden: true });
    const saveBtn = el("button", { type: "button", class: "btn btn-big btn-primary" }, "保存する");

    const servings = () => {
      const s = parseFloat(servingsInput.value);
      return s > 0 ? s : 0;
    };

    function updateTotals() {
      const s = servings();
      if (!items.length || !s) {
        perServing.replaceChildren(el("div", { class: "preview-g" }, items.length ? "人前数を入力してください" : "食材を追加してください"));
        return;
      }
      const p = recipePortion({ servings: s, items }, 1);
      perServing.replaceChildren(
        el("div", { class: "preview-g" }, `1人前 ${Math.round(p.nutrients.kcal || 0)}kcal`),
        el("div", { class: "preview-n" },
          el("span", {}, `たんぱく質 ${(p.nutrients.protein || 0).toFixed(1)}g`),
          el("span", {}, `脂質 ${(p.nutrients.fat || 0).toFixed(1)}g`),
          el("span", {}, `炭水化物 ${(p.nutrients.carb || 0).toFixed(1)}g`),
          el("span", {}, `食物繊維 ${(p.nutrients.fiber || 0).toFixed(1)}g`)));
    }

    function drawItems() {
      itemList.replaceChildren(
        ...items.map((it, i) => {
          const g = el("input", {
            type: "number", inputmode: "decimal", min: "0", step: "any", value: String(it.grams),
            class: "g-input", "aria-label": `${displayName(it)}のグラム数`,
          });
          g.addEventListener("focus", () => g.select());
          g.addEventListener("input", () => {
            const v = parseFloat(g.value);
            it.grams = v > 0 ? v : 0;
            updateTotals();
          });
          const del = el("button", {
            type: "button", class: "del", "aria-label": `${displayName(it)}を外す`,
            onclick: () => {
              const [removed] = items.splice(i, 1);
              drawItems();
              updateTotals();
              toast(`${removed.name} を外しました`, {
                action: {
                  label: "元に戻す",
                  onClick: () => { items.splice(Math.min(i, items.length), 0, removed); drawItems(); updateTotals(); },
                },
              });
            },
          }, "外す");
          return el("li", { class: "meal item" },
            el("div", { class: "meal-main" }, el("div", { class: "meal-name" }, displayName(it))),
            g, el("span", { class: "unit" }, "g"), del);
        }));
      if (!items.length) itemList.append(el("li", { class: "empty" }, "まだ食材がありません"));
    }

    const picker = createFoodPicker({
      placeholder: "食材を検索して追加",
      onPick: (food) => {
        // 単位があれば先頭の単位1つ分(例: 卵 50g)、なければ100gを初期値にする
        const u = unitsFor(food)[0];
        items.push({
          foodId: food.id, source: food.source, name: food.name,
          grams: u ? u.g : 100, n: { ...food.n },
        });
        drawItems();
        updateTotals();
        toast(`${displayName(food)} を追加しました`);
      },
    });

    function validate() {
      if (!nameInput.value.trim()) return "レシピ名を入力してください。";
      if (!servings()) return "できあがりの人前数を入力してください。";
      if (!items.length) return "食材を1つ以上追加してください。";
      if (items.some((it) => !(it.grams > 0))) return "グラム数が0の食材があります。";
      return "";
    }

    saveBtn.addEventListener("click", () => {
      const msg = validate();
      error.textContent = msg;
      error.hidden = !msg;
      if (msg) return;
      const data = {
        name: nameInput.value.trim(),
        servings: servings(),
        items: items.map((it) => ({ ...it, grams: Math.round(it.grams * 10) / 10 })),
      };
      saveBtn.disabled = true; // 連打による重複作成を防ぐ
      try {
        // オフライン時は応答が返らないため await しない
        const { done } = saveRecipe(id, data);
        done.catch(writeFailed(`レシピ「${data.name}」`));
      } catch {
        toast("保存できませんでした。", { error: true });
        saveBtn.disabled = false;
        return;
      }
      toast("レシピを保存しました");
      leaving = true;
      navigate("#/recipes");
    });

    const children = [
      el("a", { class: "back", href: "#/recipes" }, "← レシピ一覧"),
      el("h1", {}, id ? "レシピを編集" : "レシピを作る"),
      el("section", { class: "card" },
        el("label", { class: "lbl" }, "レシピ名", nameInput),
        el("label", { class: "lbl" }, "できあがりの人前数(全体の量が何人前か)", servingsInput)),
      el("section", { class: "card" }, el("h2", {}, "食材"), itemList, perServing),
      el("section", { class: "card" }, el("h2", {}, "食材を追加"), picker.node),
      error,
      saveBtn,
    ];
    if (id) {
      children.push(el("button", {
        type: "button", class: "btn btn-danger",
        onclick: () => {
          if (!confirm(`「${recipe.name}」を削除しますか?\n(記録済みの食事は消えません)`)) return;
          deleteRecipe(id).catch(writeFailed(`レシピ「${recipe.name}」`, "削除"));
          toast("レシピを削除しました");
          leaving = true;
          navigate("#/recipes");
        },
      }, "このレシピを削除"));
    }
    root.replaceChildren(...children);
    drawItems();
    updateTotals();

    // 未保存の変更があるまま画面を離れようとしたら確認する(リンク・下部タブ・戻る操作のどれでも)。
    // 開いた時点との比較なので、元の値に戻した場合は確認しない。食材検索欄への入力は変更に数えない。
    const snapshot = () => JSON.stringify([nameInput.value.trim(), servings(), items.map((it) => [it.foodId, it.grams])]);
    const initial = snapshot();
    setLeaveGuard(() => leaving || snapshot() === initial || confirm("変更が保存されていません。保存せずに移動しますか?\n(OKを押すと入力した内容は破棄されます)"));
  }

  return () => { alive = false; };
}
