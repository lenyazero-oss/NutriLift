// 身体情報から1日の目標値の目安を計算する(画面・保存には依存しない)。
// エネルギーは Mifflin-St Jeor 式の基礎代謝 × 活動係数 ± 目的の調整。あくまで目安。
export const SEXES = [
  { key: "male", label: "男性" },
  { key: "female", label: "女性" },
];

export const ACTIVITIES = [
  { key: "low", label: "ほぼ運動なし", factor: 1.2 },
  { key: "light", label: "週1〜3日運動", factor: 1.375 },
  { key: "mid", label: "週3〜5日運動", factor: 1.55 },
  { key: "high", label: "ほぼ毎日運動", factor: 1.725 },
];

// kcal: 維持カロリーへの加減、proteinPerKg: 体重1kgあたりのたんぱく質(g)
export const AIMS = [
  { key: "bulk", label: "増量", kcal: 300, proteinPerKg: 2.0 },
  { key: "keep", label: "維持", kcal: 0, proteinPerKg: 2.0 },
  { key: "cut", label: "減量", kcal: -400, proteinPerKg: 2.2 },
];

export const DEFAULT_PROFILE = { sex: "male", age: 30, height: 170, weight: 65, activity: "mid", aim: "bulk" };

const FAT_RATIO = 0.25; // 脂質はエネルギーの25%
// たんぱく質はエネルギーの40%まで。食事摂取基準の目標量(20%台まで)より高いが、筋トレ・減量時の
// 体重換算(2.0〜2.2g/kg)を尊重しつつ、極端な体格で他の栄養素を圧迫しないための頭打ち。
const MAX_PROTEIN_RATIO = 0.4;
const MIN_KCAL = 1200;

// 入力が不正なら理由を、問題なければ空文字を返す
export function validateProfile(p) {
  if (!SEXES.some((s) => s.key === p.sex)) return "性別を選んでください。";
  if (!ACTIVITIES.some((a) => a.key === p.activity)) return "活動量を選んでください。";
  if (!AIMS.some((a) => a.key === p.aim)) return "目的を選んでください。";
  if (!(Number.isInteger(p.age) && p.age >= 18 && p.age <= 100)) return "年齢は18〜100の整数で入力してください。";
  if (!(p.height >= 100 && p.height <= 230)) return "身長は100〜230cmで入力してください。";
  if (!(p.weight >= 30 && p.weight <= 250)) return "体重は30〜250kgで入力してください。";
  return "";
}

// 食物繊維は日本人の食事摂取基準(2020年版)の成人(18歳以上)の目標量。未成年は区分が違うため対象外
const fiberFor = (sex, age) => (sex === "male" ? (age >= 65 ? 20 : 21) : age >= 65 ? 17 : 18);

// 目標値の提案(キーは DEFAULT_GOALS と同じ)。p は validateProfile を通ったもの。
export function calcGoals(p) {
  const bmr = 10 * p.weight + 6.25 * p.height - 5 * p.age + (p.sex === "male" ? 5 : -161);
  const factor = ACTIVITIES.find((a) => a.key === p.activity).factor;
  const aim = AIMS.find((a) => a.key === p.aim);
  const kcal = Math.max(MIN_KCAL, Math.round((bmr * factor + aim.kcal) / 10) * 10);
  // 体重換算のたんぱく質が、エネルギーに対して大きすぎる場合だけ上限をかける
  const protein = Math.min(Math.round(p.weight * aim.proteinPerKg), Math.round((kcal * MAX_PROTEIN_RATIO) / 4));
  const fat = Math.round((kcal * FAT_RATIO) / 9);
  const carb = Math.max(1, Math.round((kcal - protein * 4 - fat * 9) / 4)); // 残りを炭水化物に
  return { kcal, protein, fat, carb, fiber: fiberFor(p.sex, p.age) };
}
