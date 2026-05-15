// data-loader.js — 載入 data/*.json 字庫，含快取
// 字庫格式：
//   { "單元名稱": [ { "en": "apple", "zh": "蘋果" }, ... ], ... }
//
// units-meta.json 列出要載哪些檔。新增字庫只要：
//   1) 在 data/ 新增 .json
//   2) 把檔名加進 units-meta.json
//   不用改任何程式碼。

const cache = {};

async function loadJson(file) {
  if (cache[file]) return cache[file];
  const res = await fetch(`data/${file}`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`載入 ${file} 失敗（${res.status}）`);
  const data = await res.json();
  cache[file] = data;
  return data;
}

export async function loadAll() {
  const meta = await loadJson('units-meta.json');
  const units = {};
  for (const file of meta.files) {
    try {
      const u = await loadJson(file);
      Object.assign(units, u);
    } catch (e) {
      console.warn(`跳過 ${file}：`, e.message);
    }
  }
  return { meta, units };
}
