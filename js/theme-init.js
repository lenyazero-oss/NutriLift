// テーマの適用と保存。<head> で同期的に読み込み、描画前に <html data-theme> を設定する(ちらつき防止)。
// 設定画面などからは window.NutriTheme を使う。保存先は端末の localStorage("theme")。
// 値は "auto"(OSのライト/ダーク設定に従う)またはテーマID。
// 検証用に、URLに ?theme=gym を付けて開くと、そのテーマを保存して適用する。
(function () {
  var KEY = "theme";
  var AUTO_LIGHT = "light";
  var AUTO_DARK = "dark";
  var root = document.documentElement;
  var mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

  // localStorage が使えない環境でも、このページの間は選択が効くようにメモリにも持つ
  var mem = null;
  function readRaw() {
    if (mem) return mem;
    try { return localStorage.getItem(KEY) || "auto"; } catch (e) { return "auto"; }
  }
  // 一覧にないID(削除されたテーマなど)は "auto" として扱い、見た目と選択表示がずれないようにする
  function known(choice) {
    if (choice === "auto") return true;
    return list().some(function (t) { return t.id === choice; });
  }
  function read() {
    var value = readRaw();
    return known(value) ? value : "auto";
  }
  function write(value) {
    mem = value;
    try { localStorage.setItem(KEY, value); } catch (e) { /* 保存できなくても適用はする */ }
  }

  // css/themes.css の [data-theme="..."] ブロックから、{ id, label } の一覧を作る
  function list() {
    var out = [];
    var seen = {};
    for (var i = 0; i < document.styleSheets.length; i++) {
      var sheet = document.styleSheets[i];
      // テーマ定義は themes.css のみ(他のCSSの [data-theme] 付きルールを選択肢に混ぜない)
      if (!sheet.href || !/themes\.css(\?|$)/.test(sheet.href)) continue;
      var rules;
      try { rules = sheet.cssRules; } catch (e) { continue; }
      for (var j = 0; j < rules.length; j++) {
        var rule = rules[j];
        if (!rule.selectorText || !rule.style) continue;
        var m = rule.selectorText.match(/\[data-theme="([\w-]+)"\]/);
        if (!m || seen[m[1]]) continue;
        seen[m[1]] = true;
        var label = rule.style.getPropertyValue("--theme-label").trim().replace(/^["']|["']$/g, "");
        out.push({ id: m[1], label: label || m[1] });
      }
    }
    return out;
  }

  function resolve(choice) {
    if (choice === "auto") return mq && mq.matches ? AUTO_DARK : AUTO_LIGHT;
    var known = list();
    // 一覧が取れない、または未知のIDなら、ライトにする
    return known.some(function (t) { return t.id === choice; }) ? choice : AUTO_LIGHT;
  }

  function apply() {
    var id = resolve(read());
    root.setAttribute("data-theme", id);
    // ブラウザの上部バーの色を、テーマの --theme-color に合わせる
    var color = getComputedStyle(root).getPropertyValue("--theme-color").trim();
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta && color) meta.setAttribute("content", color);
  }

  try {
    var param = new URLSearchParams(location.search).get("theme");
    // 一覧にあるテーマIDか "auto" のときだけ保存する(不正な値で設定が壊れないように)
    if (param && known(param)) write(param);
  } catch (e) { /* 無視 */ }

  // OSの設定が変わったとき、「自動」なら追従する
  if (mq) {
    var onChange = function () { if (read() === "auto") apply(); };
    if (mq.addEventListener) mq.addEventListener("change", onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }

  window.NutriTheme = {
    list: list,
    get: read,
    set: function (choice) { if (known(choice)) { write(choice); apply(); } },
  };
  apply();
})();
