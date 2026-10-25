// 今日の画面: 日付移動、目標に対する達成バー、朝/昼/夜/間食ごとの記録一覧
import { el, toast, writeFailed } from "../ui.js";
import { watchMeals, getGoals, deleteMeal, restoreMeal, getMealsOn } from "../db.js";
import { copyMeals, mealsInSlot, mealsToRecipeItems, saveMealsAsSet } from "../copy.js";
import { navigate } from "../router.js";
import { currentUid } from "../auth.js";
import { shownNutrients, DEFAULT_GOALS, sumNutrients, AT_LEAST } from "../nutrients.js";
import { SLOTS, dateStr, shiftDate, isValidDate } from "../util.js";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

function dateLabel(str) {
  const [y, m, d] = str.split("-").map(Number);
  const wd = WEEKDAYS[new Date(y, m - 1, d).getDay()];
  return `${m}月${d}日(${wd})`;
}

// 達成バー。値が目標を超えた場合、「目標以上」が達成の栄養素(たんぱく質・食物繊維)以外は「超過」色にする
function bar(def, value, goal, { big = false } = {}) {
  const ratio = goal > 0 ? value / goal : 0;
  const atLeast = AT_LEAST.has(def.key);
  const over = ratio > 1 && !atLeast;
  const reached = atLeast && goal > 0 && ratio >= 1; // 「以上」型は届いたら達成を文字でも示す
  const fill = el("div", { class: `fill${over ? " over" : ""}`, style: `width:${Math.min(ratio, 1) * 100}%` });
  const track = el("div", {
    class: "track", role: "progressbar", "aria-label": def.label,
    "aria-valuemin": "0", "aria-valuemax": String(goal), "aria-valuenow": String(Math.round(value)),
    ...(reached ? { "aria-valuetext": "目標達成" } : {}),
  }, fill);
  const nums = `${value.toFixed(def.decimals)} / ${goal}${def.unit}`;
  if (!big) {
    // 色だけに頼らず、超過は文字でも示す
    return el("div", { class: "bar" },
      el("div", { class: "bar-head" }, el("span", {}, def.label), el("span", { class: "bar-num" }, nums)), track,
      over ? el("div", { class: "over-text" }, `+${(value - goal).toFixed(def.decimals)}${def.unit} 超過`) : null,
      reached ? el("div", { class: "reached-text" }, "✓ 目標達成") : null);
  }
  const remain = goal - value;
  return el("div", { class: "bar bar-big" },
    el("div", { class: "bar-head" }, el("span", { class: "bar-title" }, def.label)),
    el("div", { class: "big-num" }, el("strong", {}, value.toFixed(def.decimals)), ` / ${goal}${def.unit}`),
    track,
    el("div", { class: "bar-sub" }, remain > 0 ? `あと ${remain.toFixed(def.decimals)}${def.unit}` : "目標達成"));
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

  function drawSummary() {
    const total = sumNutrients(meals);
    const protein = defs.find((d) => d.key === "protein");
    summary.replaceChildren(
      bar(protein, total.protein || 0, goals.protein, { big: true }),
      el("div", { class: "bars" },
        defs.filter((d) => d.key !== "protein").map((d) => bar(d, total[d.key] || 0, goals[d.key] ?? 0))));
  }

  function removeMeal(m) {
    const { id } = m;
    const uid = currentUid(); // 取り消し時に同じユーザーか確認するため
    deleteMeal(id).catch(writeFailed(`${m.name} の記録`, "削除"));
    toast(`${m.name} を削除しました`, {
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

  function mealRow(m) {
    const n = m.nutrients || {};
    return el("li", { class: "meal" },
      el("div", { class: "meal-main" },
        el("div", { class: "meal-name" }, m.name),
        el("div", { class: "meal-sub" },
          `${m.qtyText || `${m.grams}g`} ・ ${Math.round(n.kcal || 0)}kcal ・ P ${(n.protein || 0).toFixed(1)}g`)),
      el("button", { type: "button", class: "del", "aria-label": `${m.name}を削除`, onclick: () => removeMeal(m) }, "削除"));
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
        return el("section", { class: "card slot" },
          el("div", { class: "slot-head" }, el("h2", {}, s.label), sum),
          el("ul", { class: "meals" }, items.map(mealRow)),
          el("a", { class: "btn add-btn", href }, `＋ ${s.label}に追加`),
          // 2品以上の食事だけ、セットにできる(1品だけのセットは意味が薄く、カードも煩雑になる)
          mealsToRecipeItems(items).length >= 2
            ? el("button", { type: "button", class: "btn btn-link set-link", onclick: () => saveAsSet(s, items) }, "この食事をセットに保存")
            : null);
      }));
  }

  const redraw = () => { drawSummary(); drawList(); };

  // append に null を渡すと「null」という文字が出るため、存在するものだけ渡す
  root.append(...[nav, toTodayLink, notice, summary, list].filter(Boolean));
  redraw();

  const unwatch = watchMeals(
    date,
    (data) => { if (!alive) return; meals = data; loaded = true; notice.hidden = true; redraw(); },
    () => {
      if (!alive) return;
      notice.textContent = "記録を読み込めませんでした。通信状況を確認してください。";
      notice.hidden = false;
    }
  );

  getMealsOn(prevDate)
    .then((data) => { if (alive) { prevMeals = data; drawList(); } })
    .catch(() => {}); // 取得できなければコピーのボタンを出さないだけ

  getGoals(DEFAULT_GOALS)
    .then((g) => { if (alive) { goals = g; redraw(); } })
    .catch(() => {}); // 取得できなければ初期値のまま表示

  return () => { alive = false; unwatch(); };
}
