// 食材検索ピッカー(レシピ編集などで使う)。検索して選んだ食材を onPick に渡す。
import { el } from "./ui.js";
import { loadFoods, setUserData, searchFoods, displayName, foodMeta } from "./foods.js";
import { listCustomFoods, getUnitOverrides, getDisplayNames } from "./db.js";
import { createQuickFoods } from "./quick-foods.js";

// 自作食材・単位の読み込みは1回だけ(失敗時は次回やり直す)。食材マスタを編集したら invalidate すること。
let userDataPromise = null;
let generation = 0; // 古い取得が後から終わって新しい結果を上書きしないための世代番号
export function invalidateUserData() {
  userDataPromise = null;
  generation++;
}
export function ensureUserData() {
  if (!userDataPromise) {
    const gen = generation;
    userDataPromise = Promise.all([listCustomFoods(), getUnitOverrides(), getDisplayNames()])
      .then(([customFoods, unitOverrides, names]) => {
        if (gen === generation) setUserData({ customFoods, unitOverrides, names });
      })
      .catch((e) => {
        if (gen === generation) userDataPromise = null;
        throw e;
      });
  }
  return userDataPromise;
}

// quick: true なら、検索欄にフォーカスしたとき(入力が空の間)「最近」「よく使う」の食材を出す。戻り値の destroy を画面の後片付けで呼ぶ。
export function createFoodPicker({ onPick, placeholder = "食材名で検索(例: 鶏むね、卵)", quick: withQuick = false }) {
  const status = el("p", { class: "hint" }, "食材データを読み込み中…");
  const search = el("input", {
    type: "search", placeholder, enterkeyhint: "search", autocomplete: "off",
    "aria-label": "食材検索", disabled: true,
  });
  const results = el("ul", { class: "list" });

  function pick(f) {
    search.value = "";
    results.replaceChildren();
    search.blur();
    quick?.setVisible(false);
    onPick(f);
  }
  const quick = withQuick ? createQuickFoods({ onPick: pick }) : null;

  function showResults() {
    results.replaceChildren();
    const q = search.value.trim();
    if (!q) return;
    const hits = searchFoods(q);
    if (!hits.length) {
      results.append(el("li", { class: "empty" }, "見つかりませんでした"));
      return;
    }
    hits.forEach((f) => {
      const btn = el("button", { type: "button", class: "list-item" },
        el("span", { class: "name" }, displayName(f)),
        el("span", { class: "meta" }, foodMeta(f)));
      btn.addEventListener("click", () => pick(f));
      results.append(el("li", {}, btn));
    });
  }
  search.addEventListener("input", () => {
    showResults();
    quick?.setVisible(search.value.trim() === "");
  });
  // フォーカスで「最近」「よく使う」を出し、リストの外をタップしたら閉じる(リストのタップで先に閉じてしまわないよう pointerdown で判定)
  const outside = (e) => { if (!node.contains(e.target)) quick?.setVisible(false); };
  if (quick) {
    search.addEventListener("focus", () => { if (!search.value.trim()) quick.setVisible(true); });
    search.addEventListener("pointerdown", () => { if (!search.value.trim()) quick.setVisible(true); });
    document.addEventListener("pointerdown", outside);
  }

  (async () => {
    try {
      await loadFoods();
    } catch (e) {
      status.textContent = `食材データを読み込めません: ${e.message}`;
      status.className = "error";
      return;
    }
    status.hidden = true;
    search.disabled = false;
    try {
      await ensureUserData();
      if (search.value.trim()) showResults();
      quick?.refresh(); // 自作食材も解決できるよう、ユーザーデータのあとに集計する
    } catch {
      status.hidden = false;
      status.textContent = "自作食材と単位の設定を読み込めませんでした(成分表の食材は検索できます)。";
    }
  })();

  const node = el("div", {}, status, search, ...(quick ? [quick.node] : []), results);
  return { node, destroy: () => document.removeEventListener("pointerdown", outside) };
}
