// 食材データ(foods.json)の読み込み、端末内検索、単位の解決。
let foods = []; // { id, name, norm, n, source, units? }
let defaultRules = []; // { units, match, exclude }(match / exclude は正規化済み)
const defaultUnitsCache = new Map(); // 食材ID → 初期ルールで決まる単位(ルールは読み込み後に変わらない)
let overrides = {};
let loaded = false;

// 全角半角・大文字小文字・ひらがな/カタカナの違いを吸収
export function normalize(s) {
  return String(s)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

// 検索の照合用。normalize に加えて、長音(ブロッコリー/ブロッコリ)・中点・ハイフン・空白・カッコの違いも無視する。
// 単位の自動判定(unitsFor)は norm を使うので、こちらは検索専用の別の値として持つ。
const fold = (s) => normalize(s).replace(/[ー\-‐・･\s()()「」\[\]【】<>＜＞]/g, "");

async function fetchJson(path, required) {
  const res = await fetch(path);
  if (!res.ok) {
    if (required) throw new Error(`${path} を読み込めません(${res.status})`);
    return null;
  }
  return res.json();
}

// 成分表の食材を読み込む(初回のみ)
export async function loadFoods() {
  if (loaded) return;
  const [data, units] = await Promise.all([
    fetchJson("./data/foods.json", true),
    fetchJson("./data/default-units.json", false),
  ]);
  foods = data.foods.map((f) => ({ ...f, norm: normalize(f.name), fold: fold(f.name), source: "table" }));
  // 照合に使う語は読み込み時に一度だけ正規化しておく(unitsFor を呼ぶたびにやり直さない)
  defaultRules = (units?.rules || []).map((r) => ({
    units: r.units,
    match: (r.match || []).map(normalize),
    exclude: (r.exclude || []).map(normalize),
  }));
  defaultUnitsCache.clear();
  loaded = true;
  applyCustomFoods(); // 先にユーザーデータが届いていた場合も、自作食材を失わない
}

// 自作食材・単位の上書き・表示名を反映(Firestoreから取得したもの)
let customList = [];
let displayNames = {}; // { 食材ID: 表示名 }(成分表の食材だけ)
function applyCustomFoods() {
  foods = foods.filter((f) => f.source !== "custom");
  customList.forEach((c) =>
    foods.push({ id: c.id, name: c.name, norm: normalize(c.name), fold: fold(c.name), n: c.n || {}, units: c.units || [], source: "custom" })
  );
}
export function setUserData({ customFoods = [], unitOverrides = {}, names = {} }) {
  customList = customFoods;
  applyCustomFoods();
  overrides = unitOverrides;
  displayNames = names;
}

// 成分表の名前の「<鳥肉類>」のような分類と、先頭の「(かんきつ類)」を除いた名前。
// 例: 「<鳥肉類> にわとり [若どり・主品目] もも 皮なし 生」→「にわとり [若どり・主品目] もも 皮なし 生」
function stripCategory(name) {
  const cleaned = String(name)
    .replace(/[<＜][^>＞]*[>＞]/g, "")
    .replace(/^\s*[(（][^)）]*[)）]/, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || String(name); // 全部消えてしまう名前は元のまま
}

// 先頭の語(かな書きの学術名寄り)を、一般的な呼び名にする
const HEAD_NAMES = {
  にわとり: "鶏", うし: "牛", ぶた: "豚", めんよう: "羊", こめ: "米", こむぎ: "小麦", だいず: "大豆",
  だいこん: "大根", たまねぎ: "玉ねぎ", ほうれんそう: "ほうれん草", こまつな: "小松菜", はくさい: "白菜",
  しろさけ: "鮭", まいわし: "いわし", まさば: "さば", まあじ: "あじ", くろまぐろ: "まぐろ",
};
// [ ] の中身の言い換え。空文字は「消す」
const BRACKET_NAMES = {
  水稲穀粒: "", 水稲めし: "ご飯", 陸稲穀粒: "陸稲",陸稲めし: "ご飯(陸稲)",
  "若どり・主品目": "若どり", "親・主品目": "親どり",
  "若どり・副品目": "若どり", "親・副品目": "親どり", 二次品目: "", 副品目: "", その他: "",
};

// 成分表の名前を読みやすくした名前。
// 例: 「<鳥肉類> にわとり [若どり・主品目] むね 皮なし 生」→「鶏 若どり むね 皮なし」
//     「こむぎ [パン類] 角形食パン 食パン」→「角形食パン」 / 「こめ [水稲めし] 精白米 うるち米」→「ご飯 精白米 うるち米」
// 元の名前は保存データに残り、検索は元の名前も使う。
export function cleanName(name) {
  const base = stripCategory(name);
  const m = /^(\S+)\s+\[([^\]]*)\]\s*(.*)$/.exec(base);
  if (!m) return tidy(base.split(" "), true); // [ ] のない名前(野菜・魚など)
  const [, head, bracket, rest] = m;
  const restTokens = rest.split(" ").filter(Boolean);
  // 「パン類」「豆腐・油揚げ類」「その他」のような分類は消し、先頭の語も省く(「小麦 パン類 コッペパン」より「コッペパン」)
  if (/類$/.test(bracket) || bracket === "その他") {
    if (restTokens.length) return tidy(restTokens, false);
  }
  const b = bracket in BRACKET_NAMES ? BRACKET_NAMES[bracket] : bracket;
  const dropHead = b.startsWith("ご飯");
  return tidy([...(dropHead ? [] : [head]), b, ...restTokens], !dropHead);
}

// 語の並びを整える: 先頭を一般名に / 隣と同じか含まれる語を省く / 先頭の語が他の語に含まれるなら省く(「生」「焼き」などの調理状態は残す)
function tidy(tokens, mapHead) {
  let t = tokens.filter(Boolean);
  if (mapHead && t.length && HEAD_NAMES[t[0]]) t[0] = HEAD_NAMES[t[0]];
  t = t.filter((w, i) => !(i > 0 && (t[i - 1] === w || (w.length >= 2 && t[i - 1].includes(w)))));
  if (t.length > 1 && t.slice(1).some((w) => w !== t[0] && w.includes(t[0]))) t.shift();
  return t.join(" ") || tokens.join(" ");
}

// 検索結果などに添える分類(「鳥肉類」「だいこん類」)。なければ空文字
export function categoryOf(food) {
  if (food.source !== "table") return "";
  const m = /[<＜]([^>＞]*)[>＞]/.exec(food.name) ?? /^\s*[(（]([^)）]*)[)）]/.exec(food.name);
  return m && m[1] !== "その他" ? m[1] : "";
}

// 食材の2行目に出す説明: 「(自作 ・ )(分類 ・ )たんぱく質 ◯g / ◯kcal(100g)」
export function foodMeta(f) {
  const lead = f.source === "custom" ? "自作 ・ " : categoryOf(f) ? `${categoryOf(f)} ・ ` : "";
  return `${lead}たんぱく質 ${(f.n?.protein ?? 0).toFixed(1)}g / ${Math.round(f.n?.kcal ?? 0)}kcal(100g)`;
}

// 画面に出す名前。ユーザーが設定した表示名 > 整形した名前(元の名前は保存データに残る)。
// x は { name, source, id } か、食事・レシピの { name, source, foodId }
export function displayName(x) {
  const id = x.source === "table" ? x.foodId ?? x.id : null;
  if (id != null && displayNames[id]) return displayNames[id];
  // 自作食材・レシピは名前を自分で付けているので、そのまま出す
  return x.source === "table" ? cleanName(x.name) : x.name;
}

// 表示名が設定されているか(食材編集画面の入力欄の初期値用)
export function displayNameOf(foodId) {
  return displayNames[foodId] || "";
}

export function findFood(id, source) {
  return foods.find((f) => f.id === id && f.source === source) || null;
}

// 成分表の食品名はかな書き・学術名寄り(例: 「にわとり [若どり・主品目] むね」)のため、
// 一般的な呼び名との対応表を持つ。同じグループの語はどれで検索しても同じ意味として扱う。
const ALIAS_GROUPS = [
  ["鶏", "鳥", "とり", "にわとり", "若どり"],
  ["豚", "ぶた"],
  ["牛", "うし"],
  ["牛乳", "ぎゅうにゅう"],
  ["米", "こめ"],
  ["ご飯", "ごはん", "めし", "水稲めし"],
  ["卵", "たまご", "玉子", "鶏卵"],
  ["大豆", "だいず"],
  ["納豆", "なっとう"],
  ["豆腐", "とうふ"],
  ["鮭", "さけ", "しろさけ", "しゃけ"],
  ["胸", "むね"],
  ["腿", "もも"],
  // 漢字・表記違い・略称(成分表はひらがな・カタカナ寄り)
  ["にんじん", "人参", "ニンジン"],
  ["たまねぎ", "玉ねぎ", "玉葱", "タマネギ"],
  ["じゃがいも", "馬鈴薯", "ジャガイモ"],
  ["さつまいも", "薩摩芋", "甘藷"],
  ["きゅうり", "胡瓜"],
  ["なす", "茄子"],
  ["かぼちゃ", "南瓜"],
  ["ほうれんそう", "ほうれん草", "菠薐草"],
  ["こまつな", "小松菜"],
  ["だいこん", "大根"],
  ["はくさい", "白菜"],
  ["ぶろっこりー", "ブロッコリー", "ブロッコリ"],
  ["とうもろこし", "コーン"],
  ["ヨーグルト", "よーぐると"],
  ["バナナ", "ばなな"],
  ["あぶら", "油"],
  ["さば", "鯖"],
  ["まぐろ", "鮪", "マグロ"],
  ["えび", "海老", "エビ"],
  ["ささみ", "ささ身", "笹身"],
  ["ひき肉", "挽肉", "挽き肉", "ミンチ"],
  ["オートミール", "オーツ", "おーとみーる"],
].map((g) => g.map(normalize));
const termToGroup = new Map();
ALIAS_GROUPS.forEach((g) => g.forEach((t) => termToGroup.set(t, g)));
// 長い語を優先してマッチさせる(「牛乳」を「牛」+「乳」に分けない)
const termRe = new RegExp([...termToGroup.keys()].sort((a, b) => b.length - a.length).join("|"), "g");

// 検索語を [代替語の配列, ...] に分解。全パートがいずれかの代替語を含む食品が一致する。
function queryParts(query) {
  const parts = [];
  for (const word of normalize(query).split(/\s+/).filter(Boolean)) {
    let last = 0;
    for (const m of word.matchAll(termRe)) {
      if (m.index > last) parts.push([word.slice(last, m.index)]);
      parts.push(termToGroup.get(m[0]));
      last = m.index + m[0].length;
    }
    if (last < word.length) parts.push([word.slice(last)]);
  }
  // 「鶏肉」の「肉」は成分表の名前に含まれないことが多いので、他の語があれば無視する
  return parts.length > 1 ? parts.filter((p) => !(p.length === 1 && p[0] === "肉")) : parts;
}

// 文字が順番どおりに(間が空いていてもよい)含まれているか。例: 「とりむね」→「にわとり むね」
function isSubsequence(needle, hay) {
  let i = 0;
  for (let j = 0; j < hay.length && i < needle.length; j++) if (hay[j] === needle[i]) i++;
  return i === needle.length;
}

// 検索は段階式。前の段階で見つかったら、そこで止める(表記ゆれの吸収で「カレー」が「カレイ」に当たるような悪化を避ける)。
//   1. 厳密: ひらがな/カタカナ・全角半角を吸収した部分一致 + 別名
//   2. 表記ゆれ: 長音・中点・空白・カッコも無視(ブロッコリ → ブロッコリー)
//   3. あいまい: 検索語の文字が順に含まれる(とりむね → にわとり むね)
export function searchFoods(query, limit = 50) {
  const rawParts = queryParts(query);
  if (!rawParts.length) return [];

  const run = (field, convert) => {
    const parts = rawParts.map((alts) => alts.map(convert).filter(Boolean)).filter((alts) => alts.length);
    if (!parts.length) return [];
    // 表示名を設定した食材は、表示名でも見つかるようにする(元の名前でも見つかる)
    const hay = (f) => {
      const dn = f.source === "table" ? displayNames[f.id] : null;
      return dn ? `${f[field]} ${convert(normalize(dn))}` : f[field];
    };
    const hits = foods.filter((f) => { const h = hay(f); return parts.every((alts) => alts.some((a) => h.includes(a))); });
    // 先頭一致・自作食材・名前の短いものを優先
    const score = (f) =>
      (parts[0].some((a) => f[field].startsWith(a)) ? 0 : 100) + (f.source === "custom" ? -50 : 0) + f[field].length;
    return hits.sort((a, b) => score(a) - score(b));
  };

  let hits = run("norm", (a) => a);
  if (!hits.length) hits = run("fold", fold);
  if (!hits.length) {
    const needle = fold(query);
    if (needle.length >= 2) {
      hits = foods.filter((f) => isSubsequence(needle, f.fold)).sort((a, b) => a.fold.length - b.fold.length);
    }
  }
  return hits.slice(0, limit);
}

// 食材の単位一覧 [{name, g}]。自作食材はその食材の単位、成分表の食材は上書き → 初期値の順
export function unitsFor(food) {
  // Firestore由来の値は不正なもの(名前なし・0以下・非数値)を除く
  const valid = (list) => (list || []).filter((u) => u && u.name && Number.isFinite(u.g) && u.g > 0);
  if (food.source === "custom") return valid(food.units);
  if (overrides[food.id]) return valid(overrides[food.id]);
  let found = defaultUnitsCache.get(food.id);
  if (!found) {
    // match が空のルールは全食材に当たってしまうので除く
    const rule = defaultRules.find((r) =>
      r.match.length > 0 && r.match.every((k) => food.norm.includes(k)) && !r.exclude.some((k) => food.norm.includes(k)));
    found = rule ? rule.units : [];
    defaultUnitsCache.set(food.id, found);
  }
  return found;
}
