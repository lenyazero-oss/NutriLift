// 食材の表示名(cleanName)が、別の食材と同じになっていないか調べる。
// 使い方(プロジェクトのルートで): node tools/check_display_names.mjs
import { readFileSync } from "node:fs";
import { cleanName } from "../js/foods.js";

const { foods } = JSON.parse(readFileSync(new URL("../data/foods.json", import.meta.url), "utf8"));
const groups = new Map();
for (const f of foods) {
  const name = cleanName(f.name);
  if (!groups.has(name)) groups.set(name, []);
  groups.get(name).push(f);
}
const dups = [...groups].filter(([, list]) => list.length > 1);
console.log(`食材 ${foods.length} 件 / 表示名が重なる組 ${dups.length} 件`);
for (const [name, list] of dups) {
  console.log(`\n「${name}」`);
  list.forEach((f) => console.log(`  ${f.id}  ${f.name}`));
}
