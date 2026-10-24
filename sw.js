// 静的ファイルのキャッシュ(オフライン起動用)。更新時は VERSION を上げる。
// 注意: ファイルを追加したら ASSETS にも追記すること(1つでも404だとインストールが失敗する)。
const VERSION = "v7";
const CACHE = `meal-app-${VERSION}`;
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/style.css",
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
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 同一オリジンのGETのみ: ネットワーク優先(HTTPキャッシュを使わず常に最新を確認)、
// 失敗時にキャッシュ。ページ遷移のみ index.html にフォールバックする。
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
              e.waitUntil(caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {}));
            }
            return res;
          })
      )
    );
    return;
  }

  if (url.origin !== location.origin) return;
  e.respondWith(
    fetch(req, { cache: "no-cache" })
      .then((res) => {
        if (res.ok && res.type === "basic") {
          const copy = res.clone();
          e.waitUntil(caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {}));
        }
        return res;
      })
      .catch(async () => {
        const cached = await caches.match(req);
        if (cached) return cached;
        if (req.mode === "navigate") return caches.match("./index.html");
        return Response.error();
      })
  );
});
