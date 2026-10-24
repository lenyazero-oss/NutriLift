# NutriLift(筋トレ食事記録アプリ)

自炊した食事を記録し、たんぱく質を中心に栄養素の達成度を確認する、個人用のiPhone向けPWAです。
GitHub Pages + Firebase(Spark プラン)で無料運用します。ビルド不要の静的サイトです。

> 実装状況: ステップ6まで完了。
>
> | ステップ | 内容 |
> |---|---|
> | 1 | 土台 + 認証(Google / メール) |
> | 2 | 成分表データ(foods.json)の変換 |
> | 3 | 今日の画面(達成バー、朝・昼・夜・間食の記録) |
> | 4 | レシピの作成・編集 |
> | 5 | 履歴画面(7日間の棒グラフ、日ごとの合計) |
> | 6 | 設定画面と食材マスタ(単位の設定、自作食材) |
> | 追加 | テーマ(配色)の切り替え、タブのSVGアイコン |

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
css/  style.css themes.css
icons/
js/  firebase-config.js firebase.js auth.js router.js ui.js app.js db.js foods.js food-picker.js nutrients.js util.js theme-init.js
js/views/  login.js today.js add.js recipes.js recipe-edit.js history.js settings.js foodmaster.js foodedit.js
data/  foods.json default-units.json
tools/  convert_foods.py check_contrast.py
```

## テーマ(配色)の切り替え

設定タブの「テーマ」から、自動・ライト・ダーク・ジム(黒×オレンジ)・パステル(ピンク×ラベンダー)を選べます。タップした瞬間に切り替わります。

- 「自動」は iPhone のライト/ダーク設定に合わせます(ライトとダークのテーマを使用)。
- 選んだテーマはその端末の `localStorage` に保存されます(アカウントには保存されないので、端末ごとに設定します)。
- 動作確認用に、URL の後ろに `?theme=gym` のように付けて開くと、そのテーマで表示して保存します(`light` / `dark` / `gym` / `pastel` / `auto`)。
- ホーム画面アイコン(`manifest.json` と `icons/`)はテーマでは切り替わりません。

### テーマを追加するとき

1. `css/themes.css` の既存のブロック(例: `[data-theme="dark"]`)を丸ごとコピーします。
2. `data-theme` の名前、`--theme-label`(設定画面に出る名前)、各色の値を書き換えます。トークンはすべてのテーマで同じものを定義します。
3. 設定画面の選択肢は `themes.css` から自動で作られるので、コードの追加は不要です。

### 配色の確認(コントラスト)

文字と背景は 4.5:1 以上、バーやグラフなどの図形は面に対して 3:1 以上を目安にしています。テーマを追加・変更したら、プロジェクト直下で次を実行して確認します(全テーマの定義漏れも検出します)。

```
python tools/check_contrast.py
```

### 色の使い方のルール

- 色は `css/style.css` に直書きせず、`css/themes.css` のトークン(`var(--accent)` など)で指定します。
- 目標の超過は、色だけでなく「超過」の文字や「▲」でも示します。
- `manifest.json` の色と `icons/icon.svg` はCSS変数が使えないため、テーマとは別に管理しています。

## 成分表の変換(Excel → foods.json)

1. 文部科学省の「日本食品標準成分表(八訂)増補2023年」のExcelを `data/` に置きます(例: `data/成分表.xlsx`)。
2. 初回のみ `pip install openpyxl` を実行します。
3. プロジェクト直下で次を実行します。
   ```
   python tools/convert_foods.py data/成分表.xlsx
   ```
   - 列は Excel の「成分識別子」行(`ENERC_KCAL` など)から自動検出します。検出結果は実行時に表示されます。
   - 識別子が見つからないと言われたら `--list-tags` を付けて、シート内の識別子を確認してください。
4. `data/foods.json` が生成されます(100gあたりの kcal / たんぱく質 / 脂質 / 炭水化物 / 食物繊維)。これをコミットして公開します。Excel自体は `.gitignore` で公開対象外です。

### 値の扱い

| 成分表の表記 | foods.json の値 | 意味 |
|---|---|---|
| 数値 | そのまま | |
| `Tr` | 0 | 微量(測定値が最小記載量に達しない) |
| `(0)` | 0 | 推定値としてのゼロ |
| `(1.2)` `[1.2]` | 1.2 | 推定値・計算値。括弧を外して使う |
| `-` `…` `*` / 空欄 | 0 | 未測定・不明。0として扱う(合計は過小になりうる) |
| 解釈できない文字列 | 0 | 警告を表示して0にする |

変換後に、値の内訳(欠損・Tr・推定値の件数)が表示されます。
炭水化物は成分表の「炭水化物」(差引き法, `CHOCDF`)を使い、食物繊維は総量を使います。

### 栄養素を追加するとき
```
python tools/convert_foods.py data/成分表.xlsx --extra calcium,iron,zinc
```
対応: `calcium` `iron` `zinc` `magnesium` `vitaminB6` `vitaminD`。出力後、`js/nutrients.js` の該当項目の `shown` を `true` にすると画面に表示されます。

### 単位の初期値
`data/default-units.json` に、卵・米・鶏むね肉などの単位(個・杯・枚など)の初期値を入れています。目安の値です。食材ごとにアプリから上書きできます(設定 > 食材マスタ)。

- 成分表の食材は、単位だけ変更できます。「初期値に戻す」で上書きを消せます。
- 一度保存すると、その時点の単位の一覧が丸ごと固定されます。あとから `default-units.json` を更新しても、保存済みの食材には反映されません。
- 成分表にない食品は、食材マスタの「自作食材」で名前・100gあたりの栄養素・単位を登録できます(エネルギーとたんぱく質は必須)。
