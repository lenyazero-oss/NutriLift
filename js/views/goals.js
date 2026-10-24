// 目標値の編集(#/goals)。未設定の項目は初期値で補われる。
import { el, toast } from "../ui.js";
import { getGoals, saveGoals, deleteGoals } from "../db.js";
import { navigate } from "../router.js";
import { shownNutrients, DEFAULT_GOALS, AT_LEAST } from "../nutrients.js";

const MAX_GOAL = 99999;

export function renderGoals(root) {
  let alive = true;
  const back = el("a", { class: "back", href: "#/settings" }, "← 設定");
  root.append(back, el("h1", {}, "目標値"), el("p", { class: "hint" }, "読み込み中…"));

  // 読み込めなくても初期値で編集できる(保存はオフラインでも復帰後に反映される)
  getGoals(DEFAULT_GOALS)
    .then((goals) => alive && start(goals, false))
    .catch(() => alive && start({ ...DEFAULT_GOALS }, true));

  function start(goals, loadFailed) {
    const defs = shownNutrients().filter((d) => d.key in DEFAULT_GOALS);
    const inputs = defs.map((d) => {
      const input = el("input", {
        type: "number", inputmode: "decimal", min: "0.1", max: String(MAX_GOAL), step: "any",
        value: String(goals[d.key] ?? ""), "aria-label": `${d.label}の目標(${d.unit})`,
      });
      input.addEventListener("focus", () => input.select());
      return { def: d, input };
    });

    const error = el("p", { class: "error", role: "alert", hidden: true });
    const saveBtn = el("button", { type: "button", class: "btn btn-big btn-primary" }, "保存する");

    function validate() {
      for (const { def, input } of inputs) {
        const v = parseFloat(input.value);
        if (input.value.trim() === "") return `${def.label}を入力してください。`;
        if (!(v > 0 && v <= MAX_GOAL)) return `${def.label}は0より大きい数値(${MAX_GOAL}以下)で入力してください。`;
      }
      return "";
    }

    // オフライン時は応答が返らないため await しない
    function finish(message, done) {
      done.catch(() => toast("保存できませんでした。通信状況を確認して、もう一度操作してください。", { error: true, duration: 6000 }));
      toast(navigator.onLine === false ? `${message}(通信が回復したら反映されます)` : message);
      navigate("#/settings");
    }

    saveBtn.addEventListener("click", () => {
      const msg = validate();
      error.textContent = msg;
      error.hidden = !msg;
      if (msg) { error.scrollIntoView({ block: "center" }); return; }
      saveBtn.disabled = true; // 連打防止
      try {
        const data = {};
        inputs.forEach(({ def, input }) => (data[def.key] = Math.round(parseFloat(input.value) * 10) / 10));
        finish("目標値を保存しました", saveGoals(data));
      } catch {
        toast("保存できませんでした。", { error: true });
        saveBtn.disabled = false;
      }
    });

    // 未保存の変更があるまま離れようとしたら確認する
    let dirty = false;
    root.addEventListener("input", () => (dirty = true));
    back.addEventListener("click", (e) => {
      if (dirty && !confirm("変更を破棄して戻りますか?")) e.preventDefault();
    });

    root.replaceChildren(
      back,
      el("h1", {}, "目標値"),
      ...(loadFailed ? [el("p", { class: "error", role: "alert" }, "保存済みの目標値を読み込めなかったため、初期値を表示しています。保存すると上書きされます。")] : []),
      el("section", { class: "card" },
        el("p", { class: "hint" }, `1日の目標です。${defs.filter((d) => AT_LEAST.has(d.key)).map((d) => d.label).join("と")}は「目標以上」、ほかは「目標以内」を達成として扱います。`),
        ...inputs.map(({ def, input }) => el("label", { class: "lbl" }, `${def.label}(${def.unit})`, input))),
      error, saveBtn,
      el("button", {
        type: "button", class: "btn btn-link center reset-link",
        onclick: (e) => {
          if (!confirm("保存した目標値を捨てて、初期値に戻します。元に戻せません。よろしいですか?")) return;
          e.currentTarget.disabled = true; // 連打防止
          finish("初期値に戻しました", deleteGoals());
        },
      }, "初期値に戻す"));
  }

  return () => { alive = false; };
}
