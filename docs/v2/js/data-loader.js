// data-loader.js — 載入 data/*.json 字庫，含快取
// 字庫格式：
//   { "單元名稱": [ { "en": "apple", "zh": "蘋果" }, ... ], ... }
//
// units-meta.json 列出要載哪些檔。新增字庫只要：
//   1) 在 data/ 新增 .json
//   2) 把檔名加進 units-meta.json
//   不用改任何程式碼。
//
// v2.29 加速：
//   - 所有 JSON 用 Promise.all 平行抓（以前 sequential，8 個檔 1.5-3 秒）
//   - cache 從 'no-cache' 改 'default' 讓瀏覽器快取生效
//     （GitHub Pages 預設 max-age=600，10 分鐘內第二次開瞬間載入）
//   - 改字庫想立刻生效 → 開無痕模式或 hard reload (Ctrl+Shift+R)

const cache = {};

async function loadJson(file) {
  if (cache[file]) return cache[file];
  const res = await fetch(`data/${file}`, { cache: 'default' });
  if (!res.ok) throw new Error(`載入 ${file} 失敗（${res.status}）`);
  const data = await res.json();
  cache[file] = data;
  return data;
}

// 平行版：吃 array of file names，回傳 array of { file, data } 或 null（失敗的不擋整批）
async function loadJsonBatch(files) {
  return Promise.all(files.map(async (file) => {
    try {
      return { file, data: await loadJson(file) };
    } catch (e) {
      console.warn(`跳過 ${file}：`, e.message);
      return { file, data: null };
    }
  }));
}

export async function loadAll() {
  // 第一步：抓 meta（必須先知道有哪些檔要載）
  const meta = await loadJson('units-meta.json');

  // 第二步：把所有要載的檔名收集起來一次抓
  const allFiles = new Set(['stories.json']);
  if (meta.version === 2 && Array.isArray(meta.categories)) {
    for (const cat of meta.categories) {
      for (const file of cat.files || []) allFiles.add(file);
    }
  } else if (Array.isArray(meta.files)) {
    for (const file of meta.files) allFiles.add(file);
  }
  const fetched = await loadJsonBatch([...allFiles]);
  // 整理成 fileMap 方便查詢
  const fileMap = {};
  for (const { file, data } of fetched) if (data) fileMap[file] = data;

  // 第三步：組分類結構
  const units = {};
  const categories = [];
  let stories = [];

  if (fileMap['stories.json'] && Array.isArray(fileMap['stories.json'].stories)) {
    stories = fileMap['stories.json'].stories;
  }

  if (meta.version === 2 && Array.isArray(meta.categories)) {
    for (const cat of meta.categories) {
      const catUnits = {};
      for (const file of cat.files || []) {
        const u = fileMap[file];
        if (!u) continue;
        Object.assign(units, u);
        Object.assign(catUnits, u);
      }
      categories.push({
        id: cat.id,
        name: cat.name,
        icon: cat.icon || '📚',
        files: cat.files || [],
        current: !!cat.current,                   // v2.21：current 旗標
        units: catUnits,
      });
    }
  } else if (Array.isArray(meta.files)) {
    const catUnits = {};
    for (const file of meta.files) {
      const u = fileMap[file];
      if (!u) continue;
      Object.assign(units, u);
      Object.assign(catUnits, u);
    }
    categories.push({ id: 'all', name: '單字', icon: '📚', units: catUnits });
  }

  return { meta, units, categories, stories };
}
