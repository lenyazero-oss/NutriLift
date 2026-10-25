// 目標値の編集(#/goals)。未設定の項目は初期値で補われる。
import { el, toast, writeFailed } from "../ui.js";
import { getGoals, saveGoals, deleteGoals, getProfile, saveProfile, getGoalsRest, saveGoalsRest, deleteGoalsRest } from "../db.js";
import { diffFromBase } from "../goals-mode.js";
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
    getGoalsRest().catch(() => null), // 読めなかったときは null(保存済みの上書きを、知らずに消さないため)
  ]).then(([{ goals, failed }, savedProfile, rest]) => { if (alive) start(goals, failed, savedProfile, rest); });

  function start(goals, loadFailed, savedProfile, restLoaded) {
    const restFailed = restLoaded === null;
    const rest = restLoaded || {};
    const defs = shownNutrients().filter((d) => d.key in DEFAULT_GOALS);
    const inputs = defs.map((d) => {
      const input = el("input", {
        type: "number", inputmode: "decimal", min: "0.1", max: String(MAX_GOAL), step: "any",
        value: String(goals[d.key] ?? ""), "aria-label": `${d.label}の目標(${d.unit})`,
      });
      input.addEventListener("focus", () => input.select());
      return { def: d, input };
    });

    // 休養日の目標。トレ日と違う項目だけ保存する。触っていない項目は、トレ日の入力に合わせて動く
    const restTouched = new Set(Object.keys(rest || {}));
    const restInputs = defs.map((d) => {
      const input = el("input", {
        type: "number", inputmode: "decimal", min: "0.1", max: String(MAX_GOAL), step: "any",
        value: String(rest?.[d.key] ?? goals[d.key] ?? ""), "aria-label": `${d.label}の休養日の目標(${d.unit})`,
      });
      input.addEventListener("focus", () => input.select());
      input.addEventListener("input", () => restTouched.add(d.key));
      return { def: d, input };
    });
    const syncRest = () => inputs.forEach(({ def, input }) => {
      if (!restTouched.has(def.key)) restInputs.find((r) => r.def.key === def.key).input.value = input.value;
    });
    inputs.forEach(({ input }) => input.addEventListener("input", syncRest));

    const error = el("p", { class: "error", role: "alert", hidden: true });
    const saveBtn = el("button", { type: "button", class: "btn btn-big btn-primary" }, "保存する");

    function validate() {
      for (const { def, input } of inputs) {
        const v = parseFloat(input.value);
        if (input.value.trim() === "") return `${def.label}を入力してください。`;
        if (!(v > 0 && v <= MAX_GOAL)) return `${def.label}は0より大きい数値(${MAX_GOAL}以下)で入力してください。`;
      }
      for (const { def, input } of restInputs) {
        const v = parseFloat(input.value);
        if (input.value.trim() === "") return `休養日の${def.label}を入力してください。`;
        if (!(v > 0 && v <= MAX_GOAL)) return `休養日の${def.label}は0より大きい数値(${MAX_GOAL}以下)で入力してください。`;
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
        const round1 = (input) => Math.round(parseFloat(input.value) * 10) / 10;
        const restValues = {};
        restInputs.forEach(({ def, input }) => (restValues[def.key] = round1(input)));
        const overrides = diffFromBase(data, restValues); // トレ日と違う項目だけ
        // 休養日の目標を読み込めておらず、触ってもいないときは、休養日の保存済みの設定に手を付けない
        const touchRest = !restFailed || restTouched.size > 0;
        finish("目標値を保存しました", Promise.all([
          saveGoals(data),
          ...(touchRest ? [Object.keys(overrides).length ? saveGoalsRest(overrides) : deleteGoalsRest()] : []),
        ]));
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
        b.addEventListener("click", () => {
          if (profile[key] === o.key) return; // 同じ選択の再タップでは再計算を求めない
          profile[key] = o.key; paint(); hideResult();
        });
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
    const result = el("div", { class: "calc-result", hidden: true });
    let proposal = null;
    let staleNote = null;
    // 入力が変わったら、結果は消さずに薄くして再計算を促す(消すと画面の高さが変わって操作が乱れる)。
    // 古い提案を反映してしまわないよう、反映ボタンは使えなくする。
    function hideResult() {
      calcError.hidden = true;
      if (!proposal) return;
      proposal = null;
      result.classList.add("stale");
      result.querySelectorAll(".preview-n, .hint").forEach((n) => n.setAttribute("aria-hidden", "true")); // 古い値を読み上げない
      staleNote.textContent = "入力が変わりました。もう一度「目標値を計算する」を押してください。";
      applyBtn.classList.remove("btn-done");
      applyBtn.disabled = true;
      applyBtn.textContent = "再計算すると反映できます";
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
      // 入力が変わったときだけ文言が入る(role=status なので、入ったときに読み上げられる)。先頭に置いて見つけやすくする
      staleNote = el("p", { class: "stale-note", role: "status" });
      result.replaceChildren(
        staleNote,
        el("div", { class: "preview-n" }, defs.map((d) => el("span", {}, `${d.label} ${current(d.key)} → ${proposal[d.key]}${d.unit}`))),
        el("p", { class: "hint" }, "目安です。体の変化を見ながら、目標欄で調整してください。(たんぱく質は体重換算で、エネルギーの40%までにしています)"),
        applyBtn);
      result.classList.remove("stale");
      result.hidden = false;
    });
    let applyBtn = null;
    const goalCard = el("section", { class: "card" });
    function applyProposal() {
      if (!proposal || applyBtn.classList.contains("btn-done")) return;
      inputs.forEach(({ def, input }) => { if (def.key in proposal) input.value = String(proposal[def.key]); });
      syncRest(); // 休養日を触っていない項目も、新しいトレ日の値に合わせる
      // 反映済みは disabled にせず(薄く読みにくくなるため)、見た目で示して再タップを無効にする
      applyBtn.classList.add("btn-done");
      applyBtn.setAttribute("aria-disabled", "true");
      applyBtn.textContent = "反映しました。「保存する」で確定";
      goalCard.scrollIntoView({ block: "start", behavior: "smooth" }); // 変わった入力欄を見せる
      toast("目標欄に反映しました。保存するには「保存する」を押してください");
    }

    // 未保存の変更があるまま離れようとしたら確認する(戻るリンク・下部タブ・スワイプ戻りのどれでも)。
    // 目標欄だけを開いた時点と比べる(身体情報の入力は対象外)。
    const snapshot = () => JSON.stringify([inputs, restInputs].map((list) => list.map(({ input }) => input.value.trim())));
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
      // 休養日の目標: 変えたい項目だけ違う値にする(同じ値のままの項目はトレ日と同じ扱い)
      el("details", { class: "card", open: restTouched.size > 0 },
        el("summary", { class: "card-summary" }, "休養日の目標"),
        ...(restFailed ? [el("p", { class: "error", role: "alert" }, "保存済みの休養日の目標を読み込めませんでした。ここを変更しなければ、休養日の設定は変わりません。")] : []),
        el("p", { class: "hint" }, "トレ日と違う項目だけ変えてください。変えない項目はトレ日と同じ値になります。日ごとの切り替えは、今日画面のカードの「トレ日｜休養日」で行います。"),
        ...restInputs.map(({ def, input }) => el("label", { class: "lbl" }, `${def.label}(${def.unit})`, input))),
      error, saveBtn,
      el("button", {
        type: "button", class: "btn btn-link center reset-link",
        onclick: (e) => {
          if (!confirm("保存した目標値を捨てて、初期値に戻します。元に戻せません。よろしいですか?")) return;
          e.currentTarget.disabled = true; // 連打防止
          finish("初期値に戻しました", Promise.all([deleteGoals(), deleteGoalsRest()]), "初期値への復元");
        },
      }, "初期値に戻す"));
  }

  return () => { alive = false; };
}
