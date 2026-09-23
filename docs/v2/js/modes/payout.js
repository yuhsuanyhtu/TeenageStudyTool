// modes/payout.js — 家長頁（提領／扣款／上限與費率／練習量）
//
// 設計：
//   - v2.48：錢包綁人（家長 2026-09-23 決定）——所有裝置合計成一個錢包，提領與扣款都從這個錢包扣。
//     以前按裝置分開，家長只能「從某台提 $100」，零頭只好借扣款記帳；現在提領可填任意金額。
//   - 提領前必先 fresh sync 防 double-spend
//   - v2.48：上限與費率都在這裡設定（wallet.js 的 CONFIG_KEYS），寫 v2_config_set 事件，最後一筆生效
//   - 信任制（家庭用，不做密碼）
//
// 完成後家長按「回主畫面」即可

import { REWARD_CONFIG } from '../reward.js';
import { fetchV2Events, computeAllDevices, extractPracticeMode } from '../sync.js';
import { computeWallet, configSpec, isTestDevice } from '../wallet.js';

const LOG_WEBAPP_URL = "https://script.google.com/macros/s/AKfycbw1-aQQF4goCDF6X7_oIHEk4rVIbRrDADkq5ZQ1kopePXVehu9EGkkCNnj3Z4Hxd1aW7w/exec";
const DEFAULT_PENALTY = 10;      // v2.34：約定好、提醒過仍沒做到一次扣 $10
const WALLET_OWNER = '謙恩';     // v2.48：提領／扣款事件的「裝置」欄（錢包屬於人）

// 設定卡分組（key 對應 wallet.CONFIG_KEYS）
const GROUPS = [
  { title: '每日上限（乘連勝倍率前）', keys: ['cap.en', 'cap.cn', 'cap.all'] },
  { title: '英文費率', keys: ['rate.en.base', 'rate.en.per', 'rate.en.vocab', 'rate.en.cloze', 'rate.en.review', 'rate.en.reviewCap', 'rate.en.match', 'rate.en.reading'] },
  { title: '國文費率', keys: ['rate.cn.base', 'rate.cn.per'] },
];

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function startPayoutMode({ root, onBack }) {
  let busy = false;

  async function load() {
    root.innerHTML = `
      <button class="back" id="back">← 回主畫面</button>
      <h1>🏦 家長頁</h1>
      <p class="muted">同步中…請稍候</p>
    `;
    root.querySelector('#back').addEventListener('click', onBack);

    const result = await fetchV2Events();
    if (!result.ok) {
      root.innerHTML = `
        <button class="back" id="back">← 回主畫面</button>
        <h1>🏦 家長頁</h1>
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
    render(result.events);
  }

  function render(events) {
    const w = computeWallet(events, todayStr());
    const currentPractice = extractPracticeMode(events);
    const spec = Object.fromEntries(configSpec().map(x => [x.key, x]));
    const unit = REWARD_CONFIG.payoutUnit;
    // 參考用：各裝置賺了多少（錢包已合併，這裡只給家長對帳）
    const devices = [...computeAllDevices(events).entries()]
      .filter(([dev, m]) => !isTestDevice(dev) && (m.totalEarned || m.totalWithdrawn || m.totalPenalty))
      .sort((a, b) => b[1].totalEarned - a[1].totalEarned);
    const ledger = w.totalEarned - w.totalWithdrawn - w.totalPenalty;

    const field = (key) => {
      const s = spec[key];
      return `
        <label class="penalty-field">
          <span>${escapeHtml(s.label)}${w.fromParent[key] ? '' : '<small class="muted">（預設）</small>'}</span>
          <input class="cfg-input" data-key="${key}" type="number" value="${w.cfg[key]}" min="${s.lo}" max="${s.hi}" step="1" />
        </label>`;
    };

    root.innerHTML = `
      <button class="back" id="back">← 回主畫面</button>
      <h1>🏦 家長頁</h1>

      <div class="stats">
        <div class="stat"><div class="stat-num">$${w.totalEarned}</div><div class="stat-label">累計賺（英＋國）</div></div>
        <div class="stat"><div class="stat-num">$${w.totalWithdrawn}</div><div class="stat-label">已提領</div></div>
        <div class="stat"><div class="stat-num">$${w.available}</div><div class="stat-label">可提領</div></div>
      </div>
      ${w.totalPenalty ? `<p class="muted small">習慣扣款累計 −$${w.totalPenalty}（已從可提領扣除）</p>` : ''}
      ${ledger < 0 ? `<p class="muted small">⚠ 帳面是 −$${-ledger}（提領＋扣款超過累計），畫面顯示 $0，之後賺的錢會先補這個差額。</p>` : ''}

      <h2>💵 提領</h2>
      <div class="card penalty-card">
        <p class="muted small" style="margin-top:0;">所有裝置合計成一個錢包（v2.48）。金額可自由填，預設 $${unit}。</p>
        <label class="penalty-field">
          <span>金額</span>
          <input id="pay-amount" type="number" value="${Math.min(unit, w.available) || unit}" min="1" step="1" />
        </label>
        <button id="pay-btn" class="payout-btn" ${w.available > 0 ? '' : 'disabled'}>提領</button>
        <p class="muted small" id="pay-msg" style="margin-bottom:0;"></p>
      </div>

      <h2 style="margin-top:28px;">➖ 生活習慣扣款</h2>
      <div class="card penalty-card">
        <p class="muted small" style="margin-top:0;">
          約定好、提醒過仍沒做到的事，一次 $${DEFAULT_PENALTY}。只減「可提領」，不動學習累計與連勝。
          原因會記到 Google Sheet 的「備註」欄。<b>給現金請用上面的「提領」</b>，不要記成扣款。
        </p>
        <label class="penalty-field">
          <span>原因（必填）</span>
          <input id="pen-reason" type="text" maxlength="60" placeholder="例如：提醒了還是沒把碗放進水槽" />
        </label>
        <label class="penalty-field">
          <span>金額</span>
          <input id="pen-amount" type="number" value="${DEFAULT_PENALTY}" min="1" step="1" />
        </label>
        <button id="pen-btn" class="penalty-btn">扣款</button>
        <p class="muted small" id="pen-msg" style="margin-bottom:0;"></p>
      </div>

      <h2 style="margin-top:28px;">⚙️ 上限與費率</h2>
      <div class="card penalty-card">
        <p class="muted small" style="margin-top:0;">
          改了會同步到所有裝置，下一輪結算就用新數字。上限比的是「乘連勝倍率前」的金額。
          全科總上限填 0 ＝ 不另設（只看各科上限）。
        </p>
        ${GROUPS.map(g => `<h3 class="small" style="margin:14px 0 4px;">${escapeHtml(g.title)}</h3>${g.keys.map(field).join('')}`).join('')}
        <button id="cfg-btn" class="penalty-btn" style="margin-top:10px;">儲存變更</button>
        <p class="muted small" id="cfg-msg" style="margin-bottom:0;"></p>
      </div>

      <h2 style="margin-top:28px;">⚡ 練習量模式（英文）</h2>
      <div class="card penalty-card">
        <p class="muted small" style="margin-top:0;">
          「加練」＝砍被動、保主動：從頭複習最多 $5/天、連連看最多 $1/場、基礎獎金門檻從答對 5 題提高到 <b>10 題</b>。
          答對一題、閱讀獎金、<b>連勝門檻（5 題保連勝）都不變</b>。
        </p>
        <p class="muted small">目前：<b>${currentPractice === 1 ? '⚡ 加練模式' : '標準'}</b></p>
        <label class="penalty-field">
          <span>模式</span>
          <select id="practice-mode">
            <option value="0" ${currentPractice === 0 ? 'selected' : ''}>標準</option>
            <option value="1" ${currentPractice === 1 ? 'selected' : ''}>⚡ 加練</option>
          </select>
        </label>
        <button id="practice-btn" class="penalty-btn">套用模式</button>
        <p class="muted small" id="practice-msg" style="margin-bottom:0;"></p>
      </div>

      <details style="margin-top:28px;">
        <summary class="muted small">各裝置明細（對帳參考，錢包已合併）</summary>
        ${devices.map(([dev, m]) => `<p class="muted small">${escapeHtml(dev)}：賺 $${m.totalEarned}、提領 $${m.totalWithdrawn}${m.totalPenalty ? `、扣款 $${m.totalPenalty}` : ''}</p>`).join('') || '<p class="muted small">（無）</p>'}
      </details>
    `;
    root.querySelector('#back').addEventListener('click', onBack);
    root.querySelector('#pay-btn').addEventListener('click', () => handlePayout(w.available));
    root.querySelector('#pen-btn').addEventListener('click', handlePenalty);
    root.querySelector('#cfg-btn').addEventListener('click', () => handleConfig(w.cfg, spec));
    root.querySelector('#practice-btn').addEventListener('click', () => handlePractice(currentPractice));
  }

  const msgFn = (id) => (t) => { const el = root.querySelector(id); if (el) el.textContent = t; };

  async function handlePayout(available) {
    if (busy) return;
    const showMsg = msgFn('#pay-msg');
    const amount = Math.floor(Number(root.querySelector('#pay-amount')?.value));
    if (!amount || amount <= 0) { showMsg('金額要大於 0'); return; }
    if (amount > available) { showMsg(`可提領只有 $${available}`); return; }
    if (!confirm(`確定提領 $${amount}？\n\n提領後「可提領」會從 $${available} 變成 $${available - amount}。`)) return;
    busy = true; showMsg('提領中…');
    await postEvent({ event: 'v2_payout', amount: -amount, note: `家長提領 $${amount}`, totalPaid: amount, user: WALLET_OWNER });
    busy = false; load();
  }

  async function handlePenalty() {
    if (busy) return;
    const showMsg = msgFn('#pen-msg');
    const reason = (root.querySelector('#pen-reason')?.value || '').trim();
    const amount = Math.floor(Number(root.querySelector('#pen-amount')?.value));
    if (!reason) { showMsg('請填寫扣款原因（會記到 Google Sheet）'); return; }
    if (!amount || amount <= 0) { showMsg('金額要大於 0'); return; }
    if (!confirm(`確定扣 $${amount}？\n\n原因：${reason}\n\n（會減少「可提領」，並記到 Google Sheet）`)) return;
    busy = true; showMsg('扣款中…');
    await postEvent({ event: 'v2_penalty', amount: -Math.abs(amount), note: `習慣扣款：${reason}`, user: WALLET_OWNER });
    busy = false; load();
  }

  // v2.48：只寫有變動的 key。cap.en／cap.cn 另外寫舊事件，讓還沒更新的裝置（Service Worker 舊版）也讀得到
  async function handleConfig(current, spec) {
    if (busy) return;
    const showMsg = msgFn('#cfg-msg');
    const changes = [];
    for (const input of root.querySelectorAll('.cfg-input')) {
      const key = input.dataset.key;
      const v = Math.floor(Number(input.value));
      const s = spec[key];
      if (!Number.isFinite(v) || v < s.lo || v > s.hi) { showMsg(`「${s.label}」要在 ${s.lo} ~ ${s.hi} 之間`); return; }
      if (v !== current[key]) changes.push({ key, from: current[key], to: v, label: s.label });
    }
    if (!changes.length) { showMsg('沒有變更'); return; }
    if (!confirm(`確定儲存？\n\n${changes.map(c => `${c.label}：${c.from} → ${c.to}`).join('\n')}\n\n（會同步到所有裝置，下一輪結算生效）`)) return;
    busy = true; showMsg('儲存中…');
    for (const c of changes) {
      await postEvent({ event: 'v2_config_set', amount: c.to, note: `cfg:${c.key} 家長把「${c.label}」設為 ${c.to}` }, 0);
      if (c.key === 'cap.en') await postEvent({ event: 'v2_config_daily_cap', amount: c.to, note: `家長把英文每日獎金上限調整為 $${c.to}` }, 0);
      if (c.key === 'cap.cn') await postEvent({ event: 'v2_config_daily_cap_cn', amount: c.to, note: `家長把國文每日獎金上限調整為 $${c.to}` }, 0);
    }
    await new Promise(r => setTimeout(r, 1500));
    busy = false; load();
  }

  // v2.42：切換練習量模式 — v2_config_practice（amount 0/1），最後一筆生效
  async function handlePractice(currentPractice) {
    if (busy) return;
    const showMsg = msgFn('#practice-msg');
    const mode = Math.floor(Number(root.querySelector('#practice-mode')?.value));
    if (mode !== 0 && mode !== 1) { showMsg('模式選擇有誤'); return; }
    if (mode === currentPractice) { showMsg('跟目前的模式一樣，不用改'); return; }
    const label = mode === 1 ? '⚡ 加練模式' : '標準模式';
    if (!confirm(`確定切換為「${label}」？\n\n（會同步到所有裝置）`)) return;
    busy = true; showMsg('儲存中…');
    await postEvent({ event: 'v2_config_practice', amount: mode, note: `家長切換練習量模式為「${mode === 1 ? '加練' : '標準'}」` });
    busy = false; load();
  }

  load();
}

// 直接 POST 一筆事件（不用 logger：logger 會強制帶本機裝置名與 money/streak 欄）
//   Apps Script POST 是 fire-and-forget（no-cors 看不到回應）；預設等 1.5 秒讓 Sheet 寫入再 re-fetch
async function postEvent({ event, amount, note, totalPaid = '', user }, waitMs = 1500) {
  const payload = {
    event, unit: '', quizSize: '', correct: '', prediction: '',
    amount, note, money: '', totalPaid, streak: '',
    user: user || (() => { try { return localStorage.getItem('sv2.deviceName') || '(家長頁)'; } catch (e) { return '(家長頁)'; } })(),
  };
  try {
    await fetch(LOG_WEBAPP_URL, {
      method: 'POST', mode: 'no-cors', keepalive: true,
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    console.warn(`${event} post failed`, e);
  }
  if (waitMs) await new Promise(r => setTimeout(r, waitMs));
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}
