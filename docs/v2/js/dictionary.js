// dictionary.js — Free Dictionary API 封裝 + localStorage 永久 cache
//
// 用途：給 en2zh 題目找一個含目標單字的英文例句，
//       目標是把「認字」升級成「在語境裡認字」，讓謙恩之後能讀小說。
//
// 策略：
//   - localStorage 永久 cache（API 例句不會變）
//   - 第一次每個字會打 API（200-500ms 延遲），後續秒開
//   - 404 / 查無例句 → cache 寫 null，避免重複打 API
//   - 網路失敗 → **不**寫 cache，下次自動重試
//   - 完全非同步、失敗不擋路（題目正常出，只是上方不顯示句子）

const API_BASE = 'https://api.dictionaryapi.dev/api/v2/entries/en/';
const CACHE_PREFIX = 'sv2.dict.';

export async function fetchExample(word) {
  if (!word) return null;
  const key = CACHE_PREFIX + word.toLowerCase();

  // 先看 cache
  try {
    const cached = localStorage.getItem(key);
    if (cached !== null) {
      const parsed = JSON.parse(cached);
      return parsed.example;  // 可能是 null（已試過但無例句）
    }
  } catch (e) { /* localStorage 滿了之類 → 直接打 API */ }

  // 打 API
  try {
    const res = await fetch(API_BASE + encodeURIComponent(word.toLowerCase()), {
      method: 'GET',
      mode: 'cors',
    });
    if (!res.ok) {
      // 404 = 字典裡沒這個字，寫 null 進 cache 避免重試
      writeCache(key, null);
      return null;
    }
    const data = await res.json();
    const example = extractExample(data, word);
    writeCache(key, example);
    return example;
  } catch (e) {
    // 網路掛 / CORS 等 → 不寫 cache，下次再試
    return null;
  }
}

function writeCache(key, example) {
  try {
    localStorage.setItem(key, JSON.stringify({ example, fetchedAt: Date.now() }));
  } catch (e) { /* 空間滿了就算了 */ }
}

function extractExample(data, word) {
  if (!Array.isArray(data)) return null;
  const wordLower = word.toLowerCase();
  for (const entry of data) {
    const meanings = entry.meanings || [];
    for (const m of meanings) {
      const defs = m.definitions || [];
      for (const d of defs) {
        const ex = (d.example || '').trim();
        if (!ex) continue;
        // 例句裡要實際出現該字（也允許 plural / -ed / -ing 等變形）
        if (containsWord(ex, wordLower)) {
          return ex;
        }
      }
    }
  }
  return null;
}

function containsWord(sentence, wordLower) {
  const regex = new RegExp(`\\b${escapeRegex(wordLower)}[a-z']*\\b`, 'i');
  return regex.test(sentence);
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 把句子裡的目標字包成 <span class="sentence-target">…</span> 給 UI 顯示底線
export function highlightWord(sentence, word) {
  if (!sentence || !word) return escapeHtml(sentence || '');
  const wordLower = word.toLowerCase();
  const regex = new RegExp(`\\b(${escapeRegex(wordLower)}[a-z']*)\\b`, 'i');
  const match = sentence.match(regex);
  if (!match) return escapeHtml(sentence);
  const idx = sentence.indexOf(match[0]);
  const before = escapeHtml(sentence.slice(0, idx));
  const target = escapeHtml(match[0]);
  const after = escapeHtml(sentence.slice(idx + match[0].length));
  return `${before}<span class="sentence-target">${target}</span>${after}`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}
