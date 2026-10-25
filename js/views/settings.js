// 設定: テーマの選択、食材マスタへの入口、ログアウト
import { el, toast } from "../ui.js";
import { signOut, currentUserInfo } from "../auth.js";

const METHOD_LABEL = { google: "Googleでログイン中", password: "メールアドレスでログイン中", other: "ログイン中(方式不明)" };

// ログイン中のアカウントの表示。方式ごとにデータが別になる点も添える
function accountCard() {
  const info = currentUserInfo();
  if (!info) return null;
  return el("section", { class: "card" },
    el("h2", {}, "アカウント"),
    el("p", {}, METHOD_LABEL[info.method]),
    info.email ? el("p", { class: "hint account-email" }, info.email) : null,
    el("p", { class: "hint" }, "Googleとメールのログインはデータが別々です。別の方法でログインすると記録が見えなくなります(消えてはいません)。いつも同じ方法でログインしてください。"));
}

// 色見本。data-theme を付けた要素の中では、そのテーマのトークンで描画される
function swatch(themeId) {
  return el("div", { class: "tp", "data-theme": themeId, "aria-hidden": "true" },
    el("div", { class: "tp-track" }, el("div", { class: "tp-fill" })),
    el("div", { class: "tp-row" },
      el("span", { class: "tp-dot" }), el("span", { class: "tp-dot warn" }), el("span", { class: "tp-aa" }, "Aa")));
}

// テーマ選択。タップした瞬間に切り替わる(保存もその場で行う)
function themePicker() {
  const api = window.NutriTheme;
  if (!api) return el("p", { class: "hint" }, "テーマを読み込めませんでした。");

  const group = el("div", { class: "theme-grid", role: "group", "aria-label": "テーマ" });
  const options = [
    { id: "auto", label: "自動", sub: "iPhoneのライト/ダーク設定に合わせる", preview: el("div", { class: "tp-pair", "aria-hidden": "true" }, swatch("light"), swatch("dark")) },
    ...api.list().map((t) => ({ id: t.id, label: t.label, preview: swatch(t.id) })),
  ];

  const buttons = options.map((o) => {
    const btn = el("button", {
      type: "button", class: `theme-card${o.id === "auto" ? " theme-auto" : ""}`,
      "data-theme": o.id === "auto" ? false : o.id,
      onclick: () => { api.set(o.id); mark(); },
    },
      el("span", { class: "theme-name" }, o.label, el("span", { class: "theme-on", "aria-hidden": "true" }, "✓ 選択中")),
      o.sub ? el("span", { class: "theme-sub" }, o.sub) : null,
      o.preview);
    return { id: o.id, btn };
  });

  function mark() {
    const current = api.get();
    buttons.forEach(({ id, btn }) => {
      const on = id === current;
      btn.classList.toggle("on", on);
      btn.setAttribute("aria-pressed", String(on)); // 矢印キー操作が不要なトグルボタンとして読み上げる
    });
  }

  group.append(...buttons.map((b) => b.btn));
  mark();
  return group;
}

export function renderSettings(root) {
  root.append(
    el("h1", {}, "設定"),
    el("ul", { class: "list" },
      el("li", {}, el("a", { class: "list-item", href: "#/goals" },
        el("span", { class: "name" }, "目標値"),
        el("span", { class: "meta" }, "1日のたんぱく質・エネルギーなどの目標を変更"))),
      el("li", {}, el("a", { class: "list-item", href: "#/foodmaster" },
        el("span", { class: "name" }, "食材マスタ"),
        el("span", { class: "meta" }, "食材の単位(個・杯など)の設定と、自作食材の登録"))),
      el("li", {}, el("a", { class: "list-item", href: "#/mealtimes" },
        el("span", { class: "name" }, "食事区分の時間帯"),
        el("span", { class: "meta" }, "朝・昼・夜・間食を自動で決める時間の境目"))),
      el("li", {}, el("a", { class: "list-item", href: "#/backup" },
        el("span", { class: "name" }, "バックアップ"),
        el("span", { class: "meta" }, "全データをファイルに書き出す・ファイルから読み込む")))),
    el("section", { class: "card" },
      el("h2", {}, "テーマ"),
      el("p", { class: "hint" }, "タップするとすぐに切り替わります。この端末だけの設定です。"),
      themePicker()),
    ...[accountCard()].filter(Boolean),
    el("button", {
      type: "button", class: "btn btn-danger btn-far",
      onclick: () => {
        const email = currentUserInfo()?.email;
        if (!confirm(email ? `${email} をログアウトしますか?` : "ログアウトしますか?")) return;
        signOut().catch(() => toast("ログアウトできませんでした。", { error: true }));
      },
    }, "ログアウト"));
}
