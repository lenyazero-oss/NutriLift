// 目標値の編集(#/goals)。未設定の項目は初期値で補われる。
import { el, toast, writeFailed } from "../ui.js";
import { getGoals, saveGoals, deleteGoals, getProfile, saveProfile } from "../db.js";
import { navigate, setLeaveGuard } from "../router.js";
import { shownNutrients, DEFAULT_GOALS, AT_LEAST } from "../nutrients.js";
import { SEXES, ACTIVITIES, AIMS, DEFAULT_PROFILE, validateProfile, calcGoals } from "../profile.js";

const MAX_GOAL = 99999;

export function renderGoals(root) {
  let alive = true;
  const back = el("a", { class: "back", href: "#/settings" }, "← 設定");
  root.append(back, el("h1", {}, "目標値"), el("p", { class: "hint" }, "読み込み中…"));

  // 読み込めなくても初期値で編集できる(保存はオフラインでも復帰後に反映される)
  // 身体情報が読めなくても目標値の編集は続けられる(入力欄は初期値になる)
  // 両方そろってから1回だけ描画する(待っている間に画面を離れたら描画しない)
  Promise.all([
    getGoals(DEFAULT_GOALS).then((goals) => ({ goals, failed: false }), () => ({ goals: { ...DEFAULT_GOALS }, failed: true })),
    getProfile().catch(() => null),
  ]).then(([{ goals, failed }, savedProfile]) => { if (alive) start(goals, failed, savedProfile); });

  function start(goals, loadFailed, savedProfile) {
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
    let leaving = false; // 保存・初期値に戻すのあとは確認なしで移動する
    function finish(message, done, verb = "保存") {
      done.catch(writeFailed("目標値", verb));
      leaving = true;
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

    // 身体情報から目標値の目安を計算するカード。結果は「反映」を押すまで下の入力欄に入らない。
    const profile = { ...DEFAULT_PROFILE, ...(savedProfile || {}) };
    const numField = (key, label, unit, step, inputmode = "decimal") => {
      const input = el("input", {
        type: "number", inputmode, step, value: String(profile[key]), "aria-label": `${label}(${unit})`,
      });
      input.addEventListener("focus", () => input.select());
      input.addEventListener("input", () => { profile[key] = parseFloat(input.value); hideResult(); });
      return el("label", { class: "lbl" }, `${label}(${unit})`, input);
    };
    const segField = (label, options, key) => {
      const btns = options.map((o) => {
        const b = el("button", { type: "button", class: "seg" }, o.label);
        b.addEventListener("click", () => { profile[key] = o.key; paint(); hideResult(); });
        return { b, o };
      });
      const paint = () => btns.forEach(({ b, o }) => {
        b.classList.toggle("on", profile[key] === o.key);
        b.setAttribute("aria-pressed", String(profile[key] === o.key));
      });
      paint();
      return el("div", { class: "lbl" }, label, el("div", { class: "segs", role: "group", "aria-label": label }, btns.map((x) => x.b)));
    };
    const activitySelect = el("select", { "aria-label": "活動量" },
      ACTIVITIES.map((a) => el("option", { value: a.key, selected: a.key === profile.activity }, a.label)));
    activitySelect.addEventListener("change", () => { profile.activity = activitySelect.value; hideResult(); });

    const calcError = el("p", { class: "error", role: "alert", hidden: true });
    const result = el("div", { class: "calc-result", hidden: true, "aria-live": "polite" });
    let proposal = null;
    function hideResult() {
      proposal = null;
      result.hidden = true;
      calcError.hidden = true;
    }
    const calcBtn = el("button", { type: "button", class: "btn" }, "目標値を計算する");
    calcBtn.addEventListener("click", () => {
      const msg = validateProfile(profile);
      calcError.textContent = msg;
      calcError.hidden = !msg;
      if (msg) { calcError.scrollIntoView({ block: "center" }); return; }
      proposal = calcGoals(profile);
      // 次回から入力不要にする(失敗しても計算結果は使える)
      const { sex, age, height, weight, activity, aim } = profile;
      try { saveProfile({ sex, age, height, weight, activity, aim }).catch(writeFailed("身体情報")); } catch { /* 未ログインなど。計算は続ける */ }
      // 現在の入力欄の値 → 提案値(反映するか判断しやすいよう差を見せる)
      const current = (key) => inputs.find((x) => x.def.key === key)?.input.value || "—";
      applyBtn = el("button", { type: "button", class: "btn", onclick: applyProposal }, "目標欄に反映する(未保存)");
      result.replaceChildren(
        el("div", { class: "preview-n" }, defs.map((d) => el("span", {}, `${d.label} ${current(d.key)} → ${proposal[d.key]}${d.unit}`))),
        el("p", { class: "hint" }, "目安です。体の変化を見ながら、目標欄で調整してください。"),
        applyBtn);
      result.hidden = false;
    });
    let applyBtn = null;
    const goalCard = el("section", { class: "card" });
    function applyProposal() {
      if (!proposal) return;
      inputs.forEach(({ def, input }) => { if (def.key in proposal) input.value = String(proposal[def.key]); });
      applyBtn.disabled = true;
      applyBtn.textContent = "反映しました。「保存する」で確定";
      goalCard.scrollIntoView({ block: "start", behavior: "smooth" }); // 変わった入力欄を見せる
      toast("目標欄に反映しました。保存するには「保存する」を押してください");
    }

    // 未保存の変更があるまま離れようとしたら確認する(戻るリンク・下部タブ・スワイプ戻りのどれでも)。
    // 目標欄だけを開いた時点と比べる(身体情報の入力は対象外)。
    const snapshot = () => JSON.stringify(inputs.map(({ input }) => input.value.trim()));
    const initial = snapshot();
    setLeaveGuard(() => leaving || snapshot() === initial || confirm("変更が保存されていません。保存せずに移動しますか?\n(OKを押すと入力した内容は破棄されます)"));

    goalCard.append(
      el("p", { class: "hint" }, `1日の目標です。${defs.filter((d) => AT_LEAST.has(d.key)).map((d) => d.label).join("と")}は「目標以上」、ほかは「目標以内」を達成として扱います。`),
      ...inputs.map(({ def, input }) => el("label", { class: "lbl" }, `${def.label}(${def.unit})`, input)));

    root.replaceChildren(
      back,
      el("h1", {}, "目標値"),
      ...(loadFailed ? [el("p", { class: "error", role: "alert" }, "保存済みの目標値を読み込めなかったため、初期値を表示しています。保存すると上書きされます。")] : []),
      // たまにしか使わないので折りたたむ(身体情報が未保存の初回だけ開く)
      el("details", { class: "card calc-card", open: !savedProfile },
        el("summary", {}, "身体情報から目標を計算"),
        el("p", { class: "hint" }, "年齢・身長・体重などから、1日の目標の目安を出します(18歳以上向け)。入力した内容は次回のために保存されます。"),
        segField("性別", SEXES, "sex"),
        el("div", { class: "grid3" },
          numField("age", "年齢", "歳", "1", "numeric"),
          numField("height", "身長", "cm", "any"),
          numField("weight", "体重", "kg", "any")),
        el("label", { class: "lbl" }, "活動量", activitySelect),
        segField("目的", AIMS, "aim"),
        calcError, calcBtn, result),
      goalCard,
      error, saveBtn,
      el("button", {
        type: "button", class: "btn btn-link center reset-link",
        onclick: (e) => {
          if (!confirm("保存した目標値を捨てて、初期値に戻します。元に戻せません。よろしいですか?")) return;
          e.currentTarget.disabled = true; // 連打防止
          finish("初期値に戻しました", deleteGoals(), "初期値への復元");
        },
      }, "初期値に戻す"));
  }

  return () => { alive = false; };
}
