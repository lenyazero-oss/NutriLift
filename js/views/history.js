// 履歴画面: 7日間の棒グラフ(栄養素を切り替え可)と、日ごとの合計一覧
import { el } from "../ui.js";
import { watchMealsRange, getGoals } from "../db.js";
import { shownNutrients, DEFAULT_GOALS, sumNutrients, AT_LEAST } from "../nutrients.js";
import { dateStr, shiftDate, isValidDate } from "../util.js";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
const SVG_NS = "http://www.w3.org/2000/svg";
const W = 320, H = 190, PAD = { l: 8, r: 8, t: 22, b: 34 };

function parts(str) {
  const [y, m, d] = str.split("-").map(Number);
  return { m, d, wd: WEEKDAYS[new Date(y, m - 1, d).getDay()] };
}

function svg(tag, attrs = {}, text) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text != null) node.textContent = text;
  return node;
}

// 棒グラフ。目標線は破線。たんぱく質以外は目標超過を橙色+「▲」で示す(色だけに頼らない)
function chart(def, days, goal) {
  const hasGoal = goal > 0; // 目標が未設定の栄養素は、目標線と超過判定を出さない
  const max = Math.max(hasGoal ? goal : 0, ...days.map((d) => d.value)) * 1.15 || 1;
  const innerW = W - PAD.l - PAD.r, innerH = H - PAD.t - PAD.b;
  const slot = innerW / days.length, bw = slot * 0.6;
  const y = (v) => PAD.t + innerH * (1 - v / max);
  const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "chart", role: "img",
    "aria-label": `${def.label}の${days.length}日間の推移${hasGoal ? `。目標 ${goal}${def.unit}` : ""}` });

  root.append(svg("line", { x1: PAD.l, x2: W - PAD.r, y1: y(0), y2: y(0), class: "ax" }));
  days.forEach((d, i) => {
    const cx = PAD.l + slot * i + slot / 2;
    const over = hasGoal && d.value > goal && !AT_LEAST.has(def.key);
    if (d.value > 0) {
      const top = y(d.value);
      root.append(
        svg("rect", { x: cx - bw / 2, y: top, width: bw, height: y(0) - top, rx: 3, class: over ? "bar-over" : "bar-ok" }),
        svg("text", { x: cx, y: top - 4, class: "val", "text-anchor": "middle" },
          `${over ? "▲" : ""}${Math.round(d.value)}`));
    }
    const p = parts(d.date);
    root.append(
      svg("text", { x: cx, y: H - 18, class: `lab${d.isToday ? " today" : ""}`, "text-anchor": "middle" }, `${p.m}/${p.d}`),
      svg("text", { x: cx, y: H - 5, class: `lab${d.isToday ? " today" : ""}`, "text-anchor": "middle" }, p.wd));
  });
  // 目標線は棒の上に重ねる
  if (hasGoal) {
    root.append(
      svg("line", { x1: PAD.l, x2: W - PAD.r, y1: y(goal), y2: y(goal), class: "goal" }),
      svg("text", { x: W - PAD.r, y: y(goal) - 3, class: "goal-lab", "text-anchor": "end" }, `目標 ${goal}`));
  }
  return root;
}

export function renderHistory(root, { query }) {
  const today = dateStr();
  // end は未来にならないよう今日までに制限する
  let end = isValidDate(query.end) && query.end <= today ? query.end : today;
  const start = shiftDate(end, -6);
  const defs = shownNutrients();
  let key = defs.some((d) => d.key === query.n) ? query.n : "protein";
  const path = (e) => `#/history?end=${e}&n=${key}`;
  const navLinks = []; // { a, target }: draw() で href を最新の栄養素に更新する

  let meals = [];
  let goals = { ...DEFAULT_GOALS };
  let loaded = false;
  let failed = false;
  let alive = true;

  const label = (s) => { const p = parts(s); return `${p.m}/${p.d}`; };
  const isLatest = end >= today;

  const navLink = (target, text, aria, attrs = {}) => {
    const a = el("a", { class: attrs.class || "navbtn", "aria-label": aria }, text);
    navLinks.push({ a, target });
    return a;
  };
  const nextEnd = shiftDate(end, 7) > today ? today : shiftDate(end, 7);
  const nav = el("div", { class: "datenav" },
    navLink(shiftDate(end, -7), "‹", "前の週"),
    el("div", { class: "datelabel range" }, `${label(start)} 〜 ${label(end)}`, isLatest ? el("span", { class: "chip" }, "直近") : null),
    isLatest
      ? el("span", { class: "navbtn disabled", "aria-hidden": "true" }, "›")
      : navLink(nextEnd, "›", "次の週"));
  const toLatest = isLatest ? null : navLink(today, "直近に戻る", undefined, { class: "btn btn-link center" });
  const notice = el("p", { class: "error", role: "alert", hidden: true });
  const tabs = el("div", { class: "segs wrap", role: "group", "aria-label": "表示する栄養素" });
  const chartBox = el("section", { class: "card" });
  const list = el("section", { class: "card" });

  function dayData() {
    return Array.from({ length: 7 }, (_, i) => {
      const date = shiftDate(start, i);
      const dayMeals = meals.filter((m) => m.date === date);
      return { date, isToday: date === today, count: dayMeals.length, total: sumNutrients(dayMeals) };
    });
  }

  function draw() {
    const def = defs.find((d) => d.key === key);
    const goal = goals[key] ?? 0;
    const days = dayData().map((d) => ({ ...d, value: d.total[key] || 0 }));
    const logged = days.filter((d) => d.count > 0);
    const avg = logged.length ? logged.reduce((s, d) => s + d.value, 0) / logged.length : 0;
    const hasGoal = goal > 0;
    // たんぱく質・食物繊維は「目標以上」、それ以外は「目標以内」を達成とする(グラフの超過表示と一致させる)
    const atLeast = AT_LEAST.has(key);
    const achieved = logged.filter((d) => (atLeast ? d.value >= goal : d.value <= goal)).length;
    // 週移動のリンクにも選択中の栄養素を引き継ぐ
    navLinks.forEach(({ a, target }) => a.setAttribute("href", path(target)));

    tabs.replaceChildren(...defs.map((d) =>
      el("button", {
        type: "button", class: `seg${d.key === key ? " on" : ""}`, "aria-pressed": String(d.key === key),
        onclick: () => {
          key = d.key;
          history.replaceState(null, "", path(end)); // 再読み込みしても選択を保つ(hashchangeは発生しない)
          draw();
        },
      }, d.label)));

    chartBox.replaceChildren(
      el("div", { class: "chart-sum" },
        el("div", {}, el("span", { class: "k" }, "記録した日の平均"), el("strong", {}, loaded && logged.length ? `${avg.toFixed(def.decimals)}${def.unit}` : "—")),
        el("div", {}, el("span", { class: "k" }, atLeast ? "目標以上の日" : "目標以内の日"), el("strong", {}, loaded && hasGoal ? `${achieved} / ${logged.length}日` : "—"))),
      chart(def, days, goal),
      // 色だけに頼らず、超過は文字でも示す(超過表示があるのは、たんぱく質以外で目標がある場合)
      hasGoal && !atLeast ? el("p", { class: "hint chart-note" }, "▲ は目標を超えた日です") : null,
      !loaded && !failed ? el("p", { class: "empty" }, "読み込み中…") : null,
      loaded && !logged.length ? el("p", { class: "empty" }, "この週の記録はありません") : null);

    // 新しい日が上。記録のない日も、タップして追加できるよう表示する
    list.replaceChildren(
      el("h2", {}, "日ごとの合計"),
      el("ul", { class: "list days" }, [...days].reverse().map((d) => {
        const p = parts(d.date);
        return el("li", {},
          el("a", { class: "list-item day", href: `#/today?date=${d.date}` },
            el("span", { class: "name" }, `${p.m}月${p.d}日(${p.wd})`, d.isToday ? el("span", { class: "chip" }, "今日") : null),
            el("span", { class: "meta" }, d.count
              ? `${Math.round(d.total.kcal || 0)}kcal ・ P ${(d.total.protein || 0).toFixed(1)}g ・ ${d.count}件`
              : "記録なし")));
      })));
  }

  root.append(...[el("h1", {}, "履歴"), nav, toLatest, notice, tabs, chartBox, list].filter(Boolean));
  draw();

  const unwatch = watchMealsRange(
    start, end,
    (data) => { if (!alive) return; meals = data; loaded = true; failed = false; notice.hidden = true; draw(); },
    () => {
      if (!alive) return;
      failed = true;
      notice.textContent = "記録を読み込めませんでした。通信状況を確認して、画面を開き直してください。";
      notice.hidden = false;
      draw();
    });

  getGoals(DEFAULT_GOALS)
    .then((g) => { if (alive) { goals = g; draw(); } })
    .catch(() => {});

  return () => { alive = false; unwatch(); };
}
