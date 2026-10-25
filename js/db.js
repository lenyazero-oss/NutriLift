// Firestoreの読み書きはすべてここを経由する。パスは users/{uid}/... 固定。
import { db, fs } from "./firebase.js";
import { currentUid } from "./auth.js";
import { COLLECTIONS, SINGLES, decodeValue } from "./backup.js";

function col(name) {
  const uid = currentUid();
  if (!uid) throw new Error("ログインしていません");
  return fs.collection(db, "users", uid, name);
}

// 食事を記録する。IDを先に確定するため、オフライン時もすぐ { id } が得られる。
// done はサーバー応答まで解決されないので、呼び出し側は await せず、エラーだけ catch すること。
// createdAtMs を渡すと、その時刻で記録する(コピーで元の並び順を保つため)。省略時はサーバー時刻。
export function addMeal(meal, createdAtMs) {
  const ref = fs.doc(col("meals"));
  const createdAt = createdAtMs != null ? fs.Timestamp.fromMillis(createdAtMs) : fs.serverTimestamp();
  const done = fs.setDoc(ref, { ...meal, createdAt });
  return { id: ref.id, done };
}

// async にして、未ログインなどの同期例外も Promise の失敗として .catch で拾えるようにする
export async function deleteMeal(id) {
  return fs.deleteDoc(fs.doc(col("meals"), id));
}

// 削除の取り消し用。削除前のデータをそのままのIDで書き戻す。
// uid は削除した時点のユーザー。ログアウト・ユーザー切替後は別アカウントに書かないよう拒否する。
export async function restoreMeal(meal, uid) {
  if (!uid || uid !== currentUid()) throw new Error("ユーザーが変わったため元に戻せません");
  const { id, ...data } = meal;
  return fs.setDoc(fs.doc(col("meals"), id), { ...data, createdAt: data.createdAt ?? fs.serverTimestamp() });
}

// 指定日の食事を監視する(オフライン・書き込み直後もすぐ反映される)。戻り値は監視解除関数。
export function watchMeals(date, onData, onError) {
  const q = fs.query(col("meals"), fs.where("date", "==", date));
  return fs.onSnapshot(
    q,
    (snap) =>
      onData(
        snap.docs
          .map((d) => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) }))
          .sort((a, b) =>
            (a.createdAt?.toMillis?.() ?? 0) - (b.createdAt?.toMillis?.() ?? 0) || a.id.localeCompare(b.id))
      ),
    onError
  );
}

const withId = (d) => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) });

// 指定日の食事を1回だけ読む(「昨日からコピー」など。任意の日付に使える)
export async function getMealsOn(date) {
  const snap = await fs.getDocs(fs.query(col("meals"), fs.where("date", "==", date)));
  return snap.docs.map(withId);
}

// start(含む)以降の食事を1回だけ読む(「最近・よく使う食材」の集計用)。date の範囲条件のみで複合インデックスは不要。
export async function getMealsSince(start) {
  const snap = await fs.getDocs(fs.query(col("meals"), fs.where("date", ">=", start)));
  return snap.docs.map(withId);
}

// 期間(start〜end、両端を含む)の食事を監視する。date の範囲条件のみなので複合インデックスは不要。
export function watchMealsRange(start, end, onData, onError) {
  const q = fs.query(col("meals"), fs.where("date", ">=", start), fs.where("date", "<=", end));
  return fs.onSnapshot(
    q,
    (snap) => onData(snap.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) }))),
    onError
  );
}

// ---- レシピ: { name, servings, items:[{foodId, source, name, grams, n}] } ----
export function watchRecipes(onData, onError) {
  return fs.onSnapshot(
    col("recipes"),
    (snap) =>
      onData(
        snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => String(a.name).localeCompare(String(b.name), "ja"))
      ),
    onError
  );
}

export async function getRecipe(id) {
  const snap = await fs.getDoc(fs.doc(col("recipes"), id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// id が null なら新規作成。IDを先に確定するので、オフライン時もすぐ { id } が得られる。
export function saveRecipe(id, data) {
  const ref = id ? fs.doc(col("recipes"), id) : fs.doc(col("recipes"));
  const stamp = id ? {} : { createdAt: fs.serverTimestamp() };
  const done = fs.setDoc(ref, { ...data, ...stamp, updatedAt: fs.serverTimestamp() }, { merge: true });
  return { id: ref.id, done };
}

export async function deleteRecipe(id) {
  return fs.deleteDoc(fs.doc(col("recipes"), id));
}

// 目標値(未設定の項目は初期値で補う)
export async function getGoals(defaults) {
  const snap = await fs.getDoc(fs.doc(col("settings"), "goals"));
  const saved = snap.exists() ? snap.data() : {};
  const goals = { ...defaults };
  // 数値で正の項目だけ採用(不正な値で表示が壊れないように)
  for (const [k, v] of Object.entries(saved)) {
    if (Number.isFinite(v) && v > 0) goals[k] = v;
  }
  return goals;
}

// 目標値を保存する。呼び出し側は await せず、エラーだけ catch すること(オフライン時は応答が返らない)。
export function saveGoals(goals) {
  return fs.setDoc(fs.doc(col("settings"), "goals"), { ...goals, updatedAt: fs.serverTimestamp() }, { merge: true });
}

// 保存済みの目標値を消して初期値に戻す
export async function deleteGoals() {
  return fs.deleteDoc(fs.doc(col("settings"), "goals"));
}

// 身体情報(目標値の自動計算に使う): { sex, age, height, weight, activity, aim }。未保存なら null。
export async function getProfile() {
  const snap = await fs.getDoc(fs.doc(col("settings"), "profile"));
  return snap.exists() ? snap.data() : null;
}

// 呼び出し側は await せず、エラーだけ catch すること(オフライン時は応答が返らない)。
export function saveProfile(profile) {
  return fs.setDoc(fs.doc(col("settings"), "profile"), { ...profile, updatedAt: fs.serverTimestamp() });
}

// ---- バックアップ(書き出し/読み込み) ----
// 全データを読む。戻り値は backup.js の形: { collections:{meals:[{id,data}],…}, singles:{goals, profile} }
export async function readAllData() {
  const collections = {};
  for (const { key } of COLLECTIONS) {
    const snap = await fs.getDocs(col(key));
    collections[key] = snap.docs.map((d) => ({ id: d.id, data: d.data({ serverTimestamps: "estimate" }) }));
  }
  const singles = {};
  for (const { key } of SINGLES) {
    const snap = await fs.getDoc(fs.doc(col("settings"), key));
    singles[key] = snap.exists() ? snap.data({ serverTimestamps: "estimate" }) : null;
  }
  return { collections, singles };
}

const BATCH_SIZE = 400; // 1回の書き込みの上限(500)に余裕を持たせる
const COMMIT_TIMEOUT_MS = 30000;

// planImport の ops を書き込む。サーバーの応答まで待つので、オフラインではタイムアウトで失敗する。
// 途中で失敗した場合は、それまでの分が書き込み済みになる(ops の先頭が set、末尾が delete)。
export async function writeAllData(ops, onProgress) {
  let done = 0;
  for (let i = 0; i < ops.length; i += BATCH_SIZE) {
    const batch = fs.writeBatch(db);
    for (const op of ops.slice(i, i + BATCH_SIZE)) {
      const ref = fs.doc(col(op.coll), op.id);
      if (op.type === "set") batch.set(ref, decodeValue(op.data, (ms) => fs.Timestamp.fromMillis(ms)));
      else batch.delete(ref);
    }
    let timer;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), COMMIT_TIMEOUT_MS); });
    try {
      await Promise.race([batch.commit(), timeout]);
    } finally {
      clearTimeout(timer);
    }
    done = Math.min(i + BATCH_SIZE, ops.length);
    onProgress?.(done, ops.length);
  }
}

export async function listCustomFoods() {
  const snap = await fs.getDocs(col("customFoods"));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// 自作食材: { name, n:{kcal,protein,...}(100gあたり), units:[{name,g}] }。id が null なら新規作成。
export function saveCustomFood(id, data) {
  const ref = id ? fs.doc(col("customFoods"), id) : fs.doc(col("customFoods"));
  const stamp = id ? {} : { createdAt: fs.serverTimestamp() };
  const done = fs.setDoc(ref, { ...data, ...stamp, updatedAt: fs.serverTimestamp() }, { merge: true });
  return { id: ref.id, done };
}

export async function deleteCustomFood(id) {
  return fs.deleteDoc(fs.doc(col("customFoods"), id));
}

// 成分表の食材の単位の上書き。units が空配列なら「単位なし」として保存する。
export function saveUnitOverride(foodId, units) {
  return fs.setDoc(fs.doc(col("unitOverrides"), foodId), { units, updatedAt: fs.serverTimestamp() });
}

// 上書きを消して初期値に戻す
export async function deleteUnitOverride(foodId) {
  return fs.deleteDoc(fs.doc(col("unitOverrides"), foodId));
}

// { [foodId]: [{name, g}] }
export async function getUnitOverrides() {
  const snap = await fs.getDocs(col("unitOverrides"));
  const out = {};
  snap.docs.forEach((d) => (out[d.id] = d.data().units || []));
  return out;
}
