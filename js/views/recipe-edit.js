// レシピの作成・編集: 名前、何人前できるか、完成重量(任意)、食材(グラムか単位で入力)
// 栄養サマリーと保存ボタンは画面下部(タブの上)に固定して、食材が増えても隠れないようにする。
import { el, toast, writeFailed } from "../ui.js";
import { createFoodPicker, ensureUserData } from "../food-picker.js";
import { loadFoods, findFood, unitsFor, displayName } from "../foods.js";
import { getRecipe, saveRecipe, deleteRecipe } from "../db.js";
import { navigate, setLeaveGuard } from "../router.js";
import { recipePortion, itemsWeight } from "../nutrients.js";
import { swipeToDelete } from "../swipe.js";

const round1 = (v) => Math.round(v * 10) / 10;
const STEP_G = 10; // 「−10g / ＋10g」の刻み

export function renderRecipeEdit(root, { args }) {
  const id = args[0] && args[0] !== "new" ? args[0] : null;
  let alive = true;
  let leaving = false; // 保存・削除のあとは確認なしで移動する
  let picker = null;
  let observer = null;

  root.append(el("a", { class: "back", href: "#/recipes" }, "← レシピ一覧"), el("p", { class: "hint" }, "読み込み中…"));

  // 食材の単位(個・スコープなど)を使うため、食材データを先に読む。読めなくてもグラムでは編集できる
  const prepare = (async () => {
    try { await loadFoods(); await ensureUserData(); } catch { /* 単位なしで続ける */ }
  })();

  if (!id) {
    prepare.then(() => alive && start({ name: "", servings: 1, items: [] }));
  } else {
    Promise.all([getRecipe(id), prepare]).then(
      ([r]) => {
        if (!alive) return;
        if (!r) return fail("レシピが見つかりません。");
        start(r); // ここでの例外は通信エラーではないので、読み込みの失敗として扱わない
      },
      () => alive && fail("レシピを読み込めませんでした。通信状況を確認してください。"));
  }

  function fail(message) {
    root.replaceChildren(
      el("a", { class: "back", href: "#/recipes" }, "← レシピ一覧"),
      el("p", { class: "error", role: "alert" }, message));
  }

  function start(recipe) {
    // _unit は画面だけの状態(保存しない): null=グラム、数値=その食材の単位の番号
    const items = (recipe.items || []).map((it) => ({ ...it, _unit: null }));
    let servings = recipe.servings > 0 ? recipe.servings : 1;

    const unitsOf = (it) => { const f = findFood(it.foodId, it.source); return f ? unitsFor(f) : []; };

    const nameInput = el("input", {
      type: "text", value: recipe.name || "", placeholder: "レシピ名(例: 鶏むねのサラダ)",
      maxlength: "40", "aria-label": "レシピ名",
    });
    nameInput.addEventListener("input", () => updateAll());

    // 何人前できるか(0.5刻み、最小0.5)
    const servingsOut = el("output", { class: "stepper-value", "aria-live": "polite" });
    const stepServings = (delta) => () => {
      servings = Math.max(0.5, round1(servings + delta));
      updateAll();
    };
    const minusServings = el("button", { type: "button", class: "step-btn", "aria-label": "0.5人前減らす", onclick: stepServings(-0.5) }, "−");
    const servingsStepper = el("div", { class: "stepper", role: "group", "aria-label": "何人前できるか" },
      minusServings,
      servingsOut,
      el("button", { type: "button", class: "step-btn", "aria-label": "0.5人前増やす", onclick: stepServings(0.5) }, "＋"));

    // 完成重量(任意)。鍋の総重量など。未入力なら食材の合計を使う
    const weightInput = el("input", {
      type: "number", inputmode: "decimal", min: "0.1", max: "1000000000", step: "any", placeholder: "例: 900",
      value: recipe.totalWeight > 0 ? String(recipe.totalWeight) : "", "aria-label": "完成重量(g)",
    });
    weightInput.addEventListener("focus", () => weightInput.select());
    weightInput.addEventListener("input", () => updateAll());
    const weightHint = el("p", { class: "hint", "aria-live": "polite" });
    const totalWeightValue = () => {
      const v = parseFloat(weightInput.value);
      return v > 0 ? v : 0;
    };

    const itemList = el("ul", { class: "meals" });

    // ---- 食材の1行: 名前 / −10g・量・単位・＋10g / グラム換算。左スワイプで外す ----
    function itemRow(it) {
      const units = unitsOf(it);
      const unit = () => (it._unit != null ? units[it._unit] ?? null : null);
      const shown = () => (unit() ? round1(it.grams / unit().g) : it.grams);
      const qty = el("input", {
        type: "number", inputmode: "decimal", min: "0", step: "any", value: String(shown()),
        class: "qty-input", "aria-label": `${displayName(it)}の量`,
      });
      qty.addEventListener("focus", () => qty.select());
      const note = el("div", { class: "item-gnote" });
      const refresh = () => { note.textContent = unit() ? `= ${round1(it.grams)}g` : ""; };
      qty.addEventListener("input", () => {
        const v = parseFloat(qty.value);
        it.grams = v > 0 ? (unit() ? v * unit().g : v) : 0;
        refresh();
        updateAll();
      });
      const unitSel = el("select", { class: "unit-select", "aria-label": `${displayName(it)}の単位` },
        el("option", { value: "g" }, "g"),
        units.map((u, k) => el("option", { value: String(k) }, u.name)));
      unitSel.value = it._unit != null ? String(it._unit) : "g";
      unitSel.addEventListener("change", () => {
        it._unit = unitSel.value === "g" ? null : Number(unitSel.value);
        qty.value = String(shown());
        refresh();
        labelSteps();
      });
      // 刻み: グラムなら ±10g、単位(個・スコープなど)なら ±0.5。ラベルも合わせて変える
      const stepGrams = () => (unit() ? unit().g * 0.5 : STEP_G);
      const stepLabel = () => (unit() ? "0.5" : `${STEP_G}g`);
      const bump = (dir) => () => {
        it.grams = Math.max(0, round1(it.grams + dir * stepGrams()));
        qty.value = String(shown());
        refresh();
        updateAll();
      };
      const minus = el("button", { type: "button", class: "step-btn g-step", onclick: bump(-1) });
      const plus = el("button", { type: "button", class: "step-btn g-step", onclick: bump(1) });
      function labelSteps() {
        minus.textContent = `−${stepLabel()}`;
        plus.textContent = `＋${stepLabel()}`;
        minus.setAttribute("aria-label", `${displayName(it)}を${stepLabel()}${unit() ? unit().name : ""}減らす`);
        plus.setAttribute("aria-label", `${displayName(it)}を${stepLabel()}${unit() ? unit().name : ""}増やす`);
      }
      refresh();
      labelSteps();

      const fg = el("div", { class: "swipe-fg item-fg" },
        el("div", { class: "item-name" }, displayName(it)),
        el("div", { class: "item-controls" }, minus, qty, unitSel, plus),
        note,
        // スワイプができない人(読み上げ・スイッチ操作)向け。画面には出さず、フォーカスしたときだけ見える
        el("button", { type: "button", class: "sr-only", onclick: () => removeItem(it) }, `${displayName(it)}を外す`));
      const box = el("div", { class: "swipe-box" },
        el("div", { class: "swipe-bg", "aria-hidden": "true" }, el("span", { class: "s-off" }, "← 外す"), el("span", { class: "s-on" }, "離すと外す")),
        fg);
      swipeToDelete(box, fg, () => removeItem(it));
      return el("li", { class: "meal-wrap" }, box);
    }

    function drawItems() {
      itemList.replaceChildren(...(items.length
        ? items.map(itemRow)
        : [el("li", { class: "empty" }, "まだ食材がありません。下の検索から追加してください。")]));
    }

    function removeItem(it) {
      const index = items.indexOf(it);
      if (index < 0) return;
      items.splice(index, 1);
      drawItems();
      updateAll();
      toast(`${displayName(it)} を外しました`, {
        duration: 6000,
        action: {
          label: "元に戻す",
          onClick: () => { if (alive) { items.splice(Math.min(index, items.length), 0, it); drawItems(); updateAll(); } },
        },
      });
    }

    // ---- 食材の追加(あいまい検索。フォーカスで「最近」「よく使う」) ----
    picker = createFoodPicker({
      placeholder: "食材を検索して追加",
      quick: true,
      onPick: (food) => {
        // 単位があれば先頭の単位1つ分(例: 卵 1個)、なければ100gを初期値にする
        const units = unitsFor(food);
        items.push({
          foodId: food.id, source: food.source, name: food.name,
          grams: units[0] ? units[0].g : 100, n: { ...food.n }, _unit: units[0] ? 0 : null,
        });
        drawItems();
        updateAll();
        toast(`${displayName(food)} を追加しました`);
      },
    });

    // ---- 下部に固定: 1人前の栄養 / 保存できない理由 / 保存ボタン ----
    const summaryLine = el("div", { class: "fixed-summary", "aria-live": "polite" });
    const reasonLine = el("p", { class: "fixed-reason", role: "status" });
    const saveBtn = el("button", { type: "button", class: "btn btn-primary" }, "保存する");
    const bar = el("div", { class: "fixed-bar" },
      el("div", { class: "fixed-bar-inner" }, summaryLine, reasonLine, saveBtn));

    // 保存できない理由(なければ空)
    function problem() {
      if (!nameInput.value.trim()) return "レシピ名を入力してください";
      if (!items.length) return "食材を1つ以上追加してください";
      // 保存時は小数1桁に丸めるので、丸めたあとの値で判定する(0.04g は 0g になる)
      const zero = items.find((it) => !(round1(it.grams) > 0 && it.grams <= 1e9));
      if (zero) return `「${displayName(zero)}」の量が0か、大きすぎます`;
      if (weightInput.value.trim() !== "" && !(parseFloat(weightInput.value) >= 0.1 && parseFloat(weightInput.value) <= 1e9)) return "完成重量は0.1g以上で入力してください";
      return "";
    }

    function updateAll() {
      servingsOut.textContent = `${servings}人前`;
      minusServings.disabled = servings <= 0.5;
      const total = itemsWeight(items);
      const tw = totalWeightValue();
      const draft = { servings, items, totalWeight: tw };
      const p = recipePortion(draft, 1);
      weightHint.textContent = tw > 0
        ? `1人前 約${Math.round(p.grams)}g(完成重量 ${tw}g ÷ ${servings})`
        : `未入力なら食材の合計 ${Math.round(total)}g を使います${items.length ? `(1人前 約${Math.round(p.grams)}g)` : ""}`;
      const n = p.nutrients;
      summaryLine.replaceChildren(items.length
        ? el("div", {},
          el("strong", {}, `1人前 ${Math.round(n.kcal || 0)}kcal`),
          el("span", { class: "fixed-pfc" },
            ` P ${(n.protein || 0).toFixed(1)} ・ F ${(n.fat || 0).toFixed(1)} ・ C ${(n.carb || 0).toFixed(1)} ・ 食物繊維 ${(n.fiber || 0).toFixed(1)}g`))
        : el("div", { class: "fixed-hint" }, "食材を追加すると、1人前の栄養が出ます"));
      const why = problem();
      reasonLine.textContent = why ? `！${why}` : "";
      reasonLine.hidden = !why;
      saveBtn.disabled = !!why;
    }

    saveBtn.addEventListener("click", () => {
      if (problem()) return;
      const tw = totalWeightValue();
      const data = {
        name: nameInput.value.trim(),
        servings,
        // 画面だけの _unit は保存しない
        items: items.map(({ _unit, ...it }) => ({ ...it, grams: round1(it.grams) })), // eslint-disable-line no-unused-vars
        totalWeight: tw > 0 ? tw : null, // null は保存時に項目の削除になる
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
        el("div", { class: "lbl" }, "何人前できる?", servingsStepper),
        el("label", { class: "lbl" }, "完成重量(g・任意)", weightInput),
        el("p", { class: "hint" }, "煮物など、できあがりを量った重さ。入れると、1人前の量を正確に出せます。"),
        weightHint),
      // 追加の検索欄を、食材の一覧の上に置く(食材が増えても、検索欄を探してスクロールしなくてよい)
      el("section", { class: "card" }, el("h2", {}, "食材を追加"), picker.node),
      el("section", { class: "card" },
        el("h2", {}, "食材"),
        el("p", { class: "hint" }, "食材は左にスワイプで外せます。"),
        itemList),
    ];
    if (id) {
      children.push(el("button", {
        type: "button", class: "btn btn-danger btn-far",
        onclick: () => {
          if (!confirm(`「${recipe.name}」を削除しますか?\n(記録済みの食事は消えません)`)) return;
          deleteRecipe(id).catch(writeFailed(`レシピ「${recipe.name}」`, "削除"));
          toast("レシピを削除しました");
          leaving = true;
          navigate("#/recipes");
        },
      }, "このレシピを削除"));
    }
    children.push(bar);
    root.replaceChildren(...children);
    drawItems();
    updateAll();

    // 固定バーの高さに合わせて、本文の下の余白とトーストの位置を確保する(食材が増えても保存ボタンが隠れない)
    const setBarHeight = () => document.documentElement.style.setProperty("--bar-h", `${bar.offsetHeight}px`);
    setBarHeight();
    if (typeof ResizeObserver === "function") {
      observer = new ResizeObserver(setBarHeight);
      observer.observe(bar);
    }

    // 未保存の変更があるまま画面を離れようとしたら確認する(リンク・下部タブ・戻る操作のどれでも)。
    // 開いた時点との比較なので、元の値に戻した場合は確認しない。食材検索欄への入力は変更に数えない。
    const snapshot = () => JSON.stringify([
      nameInput.value.trim(), servings, totalWeightValue(), items.map((it) => [it.foodId, round1(it.grams)]),
    ]);
    const initial = snapshot();
    setLeaveGuard(() => leaving || snapshot() === initial || confirm("変更が保存されていません。保存せずに移動しますか?\n(OKを押すと入力した内容は破棄されます)"));
  }

  return () => {
    alive = false;
    picker?.destroy();
    observer?.disconnect();
    document.documentElement.style.removeProperty("--bar-h");
  };
}
