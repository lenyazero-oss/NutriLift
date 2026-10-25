// 食材の編集。
//  #/foodedit/new            自作食材の新規作成
//  #/foodedit/custom/<id>    自作食材の編集(名前・栄養素・単位)
//  #/foodedit/table/<id>     成分表の食材の単位の上書き
import { el, toast, writeFailed } from "../ui.js";
import { loadFoods, findFood, unitsFor, displayName, displayNameOf, cleanName } from "../foods.js";
import { ensureUserData, invalidateUserData } from "../food-picker.js";
import { saveCustomFood, deleteCustomFood, saveUnitOverride, deleteUnitOverride, saveDisplayName, deleteDisplayName } from "../db.js";
import { navigate, setLeaveGuard } from "../router.js";
import { shownNutrients } from "../nutrients.js";

const MAX_UNITS = 10;

export function renderFoodEdit(root, { args }) {
  const isNew = args[0] === "new";
  const kind = isNew ? "custom" : args[0];
  const id = isNew ? null : args[1];
  let alive = true;

  const back = el("a", { class: "back", href: "#/foodmaster" }, "← 食材マスタ");
  root.append(back, el("p", { class: "hint" }, "読み込み中…"));

  const fail = (message) => root.replaceChildren(back, el("p", { class: "error", role: "alert" }, message));

  if (!isNew && !((kind === "custom" || kind === "table") && id)) {
    fail("食材が見つかりません。");
  } else {
    (async () => {
      await loadFoods();
      await ensureUserData().catch(() => { throw new Error("user"); });
    })()
      .then(() => {
        if (!alive) return;
        const food = isNew ? { name: "", n: {}, units: [], source: "custom" } : findFood(id, kind);
        if (!food) return fail("食材が見つかりません。");
        start(food);
      })
      .catch((e) => alive && fail(e.message === "user"
        ? "自作食材と単位の設定を読み込めませんでした。通信状況を確認してください。"
        : "食材データを読み込めませんでした。"));
  }

  function start(food) {
    const isCustom = food.source === "custom";
    const units = unitsFor(food).map((u) => ({ ...u }));
    const defs = shownNutrients();

    const nameInput = el("input", { type: "text", value: food.name || "", maxlength: "40", placeholder: "食材名(例: 自家製プロテインバー)", "aria-label": "食材名" });
    // 成分表の食材には表示名を付けられる(元の名前は変わらない)。空欄なら整形した名前で表示する
    const savedDisplay = isCustom ? "" : displayNameOf(food.id);
    const displayInput = el("input", {
      type: "text", value: savedDisplay, maxlength: "40",
      placeholder: isCustom ? "" : cleanName(food.name), "aria-label": "表示名",
    });
    const nutInputs = defs.map((d) => {
      const input = el("input", {
        type: "number", inputmode: "decimal", min: "0", step: "any",
        value: food.n?.[d.key] != null ? String(food.n[d.key]) : "", "aria-label": `${d.label}(${d.unit}/100g)`,
      });
      input.addEventListener("focus", () => input.select());
      return { def: d, input };
    });

    const unitList = el("ul", { class: "meals" });
    const addUnitBtn = el("button", { type: "button", class: "btn", onclick: () => { units.push({ name: "", g: 0 }); drawUnits(); } }, "＋ 単位を追加");
    const error = el("p", { class: "error", role: "alert", hidden: true });
    const saveBtn = el("button", { type: "button", class: "btn btn-big btn-primary" }, "保存する");

    function drawUnits() {
      unitList.replaceChildren(
        ...units.map((u, i) => {
          const name = el("input", { type: "text", value: u.name, maxlength: "12", placeholder: "単位名(例: 個)", "aria-label": `単位${i + 1}の名前` });
          name.addEventListener("input", () => (u.name = name.value));
          const g = el("input", {
            type: "number", inputmode: "decimal", min: "0", step: "any", class: "g-input",
            value: u.g > 0 ? String(u.g) : "", "aria-label": `単位${i + 1}のグラム数`,
          });
          g.addEventListener("focus", () => g.select());
          g.addEventListener("input", () => { const v = parseFloat(g.value); u.g = v > 0 ? v : 0; });
          const del = el("button", {
            type: "button", class: "del", "aria-label": `単位${i + 1}を外す`,
            onclick: () => { units.splice(i, 1); drawUnits(); },
          }, "外す");
          return el("li", { class: "meal item" },
            el("div", { class: "meal-main" }, name), g, el("span", { class: "unit" }, "g"), del);
        }));
      if (!units.length) unitList.append(el("li", { class: "empty" }, "単位はありません(グラムで入力します)"));
      addUnitBtn.disabled = units.length >= MAX_UNITS;
    }

    function validate() {
      if (isCustom && !nameInput.value.trim()) return "食材名を入力してください。";
      if (isCustom) {
        // エネルギーとたんぱく質は入力漏れを防ぐため必須。ほかは空欄なら0として保存する
        for (const { def, input } of nutInputs) {
          const raw = input.value.trim();
          const v = parseFloat(raw);
          const required = def.key === "kcal" || def.key === "protein";
          if (required && raw === "") return `${def.label}を入力してください(100gあたり)。`;
          if (raw !== "" && !(v >= 0 && v <= 1000)) return `${def.label}は0〜1000の数値で入力してください。`;
        }
      }
      if (units.some((u) => !u.name.trim() || !(u.g >= 0.1))) return "単位の名前とグラム数(0.1以上)を入力してください。";
      const names = units.map((u) => u.name.trim());
      if (new Set(names).size !== names.length) return "同じ名前の単位があります。";
      return "";
    }

    const cleanUnits = () => units.map((u) => ({ name: u.name.trim(), g: Math.round(u.g * 10) / 10 }));

    let leaving = false; // 保存・削除・初期値に戻すのあとは確認なしで移動する
    function finish(message, done, what, verb = "保存") {
      // オフライン時は応答が返らないため await しない
      done.catch(writeFailed(what, verb));
      invalidateUserData();
      leaving = true;
      toast(message);
      navigate("#/foodmaster");
    }

    saveBtn.addEventListener("click", () => {
      const msg = validate();
      error.textContent = msg;
      error.hidden = !msg;
      if (msg) { error.scrollIntoView({ block: "center" }); return; }
      saveBtn.disabled = true; // 連打による重複作成を防ぐ
      try {
        if (isCustom) {
          const n = {};
          nutInputs.forEach(({ def, input }) => {
            const v = parseFloat(input.value);
            n[def.key] = v > 0 ? v : 0;
          });
          const name = nameInput.value.trim();
          finish("自作食材を保存しました", saveCustomFood(id, { name, n, units: cleanUnits() }).done, `自作食材「${name}」`);
        } else {
          // 単位と表示名を一緒に保存する。表示名が空で、すでに設定があれば削除する
          const nm = displayInput.value.trim();
          const nameOp = nm ? saveDisplayName(food.id, nm) : savedDisplay ? deleteDisplayName(food.id) : null;
          finish("保存しました", Promise.all([saveUnitOverride(food.id, cleanUnits()), nameOp].filter(Boolean)), `「${displayName(food)}」の設定`);
        }
      } catch {
        toast("保存できませんでした。", { error: true });
        saveBtn.disabled = false;
      }
    });

    // 未保存の変更があるまま離れようとしたら確認する(戻るリンク・下部タブ・スワイプ戻りのどれでも)。
    // 開いた時点の内容と比べるので、元に戻せば確認は出ない。
    const snapshot = () => JSON.stringify([
      nameInput.value.trim(), displayInput.value.trim(), nutInputs.map(({ input }) => input.value.trim()), units.map((u) => [u.name.trim(), u.g]),
    ]);
    const initial = snapshot();
    setLeaveGuard(() => leaving || snapshot() === initial || confirm("変更が保存されていません。保存せずに移動しますか?\n(OKを押すと入力した内容は破棄されます)"));

    const children = [back, el("h1", {}, isCustom ? (id ? "自作食材を編集" : "自作食材を作る") : displayName(food))];
    if (isCustom) {
      children.push(el("section", { class: "card" },
        el("label", { class: "lbl" }, "食材名", nameInput),
        el("h2", {}, "栄養素(100gあたり)"),
        ...nutInputs.map(({ def, input }) => el("label", { class: "lbl" }, `${def.label}(${def.unit})`, input))));
    } else {
      children.push(
        el("p", { class: "hint" }, "成分表の食材です。栄養素は変更できません。表示名と単位を設定できます。"),
        el("section", { class: "card" },
          el("label", { class: "lbl" }, "表示名", displayInput),
          el("p", { class: "hint" }, `空欄にすると「${cleanName(food.name)}」と表示します。元の名前: ${food.name}`)));
    }
    children.push(
      el("section", { class: "card" },
        el("h2", {}, "単位"),
        el("p", { class: "hint" }, "例: 「個」= 50g。記録するときに「2個」のように入力できます。"),
        unitList, addUnitBtn),
      error, saveBtn);

    if (!isCustom) {
      children.push(el("button", {
        type: "button", class: "btn btn-link center reset-link",
        onclick: () => {
          if (!confirm("この食材の単位の設定を捨てて、初期値に戻します。元に戻せません。よろしいですか?")) return;
          finish("初期値に戻しました", deleteUnitOverride(food.id), `「${food.name}」の単位`, "初期値への復元");
        },
      }, "初期値に戻す"));
    }
    if (isCustom && id) {
      children.push(el("button", {
        type: "button", class: "btn btn-danger btn-far",
        onclick: () => {
          if (!confirm(`「${food.name}」を削除します。元に戻せません。\n(記録済みの食事・レシピは消えません)`)) return;
          finish("自作食材を削除しました", deleteCustomFood(id), `自作食材「${food.name}」`, "削除");
        },
      }, "この食材を削除"));
    }
    root.replaceChildren(...children);
    drawUnits();
  }

  return () => { alive = false; };
}
