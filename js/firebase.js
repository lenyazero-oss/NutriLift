// Firebase SDK(CDNのmodule)の初期化。他ファイルはここから auth / db を import する。
// SDKのバージョンは FIREBASE_VERSION で一元管理(auth.js もこの値を使う)。
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  memoryLocalCache,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig, isConfigured } from "./firebase-config.js";

// Firestoreの関数は db.js などからここ経由で使う(CDNのURLを1か所にまとめるため)
export * as fs from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
export { isConfigured };
export const FIREBASE_VERSION = "10.12.2";

export let app = null;
export let auth = null;
export let db = null;

// 未設定のままでも画面(ログイン画面の案内)を表示できるよう、初期化はスキップする
if (isConfigured) {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  try {
    // オフライン永続化(IndexedDB)
    db = initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch (e) {
    // IndexedDBが使えない環境(プライベートブラウズ等)ではメモリキャッシュで動作
    console.warn("オフライン永続化を有効にできませんでした", e);
    db = initializeFirestore(app, { localCache: memoryLocalCache() });
  }
}
