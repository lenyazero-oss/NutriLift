// 行を左にスワイプして削除する。fg(前面の行)を指に合わせて動かし、しきい値を超えて離したら onDelete を呼ぶ。
// 縦スクロールは妨げない(横方向の動きと判定したときだけ追従する)。
const THRESHOLD = 90; // これ以上動かして離すと削除
const MAX = 140; // 動かせる最大量

// fg にだけリスナーを付ける(行の下に開く編集フォームでの横ドラッグで、削除されないように)
export function swipeToDelete(row, fg, onDelete) {
  let removed = false; // 二重削除を防ぐ
  let x0 = 0;
  let y0 = 0;
  let dx = 0;
  let mode = null; // null(未判定) / "h"(横) / "v"(縦)
  let active = false;

  const reset = () => {
    fg.style.transition = "transform 0.2s";
    fg.style.transform = "";
  };

  fg.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) return;
    active = true;
    mode = null;
    dx = 0;
    x0 = e.touches[0].clientX;
    y0 = e.touches[0].clientY;
    fg.style.transition = "none";
  }, { passive: true });

  fg.addEventListener("touchmove", (e) => {
    if (!active) return;
    const mx = e.touches[0].clientX - x0;
    const my = e.touches[0].clientY - y0;
    if (mode === null) {
      if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
      mode = mx < 0 && Math.abs(mx) > Math.abs(my) * 1.5 ? "h" : "v"; // 左方向で、はっきり横のときだけ
    }
    if (mode !== "h") return;
    if (e.cancelable) e.preventDefault(); // 横スワイプ中は縦スクロールさせない
    dx = Math.min(0, Math.max(mx, -MAX));
    fg.style.transform = `translateX(${dx}px)`;
    row.classList.toggle("swipe-armed", dx <= -THRESHOLD);
  }, { passive: false });

  const end = () => {
    if (!active) return;
    active = false;
    row.classList.remove("swipe-armed");
    if (mode === "h" && dx <= -THRESHOLD && !removed) {
      removed = true;
      fg.style.transition = "transform 0.15s";
      fg.style.transform = "translateX(-110%)";
      setTimeout(onDelete, 150);
      // 削除が反映されず行が残った場合に備えて、位置を戻して再びスワイプできるようにする
      setTimeout(() => { removed = false; reset(); }, 1500);
    } else {
      reset();
    }
    mode = null;
    dx = 0;
  };
  fg.addEventListener("touchend", end);
  fg.addEventListener("touchcancel", end);
}
