// トレーニング日 / 休養日ごとの目標値。画面・保存には依存しない。
// 休養日の目標は「トレ日と同じで、変えたい項目だけ上書き」。上書きがなければトレ日の値を使う。
export const DAY_MODES = [
  { key: "training", label: "トレ日" },
  { key: "rest", label: "休養日" },
];

// base: トレ日の目標 { protein, kcal, … }、restOverrides: 休養日だけ違う項目、mode: "training" | "rest"
export function goalsForMode(base, restOverrides, mode) {
  return mode === "rest" ? { ...base, ...restOverrides } : base;
}

// 休養日の入力値(全項目)から、トレ日と違う項目だけを取り出す
export function diffFromBase(base, restValues) {
  const out = {};
  for (const [k, v] of Object.entries(restValues)) {
    if (Number.isFinite(v) && v !== base[k]) out[k] = v;
  }
  return out;
}
