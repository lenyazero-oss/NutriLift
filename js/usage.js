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

// 戻り値: { recent: [{food, last}], frequent: [{food, count}] }(食材は foods.js で解決できたものだけ)。
// recent は新しい順、frequent は回数の多い順(同数なら新しい順)。
export async function loadUsage() {
  const uid = currentUid();
  if (!cache || cache.uid !== uid || Date.now() - cache.at > CACHE_MS) {
    const today = dateStr();
    const meals = await getMealsSince(shiftDate(today, -DAYS));
    const stats = new Map(); // "source:foodId" → { source, foodId, count, last }
    for (const m of meals) {
      if (!m.foodId || m.source === "recipe" || m.date > today) continue; // レシピの記録・未来の日付は数えない
      const key = `${m.source}:${m.foodId}`;
      const s = stats.get(key) || { source: m.source, foodId: m.foodId, count: 0, last: "" };
      s.count++;
      if (m.date > s.last) s.last = m.date;
      stats.set(key, s);
    }
    // 読み込み中にユーザーが変わっていたら、前のユーザーの集計を保存しない
    if (uid !== currentUid()) return { recent: [], frequent: [] };
    cache = { at: Date.now(), uid, stats: [...stats.values()] };
  }
  const withFood = cache.stats
    .map((s) => ({ ...s, food: findFood(s.foodId, s.source) }))
    .filter((s) => s.food); // 削除された自作食材などは除く
  return {
    recent: [...withFood].sort((a, b) => b.last.localeCompare(a.last) || b.count - a.count),
    frequent: [...withFood].sort((a, b) => b.count - a.count || b.last.localeCompare(a.last)),
  };
}
