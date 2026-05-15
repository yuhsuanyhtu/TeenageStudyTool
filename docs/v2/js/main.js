// main.js — 入口、極簡路由、組合各模組
// 路由（不用 hash router，三個畫面切換）：
//   home     — 主畫面：統計 + 單元清單
//   modepick — 選題型
//   mode     — 進行中（連連看 / 英翻中）
//   result   — 結果頁

import * as state from './state.js';
import * as reward from './reward.js';
import { loadAll } from './data-loader.js';
import { startMatchMode } from './modes/match.js';
import { startEn2ZhMode } from './modes/en2zh.js';

const root = document.getElementById('app');
let s = state.load();
let appData = null;
let currentUnit = null;

(async function init() {
  try {
    appData = await loadAll();
    refreshAndRenderHome();
  } catch (e) {
    root.innerHTML = `
      <h1>載入失敗</h1>
      <p class="muted">${escapeHtml(e.message)}</p>
      <p class="muted small">如果是本地測試，請用 <code>python3 -m http.server</code> 在 docs/v2/ 目錄啟動，再開 http://localhost:8000</p>
    `;
  }
})();

function refreshAndRenderHome() {
  const r = state.refreshDailyState(s);
  s = r.state;
  if (r.changed) state.save(s);
  renderHome();
}

function renderHome() {
  const mul = reward.streakMultiplier(s.streak || 0);
  const mulTxt = mul > 1 ? `×${mul.toFixed(1)}` : '';
  const unitNames = Object.keys(appData.units);

  root.innerHTML = `
    <h1>謙恩的英文</h1>
    <div class="stats">
      <div class="stat">
        <div class="stat-num">${s.streak || 0}</div>
        <div class="stat-label">連勝天數 ${mulTxt}</div>
      </div>
      <div class="stat">
        <div class="stat-num">$${s.todayEarned || 0}</div>
        <div class="stat-label">今日獎金</div>
      </div>
      <div class="stat">
        <div class="stat-num">$${s.totalEarned || 0}</div>
        <div class="stat-label">累積總額</div>
      </div>
      <div class="stat">
        <div class="stat-num">${s.freezeAvailable ?? 0}</div>
        <div class="stat-label">本月保護卡</div>
      </div>
    </div>

    <h2>選一個單元</h2>
    ${unitNames.length === 0
      ? '<p class="muted">目前沒有單字資料</p>'
      : unitNames.map(u => `
          <button class="unit-btn" data-unit="${escapeHtml(u)}">
            <span>${escapeHtml(u)}</span>
            <span class="muted small">${appData.units[u].length} 字</span>
          </button>
        `).join('')
    }

    <p class="muted small center" style="margin-top:24px">v2 · ${state.today()}</p>
  `;
  root.querySelectorAll('.unit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentUnit = btn.dataset.unit;
      renderModePicker();
    });
  });
}

function renderModePicker() {
  const words = appData.units[currentUnit];
  root.innerHTML = `
    <button class="back" id="back">← 回主畫面</button>
    <h1>${escapeHtml(currentUnit)}</h1>
    <p class="muted">${words.length} 個單字</p>

    <button class="mode-card" data-mode="match">
      <div class="mode-title">🔗 連連看</div>
      <div class="mode-desc">英中配對 6 組，輕鬆暖身。同個中文可以連到不同英文，不會被誤判。</div>
    </button>
    <button class="mode-card" data-mode="en2zh">
      <div class="mode-title">🇬🇧 → 🇹🇼 英翻中</div>
      <div class="mode-desc">看英文選中文，4 選 1。系統會自動唸發音。</div>
    </button>
  `;
  root.querySelector('#back').addEventListener('click', refreshAndRenderHome);
  root.querySelectorAll('.mode-card').forEach(b => {
    b.addEventListener('click', () => startMode(b.dataset.mode));
  });
}

function startMode(mode) {
  const words = appData.units[currentUnit];
  root.innerHTML = '';  // 由模式自己 render
  const onComplete = (result) => handleComplete(mode, result);
  if (mode === 'match') {
    startMatchMode({ root, words, onComplete });
  } else if (mode === 'en2zh') {
    startEn2ZhMode({ root, words, onComplete, allWords: words });
  }
}

function handleComplete(mode, result) {
  const today = state.today();
  const sessionCorrect = result.sessionCorrect || 0;

  // 達門檻才算「今日完成」並更新連勝
  const reachedThreshold = sessionCorrect >= reward.REWARD_CONFIG.minCorrectForBase;
  let streakChanged = false;
  if (reachedThreshold && s.lastDate !== today) {
    s = reward.updateStreakOnComplete(s, today);
    streakChanged = true;
  }

  // 計算本回合獎金
  const calc = reward.calcSessionReward({
    sessionCorrect,
    streak: s.streak || 0,
    todayPreEarned: s.todayPreEarned || 0,
  });
  s.todayPreEarned = (s.todayPreEarned || 0) + calc.sessionPre;
  s.todayEarned = (s.todayEarned || 0) + calc.sessionFinal;
  s.todayCorrect = (s.todayCorrect || 0) + sessionCorrect;
  s.totalEarned = (s.totalEarned || 0) + calc.sessionFinal;
  state.save(s);

  renderResult({ mode, result, calc, streakChanged });
}

function renderResult({ mode, result, calc, streakChanged }) {
  const { sessionCorrect, totalQuestions, message, aborted } = result;
  const earnedTxt = calc.sessionFinal > 0 ? `+ $${calc.sessionFinal}` : '$0';

  root.innerHTML = `
    <h1>${escapeHtml(message || '完成！')}</h1>

    <div class="stats">
      <div class="stat">
        <div class="stat-num">${sessionCorrect} / ${totalQuestions}</div>
        <div class="stat-label">本回合正確</div>
      </div>
      <div class="stat">
        <div class="stat-num">${earnedTxt}</div>
        <div class="stat-label">本回合獎金</div>
      </div>
    </div>

    <div class="card">
      <div class="breakdown">${escapeHtml(calc.breakdown)}</div>
      <p class="muted">
        ${streakChanged ? `🔥 連勝更新：${s.streak} 天<br>` : ''}
        今日累積：$${s.todayEarned}　·　保護卡：${s.freezeAvailable ?? 0}
      </p>
    </div>

    <button id="again">再來一回</button>
    <button class="secondary" id="back">回主畫面</button>
  `;
  root.querySelector('#again').addEventListener('click', () => startMode(mode));
  root.querySelector('#back').addEventListener('click', refreshAndRenderHome);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}
