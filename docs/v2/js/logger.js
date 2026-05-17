// logger.js — POST 事件到既有的 Google Sheet（沿用舊版的 Apps Script 端點）
//
// payload 欄位對應 Sheet「學習紀錄」表頭：
//   時間,事件,單元,題數,對,預測,獎金,待領零用錢,累計已領,連續打卡天數,備註,裝置
//
// 「裝置」欄取自 state.getDeviceName()，每台瀏覽器自己取名（媽媽 Mac / 謙恩 iPad …）
// 不再寫死「謙恩」，這樣 Sheet 看得出是哪台寫進來的
//
// 可靠性：
//   - logEvent 用 fetch + keepalive: true → 即使頁面關閉中也會送出
//   - logEventBeacon 給 pagehide 用，sendBeacon 是設計來這場景
//   - 兩個都 catch 任何錯，不會因 log 掛掉影響使用

import { getDeviceName } from './state.js';

const LOG_WEBAPP_URL = "https://script.google.com/macros/s/AKfycbw1-aQQF4goCDF6X7_oIHEk4rVIbRrDADkq5ZQ1kopePXVehu9EGkkCNnj3Z4Hxd1aW7w/exec";

// Meta（系統管理）事件：跟學習/獎金無關，不該寫 money/streak 欄
// 否則 Sheet 上會看起來像「一命名裝置就有 $52」造成誤導
const META_EVENTS = new Set([
  'v2_device_named',
  'v2_session_start',
  'v2_settings_changed',
  'v2_voice_changed',
  // 注意：v2_payout 不算 meta — 它有 amount 要影響統計
]);

function buildPayload(data, s) {
  const isMeta = META_EVENTS.has(data.event);
  return {
    event: data.event || '',
    unit: data.unit || '',
    quizSize: data.quizSize ?? '',
    correct: data.correct ?? '',
    prediction: '',                   // v2 沒有預測機制
    amount: data.amount ?? '',
    note: data.note || '',
    money: isMeta ? '' : (s.totalEarned ?? 0),
    totalPaid: '',
    streak: isMeta ? '' : (s.streak ?? 0),
    user: getDeviceName() || '(未命名)',  // 「user」這欄到 Sheet 是「裝置」欄
  };
}

export function logEvent(data, s = {}) {
  if (!LOG_WEBAPP_URL) return;
  try {
    const body = JSON.stringify(buildPayload(data, s));
    fetch(LOG_WEBAPP_URL, {
      method: 'POST',
      mode: 'no-cors',
      keepalive: true,                // 關鍵：頁面關閉中仍能送出
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body,
    }).catch(() => {});
  } catch (e) {
    // 失敗不影響使用者
  }
}

// pagehide 用：sendBeacon 是專為「頁面關閉前最後一發」設計
export function logEventBeacon(data, s = {}) {
  if (!LOG_WEBAPP_URL) return;
  try {
    const body = JSON.stringify(buildPayload(data, s));
    if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
      const blob = new Blob([body], { type: 'text/plain;charset=utf-8' });
      navigator.sendBeacon(LOG_WEBAPP_URL, blob);
    } else {
      fetch(LOG_WEBAPP_URL, {
        method: 'POST',
        mode: 'no-cors',
        keepalive: true,
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body,
      }).catch(() => {});
    }
  } catch (e) {}
}
