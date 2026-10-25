// バックアップ: 全データをJSONファイルに書き出す / ファイルから読み込む(統合・上書き)
import { el, toast } from "../ui.js";
import { readAllData, writeAllData, getMealTimes } from "../db.js";
import { buildBackup, parseBackup, planImport, COLLECTIONS, SINGLES, MAX_FILE_BYTES } from "../backup.js";
import { invalidateUserData } from "../food-picker.js";
import { setLeaveGuard } from "../router.js";
import { dateStr, setSlotTimes } from "../util.js";

const MODES = [
  { key: "merge", label: "統合", sub: "同じ記録は新しい方を残す" },
  { key: "overwrite", label: "上書き", sub: "ファイルの内容に置き換える" },
];

const countLine = (current) =>
  [...COLLECTIONS, ...SINGLES]
    .map(({ key, label }) => {
      const n = key in current.collections ? current.collections[key]?.length ?? 0 : current.singles[key] ? 1 : 0;
      return n ? `${label} ${n}件` : null;
    })
    .filter(Boolean);

export function renderBackup(root) {
  let alive = true;
  let busy = false; // 読み込みの書き込み中
  const back = el("a", { class: "back", href: "#/settings" }, "← 設定");
  setLeaveGuard(() => !busy || confirm("読み込み中です。画面を離れると途中で止まる可能性があります。移動しますか?"));

  // ---- 書き出し ----
  const exportBtn = el("button", { type: "button", class: "btn btn-big btn-primary" }, "データを書き出す");
  const exportMsg = el("p", { class: "hint", "aria-live": "polite" });
  const saveAgain = el("button", { type: "button", class: "btn", hidden: true }, "ファイルを保存する");
  let pendingFile = null;

  // iPhone では共有シート(「ファイルに保存」)が使える。使えない環境ではダウンロードにする
  async function deliver(file, preferDownload = false) {
    if (!preferDownload && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file] });
      return;
    }
    const url = URL.createObjectURL(file);
    const a = el("a", { href: url, download: file.name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  const exportNote = el("p", { class: "hint", "aria-live": "polite" });
  exportBtn.addEventListener("click", async () => {
    if (busy) return toast("読み込み中です。終わってから書き出してください。");
    exportBtn.disabled = true;
    exportBtn.textContent = "書き出し中…";
    exportMsg.textContent = "";
    exportNote.textContent = "";
    saveAgain.hidden = true;
    try {
      const current = await readAllData();
      const lines = countLine(current);
      if (!lines.length) { exportMsg.textContent = "書き出すデータがありません。"; return; }
      const text = JSON.stringify(buildBackup(current), null, 1);
      pendingFile = new File([text], `nutrilift-backup-${dateStr()}.json`, { type: "application/json" });
      exportMsg.textContent = `書き出す内容: ${lines.join("、")}`;
      try {
        await deliver(pendingFile);
        // 共有シートでファイルに保存したかどうかはアプリからは分からないため、確認を促す
        if (alive) exportNote.textContent = "共有シートを開きました。「ファイルに保存」を選んだか、ファイルアプリで確認してください。";
      } catch (e) {
        if (e?.name === "AbortError") return; // 共有シートを閉じただけ
        // 非同期の処理のあとは共有シートを開けないことがあるため、もう一度タップしてもらう
        if (alive) {
          saveAgain.hidden = false;
          exportNote.textContent = "下のボタンを押して保存してください。";
        }
      }
    } catch {
      if (alive) toast("データを読み込めませんでした。通信状況を確認して、もう一度お試しください。", { error: true, duration: 6000 });
    } finally {
      if (alive) {
        exportBtn.disabled = false;
        exportBtn.textContent = "データを書き出す";
      }
    }
  });
  saveAgain.addEventListener("click", async () => {
    try {
      await deliver(pendingFile);
      saveAgain.hidden = true;
    } catch (e) {
      if (e?.name === "AbortError") return;
      try { await deliver(pendingFile, true); saveAgain.hidden = true; } // 共有できなければダウンロードにする
      catch { toast("保存できませんでした。", { error: true }); }
    }
  });

  // ---- 読み込み ----
  const fileInput = el("input", { type: "file", accept: "application/json,.json", hidden: true, "aria-label": "バックアップファイル" });
  const pickBtn = el("button", { type: "button", class: "btn btn-big", onclick: () => fileInput.click() }, "データを読み込む");
  const importError = el("p", { class: "error", role: "alert", hidden: true });
  const importBox = el("div", { hidden: true });
  // 読み込み完了後に残す結果(トーストは数秒で消えるため)
  const doneBox = el("div", { class: "preview", hidden: true, role: "status" });

  // keepBox: 読み込みの操作を続けられるよう、内容の表示は残す(ファイルの問題のときは隠す)
  const showError = (msg, keepBox = false) => {
    importError.textContent = msg;
    importError.hidden = !msg;
    if (msg) {
      if (!keepBox) importBox.hidden = true;
      importError.scrollIntoView({ block: "center" });
    }
  };

  let pickSeq = 0; // 続けて別のファイルを選んだとき、遅れて終わった古い読み込みを捨てる
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    fileInput.value = ""; // 同じファイルをもう一度選べるように
    if (!file) return;
    const seq = ++pickSeq;
    showError("");
    importBox.hidden = true;
    doneBox.hidden = true;
    if (file.size > MAX_FILE_BYTES) return showError("ファイルが大きすぎます(20MBまで)。");
    let parsed;
    try {
      parsed = parseBackup(await file.text());
    } catch {
      return showError("ファイルを読み込めませんでした。");
    }
    if (seq !== pickSeq) return;
    if (parsed.error) return showError(`${parsed.error}既存のデータは変更されていません。`);
    let current;
    try {
      current = await readAllData();
    } catch {
      return showError("現在のデータを読み込めませんでした。通信状況を確認して、もう一度お試しください。");
    }
    if (alive && seq === pickSeq) showPlan(parsed.backup, current);
  });

  function showPlan(backup, initial) {
    let current = initial; // 書き込みに失敗したあとは読み直して、計画を作り直す
    let mode = "merge";
    const summary = el("div", { class: "preview" });
    const modeHint = el("p", { class: "hint" });
    const runBtn = el("button", { type: "button", class: "btn btn-big btn-primary" }, "読み込む");
    const progress = el("p", { class: "hint", "aria-live": "polite" });

    const modeBtns = MODES.map((m) => {
      const b = el("button", { type: "button", class: "seg seg-two" }, m.label, el("span", { class: "seg-sub" }, m.sub));
      b.addEventListener("click", () => { if (busy) return; mode = m.key; paint(); });
      return { b, m };
    });
    let plan = null;
    function paint() {
      modeBtns.forEach(({ b, m }) => {
        b.classList.toggle("on", m.key === mode);
        b.setAttribute("aria-pressed", String(m.key === mode));
      });
      const overwrite = mode === "overwrite";
      modeHint.className = overwrite ? "error" : "hint";
      modeHint.textContent = overwrite
        ? "【注意】現在のデータのうち、ファイルにない記録は削除されます。先に「データを書き出す」でバックアップを取ることをおすすめします。"
        : "同じ記録(同じID)は、更新日時が新しい方を残します。どちらかにしかない記録は、すべて残ります。迷ったらこちらです。";
      plan = planImport(backup, current, mode);
      const removes = plan.summary.reduce((s, r) => s + r.remove, 0);
      // 0件の項目は出さない(件数の行を短く保つ)。削除は色と文字の両方で目立たせる
      summary.replaceChildren(...plan.summary
        .filter((r) => r.add + r.update + r.same + r.remove > 0)
        .map((r) => el("div", { class: "preview-n" },
          el("strong", {}, r.label),
          ...[["追加", r.add], ["更新", r.update], ["変更なし", r.same]].filter(([, n]) => n > 0).map(([t, n]) => el("span", {}, `${t} ${n}`)),
          overwrite && r.remove > 0 ? el("span", { class: "over-text" }, `削除 ${r.remove}`) : null)));
      if (!summary.childNodes.length) summary.replaceChildren(el("div", { class: "preview-g" }, "ファイルにも現在のデータにも記録がありません"));
      runBtn.disabled = busy || plan.ops.length === 0;
      runBtn.classList.toggle("btn-danger", overwrite && removes > 0);
      runBtn.classList.toggle("btn-primary", !(overwrite && removes > 0));
      runBtn.textContent = plan.ops.length === 0 ? "変更する内容がありません"
        : overwrite && removes > 0 ? `上書きして${removes}件を削除する` : "読み込む";
    }

    runBtn.addEventListener("click", async () => {
      if (busy || !plan?.ops.length) return;
      if (navigator.onLine === false) return toast("オフラインです。通信できる場所で、もう一度お試しください。", { error: true, duration: 6000 });
      const removes = plan.summary.reduce((s, r) => s + r.remove, 0);
      const writes = plan.ops.filter((o) => o.type === "set").length;
      const message = mode === "merge"
        ? `ファイルの内容を統合します(${writes}件を追加・更新)。\n現在のデータは削除されません。\nよろしいですか?`
        : `ファイルにない${removes}件を削除し、${writes}件を書き込みます(上書き)。\n削除したものは元に戻せません。先に「データを書き出す」でバックアップを取ることをおすすめします。\nよろしいですか?`;
      if (!confirm(message)) return;
      const total = plan.ops.length;
      const wasOverwrite = mode === "overwrite";
      busy = true;
      showError("");
      pickBtn.disabled = true;
      exportBtn.disabled = true; // 途中の状態を書き出さない
      runBtn.disabled = true;
      modeBtns.forEach(({ b }) => (b.disabled = true));
      try {
        await writeAllData(plan.ops, (done, total) => { if (alive) progress.textContent = `書き込み中… ${done} / ${total}`; });
        invalidateUserData(); // 自作食材・単位が変わったので、検索用のキャッシュを捨てる
        getMealTimes().then((t) => setSlotTimes(t)).catch(() => {}); // 食事区分の時間帯も、再起動せずに反映する
        if (alive) {
          importBox.hidden = true;
          // トーストは数秒で消えるため、結果は画面にも残す
          doneBox.replaceChildren(
            el("div", { class: "preview-g" }, `読み込みました(${total}件${wasOverwrite && removes ? `。うち削除${removes}件` : ""})`),
            el("a", { class: "btn", href: `#/today` }, "今日の画面で確認する"));
          doneBox.hidden = false;
          doneBox.scrollIntoView({ block: "nearest" });
        }
      } catch (e) {
        invalidateUserData();
        if (alive) {
          // 途中まで書き込まれている可能性があるので、現在のデータを読み直して計画を作り直す(続きから進められる)
          try { current = await readAllData(); } catch { /* 読めなければ、前の計画のまま */ }
          paint();
          showError(e?.message === "timeout"
            ? "通信がタイムアウトしました。途中まで書き込まれている可能性があり、通信が戻ると続きが反映される場合もあります。しばらく待ってから、もう一度「読み込む」を押してください(続きから進みます)。"
            : "読み込み中にエラーが出ました。途中まで書き込まれている可能性があります。もう一度「読み込む」を押してください(続きから進みます)。", true);
        }
      } finally {
        busy = false;
        if (alive) {
          pickBtn.disabled = false;
          exportBtn.disabled = false;
          modeBtns.forEach(({ b }) => (b.disabled = false));
          progress.textContent = "";
          if (!importBox.hidden) runBtn.disabled = plan.ops.length === 0;
        }
      }
    });

    importBox.replaceChildren(
      el("p", {}, `${backup.exportedAt ? `書き出し日時: ${new Date(backup.exportedAt).toLocaleString("ja-JP").replace("Invalid Date", "不明")}` : "書き出し日時: 不明"}`),
      el("p", { class: "hint" }, `ファイルの内容: ${countLine(backup).join("、") || "なし"}`),
      el("div", { class: "segs", role: "group", "aria-label": "読み込み方" }, modeBtns.map((x) => x.b)),
      modeHint, summary, progress, runBtn);
    importBox.hidden = false;
    paint();
    importBox.scrollIntoView({ block: "nearest" });
  }

  root.append(
    back,
    el("h1", {}, "バックアップ"),
    el("section", { class: "card" },
      el("h2", {}, "書き出し"),
      el("p", { class: "hint" }, "食事記録・レシピ・自作食材・単位の設定・目標値・身体情報を、1つのJSONファイルに保存します。iPhoneでは「ファイルに保存」を選んでください。"),
      exportBtn, exportMsg, exportNote, saveAgain),
    el("section", { class: "card" },
      el("h2", {}, "読み込み"),
      el("p", { class: "hint" }, "NutriLiftで書き出したファイルを読み込みます。ファイルに問題があるときは、現在のデータは変更されません。"),
      pickBtn, fileInput, importError, importBox, doneBox));

  return () => { alive = false; };
}
