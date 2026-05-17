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
  const units = {};                       // 扁平 { 單元名: [...words] }（向下相容）
  const categories = [];                  // v2.19：分類結構，主畫面用

  // v2 schema（含 categories）：以 categories 為主
  if (meta.version === 2 && Array.isArray(meta.categories)) {
    for (const cat of meta.categories) {
      const catUnits = {};
      for (const file of cat.files || []) {
        try {
          const u = await loadJson(file);
          Object.assign(units, u);
          Object.assign(catUnits, u);
        } catch (e) {
          console.warn(`跳過 ${file}：`, e.message);
        }
      }
      categories.push({
        id: cat.id,
        name: cat.name,
        icon: cat.icon || '📚',
        units: catUnits,
      });
    }
  } else if (Array.isArray(meta.files)) {
    // 舊 v1 schema 相容：所有檔案塞到「全部」單一分類
    const catUnits = {};
    for (const file of meta.files) {
      try {
        const u = await loadJson(file);
        Object.assign(units, u);
        Object.assign(catUnits, u);
      } catch (e) {
        console.warn(`跳過 ${file}：`, e.message);
      }
    }
    categories.push({ id: 'all', name: '單字', icon: '📚', units: catUnits });
  }

  return { meta, units, categories };
}
