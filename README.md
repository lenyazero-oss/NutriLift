# 筋トレ食事記録アプリ

自炊した食事を記録し、たんぱく質を中心に栄養素の達成度を確認する、個人用のiPhone向けPWAです。
GitHub Pages + Firebase(Spark プラン)で無料運用します。ビルド不要の静的サイトです。

> 実装状況: ステップ1(土台+認証)まで完了。以降は順次追加します。

## 1. Firebase コンソールでの作業

1. [Firebaseコンソール](https://console.firebase.google.com/) で「プロジェクトを追加」(Googleアナリティクスは不要)。料金プランは Spark(無料)のままにします。
2. **ウェブアプリを追加**: プロジェクトの設定 > マイアプリ > 「</>」。表示された `firebaseConfig` の値を `js/firebase-config.js` に貼り付けます。
3. **Authentication を有効化**: 構築 > Authentication > 始める > Sign-in method で次の2つを有効にします。
   - Google(サポートメールを選択)
   - メール/パスワード
4. **承認済みドメインの追加**: Authentication > 設定 > 承認済みドメイン に `（ユーザー名）.github.io` を追加します(`localhost` は最初から入っています)。
5. **Firestore を作成**: 構築 > Firestore Database > データベースを作成(本番モードで開始、ロケーションは `asia-northeast1`(東京) を推奨)。
6. **ルールを反映**: Firestore > ルール タブに `firestore.rules` の内容を貼り付けて「公開」します。
   - `users/{uid}/` 配下は、ログイン中の本人(`request.auth.uid == uid`)のみ読み書き可。それ以外は全拒否です。
7. **メールの新規登録は最初の1回のみ**: 自分のアカウント作成後は、Authentication > Sign-in method の設定や、不要なら他人の登録に注意してください(公開URLを知られても、ルールによりデータは読み書きできません)。

## 2. GitHub Pages での公開

1. GitHub で新しいリポジトリを作成し、このフォルダの内容をリポジトリ直下にアップロード(push)します。
2. リポジトリの Settings > Pages > Source を `Deploy from a branch`、Branch を `main` / `/ (root)` にして保存します。
3. 数分後に `https://（ユーザー名）.github.io/（リポジトリ名）/` で公開されます。すべて相対パスなのでサブパスでも動作します。
4. 上記の「承認済みドメイン」に `（ユーザー名）.github.io` が入っていることを確認します。

## 3. iPhone でホーム画面に追加

Safari でURLを開く > 共有ボタン > 「ホーム画面に追加」。

### アイコンについて
`icons/icon.svg` を用意済みです。iOS のホーム画面用に PNG(`icons/icon-180.png`, `icon-192.png`, `icon-512.png`)が必要です。
任意の画像ツール、またはSVG→PNG変換サービスで上記3サイズのPNGを作成し `icons/` に置いてください。

## 4. ログインについて

- 基本は Google ログインです。ポップアップが使えない環境では自動でリダイレクト方式に切り替わります。
- iOS のホーム画面から起動したアプリで Google ログインが失敗する場合があります。その場合はメール/パスワードのログインを使ってください(同じ画面に両方あります)。
- 注意: Google ログインとメールログインは別アカウント(別の uid)として扱われ、データは共有されません。どちらか一方に統一して使うことをおすすめします。

## 5. ローカルでの確認

ES modules を使うため `file://` では動作しません。簡易サーバーで開きます(実行はご自身で)。

```
python -m http.server 8000
```

ブラウザで `http://localhost:8000/` を開きます。

## ファイル構成

```
index.html / manifest.json / sw.js / firestore.rules
css/style.css
icons/
js/  firebase-config.js firebase.js auth.js router.js ui.js app.js
js/views/  login.js (ほかは順次追加)
```

## (追記予定)

- 食品成分表の変換手順・欠損値の扱い(ステップ2)
