// よく使う食材 / 最近使った食材。保存用のデータは持たず、直近の食事記録から集計する。
import { getMealsSince } from "./db.js";
import { currentUid } from "./auth.js";
import { findFood } from "./foods.js";
import { dateStr, shiftDate } from "./util.js";

const DAYS = 60; // 集計する期間
const CACHE_MS = 5 * 60 * 1000;
let cache = null; // { at, uid, stats }。ユーザーが変わったら invalidateUsage で捨てる

export function invalidateUsage() {
  cache = null;
}

// 食事を記録した直後に、読み直さずに集計へ反映する(Firestoreの読み取りを増やさないため)
export function recordUsage(food) {
  if (!cache || cache.uid !== currentUid()) return;
  const today = dateStr();
  const s = cache.stats.find((x) => x.foodId === food.id && x.source === food.source);
  if (s) { s.count++; s.last = today; }
  else cache.stats.push({ source: food.source, foodId: food.id, count: 1, last: today });
}

// レシピを記録した直後に、最終使用日へ反映する(レシピ一覧の「最近使った順」用)
export function recordRecipeUse(recipeId, date = dateStr()) {
  if (!cache || cache.uid !== currentUid()) return;
  if (date <= dateStr() && date > (cache.recipeLast.get(recipeId) || "")) cache.recipeLast.set(recipeId, date); // 未来日は数えない。新しい日付だけ採用
}

// 集計を(必要なら)読み込んで、キャッシュを返す。ユーザーが変わったら null
let inflight = null; // { uid, promise }: 読み込み中は、同じ呼び出しで共有する(60日分の記録を2回読まない)
function ensureCache() {
  const uid = currentUid();
  if (cache && cache.uid === uid && Date.now() - cache.at <= CACHE_MS) return Promise.resolve(cache);
  if (inflight && inflight.uid === uid) return inflight.promise;
  const promise = loadCache(uid).finally(() => { if (inflight?.promise === promise) inflight = null; });
  inflight = { uid, promise };
  return promise;
}

async function loadCache(uid) {
  {
    const today = dateStr();
    const meals = await getMealsSince(shiftDate(today, -DAYS));
    const stats = new Map(); // "source:foodId" → { source, foodId, count, last }
    const recipeLast = new Map(); // レシピID → 最後に記録した日
    for (const m of meals) {
      if (m.date > today) continue; // 未来の日付は数えない
      if (m.source === "recipe") {
        if (m.recipeId && m.date > (recipeLast.get(m.recipeId) || "")) recipeLast.set(m.recipeId, m.date);
        continue; // レシピの記録は、食材としては数えない
      }
      if (!m.foodId) continue;
      const key = `${m.source}:${m.foodId}`;
      const s = stats.get(key) || { source: m.source, foodId: m.foodId, count: 0, last: "" };
      s.count++;
      if (m.date > s.last) s.last = m.date;
      stats.set(key, s);
    }
    // 読み込み中にユーザーが変わっていたら、前のユーザーの集計を保存しない
    if (uid !== currentUid()) return null;
    cache = { at: Date.now(), uid, stats: [...stats.values()], recipeLast };
  }
  return cache;
}

// レシピID → 最後に記録した日(YYYY-MM-DD)。直近60日に記録がないレシピは含まれない。
export async function loadRecipeLast() {
  const c = await ensureCache();
  return c ? c.recipeLast : new Map();
}

// 戻り値: { recent: [{food, last}], frequent: [{food, count}] }(食材は foods.js で解決できたものだけ)。
// recent は新しい順、frequent は回数の多い順(同数なら新しい順)。
export async function loadUsage() {
  const c = await ensureCache();
  if (!c) return { recent: [], frequent: [] };
  const withFood = c.stats
    .map((s) => ({ ...s, food: findFood(s.foodId, s.source) }))
    .filter((s) => s.food); // 削除された自作食材などは除く
  return {
    recent: [...withFood].sort((a, b) => b.last.localeCompare(a.last) || b.count - a.count),
    frequent: [...withFood].sort((a, b) => b.count - a.count || b.last.localeCompare(a.last)),
  };
}
