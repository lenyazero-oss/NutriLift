// レシピ・セット一覧: 検索と並び替え / 1人前をすぐ記録 / 人前・区分・日付を調整して記録 / 編集・複製・削除
import { el, toast, writeFailed } from "../ui.js";
import { watchRecipes, addMeal, deleteMeal, saveRecipe, deleteRecipe } from "../db.js";
import { recipePortion } from "../nutrients.js";
import { ensureUserData } from "../food-picker.js";
import { displayName, normalize } from "../foods.js";
import { loadRecipeLast, recordRecipeUse } from "../usage.js";
import { navigate } from "../router.js";
import { SLOTS, dateStr, guessSlot } from "../util.js";

const slotLabel = (key) => SLOTS.find((s) => s.key === key)?.label ?? "";
const round1 = (v) => Math.round(v * 10) / 10;

// 並び替え。最近使った順は、食事の記録(直近60日)から決める
const SORTS = [
  { key: "recent", label: "最近使った順" },
  { key: "protein", label: "たんぱく質順" },
  { key: "kcal", label: "低カロリー順" },
];

// 1人前の栄養の1行(レシピ作成画面の固定バーと同じ並び)
function nutritionLine(n) {
  return `1人前 ${Math.round(n.kcal || 0)}kcal ・ P ${(n.protein || 0).toFixed(1)}g ・ F ${(n.fat || 0).toFixed(1)}g ・ C ${(n.carb || 0).toFixed(1)}g ・ 食物繊維 ${(n.fiber || 0).toFixed(1)}g`;
}

// 食材を「いちご100g、卵50g」のように1行にする(長いときは画面側で省略表示)
function itemsLine(recipe) {
  return (recipe.items || []).map((it) => `${displayName(it)}${Math.round(it.grams)}g`).join("、");
}

// レシピの portions 人前を食事として記録する(記録時点の栄養素と、食材の内訳を保存)
function recordRecipe(recipe, portions, date, slot) {
  const p = recipePortion(recipe, portions);
  const ratio = portions / (recipe.servings || 1);
  const meal = {
    date, slot, foodId: null, source: "recipe", recipeId: recipe.id, name: recipe.name,
    grams: p.grams, qtyText: `${portions}人前`, nutrients: p.nutrients,
    // 記録時の内訳(あとでレシピを編集しても、この記録の内訳は変わらない)
    items: (recipe.items || []).map((it) => ({ foodId: it.foodId ?? null, source: it.source ?? null, name: it.name, grams: round1(it.grams * ratio) })),
  };
  const saveError = writeFailed(`${recipe.name} の記録`);
  try {
    const { id, done } = addMeal(meal);
    done.catch(saveError);
    recordRecipeUse(recipe.id, date); // 「最近使った順」に反映する(読み直さない)
    toast(`${recipe.name} を${slotLabel(slot)}に追加しました`, {
      duration: 6000,
      action: {
        label: "取り消し",
        onClick: () => deleteMeal(id).catch(() => toast("取り消せませんでした。", { error: true })),
      },
    });
  } catch {
    saveError();
  }
}

// 複製: 「◯◯のコピー」を作る。作ったあと、すぐ編集に進める
function duplicateRecipe(recipe) {
  const { id, createdAt, updatedAt, ...rest } = recipe; // eslint-disable-line no-unused-vars
  const name = `${recipe.name.slice(0, 30)}のコピー`; // 名前が長くても「のコピー」が切れない
  try {
    const r = saveRecipe(null, { ...rest, name });
    r.done.catch(writeFailed(`レシピ「${name}」の複製`));
    toast(`「${name}」を作りました`, { duration: 6000, action: { label: "編集する", onClick: () => navigate(`#/recipe/${encodeURIComponent(r.id)}`) } });
  } catch {
    toast("複製できませんでした。", { error: true });
  }
}

// 削除: 確認のあと消し、「元に戻す」で同じIDに書き戻せる(記録済みの食事は消えない)
function removeRecipe(recipe) {
  if (!confirm(`「${recipe.name}」を削除しますか?\n(記録済みの食事は消えません)`)) return;
  const { id, createdAt, updatedAt, ...data } = recipe; // eslint-disable-line no-unused-vars
  deleteRecipe(id).catch(writeFailed(`レシピ「${recipe.name}」`, "削除"));
  toast(`「${recipe.name}」を削除しました`, {
    duration: 6000,
    action: { label: "元に戻す", onClick: () => saveRecipe(id, data).done.catch(() => toast("元に戻せませんでした。", { error: true })) },
  });
}

// st: レシピIDごとの画面の状態。一覧を描き直しても、開いたパネルや入力途中の値を残す
function recipeCard(recipe, st) {
  const one = recipePortion(recipe, 1);
  const panel = el("div", { class: "adjust", hidden: !st.panelOpen });
  let adjustBtn; // 下で生成(記録ボタンからも参照するため先に宣言)

  // 調整パネル(人前・区分・日付)
  let portions = st.portions ?? 1;
  let slot = st.slot ?? guessSlot();
  const portionInput = el("input", {
    type: "number", inputmode: "decimal", min: "0", step: "any", value: String(portions), "aria-label": "人前",
  });
  // portions は常に「直近の有効な値」。入力途中の不正値では更新しない
  portionInput.addEventListener("input", () => {
    const v = parseFloat(portionInput.value);
    if (v > 0) { portions = v; st.portions = v; }
  });
  portionInput.addEventListener("blur", () => { portionInput.value = String(portions); });
  portionInput.addEventListener("focus", () => portionInput.select());
  const step = (delta) => () => {
    const current = parseFloat(portionInput.value) > 0 ? parseFloat(portionInput.value) : portions;
    portions = Math.max(0.5, Math.round((current + delta) * 10) / 10);
    st.portions = portions;
    portionInput.value = String(portions);
  };
  const slotBtns = SLOTS.map((s) => {
    const b = el("button", { type: "button", class: "seg" }, s.label);
    b.dataset.key = s.key;
    b.addEventListener("click", () => { slot = s.key; st.slot = slot; paint(); });
    return b;
  });
  const paint = () => slotBtns.forEach((b) => {
    const on = b.dataset.key === slot;
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", String(on));
  });
  paint();
  const dateInput = el("input", { type: "date", value: st.date ?? dateStr(), "aria-label": "日付" });
  dateInput.addEventListener("change", () => { st.date = dateInput.value; });
  const goBtn = el("button", { type: "button", class: "btn btn-primary" }, "この内容で記録する");
  goBtn.addEventListener("click", () => {
    if (!(portions > 0)) return toast("人前を入力してください");
    if (!dateInput.value) return toast("日付を入力してください");
    recordRecipe(recipe, portions, dateInput.value, slot);
    panel.hidden = true;
    st.panelOpen = false;
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

  // 区分は押した時点の時刻で決める(境目は設定で変えられる。結果はトーストに表示)。連打による二重記録を防ぐため一定時間無効化。
  const quick = el("button", { type: "button", class: "btn btn-big btn-primary" }, "1人前をすぐ記録");
  quick.addEventListener("click", () => {
    recordRecipe(recipe, 1, dateStr(), guessSlot());
    quick.disabled = true;
    setTimeout(() => (quick.disabled = false), 1500);
  });

  adjustBtn = el("button", { type: "button", class: "btn", "aria-expanded": String(!!st.panelOpen) }, "人前・区分を調整して記録");
  adjustBtn.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    st.panelOpen = !panel.hidden;
    adjustBtn.setAttribute("aria-expanded", String(!panel.hidden));
  });

  // 編集・複製・削除をまとめたメニュー(「⋯」で開く)
  const menu = el("div", { class: "card-menu", hidden: !st.menuOpen },
    el("a", { class: "menu-item", href: `#/recipe/${encodeURIComponent(recipe.id)}` }, "編集"),
    el("button", { type: "button", class: "menu-item", onclick: () => duplicateRecipe(recipe) }, "複製"),
    el("button", { type: "button", class: "menu-item menu-danger", onclick: () => removeRecipe(recipe) }, "削除…"));
  const menuBtn = el("button", { type: "button", class: "menu-btn", "aria-label": `${recipe.name}のメニュー`, "aria-expanded": String(!!st.menuOpen) }, "⋯");
  menuBtn.addEventListener("click", () => {
    menu.hidden = !menu.hidden;
    st.menuOpen = !menu.hidden;
    menuBtn.setAttribute("aria-expanded", String(!menu.hidden));
  });

  return el("section", { class: "card recipe" },
    el("div", { class: "slot-head recipe-head" }, el("h2", {}, recipe.name), menuBtn),
    menu,
    el("div", { class: "recipe-items" }, itemsLine(recipe) || "食材がありません"),
    el("div", { class: "meal-sub" }, nutritionLine(one.nutrients)),
    el("div", { class: "meal-sub" }, `${recipe.servings}人前分${recipe.totalWeight > 0 ? ` ・ 完成 ${recipe.totalWeight}g` : ""}`),
    quick, adjustBtn, panel);
}

export function renderRecipes(root) {
  let alive = true;
  let recipes = null; // null=読み込み中
  let last = new Map(); // レシピID → 最後に記録した日
  const cardState = new Map(); // レシピID → カードの画面の状態(recipeCard の st)
  let query = "";
  let sort = "recent";
  try { const s = localStorage.getItem("recipeSort"); if (SORTS.some((x) => x.key === s)) sort = s; } catch { /* 毎回「最近使った順」 */ }

  const intro = el("p", { class: "hint" }, "よく食べる組み合わせを登録すると、1タップで記録できます。今日の画面の「この食事をセットに保存」からも作れます。");
  const list = el("div", {}, el("p", { class: "hint" }, "読み込み中…"));
  const notice = el("p", { class: "error", role: "alert", hidden: true });
  const search = el("input", { type: "search", placeholder: "レシピ名で検索", enterkeyhint: "search", autocomplete: "off", "aria-label": "レシピ名で検索" });
  search.addEventListener("input", () => { query = search.value.trim(); draw(); });
  const sortBox = el("div", { class: "segs sort-segs", role: "group", "aria-label": "並び替え(最近使った順、たんぱく質が多い順、カロリーが低い順)" });

  function drawSort() {
    sortBox.replaceChildren(...SORTS.map((s) => {
      const b = el("button", { type: "button", class: `seg${sort === s.key ? " on" : ""}`, "aria-pressed": String(sort === s.key) }, s.label);
      b.addEventListener("click", () => {
        sort = s.key;
        try { localStorage.setItem("recipeSort", sort); } catch { /* 保存できなくても並び替えは有効 */ }
        drawSort();
        draw();
      });
      return b;
    }));
  }

  // 検索(ひらがな/カタカナ・全角半角を区別しない)→ 並び替え
  function visible() {
    const q = normalize(query);
    const rows = recipes.filter((r) => !q || normalize(r.name).includes(q));
    const nut = (r) => recipePortion(r, 1).nutrients;
    const byName = (a, b) => String(a.name).localeCompare(String(b.name), "ja");
    if (sort === "protein") rows.sort((a, b) => (nut(b).protein || 0) - (nut(a).protein || 0) || byName(a, b));
    else if (sort === "kcal") rows.sort((a, b) => (nut(a).kcal || 0) - (nut(b).kcal || 0) || byName(a, b));
    else rows.sort((a, b) => (last.get(b.id) || "").localeCompare(last.get(a.id) || "") || byName(a, b));
    return rows;
  }

  function draw() {
    if (!recipes) return;
    intro.hidden = recipes.length > 0; // 登録済みなら、使い方の説明は出さない
    const rows = visible();
    list.replaceChildren(
      ...(!recipes.length
        ? [el("p", { class: "empty" }, "まだレシピがありません。よく作る食材の組み合わせを登録すると、1タップで記録できます。")]
        : !rows.length ? [el("p", { class: "empty" }, "見つかりませんでした")]
        : rows.map((r) => { if (!cardState.has(r.id)) cardState.set(r.id, {}); return recipeCard(r, cardState.get(r.id)); })));
  }

  root.append(
    el("h1", {}, "レシピ・セット"),
    intro,
    el("a", { class: "btn btn-big", href: "#/recipe/new" }, "＋ レシピ・セットを作る"),
    el("section", { class: "card" }, search, sortBox),
    notice, list);
  drawSort();

  const unwatch = watchRecipes(
    (data) => {
      if (!alive) return;
      notice.hidden = true;
      recipes = data;
      draw();
    },
    () => {
      if (!alive) return;
      notice.textContent = "レシピを読み込めませんでした。通信状況を確認してください。";
      notice.hidden = false;
    }
  );
  // 最近使った順(食事の記録から集計)と、食材の表示名。届いたら並びと表示を更新する
  loadRecipeLast().then((m) => { if (alive) { last = m; draw(); } }).catch(() => {});
  ensureUserData().then(() => { if (alive) draw(); }).catch(() => {});

  return () => { alive = false; unwatch(); };
}
