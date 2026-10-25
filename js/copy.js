// 食事のコピー(「昨日からコピー」)と、食事からのセット(レシピ)作成。画面には依存しない。
import { addMeal, saveRecipe } from "./db.js";
import { findFood } from "./foods.js";

// 並びは記録した順(createdAt、同じならID)
export function mealsInSlot(meals, slot) {
  return meals
    .filter((m) => m.slot === slot)
    .sort((a, b) => (a.createdAt?.toMillis?.() ?? 0) - (b.createdAt?.toMillis?.() ?? 0) || a.id.localeCompare(b.id));
}

// meals を toDate の slot にコピーする(コピー元の日付は問わない)。
// 栄養素は記録時点のスナップショットをそのまま写す。戻り値の ids は取り消し用、done は書き込みの完了(失敗の検知用)。
export function copyMeals(meals, toDate, slot) {
  const base = Date.now();
  const results = meals.map((m, i) => {
    const { id, createdAt, ...rest } = m; // eslint-disable-line no-unused-vars
    return addMeal({ ...rest, date: toDate, slot }, base + i); // 1msずつずらして、元の並び順を保つ
  });
  return { ids: results.map((r) => r.id), done: Promise.all(results.map((r) => r.done)) };
}

// 食事の一覧からセット(レシピ)の食材を作る。食材IDのない記録(レシピの記録)や、0gの記録は含められない。
export function mealsToRecipeItems(meals) {
  const items = [];
  for (const m of meals) {
    if (!m.foodId || m.source === "recipe" || !(m.grams > 0) || !m.nutrients) continue;
    // 食材がまだあれば、その100gあたりの値を使う。なければ記録のスナップショットから逆算する
    // (丸め済みの値なので、微量の栄養素は少しずれる)
    const food = findFood(m.foodId, m.source);
    const n = {};
    if (food?.n) {
      for (const [k, v] of Object.entries(food.n)) if (Number.isFinite(v)) n[k] = v;
    } else {
      for (const [k, v] of Object.entries(m.nutrients)) {
        if (Number.isFinite(v)) n[k] = Math.round((v * 100 / m.grams) * 100) / 100;
      }
    }
    items.push({ foodId: m.foodId, source: m.source, name: m.name, grams: m.grams, n });
  }
  return items;
}

// 食事からセットを保存する(1人前のレシピとして)。保存の完了を待たずに { id, done, count, skipped } を返す。
export function saveMealsAsSet(name, meals) {
  const items = mealsToRecipeItems(meals);
  if (!items.length) return null;
  const { id, done } = saveRecipe(null, { name, servings: 1, items });
  return { id, done, count: items.length, skipped: meals.length - items.length };
}
