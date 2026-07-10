// sync.js — 從 Google Sheet 跨裝置同步 totalEarned / todayEarned / streak
//
// 為什麼存在：
//   v2 之前的 totalEarned/todayEarned/streak 只存在每台瀏覽器的 localStorage，
//   兩台裝置會各自累計、清快取就消失。
//
// 解法：
//   1. Sheet 是真相來源
//   2. localStorage 是快取
//   3. 每次 v2 開啟，背景跑一次 fetchV2Events + recomputeFromEvents，覆蓋本地
//   4. 本機完成的 session 即時更新 local，下次 startup 再從 Sheet 拉齊
//
// 依賴：
//   - Apps Script 必須部署過含 ?action=v2_events 的版本（見 apps-script/程式碼.js）

const LOG_WEBAPP_URL = "https://script.google.com/macros/s/AKfycbw1-aQQF4goCDF6X7_oIHEk4rVIbRrDADkq5ZQ1kopePXVehu9EGkkCNnj3Z4Hxd1aW7w/exec";

export async function fetchV2Events() {
  try {
    const url = `${LOG_WEBAPP_URL}?action=v2_events`;
    const res = await fetch(url, { mode: 'cors', cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data || !data.ok) throw new Error(data?.error || 'API 未就緒');
    if (!Array.isArray(data.events)) throw new Error('回應格式不對');
    return { ok: true, events: data.events };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// 從事件流水帳重算狀態（v2.9 起：每台裝置只算自己的紀錄）
// 規則：
//   - 只計入 device 等於當前裝置名的事件（不跨裝置加總）
//   - 只算事件名 endsWith('_done')
//   - 累計獎金 = 所有 amount 加總
//   - 今日獎金 = 日期 == todayStr 的 amount 加總，**v2.10 起套用日上限 $100**
//     （之前歷史事件因 localStorage 同步亂寫，sum 可能超過 cap，要在 replay 階段壓回去）
//   - 打卡日門檻：v2_review_done 一律算；其他 mode 需要 correct ≥ 5
//   - streak = 從今天往回，連續打卡天數
//
// myDevice：當前裝置名（從 state.getDeviceName 傳入）。null/空 → 不算任何事件
import { REWARD_CONFIG, effectiveDailyCap } from './reward.js';

// v2.35：從全部事件（不分裝置）找家長最後一次設定的每日上限。
// v2_config_daily_cap 事件由家長頁寫入，amount = 新上限。events 已按時間排序，最後一筆生效。
export function extractDailyCap(events) {
  let cap = null;
  for (const ev of events || []) {
    if (String(ev.event || '') === 'v2_config_daily_cap') {
      const v = Math.floor(Number(ev.amount));
      if (v >= 10 && v <= 1000) cap = v;
    }
  }
  return cap;  // null = 家長沒調過，用預設
}

export function recomputeFromEvents(events, todayStr, myDevice) {
  const dev = String(myDevice || '').trim();
  const real = (events || []).filter(ev =>
    dev && String(ev.device || '') === dev
  );
  const dailyCap = extractDailyCap(events);

  let totalEarned = 0;
  let totalWithdrawn = 0;
  let totalPenalty = 0;
  let todayEarned = 0;
  // v2.35：每日上限相關的「今日狀態」也從事件重算，
  // 換瀏覽器／清資料／殭屍分頁都繞不過每日上限（2026-07-10 的複習 $25 領兩次 bug）
  let todayReviewEarned = 0;
  let todayBaseGiven = false;
  const todayReadingDone = [];
  const completedDays = new Set();

  for (const ev of real) {
    const event = String(ev.event || '');
    const amount = Number(ev.amount) || 0;
    const correct = Number(ev.correct) || 0;
    const date = formatDate(ev.timestamp);

    if (event.endsWith('_done')) {
      if (amount > 0) {
        totalEarned += amount;
        if (date === todayStr) todayEarned += amount;
      }
      if (date === todayStr && amount > 0) {
        if (event === 'v2_review_done') todayReviewEarned += amount;
        // 基礎獎金只可能在英翻中／中翻英答對 ≥5 時發出（一天一次）
        if ((event === 'v2_en2zh_done' || event === 'v2_zh2en_done') && correct >= REWARD_CONFIG.minCorrectForBase) {
          todayBaseGiven = true;
        }
        if (event === 'v2_reading_done' && ev.unit) todayReadingDone.push(String(ev.unit));
      }
      const isReview = event === 'v2_review_done';
      const qualifies = isReview || correct >= 5;
      if (qualifies && date) completedDays.add(date);
    } else if (event === 'v2_payout') {
      // v2.16：提領事件 — amount 是負值，取絕對值累加 totalWithdrawn
      totalWithdrawn += Math.abs(amount);
    } else if (event === 'v2_penalty') {
      // v2.34：生活習慣扣款 — amount 是負值，取絕對值累加 totalPenalty。
      //   只減「可提領」，不動 totalEarned（學習成就總額不縮水）、不動 todayEarned、
      //   不影響打卡天數/連勝（扣的是生活責任，不是學習表現）。
      totalPenalty += Math.abs(amount);
    }
  }

  const streak = computeStreak(completedDays, todayStr);

  // v2.10：套用日上限（v2.35：改用家長設定的有效上限）
  const rawTodayEarned = todayEarned;
  const cap = effectiveDailyCap(dailyCap);
  if (todayEarned > cap) todayEarned = cap;

  // v2.16：可提領 = 累計賺 - 已提領；v2.34：再扣掉生活習慣扣款。不能小於 0。
  //   註：totalPenalty 是累計值，就算一時超過餘額（顯示壓回 0），日後再賺錢時
  //   仍會被扣回來（debt 自然遞延），但畫面永遠不會出現負數（焦慮型設計）。
  const availableToWithdraw = Math.max(0, totalEarned - totalWithdrawn - totalPenalty);

  return {
    totalEarned,
    totalWithdrawn,
    totalPenalty,
    availableToWithdraw,
    todayEarned,
    todayPreEarned: todayEarned,
    streak,
    eventCount: real.length,
    completedDayCount: completedDays.size,
    rawTodayEarned,
    // v2.35：今日上限狀態（防跨瀏覽器重複領）+ 家長設定的每日上限
    todayReviewEarned,
    todayBaseGiven,
    todayReadingDone,
    dailyCap,
  };
}

// v2.16：給家長提領頁用 — 算所有裝置的累計、已提領、可提領
// 回傳 Map<deviceName, { totalEarned, totalWithdrawn, availableToWithdraw }>
export function computeAllDevices(events) {
  const map = new Map();
  for (const ev of events || []) {
    const dev = String(ev.device || '').trim();
    if (!dev) continue;
    if (!map.has(dev)) map.set(dev, { totalEarned: 0, totalWithdrawn: 0, totalPenalty: 0 });
    const m = map.get(dev);
    const event = String(ev.event || '');
    const amount = Number(ev.amount) || 0;
    if (event.endsWith('_done') && amount > 0) {
      m.totalEarned += amount;
    } else if (event === 'v2_payout') {
      m.totalWithdrawn += Math.abs(amount);
    } else if (event === 'v2_penalty') {
      m.totalPenalty += Math.abs(amount);  // v2.34：生活習慣扣款
    }
  }
  for (const [, m] of map) {
    m.availableToWithdraw = Math.max(0, m.totalEarned - m.totalWithdrawn - m.totalPenalty);
  }
  return map;
}

function formatDate(ts) {
  if (!ts) return '';
  // Apps Script 回的是 "2026-05-15 22:30:00"（Asia/Taipei）→ 取前 10 碼即 YYYY-MM-DD
  return String(ts).slice(0, 10);
}

function computeStreak(completedDays, todayStr) {
  if (completedDays.size === 0) return 0;
  let streak = 0;
  let d = parseLocalDate(todayStr);
  // 若今天沒完成 → 從昨天起算（允許今天還沒做）
  if (!completedDays.has(formatDateObj(d))) {
    d.setDate(d.getDate() - 1);
  }
  while (completedDays.has(formatDateObj(d))) {
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

function parseLocalDate(s) {
  // "2026-05-15" → local Date 物件
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function formatDateObj(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
