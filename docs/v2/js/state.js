// state.js — localStorage 包裝 + 每日 / 每月狀態重置
// 設計原則：純資料 + 純函式，不直接動 DOM。

const KEY = 'sv2.state';

const DEFAULTS = {
  streak: 0,             // 目前連勝天數
  lastDate: null,        // 上次完成的日期 YYYY-MM-DD
  todayDate: null,       // 今日日期（用於判斷是否跨日重置）
  todayPreEarned: 0,     // 今日已賺取（連勝倍率前）
  todayEarned: 0,        // 今日已賺取（連勝倍率後）
  todayCorrect: 0,       // 今日累積答對數
  totalEarned: 0,        // 累積總額
  freezeAvailable: 3,    // 本月可用保護卡
  freezeMonth: null,     // 保護卡所屬月份 YYYY-MM
  todaySeenEns: {},      // 今日已練過的字 { 單元名: [en, en, ...] }（每日重置）
  baseGivenToday: false, // 今日基礎獎金 $10 是否已發過（每日重置）
  totalWithdrawn: 0,     // 累計已提領（v2.16）— 從 sync 同步
  availableToWithdraw: 0,// 可提領金額 = totalEarned - totalWithdrawn（從 sync 同步）
};

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
  } catch (e) {
    console.warn('state.load failed', e);
    return { ...DEFAULTS };
  }
}

export function save(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('state.save failed', e);
  }
}

// 用本地時間（台灣）算今天，避免 UTC vs Asia/Taipei 差一天的 bug
export function today() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function thisMonth() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

// 跨日 / 跨月時自動重置今日累計與保護卡
export function refreshDailyState(state) {
  const t = today();
  const m = thisMonth();
  let changed = false;

  if (state.todayDate !== t) {
    state.todayDate = t;
    state.todayPreEarned = 0;
    state.todayEarned = 0;
    state.todayCorrect = 0;
    state.todaySeenEns = {};  // 每天重置「今天練過的字」
    state.baseGivenToday = false;  // 每天重置「基礎獎金已給」
    changed = true;
  }
  if (state.freezeMonth !== m) {
    state.freezeMonth = m;
    state.freezeAvailable = 3;
    changed = true;
  }
  return { state, changed };
}

// 完全清空（除錯用）
export function reset() {
  localStorage.removeItem(KEY);
}

// ===== 今日單字覆蓋追蹤 =====
// 讓抽題能優先挑「今天還沒練過」的字，避免重複看到前幾個

export function getSeenEns(s, unit) {
  return new Set(s.todaySeenEns?.[unit] || []);
}

export function markSeenEns(s, unit, ens) {
  if (!s.todaySeenEns) s.todaySeenEns = {};
  if (!s.todaySeenEns[unit]) s.todaySeenEns[unit] = [];
  const set = new Set(s.todaySeenEns[unit]);
  for (const en of ens) if (en) set.add(en);
  s.todaySeenEns[unit] = [...set];
}

// ===== 裝置名（每台瀏覽器自己取，寫到 Google Sheet 的「裝置」欄） =====
const DEVICE_KEY = 'sv2.deviceName';

export function getDeviceName() {
  try { return localStorage.getItem(DEVICE_KEY); } catch (e) { return null; }
}

export function setDeviceName(name) {
  try { localStorage.setItem(DEVICE_KEY, String(name).trim().slice(0, 40)); } catch (e) {}
}

// 依 UA 猜一個合理的預設值
export function guessDeviceName() {
  const ua = (typeof navigator !== 'undefined' ? navigator.userAgent : '') || '';
  let kind = '裝置';
  if (/iPad/i.test(ua)) kind = 'iPad';
  else if (/iPhone/i.test(ua)) kind = 'iPhone';
  else if (/Android.*Mobile/i.test(ua)) kind = 'Android';
  else if (/Android/i.test(ua)) kind = 'Android平板';
  else if (/Macintosh/i.test(ua)) kind = 'Mac';
  else if (/Windows/i.test(ua)) kind = 'Windows';
  // 加 4 碼隨機讓兩台同型也能分
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${kind}-${suffix}`;
}
