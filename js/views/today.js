// 今日の画面: 日付移動、目標に対する達成バー、朝/昼/夜/間食ごとの記録一覧
import { el, toast } from "../ui.js";
import { watchMeals, getGoals, deleteMeal, restoreMeal } from "../db.js";
import { currentUid } from "../auth.js";
import { shownNutrients, DEFAULT_GOALS, sumNutrients } from "../nutrients.js";
import { SLOTS, dateStr, shiftDate, isValidDate } from "../util.js";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

function dateLabel(str) {
  const [y, m, d] = str.split("-").map(Number);
  const wd = WEEKDAYS[new Date(y, m - 1, d).getDay()];
  return `${m}月${d}日(${wd})`;
}

// 達成バー。値が目標を超えた場合、たんぱく質以外は「超過」色にする
function bar(def, value, goal, { big = false } = {}) {
  const ratio = goal > 0 ? value / goal : 0;
  const over = ratio > 1 && def.key !== "protein";
  const fill = el("div", { class: `fill${over ? " over" : ""}`, style: `width:${Math.min(ratio, 1) * 100}%` });
  const track = el("div", {
    class: "track", role: "progressbar", "aria-label": def.label,
    "aria-valuemin": "0", "aria-valuemax": String(goal), "aria-valuenow": String(Math.round(value)),
  }, fill);
  const nums = `${value.toFixed(def.decimals)} / ${goal}${def.unit}`;
  if (!big) {
    // 色だけに頼らず、超過は文字でも示す
    return el("div", { class: "bar" },
      el("div", { class: "bar-head" }, el("span", {}, def.label), el("span", { class: "bar-num" }, nums)), track,
      over ? el("div", { class: "over-text" }, `+${(value - goal).toFixed(def.decimals)}${def.unit} 超過`) : null);
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
    deleteMeal(id).catch(() => toast("削除できませんでした。通信状況を確認してください。", { error: true, duration: 6000 }));
    toast(`${m.name} を削除しました`, {
      action: {
        label: "元に戻す",
        onClick: () => restoreMeal(m, uid).catch(() => toast("元に戻せませんでした。", { error: true, duration: 6000 })),
      },
    });
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
        return el("section", { class: "card slot" },
          el("div", { class: "slot-head" },
            el("h2", {}, s.label),
            items.length ? el("span", { class: "slot-sum" }, `${Math.round(t.kcal || 0)}kcal ・ P ${(t.protein || 0).toFixed(1)}g`) : null),
          items.length ? el("ul", { class: "meals" }, items.map(mealRow))
            : el("p", { class: "empty" }, loaded ? "まだ記録がありません" : "読み込み中…"),
          el("a", { class: "btn add-btn", href: `#/add?date=${date}&slot=${s.key}` }, `＋ ${s.label}に追加`));
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

  getGoals(DEFAULT_GOALS)
    .then((g) => { if (alive) { goals = g; redraw(); } })
    .catch(() => {}); // 取得できなければ初期値のまま表示

  return () => { alive = false; unwatch(); };
}
