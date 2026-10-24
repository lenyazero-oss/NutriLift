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

export function deleteMeal(id) {
  return fs.deleteDoc(fs.doc(col("meals"), id));
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
