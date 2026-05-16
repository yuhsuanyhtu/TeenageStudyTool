// main.js — 入口、極簡路由、組合各模組
// 路由（手動切，不用 hash router）：
//   home     主畫面：統計 + 規則按鈕 + 單元清單
//   modepick 選題型
//   mode     進行中（連連看 / 英翻中 / 中翻英）
//   result   結果頁
//   rules    規則頁

import * as state from './state.js';
import * as reward from './reward.js';
import { loadAll } from './data-loader.js';
import { startMatchMode } from './modes/match.js';
import { startEn2ZhMode } from './modes/en2zh.js';
import { startZh2EnMode } from './modes/zh2en.js';
import { startReviewMode } from './modes/review.js';
import { logEvent, logEventBeacon } from './logger.js';
import { renderRules } from './rules.js';
import { fetchV2Events, recomputeFromEvents } from './sync.js';

const root = document.getElementById('app');
let s = state.load();
let appData = null;
let currentUnit = null;

// 同步狀態：給 home 畫面顯示「同步中／已同步／離線」
let syncStatus = 'idle';  // idle | syncing | done | failed
let syncMessage = '';

(async function init() {
  try {
    appData = await loadAll();
    // 第一次開：先讓使用者命名這台裝置
    if (!state.getDeviceName()) {
      renderNameDevice();
      return;
    }
    // v2.9 起不再 log session_start（雜訊太多，每次刷新都會記一筆）
    refreshAndRenderHome();
    // 背景跨裝置同步（不阻塞 UI，完成後 refresh 主畫面數字）
    syncInBackground();
  } catch (e) {
    root.innerHTML = `
      <h1>載入失敗</h1>
      <p class="muted">${escapeHtml(e.message)}</p>
      <p class="muted small">如果是本地測試，請用 <code>python3 -m http.server</code> 在 docs/v2/ 啟動，再開 http://localhost:8000</p>
    `;
  }
})();

async function syncInBackground() {
  syncStatus = 'syncing';
  syncMessage = '';
  updateSyncIndicator();
  const result = await fetchV2Events();
  if (!result.ok) {
    syncStatus = 'failed';
    syncMessage = result.error || '無法連線';
    updateSyncIndicator();
    return;
  }
  // v2.9：每台裝置只算自己的紀錄
  const computed = recomputeFromEvents(result.events, state.today(), state.getDeviceName());
  // 用 Sheet 的數字覆蓋本地（Sheet 是真相）
  s.totalEarned = computed.totalEarned;
  s.todayEarned = computed.todayEarned;
  s.streak = computed.streak;
  state.save(s);
  syncStatus = 'done';
  syncMessage = `本機 ${computed.eventCount} 筆、${computed.completedDayCount} 天`;
  updateSyncIndicator();
  // 若還在 home，重 render 反映新數字
  if (document.querySelector('.unit-btn')) {
    renderHome();
  }
}

function updateSyncIndicator() {
  const el = document.getElementById('sync-indicator');
  if (!el) return;
  const labels = {
    idle: '',
    syncing: '🔄 同步中…',
    done: `✓ 已同步（${syncMessage}）`,
    failed: `⚠ 離線（${syncMessage}）`,
  };
  el.textContent = labels[syncStatus] || '';
  el.className = `sync-indicator sync-${syncStatus}`;
}

function renderNameDevice() {
  const suggest = state.guessDeviceName();
  root.innerHTML = `
    <h1>幫這台裝置取個名字</h1>
    <p class="muted">媽媽會在紀錄上看到這個名字，方便分辨是「媽媽電腦」還是「謙恩 iPad」。</p>
    <p class="muted small">兩台機器要取不一樣的名字（這台不會影響另一台）。</p>
    <input type="text" id="dev-name" class="zh2en-input"
      value="${escapeHtml(suggest)}" maxlength="40"
      placeholder="例：謙恩 iPad、媽媽 Mac">
    <button id="save">儲存並開始</button>
  `;
  const input = root.querySelector('#dev-name');
  input.focus();
  input.select();
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); save(); }
  });
  root.querySelector('#save').addEventListener('click', save);

  function save() {
    let name = input.value.trim();
    if (!name) name = suggest;
    state.setDeviceName(name);
    logEvent({ event: 'v2_device_named', note: `命名為「${name}」` }, s);
    refreshAndRenderHome();
  }
}

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
    <div class="header-row">
      <h1>謙恩的英文</h1>
      <button class="rules-link" id="rules-btn">📋 規則</button>
    </div>

    <div class="stats">
      <div class="stat">
        <div class="stat-num">${s.streak || 0}</div>
        <div class="stat-label">連勝 ${mulTxt}</div>
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
      : unitNames.map(u => {
          const total = appData.units[u].length;
          const seen = state.getSeenEns(s, u).size;
          const pct = total > 0 ? (seen / total) * 100 : 0;
          return `
            <button class="unit-btn" data-unit="${escapeHtml(u)}">
              <span>${escapeHtml(u)}</span>
              <span class="muted small">${total} 字 · 今天 ${seen}/${total}</span>
            </button>
            <div class="unit-progress-bar"><div class="unit-progress-fill" style="width:${pct}%"></div></div>
          `;
        }).join('')
    }

    <p class="muted small center" style="margin-top:24px">
      v2 · ${state.today()} · 本機名：<b>${escapeHtml(state.getDeviceName() || '(未命名)')}</b>
      <a href="#" id="rename" style="margin-left:8px; color:#888;">改名</a>
    </p>
    <p class="muted small center sync-row">
      <span id="sync-indicator" class="sync-indicator sync-${syncStatus}">${syncStatus === 'done' ? `✓ 已同步（${escapeHtml(syncMessage)}）` : syncStatus === 'failed' ? `⚠ 離線（${escapeHtml(syncMessage)}）` : syncStatus === 'syncing' ? '🔄 同步中…' : ''}</span>
      <a href="#" id="resync" style="margin-left:8px;">重新同步</a>
    </p>
  `;
  root.querySelector('#rename').addEventListener('click', e => {
    e.preventDefault();
    state.setDeviceName('');  // 清空就會觸發命名頁
    renderNameDevice();
  });
  root.querySelector('#resync').addEventListener('click', e => {
    e.preventDefault();
    syncInBackground();
  });
  root.querySelector('#rules-btn').addEventListener('click', () => {
    renderRules(root, refreshAndRenderHome);
  });
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

    <button class="mode-card" data-mode="review">
      <div class="mode-title">📖 從頭複習</div>
      <div class="mode-desc">本課單字一張一張看過，每張會拼字母 + 唸發音。走完一輪自動領基本獎金。</div>
    </button>
    <button class="mode-card" data-mode="match">
      <div class="mode-title">🔗 連連看</div>
      <div class="mode-desc">英中配對 6 組，輕鬆暖身。多個英文對到同個中文不會誤判。</div>
    </button>
    <button class="mode-card" data-mode="en2zh">
      <div class="mode-title">🇬🇧 → 🇹🇼 英翻中</div>
      <div class="mode-desc">看英文選中文（4 選 1）。系統會先拼字母（A-P-P-L-E）再唸 apple。</div>
    </button>
    <button class="mode-card" data-mode="zh2en">
      <div class="mode-title">🇹🇼 → 🇬🇧 中翻英</div>
      <div class="mode-desc">把英文拼出來。難度最高，學最深。each / every 都是「每一」這種多答案會兩個都接受。</div>
    </button>
  `;
  root.querySelector('#back').addEventListener('click', refreshAndRenderHome);
  root.querySelectorAll('.mode-card').forEach(b => {
    b.addEventListener('click', () => startMode(b.dataset.mode));
  });
}

// 追蹤目前進行中的 mode，給 pagehide listener 用
// （孩子直接關瀏覽器時，Sheet 至少能留一筆「沒完成」紀錄）
let currentModeMeta = null;

function startMode(mode) {
  const words = appData.units[currentUnit];
  const seenSet = state.getSeenEns(s, currentUnit);
  root.innerHTML = '';
  currentModeMeta = { mode, unit: currentUnit, totalQuestions: words.length, startedAt: Date.now() };
  const onComplete = (result) => {
    currentModeMeta = null;  // 正常結束不需 pagehide log
    handleComplete(mode, result);
  };
  if (mode === 'match') {
    startMatchMode({ root, words, seenSet, onComplete });
  } else if (mode === 'en2zh') {
    startEn2ZhMode({ root, words, seenSet, onComplete, allWords: words });
  } else if (mode === 'zh2en') {
    startZh2EnMode({ root, words, seenSet, onComplete });
  } else if (mode === 'review') {
    startReviewMode({ root, words, onComplete });
  }
}

// 關瀏覽器 / 切到背景時，如果還在 mode 中，送一筆 beacon log
// （fetch keepalive 也加了，但 sendBeacon 是專門設計給這場景，更可靠）
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    if (currentModeMeta) {
      logEventBeacon({
        event: `v2_${currentModeMeta.mode}_pagehide`,
        unit: currentModeMeta.unit,
        quizSize: currentModeMeta.totalQuestions,
        note: `v2 ${currentModeMeta.mode} 關瀏覽器/切背景（沒做完）`,
      }, s);
      currentModeMeta = null;
    }
  });
}

function handleComplete(mode, result) {
  const today = state.today();
  const sessionCorrect = result.sessionCorrect || 0;
  const totalQuestions = result.totalQuestions || 0;
  const isReview = mode === 'review';

  // 達「今日完成」門檻 → 更新連勝
  //   - 一般測驗：要答對 ≥ minCorrectForBase
  //   - 複習模式：完整走完整輪也算（mom 說「轉過一次就有基本$」）
  const reachedThreshold = isReview
    ? !!result.completed
    : sessionCorrect >= reward.REWARD_CONFIG.minCorrectForBase;
  let streakChanged = false;
  if (!result.aborted && reachedThreshold && s.lastDate !== today) {
    s = reward.updateStreakOnComplete(s, today);
    streakChanged = true;
  }

  // 計算獎金（中途離開不給；複習用 calcReviewReward；其他用 calcSessionReward）
  let calc;
  if (result.aborted) {
    calc = {
      sessionPre: 0, sessionFinal: 0, multiplier: 1.0, base: 0, perWord: 0,
      breakdown: '中途離開沒有獎金，下次做完整一回再來！',
    };
  } else if (isReview) {
    calc = reward.calcReviewReward({
      streak: s.streak || 0,
      todayPreEarned: s.todayPreEarned || 0,
    });
  } else {
    calc = reward.calcSessionReward({
      sessionCorrect,
      streak: s.streak || 0,
      todayPreEarned: s.todayPreEarned || 0,
    });
  }

  if (!result.aborted) {
    s.todayPreEarned = (s.todayPreEarned || 0) + calc.sessionPre;
    s.todayEarned = (s.todayEarned || 0) + calc.sessionFinal;
    s.todayCorrect = (s.todayCorrect || 0) + sessionCorrect;
    s.totalEarned = (s.totalEarned || 0) + calc.sessionFinal;
    // 標記這回合練過的字（給「今天 X/Y」覆蓋追蹤用）
    if (Array.isArray(result.usedWords) && result.usedWords.length) {
      state.markSeenEns(s, currentUnit, result.usedWords.map(w => w.en));
    }
    state.save(s);
  }

  // 寫一筆到 Google Sheet
  const modeLabel = {
    match: '連連看', en2zh: '英翻中', zh2en: '中翻英', review: '從頭複習',
  }[mode] || mode;
  logEvent({
    event: result.aborted ? `v2_${mode}_abandoned` : `v2_${mode}_done`,
    unit: currentUnit,
    quizSize: totalQuestions,
    correct: sessionCorrect,
    amount: calc.sessionFinal,
    note: result.aborted
      ? `v2 ${modeLabel} 中途離開（做到 ${sessionCorrect}/${totalQuestions}）`
      : `v2 ${modeLabel}`,
  }, s);

  renderResult({ mode, result, calc, streakChanged });
}

function renderResult({ mode, result, calc, streakChanged }) {
  const { sessionCorrect, totalQuestions, message } = result;
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
