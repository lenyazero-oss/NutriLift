// Firestoreの読み書きはすべてここを経由する。パスは users/{uid}/... 固定。
import { db, fs } from "./firebase.js";
import { currentUid } from "./auth.js";

function col(name) {
  const uid = currentUid();
  if (!uid) throw new Error("ログインしていません");
  return fs.collection(db, "users", uid, name);
}

// 食事を記録する。IDを先に確定するため、オフライン時もすぐ { id } が得られる。
// done はサーバー応答まで解決されないので、呼び出し側は await せず、エラーだけ catch すること。
export function addMeal(meal) {
  const ref = fs.doc(col("meals"));
  const done = fs.setDoc(ref, { ...meal, createdAt: fs.serverTimestamp() });
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

export async function listCustomFoods() {
  const snap = await fs.getDocs(col("customFoods"));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// { [foodId]: [{name, g}] }
export async function getUnitOverrides() {
  const snap = await fs.getDocs(col("unitOverrides"));
  const out = {};
  snap.docs.forEach((d) => (out[d.id] = d.data().units || []));
  return out;
}
