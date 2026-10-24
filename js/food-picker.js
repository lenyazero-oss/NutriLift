// 食材検索ピッカー(レシピ編集などで使う)。検索して選んだ食材を onPick に渡す。
import { el } from "./ui.js";
import { loadFoods, setUserData, searchFoods } from "./foods.js";
import { listCustomFoods, getUnitOverrides } from "./db.js";

// 自作食材・単位の読み込みは1回だけ(失敗時は次回やり直す)。食材マスタを編集したら invalidate すること。
let userDataPromise = null;
export function invalidateUserData() {
  userDataPromise = null;
}
function ensureUserData() {
  if (!userDataPromise) {
    userDataPromise = Promise.all([listCustomFoods(), getUnitOverrides()])
      .then(([customFoods, unitOverrides]) => setUserData({ customFoods, unitOverrides }))
      .catch((e) => {
        userDataPromise = null;
        throw e;
      });
  }
  return userDataPromise;
}

export function createFoodPicker({ onPick, placeholder = "食材名で検索(例: 鶏むね、卵)" }) {
  const status = el("p", { class: "hint" }, "食材データを読み込み中…");
  const search = el("input", {
    type: "search", placeholder, enterkeyhint: "search", autocomplete: "off",
    "aria-label": "食材検索", disabled: true,
  });
  const results = el("ul", { class: "list" });

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
        el("span", { class: "name" }, f.name),
        el("span", { class: "meta" },
          `${f.source === "custom" ? "自作 ・ " : ""}たんぱく質 ${(f.n.protein ?? 0).toFixed(1)}g / ${Math.round(f.n.kcal ?? 0)}kcal(100g)`));
      btn.addEventListener("click", () => {
        search.value = "";
        results.replaceChildren();
        search.blur();
        onPick(f);
      });
      results.append(el("li", {}, btn));
    });
  }
  search.addEventListener("input", showResults);

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
    } catch {
      status.hidden = false;
      status.textContent = "自作食材と単位の設定を読み込めませんでした(成分表の食材は検索できます)。";
    }
  })();

  return { node: el("div", {}, status, search, results) };
}
