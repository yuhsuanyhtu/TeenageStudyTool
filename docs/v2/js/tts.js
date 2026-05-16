// tts.js — 文字轉語音，挑選最高品質的英文 voice
// 修正舊版「發音怪怪」的問題：之前沒挑 voice，瀏覽器隨便給，常選到合成感很重的聲音
//
// 解法：載入後列出所有 voices，依優先順序挑出真人感最強的

const PREFERRED_VOICES = [
  // macOS / iOS 自然真人聲
  'Samantha',
  'Karen',          // Australian
  'Daniel',         // British
  'Alex',
  'Moira',          // Irish
  // Google 高品質
  'Google US English',
  'Google UK English Female',
  'Google UK English Male',
  // Microsoft 神經網路語音
  'Microsoft Aria',
  'Microsoft Jenny',
  'Microsoft Guy',
];

// 中文（繁體優先）voice 排序
const PREFERRED_ZH_VOICES = [
  'Mei-Jia', 'Meijia',                  // macOS / iOS 美佳（zh-TW）
  'Yating', 'Hanhan',                   // Microsoft 雅婷／漢漢
  'Google 國語（臺灣）', 'Google 國語',
  'Tian-Tian', 'Tingting',              // zh-CN fallback
];

let voicesCache = [];
let bestVoice = null;
let bestZhVoice = null;
let userOverride = null;

function pickBest() {
  // 1. 使用者手動指定優先
  if (userOverride) {
    const v = voicesCache.find(v => v.name === userOverride);
    if (v) { bestVoice = v; return; }
  }
  // 2. 依 PREFERRED 順序找
  for (const name of PREFERRED_VOICES) {
    const v = voicesCache.find(v =>
      v.name.includes(name) && v.lang.toLowerCase().startsWith('en')
    );
    if (v) { bestVoice = v; return; }
  }
  // 3. 任何 en-US
  bestVoice =
    voicesCache.find(v => v.lang === 'en-US') ||
    voicesCache.find(v => v.lang.toLowerCase().startsWith('en')) ||
    null;
}

function pickBestZh() {
  for (const name of PREFERRED_ZH_VOICES) {
    const v = voicesCache.find(v =>
      v.name.includes(name) && (v.lang.toLowerCase().startsWith('zh') || v.lang.toLowerCase().includes('cmn'))
    );
    if (v) { bestZhVoice = v; return; }
  }
  bestZhVoice =
    voicesCache.find(v => v.lang === 'zh-TW') ||
    voicesCache.find(v => v.lang.toLowerCase().startsWith('zh')) ||
    null;
}

function loadVoices() {
  if (!('speechSynthesis' in window)) return;
  voicesCache = window.speechSynthesis.getVoices();
  try {
    userOverride = localStorage.getItem('sv2.voice') || null;
  } catch (e) {}
  pickBest();
  pickBestZh();
}

if ('speechSynthesis' in window) {
  loadVoices();
  // 多數瀏覽器是 async 載入，要監聽
  window.speechSynthesis.onvoiceschanged = loadVoices;
}

export function speak(text, opts = {}) {
  if (!('speechSynthesis' in window) || !text) return;
  // 先取消正在播的，避免疊加
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(String(text));
  u.lang = 'en-US';
  u.rate = opts.rate ?? 0.9;     // 略慢，孩子比較聽得清
  u.pitch = opts.pitch ?? 1.0;
  u.volume = opts.volume ?? 1.0;
  if (bestVoice) u.voice = bestVoice;
  window.speechSynthesis.speak(u);
}

export function stopSpeak() {
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
}

// 先唸字母拼讀（A-P-P-L-E）再唸整個字
// v2.8 起：default 不再用這個（某些字 TTS 拼錯）。改用 speakSpell 或 speak。
export function speakSpellThenWord(text) {
  if (!('speechSynthesis' in window) || !text) return;
  window.speechSynthesis.cancel();
  _queueSpellThenWord(String(text).trim());
}

// 只唸字母拼字（v2.8 新增，給「聽拼字」按鈕用）
export function speakSpell(text) {
  if (!('speechSynthesis' in window) || !text) return;
  window.speechSynthesis.cancel();
  _queueEnSpell(String(text).trim());
}

// 把英文「字（不拼字）」加進 queue
function _queueEnWord(trimmed) {
  if (!trimmed) return;
  const u = new SpeechSynthesisUtterance(trimmed);
  u.lang = 'en-US'; u.rate = 0.9;
  if (bestVoice) u.voice = bestVoice;
  window.speechSynthesis.speak(u);
}

// 把英文「拼字（只字母）」加進 queue
function _queueEnSpell(trimmed) {
  if (!trimmed) return;
  if (!/^[a-zA-Z]+$/.test(trimmed)) {
    // 詞組／含特殊字元 → 直接唸整段（無法拼字）
    _queueEnWord(trimmed);
    return;
  }
  const spelled = trimmed.toUpperCase().split('').join('. ') + '.';
  const u = new SpeechSynthesisUtterance(spelled);
  u.lang = 'en-US'; u.rate = 0.5;  // 拼字更慢更清楚
  if (bestVoice) u.voice = bestVoice;
  window.speechSynthesis.speak(u);
}

// 舊 API：拼字 + 整字（v2.8 起改為按鈕觸發用，不再是 default）
function _queueSpellThenWord(trimmed) {
  if (!trimmed) return;
  _queueEnSpell(trimmed);
  _queueEnWord(trimmed);
}

// 把中文加進當前 queue
function _queueZh(zhTrimmed) {
  if (!zhTrimmed) return;
  // 移除括號內的英文註記（例如「鉛筆盒（= pencil box）」→「鉛筆盒」）
  const clean = zhTrimmed.replace(/（[^）]*[a-zA-Z][^）]*）/g, '').replace(/\([^)]*[a-zA-Z][^)]*\)/g, '').trim();
  if (!clean) return;
  const u = new SpeechSynthesisUtterance(clean);
  u.lang = 'zh-TW'; u.rate = 0.9;
  if (bestZhVoice) u.voice = bestZhVoice;
  window.speechSynthesis.speak(u);
}

// 只唸中文
export function speakZh(text) {
  if (!('speechSynthesis' in window) || !text) return;
  window.speechSynthesis.cancel();
  _queueZh(String(text).trim());
}

// 唸完整序列：英文（整字，不拼字）→ 中文
// v2.8 起：default 不拼字，因為某些字 TTS 拼錯（例如 really）。要拼字按專屬按鈕
export function speakEnThenZh(en, zh) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  _queueEnWord(String(en || '').trim());
  _queueZh(String(zh || '').trim());
}

// 唸完整序列：中文 → 英文（整字）
export function speakZhThenEn(zh, en) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  _queueZh(String(zh || '').trim());
  _queueEnWord(String(en || '').trim());
}

export function listVoices() {
  return voicesCache.filter(v => v.lang.toLowerCase().startsWith('en'));
}

export function setVoice(name) {
  userOverride = name;
  try { localStorage.setItem('sv2.voice', name); } catch (e) {}
  pickBest();
}

export function getCurrentVoiceName() {
  return bestVoice ? bestVoice.name : '(未指定)';
}
