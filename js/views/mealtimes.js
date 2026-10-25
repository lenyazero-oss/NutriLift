// 食事区分の時間帯(#/mealtimes): 朝・昼・間食の「終わりの時刻」。それ以外の時間は夜。
// 食事区分を自動で決めるすべての場所(レシピのすぐ記録、食事追加の初期値など)に使われる。
import { el, toast, writeFailed } from "../ui.js";
import { getMealTimes, saveMealTimes, deleteMealTimes } from "../db.js";
import { navigate, setLeaveGuard } from "../router.js";
import { DEFAULT_SLOT_TIMES, getSlotTimes, setSlotTimes, validSlotTimes, guessSlot, SLOTS } from "../util.js";

const ROWS = [
  { key: "morningEnd", label: "朝" },
  { key: "noonEnd", label: "昼" },
  { key: "snackEnd", label: "間食" },
];

export function renderMealTimes(root) {
  let alive = true;
  let leaving = false;
  const back = el("a", { class: "back", href: "#/settings" }, "← 設定");
  root.append(back, el("h1", {}, "食事区分の時間帯"), el("p", { class: "hint" }, "読み込み中…"));

  // 読めなければ、いま使っている値(初期値)で編集できる
  getMealTimes().catch(() => null).then((saved) => { if (alive) start(validSlotTimes(saved) ? saved : getSlotTimes()); });

  function start(times) {
    const selects = ROWS.map((r) => {
      const sel = el("select", { "aria-label": `${r.label}は何時まで` },
        Array.from({ length: 23 }, (_, i) => el("option", { value: String(i + 1) }, `${i + 1}時まで`)));
      sel.value = String(times[r.key]);
      sel.addEventListener("change", update);
      return { ...r, sel };
    });
    const read = () => Object.fromEntries(selects.map((s) => [s.key, Number(s.sel.value)]));

    const error = el("p", { class: "error", role: "alert", hidden: true });
    const example = el("p", { class: "hint", "aria-live": "polite" });
    const saveBtn = el("button", { type: "button", class: "btn btn-big btn-primary" }, "保存する");

    function update() {
      const t = read();
      const ok = validSlotTimes(t);
      error.textContent = ok ? "" : "朝より昼、昼より間食の時刻を、遅くしてください。";
      error.hidden = ok;
      saveBtn.disabled = !ok;
      if (ok) {
        const label = (h) => SLOTS.find((s) => s.key === guessSlot(new Date(2000, 0, 1, h), t))?.label;
        example.textContent = `例: 7時 → ${label(7)}、12時 → ${label(12)}、16時 → ${label(16)}、20時 → ${label(20)}`;
      } else {
        example.textContent = "";
      }
    }

    saveBtn.addEventListener("click", () => {
      const t = read();
      if (!validSlotTimes(t)) return;
      saveBtn.disabled = true; // 連打防止
      try {
        setSlotTimes(t); // すぐ反映(保存はオフラインでも復帰後に反映される)
        saveMealTimes(t).catch(writeFailed("食事区分の時間帯"));
      } catch {
        toast("保存できませんでした。", { error: true });
        saveBtn.disabled = false;
        return;
      }
      leaving = true;
      toast("食事区分の時間帯を保存しました");
      navigate("#/settings");
    });

    const initial = JSON.stringify(read());
    setLeaveGuard(() => leaving || JSON.stringify(read()) === initial || confirm("変更が保存されていません。保存せずに移動しますか?\n(OKを押すと入力した内容は破棄されます)"));

    root.replaceChildren(
      back,
      el("h1", {}, "食事区分の時間帯"),
      el("section", { class: "card" },
        el("p", { class: "hint" }, "食事区分を自動で決めるときの、時間の境目です。「何時まで」を朝・昼・間食ごとに決めます。それ以外の時間は「夜」になります。"),
        ...selects.map(({ label, sel }) => el("label", { class: "lbl" }, `${label}は何時まで`, sel)),
        el("p", { class: "hint" }, "夜は、上のどれにも当てはまらない時間です。"),
        example),
      error, saveBtn,
      el("button", {
        type: "button", class: "btn btn-link center reset-link",
        onclick: (e) => {
          if (!confirm(`初期値(朝${DEFAULT_SLOT_TIMES.morningEnd}時・昼${DEFAULT_SLOT_TIMES.noonEnd}時・間食${DEFAULT_SLOT_TIMES.snackEnd}時まで)に戻します。よろしいですか?`)) return;
          e.currentTarget.disabled = true;
          setSlotTimes(null);
          deleteMealTimes().catch(writeFailed("食事区分の時間帯", "初期値への復元"));
          leaving = true;
          toast("初期値に戻しました");
          navigate("#/settings");
        },
      }, "初期値に戻す"));
    update();
  }

  return () => { alive = false; };
}
