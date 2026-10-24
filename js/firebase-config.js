// Firebaseコンソール > プロジェクトの設定 > マイアプリ(ウェブ) の値に置き換えてください。
// これらの値は公開されても問題ありません(保護は Firestore ルールと承認済みドメインで行います)。
export const firebaseConfig = {
  apiKey: "AIzaSyAL4CzOzFUpWjC-vviuVKuE06SJtHCKCZ0",
  authDomain: "nutrilift-beb5a.firebaseapp.com",
  projectId: "nutrilift-beb5a",
  storageBucket: "nutrilift-beb5a.firebasestorage.app",
  messagingSenderId: "1046085034862",
  appId: "1:1046085034862:web:7117b1e9a58a84f742177f",
};

// 未設定(プレースホルダーのまま)かどうか
export const isConfigured = !firebaseConfig.apiKey.startsWith("YOUR_");
