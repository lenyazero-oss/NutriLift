// バックアップ(書き出し/読み込み)の形式・検証・統合の計画。Firestore には触らない(読み書きは db.js)。
// ファイル形式: { app:"NutriLift", format:1, exportedAt, data:{ meals:[{id,…}], recipes, customFoods, unitOverrides, displayNames, goals, profile } }
// Firestore の Timestamp は { "_ts": ミリ秒 } で表す。
import { NUTRIENTS } from "./nutrients.js";

export const FORMAT = 1;
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_DOCS = 10000; // Firestore 無料枠の書き込み(1日2万件)に収まる範囲
const MAX_DOC_CHARS = 900000; // 1ドキュメントの上限(1MiB)に余裕を持たせる

// コレクション単位のデータ(ドキュメントIDが複数ある)と、1つだけの設定(settings/<key>)
export const COLLECTIONS = [
  { key: "meals", label: "食事記録" },
  { key: "recipes", label: "レシピ" },
  { key: "customFoods", label: "自作食材" },
  { key: "unitOverrides", label: "単位の設定" },
  // optional: 後から追加した項目。古いバックアップにはないので、ファイルに無ければ「含まれない」として触らない
  { key: "displayNames", label: "表示名", optional: true },
  { key: "weights", label: "体重", optional: true },
];
export const SINGLES = [
  { key: "goals", label: "目標値" },
  { key: "profile", label: "身体情報" },
  { key: "mealTimes", label: "食事区分の時間帯", optional: true },
];

// ---- Timestamp の変換 ----
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isTs = (v) => isObj(v) && Object.keys(v).length === 1 && Number.isFinite(v._ts);
// 整数ミリ秒にそろえる(小数のままだと、書き出し→復元で1マイクロ秒ずれて「更新あり」と判定されることがある)
const toMillis = (v) => (v && typeof v.toMillis === "function" ? Math.floor(v.toMillis()) : isTs(v) ? v._ts : 0);

export function encodeValue(v) {
  if (v && typeof v.toMillis === "function") return { _ts: Math.floor(v.toMillis()) };
  if (Array.isArray(v)) return v.map(encodeValue);
  if (isObj(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encodeValue(x)]));
  return v;
}

// { _ts } を fromMillis(ミリ秒) で作る値(Firestore の Timestamp)に戻す
export function decodeValue(v, fromMillis) {
  if (isTs(v)) return fromMillis(v._ts);
  if (Array.isArray(v)) return v.map((x) => decodeValue(x, fromMillis));
  if (isObj(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, decodeValue(x, fromMillis)]));
  return v;
}

// ---- 検証(firestore.rules と同じ条件。書き込みが拒否されるデータを、書き込む前に見つける) ----
const str = (v, max) => typeof v === "string" && v.length >= 1 && v.length <= max;
const num = (v, min, max) => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
const keysOk = (d, allowed, required) =>
  Object.keys(d).every((k) => allowed.includes(k)) && required.every((k) => k in d);
const optTs = (d, k) => !(k in d) || isTs(d[k]);
// 栄養素のマップ。キーは英数字のみ("__proto__" や予約名、空文字を除く)
const numMap = (m, max) => isObj(m) && Object.keys(m).length <= max
  && Object.entries(m).every(([k, x]) => /^[A-Za-z][A-Za-z0-9]{0,40}$/.test(k) && num(x, -1e9, 1e9));
// レシピの食材: { foodId, source, name, grams, n }
const recipeItem = (it) => isObj(it)
  && Object.keys(it).every((k) => ["foodId", "source", "name", "grams", "n"].includes(k))
  && str(it.name, 200) && num(it.grams, 0, 1e9) && numMap(it.n ?? {}, 30)
  && (it.foodId == null || str(it.foodId, 100)) && (it.source == null || ["table", "custom"].includes(it.source));
const unitList = (u) => Array.isArray(u) && u.length <= 10 && u.every((x) => isObj(x) && str(x.name, 100) && num(x.g, 0, 1e6));

const GOAL_KEYS = NUTRIENTS.map((n) => n.key);

// 問題があれば理由を、なければ空文字を返す
const VALIDATORS = {
  meals(d) {
    if (!keysOk(d, ["date", "slot", "foodId", "source", "recipeId", "name", "grams", "qtyText", "nutrients", "items", "createdAt"],
      ["date", "slot", "source", "name", "grams", "qtyText", "nutrients"])) return "項目が不足しているか、余分な項目があります";
    if (typeof d.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(d.date)) return "日付の形式が正しくありません";
    if (!["morning", "noon", "night", "snack"].includes(d.slot)) return "食事区分が正しくありません";
    if (!["table", "custom", "recipe"].includes(d.source)) return "種類が正しくありません";
    if (d.foodId != null && !str(d.foodId, 100)) return "食材IDが正しくありません";
    if (d.recipeId != null && !str(d.recipeId, 100)) return "レシピIDが正しくありません";
    if (!str(d.name, 200)) return "名前が正しくありません";
    if (!num(d.grams, 0, 1e9)) return "グラム数が正しくありません";
    if (typeof d.qtyText !== "string" || d.qtyText.length > 100) return "数量の表記が正しくありません";
    if (!numMap(d.nutrients, 30)) return "栄養素が正しくありません";
    if ("items" in d && !(Array.isArray(d.items) && d.items.length <= 200 && d.items.every((x) => isObj(x) && str(x.name, 200) && num(x.grams, 0, 1e9)))) return "内訳が正しくありません";
    if (!optTs(d, "createdAt")) return "作成日時が正しくありません";
    return "";
  },
  recipes(d) {
    if (!keysOk(d, ["name", "servings", "items", "totalWeight", "createdAt", "updatedAt"], ["name", "servings", "items"])) return "項目が不足しているか、余分な項目があります";
    if ("totalWeight" in d && !num(d.totalWeight, 0.1, 1e9)) return "完成重量が正しくありません";
    if (!str(d.name, 100)) return "名前が正しくありません";
    if (!(num(d.servings, 0, 1e9) && d.servings > 0)) return "人前数が正しくありません";
    if (!Array.isArray(d.items) || d.items.length > 200 || !d.items.every(recipeItem)) return "食材の一覧が正しくありません";
    if (!optTs(d, "createdAt") || !optTs(d, "updatedAt")) return "日時が正しくありません";
    return "";
  },
  customFoods(d) {
    if (!keysOk(d, ["name", "n", "units", "createdAt", "updatedAt"], ["name", "n", "units"])) return "項目が不足しているか、余分な項目があります";
    if (!str(d.name, 100)) return "名前が正しくありません";
    if (!numMap(d.n, 30)) return "栄養素が正しくありません";
    if (!unitList(d.units)) return "単位が正しくありません";
    if (!optTs(d, "createdAt") || !optTs(d, "updatedAt")) return "日時が正しくありません";
    return "";
  },
  // 日付がドキュメントIDと同じで、実在する日付であること
  weights(d, id) {
    if (!keysOk(d, ["date", "kg", "updatedAt"], ["date", "kg"])) return "項目が不足しているか、余分な項目があります";
    if (d.date !== id || !/^\d{4}-\d{2}-\d{2}$/.test(d.date)) return "日付が正しくありません";
    if (!num(d.kg, 20, 400)) return "体重が正しくありません";
    if (!optTs(d, "updatedAt")) return "日時が正しくありません";
    return "";
  },
  displayNames(d) {
    if (!keysOk(d, ["name", "updatedAt"], ["name"])) return "項目が不足しているか、余分な項目があります";
    if (!str(d.name, 100)) return "表示名が正しくありません";
    if (!optTs(d, "updatedAt")) return "日時が正しくありません";
    return "";
  },
  unitOverrides(d) {
    if (!keysOk(d, ["units", "updatedAt"], ["units"])) return "項目が不足しているか、余分な項目があります";
    if (!unitList(d.units)) return "単位が正しくありません";
    if (!optTs(d, "updatedAt")) return "日時が正しくありません";
    return "";
  },
  goals(d) {
    if (!keysOk(d, [...GOAL_KEYS, "updatedAt"], [])) return "余分な項目があります";
    if (!GOAL_KEYS.every((k) => !(k in d) || num(d[k], 0, 99999))) return "目標値が正しくありません";
    if (!optTs(d, "updatedAt")) return "日時が正しくありません";
    return "";
  },
  mealTimes(d) {
    if (!keysOk(d, ["morningEnd", "noonEnd", "snackEnd", "updatedAt"], ["morningEnd", "noonEnd", "snackEnd"])) return "項目が不足しているか、余分な項目があります";
    const { morningEnd: a, noonEnd: b, snackEnd: c } = d;
    if (![a, b, c].every((h) => Number.isInteger(h) && h >= 1 && h <= 23) || !(a < b && b < c)) return "時刻が正しくありません";
    if (!optTs(d, "updatedAt")) return "日時が正しくありません";
    return "";
  },
  profile(d) {
    if (!keysOk(d, ["sex", "age", "height", "weight", "activity", "aim", "updatedAt"], ["sex", "age", "height", "weight", "activity", "aim"])) return "項目が不足しているか、余分な項目があります";
    if (!["male", "female"].includes(d.sex) || !["low", "light", "mid", "high"].includes(d.activity) || !["bulk", "keep", "cut"].includes(d.aim)) return "選択項目が正しくありません";
    if (!(num(d.age, 1, 150) && num(d.height, 1, 300) && num(d.weight, 1, 500))) return "年齢・身長・体重が正しくありません";
    if (!optTs(d, "updatedAt")) return "日時が正しくありません";
    return "";
  },
};

// ドキュメントIDとして使える文字列か(パスを壊す "/" や、予約された名前を除く)
const validId = (id) => str(id, 100) && !id.includes("/") && id !== "." && id !== ".." && !/^__.*__$/.test(id);

// ---- 書き出し ----
// current: { collections:{meals:[{id,data}],…}, singles:{goals:data|null, profile:data|null} }(db.js の readAllData)
export function buildBackup(current, now = new Date()) {
  const data = {};
  for (const { key } of COLLECTIONS) data[key] = current.collections[key].map(({ id, data: d }) => ({ id, ...encodeValue(d) }));
  for (const { key } of SINGLES) data[key] = current.singles[key] ? encodeValue(current.singles[key]) : null;
  return { app: "NutriLift", format: FORMAT, exportedAt: now.toISOString(), data };
}

// ---- 読み込み ----
// 成功: { backup: { exportedAt, collections, singles } }(readAllData と同じ形。日時は { _ts })
// 失敗: { error }。どちらの場合も既存データには触れない
export function parseBackup(text) {
  let b;
  try { b = JSON.parse(text); } catch { return { error: "JSONとして読み込めません。NutriLiftで書き出したファイルを選んでください。" }; }
  if (!isObj(b) || b.app !== "NutriLift") return { error: "NutriLiftのバックアップファイルではありません。" };
  if (b.format !== FORMAT) {
    return { error: Number(b.format) > FORMAT ? "新しい版のアプリで書き出されたファイルです。アプリを更新してから読み込んでください。" : "対応していない形式のファイルです。" };
  }
  if (!isObj(b.data)) return { error: "データが含まれていません。" };

  // 書き出したファイルには全項目が必ずある。欠けているのは壊れたファイルなので、「上書き」で全削除になる前に止める
  const collections = {};
  let total = 0;
  for (const { key, label, optional } of COLLECTIONS) {
    if (optional && !(key in b.data)) { collections[key] = null; continue; } // 古いバックアップ: この項目は含まれない
    const list = b.data[key];
    if (!Array.isArray(list)) return { error: `${label}がファイルにないか、形式が正しくありません。` };
    total += list.length;
    if (total > MAX_DOCS) return { error: `記録が多すぎます(${MAX_DOCS}件まで)。` };
    const seen = new Set();
    collections[key] = [];
    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      const where = `${label}の${i + 1}件目`;
      if (!isObj(item)) return { error: `${where}: 形式が正しくありません。` };
      const { id, ...data } = item;
      if (!validId(id)) return { error: `${where}: IDが正しくありません。` };
      if (seen.has(id)) return { error: `${where}: IDが重複しています。` };
      seen.add(id);
      const problem = VALIDATORS[key](data, id);
      if (problem) return { error: `${where}: ${problem}。` };
      if (JSON.stringify(data).length > MAX_DOC_CHARS) return { error: `${where}: データが大きすぎます。` };
      collections[key].push({ id, data });
    }
  }
  const singles = {};
  for (const { key, label, optional } of SINGLES) {
    if (optional && !(key in b.data)) { singles[key] = undefined; continue; } // 古いバックアップ: この項目は含まれない
    if (!(key in b.data)) return { error: `${label}がファイルにありません。` };
    const d = b.data[key];
    if (d !== null && !isObj(d)) return { error: `${label}の形式が正しくありません。` };
    const problem = d ? VALIDATORS[key](d) : "";
    if (problem) return { error: `${label}: ${problem}。` };
    singles[key] = d;
  }
  return { backup: { exportedAt: typeof b.exportedAt === "string" ? b.exportedAt : "", collections, singles } };
}

// ---- 読み込みの計画 ----
// キーの順序に依存しない比較用の文字列
const canon = (v) => JSON.stringify(v, (_, x) =>
  isObj(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x);

// 更新日時(なければ作成日時)。大きいほど新しい
const stampOf = (d) => Math.max(toMillis(d.updatedAt), toMillis(d.createdAt));

// mode: "merge"(統合: 同じIDは新しい方を残す。どちらかにしかない記録は残す)
//       "overwrite"(上書き: ファイルの内容に置き換える。ファイルにない記録は削除する)
// 戻り値: { ops:[{type:"set"|"delete", coll, id, data?}](set が先、delete が後), summary:[{label, add, update, same, remove}] }
export function planImport(file, current, mode) {
  const sets = [];
  const deletes = [];
  const summary = [];

  const compare = (label, coll, fileDocs, curDocs) => {
    const cur = new Map(curDocs.map((x) => [x.id, x.data]));
    const row = { label, add: 0, update: 0, same: 0, remove: 0 };
    const inFile = new Set();
    for (const { id, data } of fileDocs) {
      inFile.add(id);
      const existing = cur.get(id);
      if (!existing) { row.add++; sets.push({ type: "set", coll, id, data }); continue; }
      const newer = mode === "overwrite" ? true : stampOf(data) > stampOf(existing);
      // 上書きでも、中身がまったく同じなら書かない
      if (newer && canon(encodeValue(existing)) !== canon(data)) { row.update++; sets.push({ type: "set", coll, id, data }); }
      else row.same++;
    }
    if (mode === "overwrite") {
      for (const { id } of curDocs) if (!inFile.has(id)) { row.remove++; deletes.push({ type: "delete", coll, id }); }
    }
    summary.push(row);
  };

  for (const { key, label } of COLLECTIONS) {
    if (file.collections[key] === null) continue; // ファイルに含まれない項目は、統合でも上書きでも触らない
    compare(label, key, file.collections[key], current.collections[key]);
  }
  for (const { key, label } of SINGLES) {
    if (file.singles[key] === undefined) continue; // ファイルに含まれない項目は触らない
    const f = file.singles[key];
    const c = current.singles[key];
    compare(label, "settings",
      f ? [{ id: key, data: f }] : [],
      c ? [{ id: key, data: c }] : []);
  }
  return { ops: [...sets, ...deletes], summary };
}
