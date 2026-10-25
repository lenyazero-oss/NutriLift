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
// 食事区分の自動判定の境目(「何時まで」)。設定(settings/mealTimes)で変えられる。初期値は 朝〜10時・昼〜15時・間食〜17時・それ以外は夜
export const DEFAULT_SLOT_TIMES = { morningEnd: 10, noonEnd: 15, snackEnd: 17 };
let slotTimes = { ...DEFAULT_SLOT_TIMES };

// 1〜23の整数で、朝 < 昼 < 間食 の順か
export function validSlotTimes(t) {
  return !!t && [t.morningEnd, t.noonEnd, t.snackEnd].every((h) => Number.isInteger(h) && h >= 1 && h <= 23)
    && t.morningEnd < t.noonEnd && t.noonEnd < t.snackEnd;
}
export function setSlotTimes(t) {
  slotTimes = validSlotTimes(t) ? { morningEnd: t.morningEnd, noonEnd: t.noonEnd, snackEnd: t.snackEnd } : { ...DEFAULT_SLOT_TIMES };
}
export const getSlotTimes = () => ({ ...slotTimes });

// 時刻から食事区分を決める。times を渡すと、その境目で判定する(設定画面の例の表示用)
export function guessSlot(d = new Date(), times = slotTimes) {
  const h = d.getHours();
  if (h < times.morningEnd) return "morning";
  if (h < times.noonEnd) return "noon";
  if (h < times.snackEnd) return "snack";
  return "night";
}
