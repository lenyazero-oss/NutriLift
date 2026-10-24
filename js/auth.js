// 認証方式ごとに関数を分離(方式の追加・切替が容易な構造)。
import {
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  onAuthStateChanged,
  signOut as fbSignOut,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { auth } from "./firebase.js";

// ポップアップが使えない環境ではリダイレクト方式へ切り替える
const FALLBACK_TO_REDIRECT = [
  "auth/popup-blocked",
  "auth/operation-not-supported-in-this-environment",
];

export async function signInGoogle() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    if (FALLBACK_TO_REDIRECT.includes(e.code)) {
      await signInWithRedirect(auth, provider);
      return;
    }
    throw e;
  }
}

export function signInEmail(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}

// 予備ログイン用。初回のみ新規登録に使う
export function signUpEmail(email, password) {
  return createUserWithEmailAndPassword(auth, email, password);
}

export function resetPassword(email) {
  return sendPasswordResetEmail(auth, email);
}

// リダイレクト方式から戻ってきた際のエラーを拾う
export function checkRedirectResult() {
  return getRedirectResult(auth);
}

export function signOut() {
  return fbSignOut(auth);
}

export function onAuth(callback) {
  return onAuthStateChanged(auth, callback);
}

export function currentUid() {
  return auth.currentUser ? auth.currentUser.uid : null;
}

// エラーコードを日本語メッセージに変換
export function authErrorMessage(e) {
  const map = {
    "auth/invalid-email": "メールアドレスの形式が正しくありません。",
    "auth/missing-password": "パスワードを入力してください。",
    "auth/weak-password": "パスワードは6文字以上にしてください。",
    "auth/email-already-in-use": "このメールアドレスは既に登録されています。",
    "auth/invalid-credential": "メールアドレスまたはパスワードが違います。",
    "auth/user-not-found": "メールアドレスまたはパスワードが違います。",
    "auth/wrong-password": "メールアドレスまたはパスワードが違います。",
    "auth/too-many-requests": "試行回数が多すぎます。しばらくしてからお試しください。",
    "auth/network-request-failed": "通信に失敗しました。接続を確認してください。",
    "auth/popup-closed-by-user": "ログインがキャンセルされました。",
    "auth/cancelled-popup-request": "ログインがキャンセルされました。",
    "auth/unauthorized-domain":
      "このドメインは承認されていません。Firebaseの承認済みドメインを確認してください。",
    "auth/operation-not-allowed":
      "この認証方式が有効になっていません。FirebaseのAuthenticationを確認してください。",
  };
  return map[e.code] || `ログインに失敗しました(${e.code || "不明なエラー"})`;
}
