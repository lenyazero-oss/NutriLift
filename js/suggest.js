// 不足分の提案: 残りのたんぱく質を、よく使う食材で補うならどれくらいか。画面には依存しない。
import { loadUsage } from "./usage.js";
import { searchFoods, unitsFor, displayName } from "./foods.js";

const MIN_REMAIN = 5; // これ未満の不足は提案しない
const MIN_PROTEIN_PER_100G = 10; // たんぱく質の多い食材だけ(100gあたり)
const MAX_GRAMS = 400; // 量が多すぎる提案は避ける
// よく使う食材の記録がまだないときの候補(成分表を検索して使う)
const FALLBACK_QUERIES = ["にわとり むね 皮なし 生", "鶏卵 全卵 生", "納豆"];

const roundTo5 = (g) => Math.max(5, Math.round(g / 5) * 5);

// 食材 food を grams 食べる、の表示用の数量(例: 「約150g(1.5個)」)
function describe(food, grams) {
  const unit = unitsFor(food).find((u) => u.g >= 20 && grams / u.g >= 0.5 && grams / u.g <= 10);
  const count = unit ? Math.round((grams / unit.g) * 2) / 2 : null;
  return `約${grams}g${unit ? `(${count}${unit.name})` : ""}`;
}

// remain: 残りのたんぱく質(g)。戻り値: [{ food, grams, text }](最大2件)。提案できなければ空配列。
export async function suggestProtein(remain) {
  if (!(remain >= MIN_REMAIN)) return [];
  let foods = [];
  try {
    const usage = await loadUsage();
    foods = usage.frequent.map((u) => u.food);
  } catch { /* 集計できなければ、候補の食材だけで提案する */ }
  if (!foods.length) foods = FALLBACK_QUERIES.map((q) => searchFoods(q)[0]).filter(Boolean);
  foods = foods.filter((f) => (f.n?.protein ?? 0) >= MIN_PROTEIN_PER_100G); // 値のない食材は除く(0除算・NaNを避ける)

  const out = [];
  for (const food of foods) {
    const grams = roundTo5((remain / food.n.protein) * 100);
    if (!Number.isFinite(grams) || grams > MAX_GRAMS) continue;
    out.push({ food, grams, text: `${displayName(food)} ${describe(food, grams)}` });
    if (out.length >= 2) break;
  }
  return out;
}
