// 日付・食事区分の共通ヘルパー(日付はすべて端末のローカル日付 "YYYY-MM-DD")
export const SLOTS = [
  { key: "morning", label: "朝" },
  { key: "noon", label: "昼" },
  { key: "night", label: "夜" },
  { key: "snack", label: "間食" },
];

export function dateStr(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function shiftDate(str, days) {
  const [y, m, d] = str.split("-").map(Number);
  return dateStr(new Date(y, m - 1, d + days));
}

export function isValidDate(str) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str || "")) return false;
  const [y, m, d] = str.split("-").map(Number);
  return dateStr(new Date(y, m - 1, d)) === str; // 2026-13-45 のような存在しない日付を除く
}

// 時刻から食事区分を推定(〜10時=朝、〜15時=昼、〜17時=間食、以降=夜)
export function guessSlot(d = new Date()) {
  const h = d.getHours();
  if (h < 10) return "morning";
  if (h < 15) return "noon";
  if (h < 17) return "snack";
  return "night";
}
