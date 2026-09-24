// wallet.js — 錢包唯一算法（v2.48）：設定（上限／費率）＋以「人」計的錢包
//
// 為什麼存在：
//   v2.47 以前「餘額」有三套算法——英文 v2 按裝置、首頁與國文按人、提領頁按裝置——
//   而且上限／費率寫死在 reward.js、chinese/index.html、index.html 三處。
//   家長 2026-09-23 決定：錢包綁人（所有裝置合計）、上限與費率在家長頁可設定。
//   所有頁面（首頁、英文、國文、家長頁）都讀這一份。純函式，無 DOM、無網路。
//
// 設定事件（最後一筆生效，events 已按時間排序）：
//   - v2_config_set，note = "cfg:<key>"，amount = 值  ← v2.48 新增，通用
//   - v2_config_daily_cap（= cap.en）、v2_config_daily_cap_cn（= cap.cn）← 舊事件照讀
//
// 上限比較的是「乘連勝倍率前」的金額（v2.48 修正）：
//   v2.48 起每筆賺錢事件的 note 帶 "#pre:N"；舊事件沒有，退回用 amount（乘後金額）。

export const CONFIG_KEYS = [
  // key,               預設, 最小, 最大, 標籤
  ['cap.en',              50,  10, 1000, '英文每日上限'],
  ['cap.cn',             100,  10, 1000, '國文每日上限'],
  ['cap.soc',             50,  10, 1000, '社會每日上限'],
  ['cap.sci',             50,  10, 1000, '自然每日上限'],
  ['cap.math',            50,  10, 1000, '數學每日上限'],
  ['cap.all',              0,   0, 3000, '全科每日總上限（0＝不另設）'],
  ['rate.en.base',         5,   0,  100, '英文基礎獎金（一天一次）'],
  ['rate.en.per',          1,   0,  100, '英翻中／中翻英 每題'],
  ['rate.en.vocab',        2,   0,  100, '文意字彙 每題'],
  ['rate.en.cloze',        2,   0,  100, '克漏字 每格'],
  ['rate.en.review',      12,   0,  100, '從頭複習 每輪'],
  ['rate.en.reviewCap',   12,   0,  100, '從頭複習 每日上限'],
  ['rate.en.match',        2,   0,  100, '連連看 每場'],
  ['rate.en.reading',      3,   0,  100, '英文閱讀理解 每題'],
  ['rate.cn.base',        10,   0,  100, '國文基礎獎金（一天一次）'],
  ['rate.cn.per',          2,   0,  100, '國文 每題一次答對'],
  ['rate.hk.per',          2,   0,  100, '會考題 每題（同一題只付一次）'],
];

// v2.49：科目清單——錢包、首頁、家長頁、國文頁、sync.js 都從這裡產生，新增科目只改這裡。
//   match：這個事件名算不算這科的收入。英文包含舊的 *_done 與會考題 v2_hk_en_paid。
//   ⚠️ 會考事件一律 v2_hk_<科>_paid，絕不以 _done 結尾（否則會被當成英文單字題型，吃英文連勝與基礎獎金邏輯）
export const SUBJECTS = [
  { id: 'en',   label: '英文', match: e => /^v2_hk_en_paid$/.test(e) || (e.startsWith('v2_') && e.endsWith('_done')) },
  { id: 'cn',   label: '國文', match: e => /^v2_cn_.*_paid$/.test(e) || e === 'v2_hk_cn_paid' },   // v2.54：國文會考題算國文收入、吃國文上限
  { id: 'soc',  label: '社會', match: e => e === 'v2_hk_soc_paid' },
  { id: 'sci',  label: '自然', match: e => e === 'v2_hk_sci_paid' },
  { id: 'math', label: '數學', match: e => e === 'v2_hk_math_paid' },
];
const SPEC = Object.fromEntries(CONFIG_KEYS.map(([k, d, lo, hi, label]) => [k, { d, lo, hi, label }]));
const LEGACY = { v2_config_daily_cap: 'cap.en', v2_config_daily_cap_cn: 'cap.cn' };
const LEGACY_CAP_MIN = 10;   // 舊事件的合法範圍是 10–1000（沿用 v2.35 的驗證）

function validValue(key, raw, legacy) {
  const s = SPEC[key];
  if (!s) return null;
  const v = Math.floor(Number(raw));
  if (!Number.isFinite(v)) return null;
  const lo = legacy ? LEGACY_CAP_MIN : s.lo;
  return (v >= lo && v <= s.hi) ? v : null;
}

// 回傳 { values: {key: 值}, fromParent: {key: true} }
export function parseConfig(events) {
  const values = {};
  const fromParent = {};
  for (const [k, d] of CONFIG_KEYS) values[k] = d;
  for (const ev of events || []) {
    if (isTestDevice(ev.device)) continue;   // 測試裝置不能改到正式設定（reviewer L3）
    const name = String(ev.event || '');
    let key = null, legacy = false;
    if (LEGACY[name]) { key = LEGACY[name]; legacy = true; }
    else if (name === 'v2_config_set') {
      const m = String(ev.note || '').match(/^cfg:([a-zA-Z.]+)/);
      if (m) key = m[1];
    }
    if (!key) continue;
    const v = validValue(key, ev.amount, legacy);
    if (v === null) continue;
    values[key] = v;
    fromParent[key] = true;
  }
  return { values, fromParent };
}

export function configSpec() { return CONFIG_KEYS.map(([key, d, lo, hi, label]) => ({ key, d, lo, hi, label })); }

// 測試裝置不進錢包（家長或 AI 測試用；v2.48 起名稱含「測試」或 [test] 一律排除）
export function isTestDevice(name) { return /測試|\[test\]/i.test(String(name || '')); }

// 事件屬於哪一科的收入；不是收入回 null
//   英文：*_done（v2.40 起的慣例）＋ v2_hk_en_paid；國文：v2_cn_*_paid；會考其他科：v2_hk_<科>_paid
export function earnSubject(eventName) {
  const e = String(eventName || '');
  for (const s of SUBJECTS) if (s.match(e)) return s.id;
  return null;
}

// 會考題事件（v2_hk_<科>_paid）：不算打卡、不乘連勝、沒有基礎獎金
export function isHkEvent(eventName) { return /^v2_hk_[a-z]+_paid$/.test(String(eventName || '')); }

function emptyToday() { return Object.fromEntries(SUBJECTS.map(s => [s.id, { pre: 0, fin: 0 }])); }

// 乘倍率前的金額：note 的 #pre:N；沒有（v2.47 以前的舊事件）退回 amount
export function preOf(ev) {
  const m = String(ev.note || '').match(/#pre:(\d+)/);
  if (m) return Number(m[1]);
  return Math.max(0, Number(ev.amount) || 0);
}

export function dateOf(ts) { return ts ? String(ts).slice(0, 10) : ''; }

// 以人計的錢包（所有裝置合計、排除測試裝置）
export function computeWallet(events, todayStr) {
  const { values: cfg, fromParent } = parseConfig(events);
  let totalEarned = 0, totalWithdrawn = 0, totalPenalty = 0;
  const today = emptyToday();
  for (const ev of events || []) {
    if (isTestDevice(ev.device)) continue;
    const name = String(ev.event || '');
    const amount = Number(ev.amount) || 0;
    const subj = earnSubject(name);
    if (subj) {
      if (amount <= 0) continue;
      totalEarned += amount;
      if (dateOf(ev.timestamp) === todayStr) {
        today[subj].fin += amount;
        today[subj].pre += preOf(ev);
      }
    } else if (name === 'v2_payout') totalWithdrawn += Math.abs(amount);
    else if (name === 'v2_penalty') totalPenalty += Math.abs(amount);
  }
  const available = Math.max(0, totalEarned - totalWithdrawn - totalPenalty);
  const todayPreAll = SUBJECTS.reduce((sum, s) => sum + today[s.id].pre, 0);
  return { cfg, fromParent, totalEarned, totalWithdrawn, totalPenalty, available, today, todayPreAll };
}

// 這一科今天還能賺多少（乘倍率前）：同時受「本科上限」與「全科總上限」限制
//   cap.all = 0 表示不另設總上限
export function remainingPre(cfg, subject, todayPreSubject, todayPreAll) {
  const capS = Number(cfg[`cap.${subject}`]) || 0;
  const subjLeft = Math.max(0, capS - (todayPreSubject || 0));
  const capAll = Number(cfg['cap.all']) || 0;
  if (capAll <= 0) return subjLeft;
  return Math.min(subjLeft, Math.max(0, capAll - (todayPreAll || 0)));
}

// 本地快照（只給畫面「先顯示上次的數字」用）
//   ⚠️ 只存伺服器算出來的值；絕不拿來算錢、合併或 POST（避免重演 v2.35 的 25→489 事件）
const SNAP_KEY = 'sv2.walletSnapshot';
export function saveSnapshot(w, todayStr) {
  try {
    localStorage.setItem(SNAP_KEY, JSON.stringify({
      at: Date.now(), day: todayStr, available: w.available, today: w.today, cfg: w.cfg,
    }));
  } catch (e) {}
}
export function loadSnapshot() {
  try { const s = JSON.parse(localStorage.getItem(SNAP_KEY) || 'null'); return s && typeof s === 'object' ? s : null; }
  catch (e) { return null; }
}
