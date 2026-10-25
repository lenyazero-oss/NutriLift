// 「最近」「よく使う」の食材リスト(食事追加画面・レシピ編集の食材検索で共通)。直近60日の食事記録から集計する(usage.js)。
import { el } from "./ui.js";
import { loadUsage } from "./usage.js";
import { displayName } from "./foods.js";
import { dateStr } from "./util.js";

// 最後に記録した日の表示(今日 / 昨日 / ◯日前 / 月/日)
export function agoLabel(last) {
  const [y, m, d] = last.split("-").map(Number);
  const [ty, tm, td] = dateStr().split("-").map(Number);
  const days = Math.round((new Date(ty, tm - 1, td) - new Date(y, m - 1, d)) / 86400000);
  if (days <= 0) return "今日";
  if (days === 1) return "昨日";
  return days < 7 ? `${days}日前` : `${m}/${d}`;
}

// onPick(food): 食材を選んだとき。戻り値の node を画面に置き、setVisible で出し入れ、refresh で集計を読み込む。
export function createQuickFoods({ onPick }) {
  const node = el("section", { class: "quick", hidden: true });
  let usage = null;
  let mode = "recent";
  let seq = 0; // 古い集計が後から届いても、新しい結果を上書きしない
  let wanted = false;
  const apply = () => { node.hidden = !(wanted && usage); };

  function draw() {
    const list = usage ? usage[mode === "recent" ? "recent" : "frequent"].slice(0, 8) : [];
    const tabs = el("div", { class: "segs", role: "group", "aria-label": "食材の並び" },
      [["recent", "最近"], ["frequent", "よく使う"]].map(([key, label]) => {
        const b = el("button", { type: "button", class: `seg${mode === key ? " on" : ""}`, "aria-pressed": String(mode === key) }, label);
        b.addEventListener("click", () => { mode = key; draw(); });
        return b;
      }));
    node.replaceChildren(
      tabs,
      list.length
        ? el("ul", { class: "list quick-list" }, list.map((u) => {
          const f = u.food;
          const btn = el("button", { type: "button", class: "list-item" },
            el("span", { class: "name" }, displayName(f)),
            el("span", { class: "meta" },
              `${mode === "recent" ? agoLabel(u.last) : `${u.count}回`} ・ たんぱく質 ${(f.n.protein ?? 0).toFixed(1)}g / ${Math.round(f.n.kcal ?? 0)}kcal(100g)`));
          btn.addEventListener("click", () => onPick(f));
          return el("li", {}, btn);
        }))
        : el("p", { class: "hint" }, "記録すると、ここに最近使った食材とよく使う食材が表示されます。"));
    apply();
  }

  async function refresh() {
    const mine = ++seq;
    try {
      const u = await loadUsage();
      if (mine !== seq) return;
      usage = u;
      draw();
    } catch { /* 集計できなくても検索は使える */ }
  }

  function setVisible(v) {
    wanted = v;
    apply();
  }

  return { node, refresh, setVisible };
}
