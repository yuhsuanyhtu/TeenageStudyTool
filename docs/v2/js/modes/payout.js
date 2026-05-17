// modes/payout.js — 家長提領頁
//
// 設計：
//   - 跨裝置：列所有裝置的累計賺 / 已提領 / 可提領
//   - 提領前必先 fresh sync 防 double-spend（媽媽在 A 機提了，B 機也想提就要先 sync）
//   - 每筆 $100 一單位
//   - POST v2_payout 事件，amount=-100
//   - 信任制（家庭用，不做密碼）— 如需防孩子自助，未來加 PIN
//
// 完成後家長按「回主畫面」即可

import { REWARD_CONFIG } from '../reward.js';
import { fetchV2Events, computeAllDevices } from '../sync.js';
import { logEvent } from '../logger.js';

export function startPayoutMode({ root, onBack }) {
  let busy = false;

  async function load() {
    root.innerHTML = `
      <button class="back" id="back">← 回主畫面</button>
      <h1>🏦 家長提領</h1>
      <p class="muted">同步中…請稍候</p>
    `;
    root.querySelector('#back').addEventListener('click', onBack);

    const result = await fetchV2Events();
    if (!result.ok) {
      root.innerHTML = `
        <button class="back" id="back">← 回主畫面</button>
        <h1>🏦 家長提領</h1>
        <div class="card">
          <p>⚠ 無法連線到 Google Sheet</p>
          <p class="muted small">${escapeHtml(result.error || '')}</p>
          <p class="muted small">為了避免重複提領，必須先成功同步才能提領。請檢查網路與 Apps Script 部署狀態，再試一次。</p>
        </div>
        <button id="retry">重試</button>
      `;
      root.querySelector('#back').addEventListener('click', onBack);
      root.querySelector('#retry').addEventListener('click', load);
      return;
    }

    renderList(result.events);
  }

  function renderList(events) {
    const map = computeAllDevices(events);
    // 排序：可提領金額 desc
    const devices = [...map.entries()].sort((a, b) =>
      b[1].availableToWithdraw - a[1].availableToWithdraw
    );

    const unit = REWARD_CONFIG.payoutUnit;
    let totalAvailable = 0;
    let totalEarnedAll = 0;
    let totalWithdrawnAll = 0;
    for (const [, m] of map) {
      totalAvailable += m.availableToWithdraw;
      totalEarnedAll += m.totalEarned;
      totalWithdrawnAll += m.totalWithdrawn;
    }

    root.innerHTML = `
      <button class="back" id="back">← 回主畫面</button>
      <h1>🏦 家長提領</h1>
      <p class="muted">每筆提領以 $${unit} 為單位，按下提領會寫到 Google Sheet</p>

      <div class="stats">
        <div class="stat">
          <div class="stat-num">$${totalEarnedAll}</div>
          <div class="stat-label">所有裝置累計</div>
        </div>
        <div class="stat">
          <div class="stat-num">$${totalWithdrawnAll}</div>
          <div class="stat-label">已提領總額</div>
        </div>
        <div class="stat">
          <div class="stat-num">$${totalAvailable}</div>
          <div class="stat-label">可提領總額</div>
        </div>
      </div>

      <h2>各裝置明細</h2>
      ${devices.length === 0 ? '<p class="muted">沒有任何裝置紀錄</p>' :
        devices.map(([dev, m]) => `
          <div class="card payout-card">
            <div class="payout-dev">${escapeHtml(dev)}</div>
            <div class="payout-row">
              <span>累計賺</span><b>$${m.totalEarned}</b>
            </div>
            <div class="payout-row">
              <span>已提領</span><b>$${m.totalWithdrawn}</b>
            </div>
            <div class="payout-row payout-avail">
              <span>可提領</span><b>$${m.availableToWithdraw}</b>
            </div>
            <button class="payout-btn" data-dev="${escapeHtml(dev)}"
              data-avail="${m.availableToWithdraw}"
              ${m.availableToWithdraw < unit ? 'disabled' : ''}>
              提領 $${unit}${m.availableToWithdraw < unit ? '（不足）' : ''}
            </button>
          </div>
        `).join('')}

      <p class="muted small" style="margin-top:16px;">
        ⚠ 提領前會自動同步 Sheet，避免兩台裝置同時提領造成超領
      </p>
    `;
    root.querySelector('#back').addEventListener('click', onBack);
    root.querySelectorAll('.payout-btn').forEach(btn => {
      btn.addEventListener('click', () => handlePayout(btn.dataset.dev, +btn.dataset.avail));
    });
  }

  async function handlePayout(deviceName, available) {
    if (busy) return;
    const unit = REWARD_CONFIG.payoutUnit;
    if (available < unit) {
      alert(`${deviceName} 可提領 $${available} 不夠一筆 $${unit}`);
      return;
    }
    if (!confirm(`確定要從「${deviceName}」提領 $${unit}？\n\n提領後該裝置「可提領」會少 $${unit}。`)) return;

    busy = true;
    // 直接 POST 一個 v2_payout 事件，amount=-100，device=被提領的那台
    // 注意：getDeviceName() 取的是「當前操作的裝置」(媽媽 Mac)，
    // 但 sheet 上「裝置」欄要記「被提領的那台」(謙恩 iPad)
    // logger 預設用 getDeviceName()，這裡要 override。先改 payload 寫入方式。
    //
    // 簡化做法：直接 fetch POST 一個自訂 payload
    await postPayout(deviceName, unit);
    busy = false;
    // 重新載入（會 re-sync）
    load();
  }

  load();
}

// 直接 POST，自訂 device 欄位（不用 logger 因為 logger 強制用本機 device）
async function postPayout(targetDevice, amount) {
  const LOG_WEBAPP_URL = "https://script.google.com/macros/s/AKfycbw1-aQQF4goCDF6X7_oIHEk4rVIbRrDADkq5ZQ1kopePXVehu9EGkkCNnj3Z4Hxd1aW7w/exec";
  const payload = {
    event: 'v2_payout',
    unit: '',
    quizSize: '',
    correct: '',
    prediction: '',
    amount: -amount,                     // 負值
    note: `家長提領 $${amount}（對 ${targetDevice}）`,
    money: '',
    totalPaid: amount,                   // 給 Sheet 「累計已領」欄參考用
    streak: '',
    user: targetDevice,                  // 「裝置」欄寫被提領的裝置
  };
  try {
    await fetch(LOG_WEBAPP_URL, {
      method: 'POST',
      mode: 'no-cors',
      keepalive: true,
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    console.warn('payout post failed', e);
  }
  // Apps Script POST 是 fire-and-forget；等 1.5 秒讓 Sheet 寫入完成再 re-fetch
  await new Promise(r => setTimeout(r, 1500));
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}
