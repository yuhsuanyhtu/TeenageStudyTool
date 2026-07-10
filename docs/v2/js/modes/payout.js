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

import { REWARD_CONFIG, effectiveDailyCap } from '../reward.js';
import { fetchV2Events, computeAllDevices, extractDailyCap } from '../sync.js';
import { logEvent } from '../logger.js';

// v2.34：生活習慣扣款預設金額（媽媽跟謙恩約定：提醒過仍沒做到一次扣 $10）
const DEFAULT_PENALTY = 10;

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
    // v2.35：目前生效的每日上限（家長設定 or 預設）
    const customCap = extractDailyCap(events);
    const currentCap = effectiveDailyCap(customCap);
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

    // v2.34：生活習慣扣款用的裝置選單（沿用提領頁已抓到的裝置清單）
    const deviceNames = devices.map(([dev]) => dev);
    const penaltyDeviceOptions = deviceNames.length
      ? deviceNames.map(d => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('')
      : '<option value="">（尚無裝置紀錄）</option>';

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
            ${m.totalPenalty ? `
            <div class="payout-row">
              <span>習慣扣款</span><b>−$${m.totalPenalty}</b>
            </div>` : ''}
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

      <h2 style="margin-top:28px;">➖ 生活習慣扣款</h2>
      <div class="card penalty-card">
        <p class="muted small" style="margin-top:0;">
          約定好、提醒過仍沒做到的事，一次 $${DEFAULT_PENALTY}。
          只會減少「可提領」，不會動到他的學習累計與連勝。
          扣款原因會記到 Google Sheet 的「備註」欄。
        </p>
        <label class="penalty-field">
          <span>裝置</span>
          <select id="pen-dev">${penaltyDeviceOptions}</select>
        </label>
        <label class="penalty-field">
          <span>原因（必填）</span>
          <input id="pen-reason" type="text" maxlength="60"
            placeholder="例如：提醒了還是沒把碗放進水槽" />
        </label>
        <label class="penalty-field">
          <span>金額</span>
          <input id="pen-amount" type="number" value="${DEFAULT_PENALTY}" min="1" step="1" />
        </label>
        <button id="pen-btn" class="penalty-btn" ${deviceNames.length ? '' : 'disabled'}>扣款</button>
        <p class="muted small" id="pen-msg" style="margin-bottom:0;"></p>
      </div>

      <h2 style="margin-top:28px;">⚙️ 每日獎金上限</h2>
      <div class="card penalty-card">
        <p class="muted small" style="margin-top:0;">
          目前上限：<b>$${currentCap}</b>${customCap === null ? '（預設）' : '（家長設定）'}。
          「基礎 + 按字數」一天最多賺這個數，改了會同步到所有裝置，孩子的規則頁也會跟著更新。
        </p>
        <label class="penalty-field">
          <span>新上限</span>
          <input id="cap-amount" type="number" value="${currentCap}" min="10" max="1000" step="10" />
        </label>
        <button id="cap-btn" class="penalty-btn">儲存上限</button>
        <p class="muted small" id="cap-msg" style="margin-bottom:0;"></p>
      </div>
    `;
    root.querySelector('#back').addEventListener('click', onBack);
    root.querySelectorAll('.payout-btn').forEach(btn => {
      btn.addEventListener('click', () => handlePayout(btn.dataset.dev, +btn.dataset.avail));
    });
    const penBtn = root.querySelector('#pen-btn');
    if (penBtn) penBtn.addEventListener('click', handlePenalty);
    const capBtn = root.querySelector('#cap-btn');
    if (capBtn) capBtn.addEventListener('click', () => handleDailyCap(currentCap));
  }

  // v2.35：家長調整每日上限 — POST v2_config_daily_cap 事件（amount = 新上限）
  async function handleDailyCap(currentCap) {
    if (busy) return;
    const amount = Math.floor(Number(root.querySelector('#cap-amount')?.value));
    const msg = root.querySelector('#cap-msg');
    const showMsg = (t) => { if (msg) msg.textContent = t; };

    if (!amount || amount < 10 || amount > 1000) { showMsg('上限要在 $10 ~ $1000 之間'); return; }
    if (amount === currentCap) { showMsg('跟目前的上限一樣，不用改'); return; }
    if (!confirm(`確定把每日獎金上限改成 $${amount}？\n\n（目前 $${currentCap}，會同步到所有裝置，今天就生效）`)) return;

    busy = true;
    showMsg('儲存中…');
    await postDailyCap(amount);
    busy = false;
    load();
  }

  async function handlePenalty() {
    if (busy) return;
    const dev = (root.querySelector('#pen-dev')?.value || '').trim();
    const reason = (root.querySelector('#pen-reason')?.value || '').trim();
    const amount = Math.floor(Number(root.querySelector('#pen-amount')?.value));
    const msg = root.querySelector('#pen-msg');
    const showMsg = (t) => { if (msg) msg.textContent = t; };

    if (!dev) { showMsg('請先選擇裝置'); return; }
    if (!reason) { showMsg('請填寫扣款原因（會記到 Google Sheet）'); return; }
    if (!amount || amount <= 0) { showMsg('金額要大於 0'); return; }
    if (!confirm(`確定要從「${dev}」扣 $${amount}？\n\n原因：${reason}\n\n（會減少他的「可提領」，並記到 Google Sheet）`)) return;

    busy = true;
    showMsg('扣款中…');
    await postPenalty(dev, amount, reason);
    busy = false;
    // 重新載入（會 re-sync，數字立刻反映）
    load();
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

// v2.34：生活習慣扣款 — POST 一個 v2_penalty 事件，amount 為負值，原因寫進 note（→ Sheet 備註欄）
// 事件名以 v2_ 開頭，Apps Script 的 doPost 會原樣寫入、?action=v2_events 會原樣回傳，
// 所以後端不用改；sync.js 會把它從「可提領」扣掉。
async function postPenalty(targetDevice, amount, reason) {
  const LOG_WEBAPP_URL = "https://script.google.com/macros/s/AKfycbw1-aQQF4goCDF6X7_oIHEk4rVIbRrDADkq5ZQ1kopePXVehu9EGkkCNnj3Z4Hxd1aW7w/exec";
  const payload = {
    event: 'v2_penalty',
    unit: '',
    quizSize: '',
    correct: '',
    prediction: '',
    amount: -Math.abs(amount),           // 負值
    note: `習慣扣款：${reason}`,          // 原因記到 Sheet「備註」欄
    money: '',
    totalPaid: '',
    streak: '',
    user: targetDevice,                  // 「裝置」欄寫被扣款的裝置
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
    console.warn('penalty post failed', e);
  }
  // 等 1.5 秒讓 Sheet 寫入完成再 re-fetch
  await new Promise(r => setTimeout(r, 1500));
}

// v2.35：家長調整每日上限 — POST 一個 v2_config_daily_cap 事件，amount = 新上限。
// 事件名以 v2_ 開頭，後端原樣寫入與回傳（零改動）；sync.js 的 extractDailyCap 會
// 掃全部事件取最後一筆生效，所以「裝置」欄記操作的家長裝置即可（純留紀錄）。
async function postDailyCap(amount) {
  const LOG_WEBAPP_URL = "https://script.google.com/macros/s/AKfycbw1-aQQF4goCDF6X7_oIHEk4rVIbRrDADkq5ZQ1kopePXVehu9EGkkCNnj3Z4Hxd1aW7w/exec";
  const payload = {
    event: 'v2_config_daily_cap',
    unit: '',
    quizSize: '',
    correct: '',
    prediction: '',
    amount: Math.abs(amount),
    note: `家長把每日獎金上限調整為 $${amount}`,
    money: '',
    totalPaid: '',
    streak: '',
    user: (() => { try { return localStorage.getItem('sv2.deviceName') || '(家長頁)'; } catch (e) { return '(家長頁)'; } })(),
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
    console.warn('daily cap post failed', e);
  }
  // 等 1.5 秒讓 Sheet 寫入完成再 re-fetch
  await new Promise(r => setTimeout(r, 1500));
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}
