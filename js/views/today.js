// 今日の画面: 日付移動、目標に対する達成バー、朝/昼/夜/間食ごとの記録一覧
import { el, toast, writeFailed } from "../ui.js";
import { watchMeals, getGoals, deleteMeal, restoreMeal, getMealsOn, updateMeal, getRecipe, watchWeight, saveWeight, deleteWeight } from "../db.js";
import { loadFoods, findFood, unitsFor, displayName } from "../foods.js";
import { ensureUserData } from "../food-picker.js";
import { swipeToDelete } from "../swipe.js";
import { copyMeals, mealsInSlot, mealsToRecipeItems, saveMealsAsSet } from "../copy.js";
import { navigate } from "../router.js";
import { currentUid } from "../auth.js";
import { shownNutrients, DEFAULT_GOALS, sumNutrients, AT_LEAST, scale, formatValue } from "../nutrients.js";
import { suggestProtein } from "../suggest.js";
import { SLOTS, dateStr, shiftDate, isValidDate, guessSlot } from "../util.js";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

function dateLabel(str) {
  const [y, m, d] = str.split("-").map(Number);
  const wd = WEEKDAYS[new Date(y, m - 1, d).getDay()];
  return `${m}月${d}日(${wd})`;
}

// 達成バー。値が目標を超えた場合、「目標以上」が達成の栄養素(たんぱく質・食物繊維)以外は「超過」色にする
// mode: "intake"(摂取量 / 目標) か "remain"(残り量)。棒は常に摂取量の割合を示す。
function bar(def, value, goal, { big = false, mode = "intake" } = {}) {
  const ratio = goal > 0 ? value / goal : 0;
  const atLeast = AT_LEAST.has(def.key);
  const over = ratio > 1 && !atLeast;
  const reached = atLeast && goal > 0 && ratio >= 1; // 「以上」型は届いたら達成を文字でも示す
  const fmt = (v) => `${v.toFixed(def.decimals)}${def.unit}`;
  const fill = el("div", { class: `fill${over ? " over" : ""}`, style: `width:${Math.min(ratio, 1) * 100}%` });
  const track = el("div", {
    class: "track", role: "progressbar", "aria-label": def.label,
    "aria-valuemin": "0", "aria-valuemax": String(goal), "aria-valuenow": String(Math.round(value)),
    ...(reached ? { "aria-valuetext": "目標達成" } : {}),
  }, fill);
  const remain = goal - value;
  if (!big) {
    // 残り量表示: 「以上」型は あと◯ / 達成、「以内」型は 残り◯ / 超過。色だけに頼らず文字でも示す
    const remainText = atLeast
      ? (remain > 0 ? `あと ${fmt(remain)}` : "✓ 達成")
      : (remain >= 0 ? `残り ${fmt(remain)}` : `+${fmt(-remain)} 超過`);
    const nums = mode === "remain" ? (goal > 0 ? remainText : "—") : `${value.toFixed(def.decimals)} / ${goal}${def.unit}`;
    return el("div", { class: "bar" },
      el("div", { class: "bar-head" }, el("span", {}, def.label),
        el("span", { class: `bar-num${mode === "remain" && (over || (reached && atLeast)) ? (over ? " over-text" : " reached-text") : ""}` }, nums)),
      track,
      mode === "intake" && over ? el("div", { class: "over-text" }, `+${fmt(value - goal)} 超過`) : null,
      mode === "intake" && reached ? el("div", { class: "reached-text" }, "✓ 目標達成") : null);
  }
  if (mode === "remain") {
    return el("div", { class: "bar bar-big" },
      el("div", { class: "bar-head" }, el("span", { class: "bar-title" }, def.label)),
      remain > 0
        ? el("div", { class: "big-num" }, "あと ", el("strong", {}, remain.toFixed(def.decimals)), def.unit)
        : el("div", { class: "big-num" }, el("strong", { class: "reached-text-big" }, "✓ 達成")),
      track,
      el("div", { class: "bar-sub" }, remain > 0 ? `目標 ${goal}${def.unit}` : `${fmt(value)} / 目標 ${goal}${def.unit}`));
  }
  return el("div", { class: "bar bar-big" },
    el("div", { class: "bar-head" }, el("span", { class: "bar-title" }, def.label)),
    el("div", { class: "big-num" }, el("strong", {}, value.toFixed(def.decimals)), ` / ${goal}${def.unit}`),
    track,
    el("div", { class: "bar-sub" }, remain > 0 ? `あと ${remain.toFixed(def.decimals)}${def.unit}` : "目標達成"));
}

// PFCバランス: たんぱく質・脂質・炭水化物のカロリー比率(P×4、F×9、C×4)。食べた分が0なら出さない
function pfcBlock(total) {
  const kcal = { p: (total.protein || 0) * 4, f: (total.fat || 0) * 9, c: (total.carb || 0) * 4 };
  const sum = kcal.p + kcal.f + kcal.c;
  if (sum <= 0) return null;
  const pctP = Math.round((kcal.p / sum) * 100);
  const pctF = Math.round((kcal.f / sum) * 100);
  const pct = { p: pctP, f: pctF, c: Math.max(0, 100 - pctP - pctF) }; // 合計が100%になるよう、炭水化物で調整
  const names = { p: "たんぱく質", f: "脂質", c: "炭水化物" };
  return el("div", { class: "pfc" },
    el("div", { class: "pfc-title" }, "PFCバランス(カロリー比)"),
    el("div", { class: "pfc-bar", "aria-hidden": "true" }, // 凡例に同じ内容が文字であるので、読み上げは凡例だけ
      ["p", "f", "c"].map((k) => el("span", { class: `pfc-${k}`, style: `flex:${kcal[k]}` }))),
    el("div", { class: "pfc-legend" },
      ["p", "f", "c"].map((k) => el("span", {}, el("i", { class: `pfc-${k}` }), `${names[k]} ${pct[k]}%`))));
}

// 1食あたりのたんぱく質の目安(g)。これを下回る/上回る食事は「少なめ」「多め」
const MEAL_PROTEIN = { low: 20, high: 40 };
// 表示は整数のグラムなので、判定も整数に丸めた値で行う(19.6g → 「20g」なら「適量」)
const proteinState = (p0) => { const p = Math.round(p0); return (p < MEAL_PROTEIN.low ? ["少なめ", "mp-low"] : p <= MEAL_PROTEIN.high ? ["適量", "mp-good"] : ["多め", "mp-high"]); };

// 食事ごとのたんぱく質の分散。間食は目安の対象にしない
function mealProteinBlock(meals) {
  return el("div", { class: "meal-protein" },
    el("div", { class: "pfc-title" }, `1食あたりのたんぱく質(目安 ${MEAL_PROTEIN.low}〜${MEAL_PROTEIN.high}g)`),
    el("div", { class: "meal-protein-row" }, SLOTS.map((s) => {
      const items = meals.filter((m) => m.slot === s.key);
      const p = sumNutrients(items).protein || 0;
      const judged = s.key !== "snack" && items.length > 0;
      const [state, cls] = judged ? proteinState(p) : ["", ""];
      return el("div", { class: "mp-cell", "aria-label": `${s.label} たんぱく質${items.length ? `${p.toFixed(0)}g ${state}` : "なし"}` },
        s.label,
        el("strong", {}, items.length ? `${p.toFixed(0)}g` : "—"),
        el("div", { class: "mp-track" }, el("div", { class: "mp-fill", style: `width:${Math.min(p / MEAL_PROTEIN.high, 1) * 100}%` })),
        el("span", { class: cls }, state || "\u00a0"));
    })),
    el("div", { class: "hint" }, "間食は目安の対象外です。"));
}

export function renderToday(root, { query }) {
  const date = isValidDate(query.date) ? query.date : dateStr();
  const isToday = date === dateStr();
  const path = (d) => `#/today?date=${d}`;

  let meals = [];
  let goals = { ...DEFAULT_GOALS };
  let loaded = false;
  let alive = true;
  const defs = shownNutrients();

  const summary = el("section", { class: "card summary" });
  const list = el("div");
  const notice = el("p", { class: "error", role: "alert", hidden: true });

  const nav = el("div", { class: "datenav" },
    el("a", { class: "navbtn", href: path(shiftDate(date, -1)), "aria-label": "前の日" }, "‹"),
    el("div", { class: "datelabel" }, dateLabel(date), isToday ? el("span", { class: "chip" }, "今日") : null),
    el("a", { class: "navbtn", href: path(shiftDate(date, 1)), "aria-label": "次の日" }, "›"));
  const toTodayLink = isToday ? null
    : el("a", { class: "btn btn-link center", href: "#/today" }, "今日に戻る");

  // 摂取量 / 残り量の表示。カードのどこをタップしても切り替わり、選択は端末に覚えておく
  let summaryMode = "intake";
  try { if (localStorage.getItem("summaryMode") === "remain") summaryMode = "remain"; } catch { /* 保存できない環境では毎回「摂取量」 */ }
  function setMode(mode, refocus = false) {
    summaryMode = mode;
    try { localStorage.setItem("summaryMode", summaryMode); } catch { /* 保存できなくても切り替えは有効 */ }
    drawSummary();
    if (refocus) summary.querySelector(`[data-mode="${mode}"]`)?.focus(); // 描き直してもフォーカス位置を保つ
  }
  summary.addEventListener("click", () => setMode(summaryMode === "remain" ? "intake" : "remain"));

  function drawSummary() {
    const total = sumNutrients(meals);
    const protein = defs.find((d) => d.key === "protein");
    summary.replaceChildren(
      // キーボード・読み上げ用の切り替えボタン(カードのタップと同じ動作。クリックはカードに伝わる)
      el("div", { class: "mode-row", onclick: (e) => e.stopPropagation() }, // 余白のタップで、カード全体の切替が働かないように
        el("div", { class: "mode-seg", role: "group", "aria-label": "表示の切り替え(カードをタップしても切り替わります)" },
          [["intake", "摂取量"], ["remain", "残り量"]].map(([key, label]) => {
            const b = el("button", { type: "button", class: `mode-btn${summaryMode === key ? " on" : ""}`, "data-mode": key, "aria-pressed": String(summaryMode === key) }, label);
            b.addEventListener("click", (e) => { e.stopPropagation(); setMode(key, true); }); // カード全体の切替と二重にならないように
            return b;
          }))),
      bar(protein, total.protein || 0, goals.protein, { big: true, mode: summaryMode }),
      el("div", { class: "bars" },
        defs.filter((d) => d.key !== "protein").map((d) => bar(d, total[d.key] || 0, goals[d.key] ?? 0, { mode: summaryMode }))),
    );
    refreshSuggest();
  }

  // 体重(1日1件)。入力中の値を、他の更新で上書きしない
  let savedWeight = null;
  const weightInput = el("input", { type: "number", inputmode: "decimal", min: "20", max: "400", step: "0.1", "aria-label": "体重(kg)", placeholder: "例: 65.2" });
  weightInput.addEventListener("focus", () => {
    weightInput.select();
    setTimeout(() => weightBox.scrollIntoView({ block: "center", behavior: "smooth" }), 300); // キーボードに隠れないように
  });
  const weightBtn = el("button", { type: "button", class: "btn btn-primary" }, "記録");
  const weightClear = el("button", { type: "button", class: "btn btn-link", hidden: true }, "削除");
  const weightBox = el("section", { class: "card weight-card" },
    el("h2", {}, "体重"),
    el("div", { class: "weight-row" }, weightInput, el("span", { class: "unit" }, "kg"), weightBtn, weightClear));
  function drawWeight() {
    if (document.activeElement !== weightInput) weightInput.value = savedWeight != null ? String(savedWeight) : "";
    weightBtn.textContent = savedWeight != null ? "更新" : "記録";
    weightClear.hidden = savedWeight == null;
  }
  weightBtn.addEventListener("click", () => {
    const kg = Math.round(parseFloat(weightInput.value) * 10) / 10;
    if (!(kg >= 20 && kg <= 400)) return toast("体重は20〜400kgで入力してください", { error: true });
    try {
      saveWeight(date, kg).catch(writeFailed("体重"));
      weightInput.blur();
      toast(`体重 ${kg}kg を保存しました`);
    } catch {
      toast("保存できませんでした。", { error: true });
    }
  });
  weightInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); weightBtn.click(); } });
  weightClear.addEventListener("click", () => {
    const before = savedWeight;
    deleteWeight(date).catch(writeFailed("体重", "削除"));
    toast("体重の記録を削除しました", {
      duration: 6000,
      action: { label: "元に戻す", onClick: () => { if (before != null) saveWeight(date, before).catch(writeFailed("体重")); } },
    });
  });

  // 食事一覧の下のカード: PFCバランスと1食あたりのたんぱく質。上部カードを短く保ち、1日の記録を先に見せる
  const distBody = el("div");
  const distBox = el("details", { class: "card dist", open: true },
    el("summary", {}, "PFCバランスと1食あたりのたんぱく質"), distBody);
  function drawDist() {
    distBody.replaceChildren(...[pfcBlock(sumNutrients(meals)), mealProteinBlock(meals)].filter(Boolean));
  }

  // 不足分の提案(今日だけ): 残りのたんぱく質を、よく使う食材で補う量。タップでその食材の追加画面へ
  const suggestBox = el("section", { class: "suggest", hidden: true });
  let suggestSeq = 0;
  let suggestKey = ""; // 前回と同じ提案なら、表示を作り直さない(摂取量/残りの切替でちらつかないように)
  let goalsReady = false;
  async function refreshSuggest() {
    const seq = ++suggestSeq;
    const remain = (goals.protein || 0) - (sumNutrients(meals).protein || 0);
    // 目標が届くまでは出さない(初期値の目標で一瞬出てから差し替わるのを防ぐ)
    if (!isToday || !loaded || !goalsReady || !(remain >= 5)) { suggestBox.hidden = true; return; }
    try {
      await loadFoods();
      await ensureUserData().catch(() => {});
      const list = await suggestProtein(remain);
      if (!alive || seq !== suggestSeq) return;
      if (!list.length) { suggestBox.hidden = true; return; }
      const slotKey = guessSlot();
      const key = `${remain.toFixed(0)}|${list.map((s) => s.text).join("|")}`;
      if (key === suggestKey && !suggestBox.hidden) return;
      suggestKey = key;
      const slotName = SLOTS.find((x) => x.key === slotKey)?.label ?? "";
      suggestBox.replaceChildren(
        el("span", { class: "suggest-lead" }, `あと${remain.toFixed(0)}g:`),
        ...list.map((s) =>
          el("a", { class: "suggest-link", href: `#/add?date=${date}&slot=${slotKey}&food=${s.food.source}:${encodeURIComponent(s.food.id)}` }, s.text)),
        el("span", { class: "suggest-note" }, `タップで${slotName}に追加`));
      suggestBox.hidden = false;
    } catch { suggestBox.hidden = true; } // 提案できなくても、画面の他の部分には影響しない
  }

  function removeMeal(m) {
    const { id } = m;
    if (editingId === id) { editingId = null; editPanel = null; } // 「元に戻す」で復活した行が編集モードで開かないように
    const uid = currentUid(); // 取り消し時に同じユーザーか確認するため
    deleteMeal(id).catch(writeFailed(`${displayName(m)} の記録`, "削除"));
    toast(`${displayName(m)} を削除しました`, {
      duration: 6000,
      action: {
        label: "元に戻す",
        onClick: () => restoreMeal(m, uid).catch(() => toast("元に戻せませんでした。", { error: true, duration: 6000 })),
      },
    });
  }

  // 前日(今日を見ているときは「昨日」)の食事。同じ食事区分が空のときにコピーできる。
  // 日付を引数にした作りなので、コピー元を任意の日付にも広げられる
  const prevDate = shiftDate(date, -1);
  const prevLabel = isToday ? "昨日" : "前日";
  let prevMeals = [];

  function copyFromPrev(slotDef, prevItems, btn) {
    if (meals.some((m) => m.slot === slotDef.key)) return toast("この食事にはすでに記録があります"); // 別の端末で先に記録された場合
    btn.disabled = true; // 連打による二重コピーを防ぐ
    const uid = currentUid();
    try {
      const { ids, done } = copyMeals(prevItems, date, slotDef.key);
      done.catch(writeFailed(`${prevLabel}の${slotDef.label}のコピー`));
      toast(`${prevLabel}の${slotDef.label}を${ids.length}品コピーしました`, {
        duration: 6000,
        action: {
          label: "元に戻す",
          onClick: () => {
            if (uid !== currentUid()) return toast("ユーザーが変わったため元に戻せません", { error: true });
            Promise.all(ids.map((id) => deleteMeal(id))).catch(() => toast("元に戻せませんでした。", { error: true, duration: 6000 }));
          },
        },
      });
    } catch {
      btn.disabled = false;
      toast("コピーできませんでした。", { error: true });
    }
  }

  // 食事に記録した食材を、1人前のレシピ(セット)として保存する。名前は入力してもらう
  function saveAsSet(slotDef, items) {
    const input = prompt("セットの名前を入力してください", `${slotDef.label}のセット`);
    if (input === null) return;
    const name = input.trim().slice(0, 40);
    if (!name) return toast("名前を入力してください");
    try {
      const r = saveMealsAsSet(name, items);
      if (!r) return toast("食材から記録した品がないため、セットにできません", { error: true, duration: 5000 });
      r.done.catch(writeFailed(`セット「${name}」`));
      toast(`セット「${name}」を保存しました${r.skipped ? `(レシピから記録した${r.skipped}品は含まれません)` : ""}`, {
        action: { label: "セットを見る", onClick: () => navigate("#/recipes") },
        duration: 6000,
      });
    } catch {
      toast("保存できませんでした。", { error: true });
    }
  }

  // 数量の表記。グラム以外の単位(個・本・人前など)には、グラム換算を併記する(例: 1本(約100g))
  function qtyLabel(m) {
    const q = m.qtyText || `${m.grams}g`;
    return /^[\d.]+\s*g$/.test(q) ? q : `${q}(約${Math.round(m.grams * 10) / 10}g)`;
  }

  // 行をタップすると、その場で量を変更できる。開いている行の ID は、記録の更新で描き直されても覚えておく
  let editingId = null;
  // 操作のヒントは、最初の数回だけ出す(慣れたら邪魔になるため)
  let showHint = true;
  try {
    const count = Number(localStorage.getItem("swipeHintCount") || 0);
    showHint = count < 5;
    localStorage.setItem("swipeHintCount", String(count + 1));
  } catch { /* 保存できない環境では毎回出す */ }
  let editPanel = null; // { id, node }: 描き直しでも入力中のフォームを失わないよう、作ったフォームを使い回す

  // 量の変更フォーム。食材なら グラム/単位×数量、レシピなら人前数。栄養素は食材の100gあたりから計算し直す
  async function buildEditor(m, panel) {
    panel.replaceChildren(el("p", { class: "hint" }, "読み込み中…"));
    const isRecipe = m.source === "recipe";
    let food = null;
    let units = [];
    if (!isRecipe && m.foodId) {
      try { await loadFoods(); await ensureUserData(); } catch { /* 読み込めなくても、グラムでの変更はできる */ }
      food = findFood(m.foodId, m.source);
      units = food ? unitsFor(food) : [];
    }
    // レシピの記録は、食材の内訳を見せる。記録時の内訳があればそれ。ない(過去の)記録は、現在のレシピから出す
    let breakdown = null;
    let fromCurrent = false;
    if (isRecipe) {
      if (Array.isArray(m.items) && m.items.length) breakdown = m.items;
      else if (m.recipeId) {
        try {
          const r = await getRecipe(m.recipeId);
          if (r?.items?.length) {
            const p0 = parseFloat((m.qtyText || "").match(/^([\d.]+)人前$/)?.[1]);
            const ratio = p0 > 0 && r.servings > 0 ? p0 / r.servings : 1;
            breakdown = r.items.map((it) => ({ foodId: it.foodId, source: it.source, name: it.name, grams: Math.round(it.grams * ratio * 10) / 10 }));
            fromCurrent = true;
          }
        } catch { /* 内訳が取れなくても、量の変更はできる */ }
      }
    }
    if (!alive || editingId !== m.id) return;

    // 栄養素は記録時点のスナップショットを量の比で増減する(あとで食材マスタを編集していても、過去の記録の前提は変えない)。
    // 記録が0gなど比にできないときだけ、食材の100gあたりの値を使う
    const snapshot = Object.entries(m.nutrients || {}).filter(([, v]) => Number.isFinite(v));
    const portions0 = isRecipe ? parseFloat((m.qtyText || "").match(/^([\d.]+)人前$/)?.[1]) : NaN;
    const byPortions = isRecipe && portions0 > 0;

    // いまの量を初期値にする: 「150g」→ グラム、「2個」→ その単位、「1.5人前」→ 人前
    let unitIndex = "g";
    let qtyValue = String(Math.round(m.grams * 10) / 10);
    if (byPortions) qtyValue = String(portions0);
    else {
      const match = (m.qtyText || "").match(/^([\d.]+)\s*(.+)$/);
      const idx = match ? units.findIndex((u) => u.name === match[2]) : -1;
      if (match && match[2] !== "g" && idx >= 0) { unitIndex = String(idx); qtyValue = match[1]; }
      else if (match && match[2] === "g") qtyValue = match[1];
    }

    const qty = el("input", { type: "number", inputmode: "decimal", min: "0", step: "any", value: qtyValue, "aria-label": byPortions ? "人前" : "量" });
    qty.addEventListener("focus", () => {
      qty.select();
      setTimeout(() => panel.scrollIntoView({ block: "center", behavior: "smooth" }), 300); // キーボードに保存ボタンが隠れないように
    });
    qty.setAttribute("enterkeyhint", "done");
    qty.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); saveBtn.click(); } });
    const unitSel = byPortions ? null : el("select", { "aria-label": "単位" },
      el("option", { value: "g" }, "グラム (g)"),
      units.map((u, i) => el("option", { value: String(i) }, `${u.name} (${u.g}g)`)));
    if (unitSel) unitSel.value = unitIndex;
    const preview = el("div", { class: "preview", "aria-live": "polite" });
    const saveBtn = el("button", { type: "button", class: "btn btn-primary" }, "量を変更する");

    // 入力から、新しい グラム・表記・栄養素 を計算する(不正なら null)
    const compute = () => {
      const q = parseFloat(qty.value);
      if (!(q > 0)) return null;
      if (byPortions) {
        const ratio = q / portions0;
        return {
          grams: Math.round(m.grams * ratio * 10) / 10, qtyText: `${q}人前`,
          nutrients: Object.fromEntries(Object.entries(m.nutrients || {}).filter(([, v]) => Number.isFinite(v)).map(([k, v]) => [k, Math.round(v * ratio * 100) / 100])),
          ...(Array.isArray(m.items) ? { items: m.items.map((it) => ({ ...it, grams: Math.round(it.grams * ratio * 10) / 10 })) } : {}),
        };
      }
      const unit = unitSel.value === "g" ? null : units[Number(unitSel.value)];
      const g = Math.round((unit ? q * unit.g : q) * 10) / 10;
      if (!(g > 0) || g > 100000) return null;
      let nutrients;
      if (m.grams > 0 && snapshot.length) {
        const ratio = g / m.grams;
        nutrients = Object.fromEntries(snapshot.map(([k, v]) => [k, Math.round(v * ratio * 100) / 100]));
      } else if (food?.n) nutrients = scale(food.n, g);
      else return null;
      return { grams: g, qtyText: unit ? `${q}${unit.name}` : `${q}g`, nutrients };
    };
    const update = () => {
      const r = compute();
      saveBtn.disabled = !r;
      preview.replaceChildren(el("div", { class: "preview-g" }, r ? qtyLabel(r) : "量を入力してください"),
        ...(r ? [el("div", { class: "preview-n" }, shownNutrients().map((d) => el("span", {}, `${d.label} ${formatValue(d, r.nutrients[d.key] || 0)}`)))] : []));
    };
    qty.addEventListener("input", update);
    unitSel?.addEventListener("change", update);

    saveBtn.addEventListener("click", () => {
      const r = compute();
      if (!r) return;
      const before = { grams: m.grams, qtyText: m.qtyText || `${m.grams}g`, nutrients: m.nutrients || {}, items: m.items };
      updateMeal(m.id, r).catch(writeFailed(`${displayName(m)} の量の変更`));
      editingId = null;
      editPanel = null;
      drawList();
      toast(`${displayName(m)} の量を変更しました`, {
        duration: 6000,
        action: { label: "元に戻す", onClick: () => updateMeal(m.id, before).catch(() => toast("元に戻せませんでした。", { error: true, duration: 6000 })) },
      });
    });

    panel.replaceChildren(
      ...(breakdown
        ? [el("div", { class: "breakdown" },
          el("div", { class: "breakdown-title" }, "食材の内訳"),
          el("ul", {}, breakdown.map((it) => el("li", {}, el("span", { class: "breakdown-name" }, displayName(it)), el("span", { class: "breakdown-g" }, `${Math.round(it.grams)}g`)))),
          fromCurrent ? el("p", { class: "hint" }, "この記録には内訳がないため、現在のレシピをもとに表示しています。") : null)]
        : []),
      el("div", { class: "row2" }, qty, ...(unitSel ? [unitSel] : [el("span", { class: "unit" }, "人前")])),
      preview,
      saveBtn,
      el("div", { class: "edit-actions" },
        el("button", { type: "button", class: "btn btn-link edit-delete", onclick: () => { editingId = null; editPanel = null; removeMeal(m); } }, "この記録を削除"),
        el("button", { type: "button", class: "btn btn-link edit-close", onclick: () => { editingId = null; editPanel = null; drawList(); } }, "閉じる")));
    update();
  }

  // 1件の記録。左スワイプで削除(「元に戻す」付き)、タップで量の変更。大きな削除ボタンは置かない
  function mealRow(m) {
    const n = m.nutrients || {};
    const open = editingId === m.id;
    const reuse = open && editPanel?.id === m.id;
    const panel = reuse ? editPanel.node : el("div", { class: "meal-edit", hidden: !open });
    if (open && !reuse) editPanel = { id: m.id, node: panel };
    const tap = el("button", { type: "button", class: "meal-tap", "aria-expanded": String(open) },
      el("span", { class: "meal-name" }, displayName(m)),
      el("span", { class: "meal-sub" }, `${qtyLabel(m)} ・ ${Math.round(n.kcal || 0)}kcal ・ P ${(n.protein || 0).toFixed(1)}g`));
    tap.addEventListener("click", () => {
      editingId = open ? null : m.id;
      editPanel = null;
      drawList();
    });
    const fg = el("div", { class: "swipe-fg" }, tap);
    // 背面の赤い帯は、この行の見出し(box)の中だけ。編集フォーム(panel)は帯の外に置く(帯がフォームを覆い隠さないように)
    const box = el("div", { class: "swipe-box" },
      el("div", { class: "swipe-bg", "aria-hidden": "true" }, el("span", { class: "s-off" }, "← 削除"), el("span", { class: "s-on" }, "離すと削除")),
      fg);
    const row = el("li", { class: "meal-wrap" }, box, panel);
    swipeToDelete(box, fg, () => removeMeal(m));
    if (open && !reuse) buildEditor(m, panel);
    return row;
  }

  // 食事枠の開閉。記録があっても閉じて、1日の全体を短く見られる。閉じた枠は端末に覚えておく
  const collapsed = new Set();
  try { JSON.parse(localStorage.getItem("collapsedSlots") || "[]").forEach((k) => collapsed.add(k)); } catch { /* 読めなければ、すべて開く */ }
  const slotHadItems = {}; // 前回の描画で記録があったか(空だった枠に最初の1品が入ったら、自動で開く)
  function toggleSlot(key) {
    if (editingId && meals.some((m) => m.id === editingId && m.slot === key)) { editingId = null; editPanel = null; }
    if (collapsed.has(key)) collapsed.delete(key); else collapsed.add(key);
    try { localStorage.setItem("collapsedSlots", JSON.stringify([...collapsed])); } catch { /* 保存できなくても開閉はできる */ }
    drawList();
  }

  function drawList() {
    // replaceChildren は配列を受け取れないため、スプレッドで展開して渡す
    list.replaceChildren(
      ...SLOTS.map((s) => {
        const items = meals.filter((m) => m.slot === s.key);
        const t = sumNutrients(items);
        // 記録がなくても合計は出す(読み込み中は「—」)
        const sum = el("span", { class: "slot-sum", "aria-label": loaded ? null : "読み込み中" },
          loaded ? `${Math.round(t.kcal || 0)}kcal ・ P ${(t.protein || 0).toFixed(1)}g` : "—");
        const href = `#/add?date=${date}&slot=${s.key}`;
        // 空の枠は1行にまとめて、1日の全体がスクロールなしで見えるようにする
        if (!items.length) {
          if (loaded) slotHadItems[s.key] = false;
          // 前日の同じ食事があるときだけ、コピーのボタンを下に出す
          // 今日の記録を読み込む前は出さない(すでに記録のある枠に出て、二重にコピーするのを防ぐ)
          const prev = loaded ? mealsInSlot(prevMeals, s.key) : [];
          // 見出しと合計は縦に重ねて、コピーのボタンも同じ1行に収める(コピーがあっても高さが増えない)
          return el("section", { class: "card slot slot-empty" },
            el("div", { class: "slot-left" }, el("h2", {}, s.label), sum),
            prev.length
              ? el("button", {
                type: "button", class: "btn add-inline copy-inline",
                "aria-label": `${prevLabel}の${s.label}(${prev.length}品)をコピー`,
                onclick: (e) => copyFromPrev(s, prev, e.currentTarget),
              }, "コピー")
              : null,
            el("a", { class: "btn add-inline", href, "aria-label": `${s.label}に追加` }, "＋ 追加"));
        }
        // 空だった枠に最初の記録が入ったら開く(閉じたまま、足した記録が見えない状態を避ける)。読み込み前は判定しない
        if (loaded) {
          if (slotHadItems[s.key] === false && collapsed.has(s.key)) {
            collapsed.delete(s.key);
            try { localStorage.setItem("collapsedSlots", JSON.stringify([...collapsed])); } catch { /* 保存できなくても開く */ }
          }
          slotHadItems[s.key] = true;
        }
        const isCollapsed = collapsed.has(s.key);
        // 見出し全体が開閉ボタン(左に矢印、タイトルとチップの下に合計)。閉じているときは「＋ 追加」を右に出す。
        // ボタンの名前は中身(朝・適量・合計)に任せ、開閉の状態は aria-expanded で伝える
        const head = el("div", { class: "slot-head slot-head-row" },
          el("h2", {},
            el("button", { type: "button", class: "slot-toggle", "aria-expanded": String(!isCollapsed), onclick: () => toggleSlot(s.key) },
              el("span", { class: "slot-chev", "aria-hidden": "true" }, "›"),
              el("span", { class: "slot-left" },
                el("span", { class: "slot-title" }, s.label,
                  s.key !== "snack" ? el("span", { class: `protein-chip ${proteinState(t.protein || 0)[1]}` }, proteinState(t.protein || 0)[0]) : null),
                sum))),
          isCollapsed ? el("a", { class: "btn add-inline", href, "aria-label": `${s.label}に追加` }, "＋ 追加") : null);
        if (isCollapsed) return el("section", { class: "card slot slot-collapsed" }, head);
        return el("section", { class: "card slot" },
          head,
          el("ul", { class: "meals" }, items.map(mealRow)),
          el("a", { class: "btn add-btn", href }, `＋ ${s.label}に追加`),
          // 2品以上の食事だけ、セットにできる(1品だけのセットは意味が薄く、カードも煩雑になる)
          mealsToRecipeItems(items).length >= 2
            ? el("button", { type: "button", class: "btn btn-link set-link", onclick: () => saveAsSet(s, items) }, "この食事をセットに保存")
            : null);
      }),
      // 操作の手がかり(大きな削除ボタンをなくしたため)。記録があるときだけ出す
      ...(meals.length && showHint ? [el("p", { class: "hint swipe-hint" }, "記録は左にスワイプで削除できます。タップすると量の変更と、削除ができます。")] : []));
  }

  const redraw = () => { drawSummary(); drawList(); drawDist(); };

  // append に null を渡すと「null」という文字が出るため、存在するものだけ渡す
  root.append(...[nav, toTodayLink, notice, summary, suggestBox, list, weightBox, distBox].filter(Boolean));
  redraw();
  drawWeight();

  const unwatch = watchMeals(
    date,
    (data) => { if (!alive) return; meals = data; loaded = true; notice.hidden = true; redraw(); },
    () => {
      if (!alive) return;
      notice.textContent = "記録を読み込めませんでした。通信状況を確認してください。";
      notice.hidden = false;
    }
  );

  // 表示名(食材マスタで設定したもの)を反映する。読み込めなくても、整形した名前で表示する
  ensureUserData().then(() => { if (alive) drawList(); }).catch(() => {});

  getMealsOn(prevDate)
    .then((data) => { if (alive) { prevMeals = data; drawList(); } })
    .catch(() => {}); // 取得できなければコピーのボタンを出さないだけ

  getGoals(DEFAULT_GOALS)
    .then((g) => { if (alive) { goals = g; goalsReady = true; drawSummary(); } })
    .catch(() => { goalsReady = true; }); // 取得できなければ初期値のまま表示

  // 体重。変更はすぐ反映される
  const unwatchWeight = watchWeight(date, (kg) => { if (alive) { savedWeight = kg; drawWeight(); } }, () => {});

  return () => { alive = false; unwatch(); unwatchWeight(); };
}
