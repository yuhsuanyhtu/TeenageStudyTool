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
