// レシピ一覧: 1タップで記録 / 人前・区分・日付を調整して記録 / 編集
import { el, toast } from "../ui.js";
import { watchRecipes, addMeal, deleteMeal } from "../db.js";
import { recipePortion } from "../nutrients.js";
import { SLOTS, dateStr, guessSlot } from "../util.js";

const slotLabel = (key) => SLOTS.find((s) => s.key === key)?.label ?? "";

// レシピの portions 人前を食事として記録する(記録時点の栄養素を保存)
function recordRecipe(recipe, portions, date, slot) {
  const p = recipePortion(recipe, portions);
  const meal = {
    date, slot, foodId: null, source: "recipe", recipeId: recipe.id, name: recipe.name,
    grams: p.grams, qtyText: `${portions}人前`, nutrients: p.nutrients,
  };
  const saveError = () =>
    toast("保存できませんでした。通信状況を確認して、もう一度お試しください。", { error: true, duration: 6000 });
  try {
    const { id, done } = addMeal(meal);
    done.catch(saveError);
    toast(`${recipe.name} を${slotLabel(slot)}に記録しました`, {
      action: {
        label: "元に戻す",
        onClick: () => deleteMeal(id).catch(() => toast("取り消せませんでした。", { error: true })),
      },
    });
  } catch {
    saveError();
  }
}

function recipeCard(recipe) {
  const one = recipePortion(recipe, 1);
  const n = one.nutrients;
  const panel = el("div", { class: "adjust", hidden: true });
  let adjustBtn; // 下で生成(記録ボタンからも参照するため先に宣言)

  // 調整パネル(人前・区分・日付)
  let portions = 1;
  let slot = guessSlot();
  const portionInput = el("input", {
    type: "number", inputmode: "decimal", min: "0", step: "any", value: "1", "aria-label": "人前",
  });
  // portions は常に「直近の有効な値」。入力途中の不正値では更新しない
  portionInput.addEventListener("input", () => {
    const v = parseFloat(portionInput.value);
    if (v > 0) portions = v;
  });
  portionInput.addEventListener("blur", () => { portionInput.value = String(portions); });
  portionInput.addEventListener("focus", () => portionInput.select());
  const step = (delta) => () => {
    const current = parseFloat(portionInput.value) > 0 ? parseFloat(portionInput.value) : portions;
    portions = Math.max(0.5, Math.round((current + delta) * 10) / 10);
    portionInput.value = String(portions);
  };
  const slotBtns = SLOTS.map((s) => {
    const b = el("button", { type: "button", class: "seg" }, s.label);
    b.dataset.key = s.key;
    b.addEventListener("click", () => { slot = s.key; paint(); });
    return b;
  });
  const paint = () => slotBtns.forEach((b) => {
    const on = b.dataset.key === slot;
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", String(on));
  });
  paint();
  const dateInput = el("input", { type: "date", value: dateStr(), "aria-label": "日付" });
  const goBtn = el("button", { type: "button", class: "btn btn-primary" }, "この内容で記録する");
  goBtn.addEventListener("click", () => {
    if (!(portions > 0)) return toast("人前を入力してください");
    if (!dateInput.value) return toast("日付を入力してください");
    recordRecipe(recipe, portions, dateInput.value, slot);
    panel.hidden = true;
    adjustBtn.setAttribute("aria-expanded", "false");
  });
  panel.append(
    el("div", { class: "lbl" }, "人前",
      el("div", { class: "stepper" },
        el("button", { type: "button", class: "step-btn", "aria-label": "0.5人前減らす", onclick: step(-0.5) }, "−"),
        portionInput,
        el("button", { type: "button", class: "step-btn", "aria-label": "0.5人前増やす", onclick: step(0.5) }, "＋"))),
    el("div", { class: "lbl" }, "食事区分", el("div", { class: "segs", role: "group", "aria-label": "食事区分" }, slotBtns)),
    el("label", { class: "lbl" }, "日付", dateInput),
    goBtn);

  // 区分は押した時点の時刻で決める(結果はトーストに表示)。連打による二重記録を防ぐため一定時間無効化。
  const quick = el("button", { type: "button", class: "btn btn-big btn-primary" }, "1人前をすぐ記録");
  quick.addEventListener("click", () => {
    recordRecipe(recipe, 1, dateStr(), guessSlot());
    quick.disabled = true;
    setTimeout(() => (quick.disabled = false), 1500);
  });

  adjustBtn = el("button", { type: "button", class: "btn", "aria-expanded": "false" }, "人前・区分を調整して記録");
  adjustBtn.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    adjustBtn.setAttribute("aria-expanded", String(!panel.hidden));
  });

  return el("section", { class: "card recipe" },
    el("div", { class: "slot-head" },
      el("h2", {}, recipe.name),
      el("a", { class: "edit-link", href: `#/recipe/${encodeURIComponent(recipe.id)}` }, "編集")),
    el("div", { class: "meal-sub" },
      `1人前 ${Math.round(n.kcal || 0)}kcal ・ P ${(n.protein || 0).toFixed(1)}g ・ F ${(n.fat || 0).toFixed(1)}g ・ C ${(n.carb || 0).toFixed(1)}g`),
    el("div", { class: "meal-sub" }, `${recipe.items?.length || 0}品目 ・ ${recipe.servings}人前分`),
    quick, adjustBtn, panel);
}

export function renderRecipes(root) {
  let alive = true;
  const list = el("div", {}, el("p", { class: "hint" }, "読み込み中…"));
  const notice = el("p", { class: "error", role: "alert", hidden: true });

  root.append(
    el("h1", {}, "レシピ"),
    el("a", { class: "btn btn-big", href: "#/recipe/new" }, "＋ レシピを作る"),
    notice, list);

  const unwatch = watchRecipes(
    (recipes) => {
      if (!alive) return;
      notice.hidden = true;
      list.replaceChildren(
        ...(recipes.length
          ? recipes.map(recipeCard)
          : [el("p", { class: "empty" }, "まだレシピがありません。よく作る食材の組み合わせを登録すると、1タップで記録できます。")]));
    },
    () => {
      if (!alive) return;
      notice.textContent = "レシピを読み込めませんでした。通信状況を確認してください。";
      notice.hidden = false;
    }
  );
  return () => { alive = false; unwatch(); };
}
