// 静的ファイルのキャッシュ(オフライン起動用)。更新時は VERSION を上げる。
// 注意: ファイルを追加したら ASSETS にも追記すること(1つでも404だとインストールが失敗する)。
const VERSION = "v23";
const CACHE = `meal-app-${VERSION}`;
// Firebase SDK(バージョン固定)用。アプリの更新(VERSION)では削除しない。SDKを更新したら名前を変える。
const SDK_CACHE = "meal-sdk-v1";
const NETWORK_TIMEOUT_MS = 4000;
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/style.css",
  "./css/themes.css",
  "./js/theme-init.js",
  "./icons/icon.svg",
  "./js/app.js",
  "./js/firebase.js",
  "./js/firebase-config.js",
  "./js/auth.js",
  "./js/router.js",
  "./js/ui.js",
  "./js/views/login.js",
  "./js/views/add.js",
  "./js/views/today.js",
  "./js/views/recipes.js",
  "./js/views/recipe-edit.js",
  "./js/views/history.js",
  "./js/views/settings.js",
  "./js/views/foodmaster.js",
  "./js/views/foodedit.js",
  "./js/views/goals.js",
  "./js/food-picker.js",
  "./js/db.js",
  "./js/foods.js",
  "./js/nutrients.js",
  "./js/util.js",
  // data/*.json は初回アクセス時にキャッシュされる(未生成でもインストールが失敗しないよう除外)
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== SDK_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))]);
}

// ネットワーク優先(HTTPキャッシュを使わず常に最新を確認)。
// キャッシュがあるときは、通信が遅い場合に数秒でキャッシュへ切り替える。
// ページ遷移のみ、見つからなければ index.html にフォールバックする。
async function networkFirst(e, req) {
  const cached = await caches.match(req);
  try {
    const request = fetch(req, { cache: "no-cache" });
    const res = await (cached ? withTimeout(request, NETWORK_TIMEOUT_MS) : request);
    if (res.ok && res.type === "basic") {
      const copy = res.clone();
      e.waitUntil(caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {}));
    }
    return res;
  } catch {
    if (cached) return cached;
    if (req.mode === "navigate") return caches.match("./index.html");
    return Response.error();
  }
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET") return;

  // Firebase SDK(バージョン固定のCDN)はキャッシュ優先。オフライン起動に必要なため保存する。
  if (url.hostname === "www.gstatic.com" && url.pathname.startsWith("/firebasejs/")) {
    e.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              e.waitUntil(caches.open(SDK_CACHE).then((c) => c.put(req, copy)).catch(() => {}));
            }
            return res;
          })
      )
    );
    return;
  }

  if (url.origin !== location.origin) return;
  e.respondWith(networkFirst(e, req));
});
