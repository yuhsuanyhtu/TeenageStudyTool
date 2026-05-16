// logger.js — POST 事件到既有的 Google Sheet（沿用舊版的 Apps Script 端點）
//
// payload 欄位對應 Sheet「學習紀錄」表頭：
//   時間,事件,單元,題數,對,預測,獎金,待領零用錢,累計已領,連續打卡天數,備註,裝置
//
// v2 沒有「待領 vs 已領」分開，所以「待領」欄填累積總額、「已領」欄留 0
// 「裝置」欄由舊端點自己塞 user 名字（從 payload.user）

const LOG_WEBAPP_URL = "https://script.google.com/macros/s/AKfycbw1-aQQF4goCDF6X7_oIHEk4rVIbRrDADkq5ZQ1kopePXVehu9EGkkCNnj3Z4Hxd1aW7w/exec";

const USER_NAME = '謙恩';  // v2 暫時寫死，之後加設定頁可改

function buildPayload(data, s) {
  return {
    event: data.event || '',
    unit: data.unit || '',
    quizSize: data.quizSize ?? '',
    correct: data.correct ?? '',
    prediction: '',  // v2 沒有預測機制
    amount: data.amount ?? '',
    note: data.note || '',
    money: s.totalEarned ?? 0,
    totalPaid: 0,
    streak: s.streak ?? 0,
    user: USER_NAME,
  };
}

export function logEvent(data, s = {}) {
  if (!LOG_WEBAPP_URL) return;
  try {
    const body = JSON.stringify(buildPayload(data, s));
    fetch(LOG_WEBAPP_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body,
    }).catch(() => {});
  } catch (e) {
    // 失敗不影響使用者
  }
}

// pagehide 用：靠 sendBeacon 確保關瀏覽器前送出
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
