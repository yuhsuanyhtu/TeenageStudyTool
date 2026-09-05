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
// v2.43（效能）：這個免費 API 2026 下半年常常 10–20 秒不回應，之前沒有 timeout，
//   英翻中／從頭複習每題都 await 它 → 孩子看到「準備題目中…」卡住（越來越慢的主因）。
//   改法：
//   - 每次請求 3 秒 timeout（AbortController）；逾時視同「查不到」，**不寫 cache**，下次再試
//   - 只有 404（字典真的沒這個字）才把空結構寫進 cache；429/5xx 是暫時故障不寫
//   - 同一個字同時多次呼叫共用一個 in-flight promise（以前 prefetch + 出題會重複打 2 次）
//   - 熔斷：連續 2 次逾時／失敗 → 5 分鐘內直接回空結構不打 API（避免每題都白等 3 秒）
//   - 記憶體 cache（同一頁不用每次 JSON.parse localStorage）
//   - localStorage 寫入失敗（滿了）→ 淘汰最舊的 200 筆字典 cache 再寫
//   - prefetchDictionary()：改成兩條線慢慢抓，不再一次射 8 個請求觸發限流
//
// 回傳結構：
//   {
//     examples: [{ pos: 'noun'|'verb'|'adjective'|..., text: '...' }, ...],
//     definitions: [{ pos: '...', text: '...' }, ...],   // v2.25：給閱讀模式 fallback 用
//     synonyms: ['fine', 'healthy', ...],
//     antonyms: ['sick', 'ill', ...]
//   }

const API_BASE = 'https://api.dictionaryapi.dev/api/v2/entries/en/';
const CACHE_PREFIX = 'sv2.dict.';
const EMPTY = Object.freeze({ examples: [], definitions: [], synonyms: [], antonyms: [] });

const TIMEOUT_MS = 3000;                 // 單次請求最多等 3 秒
const BREAKER_FAILS = 2;                 // 連續失敗幾次就熔斷
const BREAKER_COOLDOWN_MS = 5 * 60 * 1000; // 熔斷 5 分鐘
const EVICT_BATCH = 200;                 // localStorage 滿了時一次淘汰幾筆

const mem = new Map();        // key → data（記憶體 cache）
const inflight = new Map();   // key → Promise（去重）
let consecutiveFails = 0;
let breakerUntil = 0;
let lastError = '';
const stats = { hitMem: 0, hitLocal: 0, fetched: 0, timeouts: 0, failed: 0, skippedByBreaker: 0 };

export async function fetchDictionary(word) {
  if (!word) return EMPTY;
  const key = CACHE_PREFIX + word.toLowerCase();

  const m = mem.get(key);
  if (m) { stats.hitMem++; return m; }

  try {
    const cached = localStorage.getItem(key);
    if (cached !== null) {
      const parsed = JSON.parse(cached);
      const data = parsed.data || EMPTY;
      mem.set(key, data);
      stats.hitLocal++;
      return data;
    }
  } catch (e) {}

  if (Date.now() < breakerUntil) {
    stats.skippedByBreaker++;
    return EMPTY;
  }

  if (inflight.has(key)) return inflight.get(key);
  const p = doFetch(word, key).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

async function doFetch(word, key) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(API_BASE + encodeURIComponent(word.toLowerCase()), {
      method: 'GET',
      mode: 'cors',
      signal: ctrl.signal,
    });
    if (res.status === 404) {
      // 字典真的沒這個字（片語、專有名詞）→ 永久記住，別再問
      writeCache(key, EMPTY);
      mem.set(key, EMPTY);
      noteOk();
      return EMPTY;
    }
    if (!res.ok) {
      // 429 限流 / 5xx 故障：暫時性，不寫 cache
      noteFail(`HTTP ${res.status}`);
      return EMPTY;
    }
    const data = await res.json();
    const parsed = extractDictionaryData(data, word);
    writeCache(key, parsed);
    mem.set(key, parsed);
    stats.fetched++;
    noteOk();
    return parsed;
  } catch (e) {
    if (e && e.name === 'AbortError') { stats.timeouts++; noteFail('timeout'); }
    else noteFail(e && e.message ? e.message : 'network');
    return EMPTY;
  } finally {
    clearTimeout(timer);
  }
}

function noteOk() { consecutiveFails = 0; }
function noteFail(reason) {
  stats.failed++;
  lastError = reason || '';
  consecutiveFails++;
  if (consecutiveFails >= BREAKER_FAILS) {
    breakerUntil = Date.now() + BREAKER_COOLDOWN_MS;
    consecutiveFails = 0;
  }
}

// 背景預抓：兩條線輪流抓（以前 Promise.all 一次 8 發，容易被限流）。
// 熔斷中或已有 cache 的字幾乎不花時間。fire-and-forget，呼叫端不用 await。
export function prefetchDictionary(words, concurrency = 2) {
  const queue = (words || []).map(w => (typeof w === 'string' ? w : w && w.en)).filter(Boolean);
  const worker = async () => {
    while (queue.length) {
      const w = queue.shift();
      try { await fetchDictionary(w); } catch (e) {}
    }
  };
  for (let i = 0; i < concurrency; i++) worker();
}

// 給主畫面／診斷用
export function dictionaryStatus() {
  const now = Date.now();
  return {
    breakerOpen: now < breakerUntil,
    breakerSecondsLeft: Math.max(0, Math.round((breakerUntil - now) / 1000)),
    lastError,
    ...stats,
  };
}

function writeCache(key, data) {
  const val = JSON.stringify({ data, fetchedAt: Date.now() });
  try {
    localStorage.setItem(key, val);
  } catch (e) {
    // 滿了：淘汰最舊的一批字典 cache 再試一次（只動 sv2.dict.*，不碰學習狀態）
    try {
      evictOldest(EVICT_BATCH);
      localStorage.setItem(key, val);
    } catch (e2) {}
  }
}

function evictOldest(n) {
  const entries = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith(CACHE_PREFIX)) continue;
    let t = 0;
    try { t = Number(JSON.parse(localStorage.getItem(k) || '{}').fetchedAt) || 0; } catch (e) {}
    entries.push([k, t]);
  }
  entries.sort((a, b) => a[1] - b[1]);
  for (const [k] of entries.slice(0, n)) {
    try { localStorage.removeItem(k); } catch (e) {}
    mem.delete(k);
  }
}

function extractDictionaryData(apiData, word) {
  const result = { examples: [], definitions: [], synonyms: [], antonyms: [] };
  if (!Array.isArray(apiData)) return result;
  const wordLower = word.toLowerCase();
  const seenEx = new Set();
  const seenDef = new Set();
  const synSet = new Set();
  const antSet = new Set();

  for (const entry of apiData) {
    for (const m of (entry.meanings || [])) {
      const pos = m.partOfSpeech || '';
      for (const s of (m.synonyms || [])) synSet.add(s);
      for (const a of (m.antonyms || [])) antSet.add(a);
      for (const d of (m.definitions || [])) {
        for (const s of (d.synonyms || [])) synSet.add(s);
        for (const a of (d.antonyms || [])) antSet.add(a);
        // v2.25：蒐集定義（每個 POS 第一個）
        const def = (d.definition || '').trim();
        if (def && !seenDef.has(pos + ':' + def)) {
          seenDef.add(pos + ':' + def);
          result.definitions.push({ pos, text: def });
        }
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

// v2.43：例句庫（Tatoeba）的句子用「字面 m」定位目標字（可能是片語、變化形）
//   找不到 m 時退回 highlightWord(word)。
export function highlightSurface(sentence, surface, word) {
  if (!sentence) return '';
  if (surface) {
    const idx = sentence.toLowerCase().indexOf(String(surface).toLowerCase());
    if (idx >= 0) {
      const before = escapeHtml(sentence.slice(0, idx));
      const target = escapeHtml(sentence.slice(idx, idx + surface.length));
      const after = escapeHtml(sentence.slice(idx + surface.length));
      return `${before}<span class="sentence-target">${target}</span>${after}`;
    }
  }
  return highlightWord(sentence, word);
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
