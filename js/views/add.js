// 食事追加: 食材検索 → グラム、または 単位×数量 → 記録
import { el, toast, writeFailed } from "../ui.js";
import { loadFoods, searchFoods, unitsFor } from "../foods.js";
import { ensureUserData } from "../food-picker.js";
import { addMeal, deleteMeal } from "../db.js";
import { setRefreshBlocker } from "../router.js";
import { shownNutrients, scale, formatValue } from "../nutrients.js";
import { SLOTS, dateStr, isValidDate, guessSlot } from "../util.js";

export function renderAdd(root, { query }) {
  let date = isValidDate(query.date) ? query.date : dateStr();
  let slot = SLOTS.some((s) => s.key === query.slot) ? query.slot : guessSlot();
  let selected = null;
  // 日付をまたいでも、食材を選んだり検索語を入力している間は画面を描き直さない
  setRefreshBlocker(() => selected !== null || search.value.trim() !== "");

  const back = el("a", { class: "back", href: `#/today?date=${date}` }, "← 今日の画面へ");
  const dateInput = el("input", { type: "date", value: date, "aria-label": "日付" });
  dateInput.addEventListener("change", () => {
    if (isValidDate(dateInput.value)) {
      date = dateInput.value;
      back.href = `#/today?date=${date}`;
    }
  });

  // 食事区分(朝/昼/夜/間食)
  const slotBtns = SLOTS.map((s) => {
    const b = el("button", { type: "button", class: "seg" }, s.label);
    b.addEventListener("click", () => {
      slot = s.key;
      paintSlots();
    });
    b.dataset.key = s.key;
    return b;
  });
  const paintSlots = () =>
    slotBtns.forEach((b) => {
      const on = b.dataset.key === slot;
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", String(on));
    });
  paintSlots();

  const status = el("p", { class: "hint" }, "食材データを読み込み中…");
  const search = el("input", {
    type: "search", placeholder: "食材名で検索(例: 鶏むね、卵)", enterkeyhint: "search",
    autocomplete: "off", "aria-label": "食材検索", disabled: true,
  });
  const results = el("ul", { class: "list" });
  const formArea = el("div");

  search.addEventListener("input", () => {
    selected = null;
    formArea.replaceChildren();
    showResults();
  });

  function showResults() {
    results.replaceChildren();
    const q = search.value.trim();
    if (!q) return;
    const hits = searchFoods(q);
    if (!hits.length) {
      results.append(el("li", { class: "empty" }, "見つかりませんでした"));
      return;
    }
    hits.forEach((f) => {
      const btn = el("button", { type: "button", class: "list-item" },
        el("span", { class: "name" }, f.name),
        el("span", { class: "meta" },
          `${f.source === "custom" ? "自作 ・ " : ""}たんぱく質 ${(f.n.protein ?? 0).toFixed(1)}g / ${Math.round(f.n.kcal ?? 0)}kcal(100g)`));
      btn.addEventListener("click", () => select(f));
      results.append(el("li", {}, btn));
    });
  }

  function select(food) {
    selected = food;
    results.replaceChildren();
    search.value = food.name;
    search.blur(); // キーボードを閉じてから量の入力へ
    formArea.replaceChildren(buildForm(food));
    formArea.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  function buildForm(food) {
    const units = unitsFor(food);
    const unitSel = el("select", { "aria-label": "単位" },
      el("option", { value: "g" }, "グラム (g)"),
      units.map((u, i) => el("option", { value: String(i) }, `${u.name} (${u.g}g)`)));
    const qty = el("input", { type: "number", inputmode: "decimal", min: "0", step: "any", value: "100", "aria-label": "量" });
    const preview = el("div", { class: "preview", "aria-live": "polite" });
    const saveBtn = el("button", { type: "button", class: "btn btn-big btn-primary" }, "記録する");

    const grams = () => {
      const q = parseFloat(qty.value);
      if (!(q > 0)) return 0;
      return unitSel.value === "g" ? q : q * units[Number(unitSel.value)].g;
    };
    const update = () => {
      const g = grams();
      preview.replaceChildren(
        el("div", { class: "preview-g" }, g > 0 ? `${Math.round(g * 10) / 10} g` : "量を入力してください"),
        g > 0 ? el("div", { class: "preview-n" },
          shownNutrients().map((d) => el("span", {}, `${d.label} ${formatValue(d, scale(food.n, g)[d.key])}`))) : null);
      saveBtn.disabled = !(g > 0);
    };
    unitSel.addEventListener("change", () => {
      qty.value = unitSel.value === "g" ? "100" : "1";
      update();
    });
    qty.addEventListener("input", update);
    qty.addEventListener("focus", () => qty.select()); // 初期値を上書き入力しやすくする

    saveBtn.addEventListener("click", () => {
      const g = grams();
      if (!(g > 0)) return;
      const q = parseFloat(qty.value);
      const qtyText = unitSel.value === "g" ? `${q}g` : `${q}${units[Number(unitSel.value)].name}`;
      // 記録時点の栄養素をスナップショットとして保存(後で食材データが変わっても影響しない)
      const meal = {
        date, slot, foodId: food.id, source: food.source, name: food.name,
        grams: Math.round(g * 10) / 10, qtyText, nutrients: scale(food.n, g),
      };
      // オフライン時は応答が返らないため await しない
      const saveError = writeFailed(`${food.name} の記録`);
      try {
        const { id, done } = addMeal(meal);
        done.catch(saveError);
        toast(`${food.name} を記録しました`, {
          action: {
            label: "元に戻す",
            onClick: () => deleteMeal(id).catch(() => toast("取り消せませんでした。", { error: true })),
          },
        });
      } catch {
        saveError();
        return;
      }
      selected = null;
      search.value = "";
      formArea.replaceChildren();
      // キーボードを出さない(トーストと結果を見やすくするため)。次の食材は検索欄をタップして入力
    });

    update();
    return el("section", { class: "card" },
      el("h2", {}, food.name),
      el("div", { class: "row2" }, qty, unitSel),
      units.length ? null : el("p", { class: "hint" }, "この食材にはまだ単位がありません(グラムのみ)。"),
      preview, saveBtn);
  }

  root.append(
    back,
    el("h1", {}, "食事を追加"),
    el("section", { class: "card" },
      el("label", { class: "lbl" }, "日付", dateInput),
      el("div", { class: "lbl" }, "食事区分", el("div", { class: "segs", role: "group", "aria-label": "食事区分" }, slotBtns))),
    status, search, results, formArea
  );

  // データ読み込み。Firestore(自作食材・単位)が失敗しても成分表の検索は使えるようにする
  (async () => {
    try {
      await loadFoods();
    } catch (e) {
      status.textContent = `食材データを読み込めません: ${e.message}`;
      status.className = "error";
      return;
    }
    // 成分表が読めた時点で検索を有効にする(Firestoreの取得は待たない)
    status.hidden = true;
    search.disabled = false;
    search.focus();
    try {
      await ensureUserData(); // 食材マスタと共通のキャッシュ(編集時に無効化される)
      if (search.value.trim() && !selected) showResults(); // 取得前に入力された検索を更新
    } catch (e) {
      status.hidden = false;
      status.textContent = "自作食材と単位の設定を読み込めませんでした(成分表の食材は検索できます)。";
    }
  })();
}
