// 栄養素の定義。栄養素を追加するときは NUTRIENTS に1行足し、
// foods.json 側に同じ key を出力する(tools/convert_foods.py の --extra)。
// shown: true の項目が画面に表示される(最初は5項目)。
// 追加したら firestore.rules の validGoals(許可キーと goal())にも同じ key を足すこと。
export const NUTRIENTS = [
  { key: "protein", label: "たんぱく質", unit: "g", decimals: 1, shown: true },
  { key: "kcal", label: "エネルギー", unit: "kcal", decimals: 0, shown: true },
  { key: "fat", label: "脂質", unit: "g", decimals: 1, shown: true },
  { key: "carb", label: "炭水化物", unit: "g", decimals: 1, shown: true },
  { key: "fiber", label: "食物繊維", unit: "g", decimals: 1, shown: true },
  // 拡張用(foods.json にデータを出力したうえで shown を true にする)
  { key: "calcium", label: "カルシウム", unit: "mg", decimals: 0, shown: false },
  { key: "iron", label: "鉄", unit: "mg", decimals: 1, shown: false },
  { key: "zinc", label: "亜鉛", unit: "mg", decimals: 1, shown: false },
  { key: "magnesium", label: "マグネシウム", unit: "mg", decimals: 0, shown: false },
  { key: "vitaminB6", label: "ビタミンB6", unit: "mg", decimals: 2, shown: false },
  { key: "vitaminD", label: "ビタミンD", unit: "μg", decimals: 1, shown: false },
];

export const shownNutrients = () => NUTRIENTS.filter((n) => n.shown);

// 目標値の初期値(設定画面で変更可)
export const DEFAULT_GOALS = { kcal: 2400, protein: 130, fat: 65, carb: 300, fiber: 20 };

// 「目標以上」が達成の栄養素(それ以外は「目標以内」が達成で、超えると超過扱い)。今日・履歴で共通
export const AT_LEAST = new Set(["protein", "fiber"]);

// 100gあたりの栄養素 n を grams グラム分に換算(未定義の栄養素は含めない)
export function scale(n, grams) {
  const out = {};
  for (const [k, v] of Object.entries(n)) {
    if (Number.isFinite(v)) out[k] = Math.round(v * grams) / 100;
  }
  return out;
}

// 食事記録(nutrients スナップショット)の合計
export function sumNutrients(meals) {
  const total = {};
  for (const m of meals) {
    for (const [k, v] of Object.entries(m.nutrients || {})) {
      if (Number.isFinite(v)) total[k] = (total[k] || 0) + v;
    }
  }
  return total;
}

// レシピの全体の栄養素(items の n は100gあたり、grams は使用量)
export function recipeTotals(items) {
  return sumNutrients(items.map((it) => ({ nutrients: scale(it.n || {}, it.grams) })));
}

// 食材の合計の重さ(g)
export const itemsWeight = (items) => (items || []).reduce((s, it) => s + (Number(it.grams) || 0), 0);

// レシピ全体の重さ(g): 完成重量(鍋の総重量など。任意)があればそれ、なければ食材の合計
export const recipeWeight = (recipe) => (recipe.totalWeight > 0 ? recipe.totalWeight : itemsWeight(recipe.items));

// 全体を「全体の人前数」で割り、portions 人前分にした栄養素と重さ(重さは完成重量があればそれを基準にする)
export function recipePortion(recipe, portions) {
  const ratio = portions / (recipe.servings || 1);
  const total = recipeTotals(recipe.items || []);
  const nutrients = {};
  for (const [k, v] of Object.entries(total)) nutrients[k] = Math.round(v * ratio * 100) / 100;
  return { nutrients, grams: Math.round(recipeWeight(recipe) * ratio * 10) / 10 };
}

export function formatValue(def, value) {
  const v = Number(value) || 0;
  return `${v.toFixed(def.decimals)}${def.unit}`;
}
