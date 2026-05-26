// dictionary.js — Free Dictionary API 封裝 + localStorage 永久 cache
//
// 用途：
//   - 給 en2zh 題目找含目標字的例句（v2.22）
//   - 給「從頭複習」單字卡顯示同義字 / 反義字（v2.23）
//   - 例句 POS 標記讓 quiz 可以動態選對的中文意思（v2.23）
//
// 策略：
//   - 一次 API 抓齊：examples[]、synonyms[]、antonyms[]
//   - localStorage 永久 cache（字典資料極少變動）
//   - 失敗 / 404 → cache 空結構，題目正常出，只是看不到附加資訊
//
// 回傳結構：
//   {
//     examples: [{ pos: 'noun'|'verb'|'adjective'|..., text: '...' }, ...],
//     synonyms: ['fine', 'healthy', ...],
//     antonyms: ['sick', 'ill', ...]
//   }

const API_BASE = 'https://api.dictionaryapi.dev/api/v2/entries/en/';
const CACHE_PREFIX = 'sv2.dict.';
const EMPTY = { examples: [], synonyms: [], antonyms: [] };

export async function fetchDictionary(word) {
  if (!word) return EMPTY;
  const key = CACHE_PREFIX + word.toLowerCase();

  try {
    const cached = localStorage.getItem(key);
    if (cached !== null) {
      const parsed = JSON.parse(cached);
      return parsed.data || EMPTY;
    }
  } catch (e) {}

  try {
    const res = await fetch(API_BASE + encodeURIComponent(word.toLowerCase()), {
      method: 'GET',
      mode: 'cors',
    });
    if (!res.ok) {
      writeCache(key, EMPTY);
      return EMPTY;
    }
    const data = await res.json();
    const parsed = extractDictionaryData(data, word);
    writeCache(key, parsed);
    return parsed;
  } catch (e) {
    // 網路掛 → 不寫 cache，下次重試
    return EMPTY;
  }
}

function writeCache(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify({ data, fetchedAt: Date.now() }));
  } catch (e) {}
}

function extractDictionaryData(apiData, word) {
  const result = { examples: [], synonyms: [], antonyms: [] };
  if (!Array.isArray(apiData)) return result;
  const wordLower = word.toLowerCase();
  const seenEx = new Set();
  const synSet = new Set();
  const antSet = new Set();

  for (const entry of apiData) {
    for (const m of (entry.meanings || [])) {
      const pos = m.partOfSpeech || '';
      // 蒐集 meaning 層級的同／反義字
      for (const s of (m.synonyms || [])) synSet.add(s);
      for (const a of (m.antonyms || [])) antSet.add(a);
      for (const d of (m.definitions || [])) {
        // 蒐集 definition 層級的同／反義字
        for (const s of (d.synonyms || [])) synSet.add(s);
        for (const a of (d.antonyms || [])) antSet.add(a);
        // 蒐集含目標字的例句
        const ex = (d.example || '').trim();
        if (!ex || seenEx.has(ex)) continue;
        if (containsWord(ex, wordLower)) {
          seenEx.add(ex);
          result.examples.push({ pos, text: ex });
        }
      }
    }
  }
  // 同／反義字最多各留 6 個（太多會塞爆卡片）
  result.synonyms = [...synSet].filter(s => s && s.toLowerCase() !== wordLower).slice(0, 6);
  result.antonyms = [...antSet].filter(s => s && s.toLowerCase() !== wordLower).slice(0, 6);
  return result;
}

function containsWord(sentence, wordLower) {
  const regex = new RegExp(`\\b${escapeRegex(wordLower)}[a-z']*\\b`, 'i');
  return regex.test(sentence);
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 把句子裡的目標字包成 <span class="sentence-target">…</span>
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

// 把 ECDICT 的短 POS（n/v/adj/adv/aux...）對應到 API 的長 POS（noun/verb/adjective/adverb...）
// 用來把字的某個 meaning 跟 API 例句的 partOfSpeech 配對
const POS_MAP = {
  n: 'noun', v: 'verb', vt: 'verb', vi: 'verb',
  adj: 'adjective', a: 'adjective',
  adv: 'adverb', ad: 'adverb',
  aux: 'auxiliary verb',
  prep: 'preposition', conj: 'conjunction',
  pron: 'pronoun', interj: 'interjection', num: 'numeral',
};
export function ecdictPosToApi(p) {
  return POS_MAP[p] || p || '';
}

// 從 examples 裡找符合 POS 的；找不到回 null
export function pickExampleByPos(examples, targetEcdictPos) {
  if (!Array.isArray(examples) || examples.length === 0) return null;
  const targetApiPos = ecdictPosToApi(targetEcdictPos);
  if (targetApiPos) {
    const match = examples.find(e => (e.pos || '').toLowerCase() === targetApiPos);
    if (match) return match;
  }
  // 沒指定 POS 或找不到 → 退回第一個例句
  return examples[0];
}

// 給定一個字 (含 meanings)、一個 API 例句 → 找出該例句對應的中文意思
export function pickMeaningByExamplePos(meanings, exampleApiPos) {
  if (!Array.isArray(meanings) || meanings.length === 0) return null;
  if (!exampleApiPos) return meanings[0];
  const match = meanings.find(m => ecdictPosToApi(m.pos) === exampleApiPos);
  return match || meanings[0];
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}
