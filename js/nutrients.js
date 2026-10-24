// 栄養素の定義。栄養素を追加するときは NUTRIENTS に1行足し、
// foods.json 側に同じ key を出力する(tools/convert_foods.py の --extra)。
// shown: true の項目が画面に表示される(最初は5項目)。
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

export function formatValue(def, value) {
  const v = Number(value) || 0;
  return `${v.toFixed(def.decimals)}${def.unit}`;
}
