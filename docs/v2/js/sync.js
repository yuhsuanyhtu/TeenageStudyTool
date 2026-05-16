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
//   - 今日獎金 = 日期 == todayStr 的 amount 加總
//   - 打卡日門檻：v2_review_done 一律算；其他 mode 需要 correct ≥ 5
//   - streak = 從今天往回，連續打卡天數
//
// myDevice：當前裝置名（從 state.getDeviceName 傳入）。null/空 → 不算任何事件
export function recomputeFromEvents(events, todayStr, myDevice) {
  const dev = String(myDevice || '').trim();
  const real = (events || []).filter(ev =>
    dev && String(ev.device || '') === dev
  );

  let totalEarned = 0;
  let todayEarned = 0;
  const completedDays = new Set();

  for (const ev of real) {
    const event = String(ev.event || '');
    if (!event.endsWith('_done')) continue;

    const amount = Number(ev.amount) || 0;
    const correct = Number(ev.correct) || 0;
    const date = formatDate(ev.timestamp);

    if (amount > 0) {
      totalEarned += amount;
      if (date === todayStr) todayEarned += amount;
    }

    const isReview = event === 'v2_review_done';
    const qualifies = isReview || correct >= 5;
    if (qualifies && date) completedDays.add(date);
  }

  const streak = computeStreak(completedDays, todayStr);

  return {
    totalEarned,
    todayEarned,
    streak,
    eventCount: real.length,
    completedDayCount: completedDays.size,
  };
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
