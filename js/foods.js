// 食材データ(foods.json)の読み込み、端末内検索、単位の解決。
let foods = []; // { id, name, norm, n, source, units? }
let defaultRules = [];
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
  defaultRules = units?.rules || [];
  loaded = true;
}

// 自作食材・単位の上書きを反映(Firestoreから取得したもの)
export function setUserData({ customFoods = [], unitOverrides = {} }) {
  foods = foods.filter((f) => f.source !== "custom");
  customFoods.forEach((c) =>
    foods.push({ id: c.id, name: c.name, norm: normalize(c.name), fold: fold(c.name), n: c.n || {}, units: c.units || [], source: "custom" })
  );
  overrides = unitOverrides;
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
    const hits = foods.filter((f) => parts.every((alts) => alts.some((a) => f[field].includes(a))));
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
  for (const rule of defaultRules) {
    const matched = rule.match.every((k) => food.norm.includes(normalize(k)));
    const excluded = (rule.exclude || []).some((k) => food.norm.includes(normalize(k)));
    if (matched && !excluded) return rule.units;
  }
  return [];
}
