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

let voicesCache = [];
let bestVoice = null;
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

function loadVoices() {
  if (!('speechSynthesis' in window)) return;
  voicesCache = window.speechSynthesis.getVoices();
  // 還原使用者偏好
  try {
    userOverride = localStorage.getItem('sv2.voice') || null;
  } catch (e) {}
  pickBest();
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
// 只對「純字母單字」拼讀；詞組或含特殊字元直接唸整段
export function speakSpellThenWord(text) {
  if (!('speechSynthesis' in window) || !text) return;
  window.speechSynthesis.cancel();
  const trimmed = String(text).trim();
  const isSingleWord = /^[a-zA-Z]+$/.test(trimmed);
  if (!isSingleWord) {
    // 詞組（含空格、標點、連字號）→ 直接唸整段
    const u = new SpeechSynthesisUtterance(trimmed);
    u.lang = 'en-US';
    u.rate = 0.9;
    if (bestVoice) u.voice = bestVoice;
    window.speechSynthesis.speak(u);
    return;
  }
  // 字母逐字唸：大寫 + 句號讓 TTS 把每個字母當獨立片段
  const spelled = trimmed.toUpperCase().split('').join('. ') + '.';
  const u1 = new SpeechSynthesisUtterance(spelled);
  u1.lang = 'en-US';
  u1.rate = 0.6;  // 字母慢慢唸
  if (bestVoice) u1.voice = bestVoice;
  window.speechSynthesis.speak(u1);
  // 接著唸整個字（speechSynthesis 會自動排隊）
  const u2 = new SpeechSynthesisUtterance(trimmed);
  u2.lang = 'en-US';
  u2.rate = 0.9;
  if (bestVoice) u2.voice = bestVoice;
  window.speechSynthesis.speak(u2);
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
