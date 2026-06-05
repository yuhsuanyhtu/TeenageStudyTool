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
import { startReadingMode } from './modes/reading.js';
import { startDexbook } from './dexbook.js';
import { logEvent, logEventBeacon } from './logger.js';
import { renderRules } from './rules.js';
import { fetchV2Events, recomputeFromEvents } from './sync.js';
import { startPayoutMode } from './modes/payout.js';
import * as srs from './srs.js';

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
    // v2.17：URL 帶 #payout 直接進家長提領頁（隱藏入口，孩子在主畫面看不到按鈕）
    if (window.location.hash === '#payout') {
      startPayoutMode({
        root,
        onBack: () => {
          history.replaceState(null, '', window.location.pathname);
          refreshAndRenderHome();
          syncInBackground();
        },
      });
      return;
    }
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

// v2.20：節流——每次 sync 開始時記時間，太短間隔不重跑
let lastSyncAt = 0;
const MIN_RESYNC_INTERVAL_MS = 60 * 1000;  // 60 秒內不重 sync

async function syncInBackground() {
  lastSyncAt = Date.now();
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
  // v2.20 Bug C 修正：MAX 語意而不是覆蓋
  //   - 累計類欄位（totalEarned、todayEarned、streak）：取 max(local, server)
  //     原因：本地剛跑完的 session POST 出去到 Sheet 寫好之間有延遲，
  //     這段空窗如果 sync 跑了會把剛賺的錢覆蓋掉。
  //   - totalWithdrawn：信任 server（只有家長提領頁能寫，本地不會自己增加）
  //   - availableToWithdraw：永遠用 totalEarned - totalWithdrawn 重算（保證一致）
  s.totalEarned = Math.max(s.totalEarned || 0, computed.totalEarned);
  s.totalWithdrawn = computed.totalWithdrawn;          // 信任 server
  s.totalPenalty = computed.totalPenalty || 0;         // v2.34：信任 server（只有家長頁能寫扣款）
  s.availableToWithdraw = Math.max(0, s.totalEarned - s.totalWithdrawn - (s.totalPenalty || 0));
  s.todayEarned = Math.max(s.todayEarned || 0, computed.todayEarned);
  s.todayPreEarned = Math.max(s.todayPreEarned || 0, computed.todayPreEarned);
  s.streak = Math.max(s.streak || 0, computed.streak);
  state.save(s);
  syncStatus = 'done';
  syncMessage = `本機 ${computed.eventCount} 筆、${computed.completedDayCount} 天`;
  updateSyncIndicator();
  // 若還在 home，重 render 反映新數字
  if (document.querySelector('.unit-btn')) {
    renderHome();
  }
}

// v2.20 Bug C 修正：tab 重新被看到時自動 re-sync（節流 60 秒）
// 場景：媽媽在另一台機器提領 $100，謙恩 iPad 上的 tab 一直開著，
// 切回 tab 時自動同步，畫面數字立刻反映提領。
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (Date.now() - lastSyncAt < MIN_RESYNC_INTERVAL_MS) return;
    syncInBackground();
  });
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
        <div class="stat-num">$${s.todayEarned || 0}</div>
        <div class="stat-label">今日獎金</div>
      </div>
      <div class="stat">
        <div class="stat-num">$${s.availableToWithdraw || 0}</div>
        <div class="stat-label">可提領</div>
      </div>
      <div class="stat">
        <div class="stat-num">${s.streak || 0}</div>
        <div class="stat-label">連勝 ${mulTxt}</div>
      </div>
      <!-- v2.32：「已提領」拿掉（謙恩說不用顯示）。家長提領頁仍可看 -->
    </div>

    <h2>選一個單元</h2>
    ${appData.categories && appData.categories.length > 0
      ? appData.categories.map(cat => {
          const catUnitNames = Object.keys(cat.units);
          if (catUnitNames.length === 0) return '';
          // 該分類今天總共練了幾字 + 累計已會
          let catSeen = 0, catTotal = 0, catMastered = 0;
          for (const u of catUnitNames) {
            const words = cat.units[u];
            catTotal += words.length;
            catSeen += state.getSeenEns(s, u).size;
            catMastered += srs.countMasteredIn(words, s.wordStats);
          }
          // v2.21：預設展開 units-meta.json 裡標 `"current": true` 的分類（謙恩當期）。
          // 找不到 → 退回最後一個分類（最新的）。
          // 不再用 lastCategoryId，避免「某次手滑點到 A1 就永遠卡在 A1」。
          const defaultCat = appData.categories.find(c => c.current)
            || appData.categories[appData.categories.length - 1];
          const isOpen = cat.id === (defaultCat ? defaultCat.id : null);
          return `
            <details class="cat-section" data-cat-id="${escapeHtml(cat.id)}" ${isOpen ? 'open' : ''}>
              <summary class="cat-header">
                <span class="cat-title">${cat.icon} ${escapeHtml(cat.name)}</span>
                <span class="muted small">${catUnitNames.length} 單元 · 今天 ${catSeen}/${catTotal} 字 · 🌳 已會 ${catMastered}</span>
              </summary>
              <div class="cat-units">
                ${catUnitNames.map(u => {
                  const words = cat.units[u];
                  const total = words.length;
                  const seen = state.getSeenEns(s, u).size;
                  const mastered = srs.countMasteredIn(words, s.wordStats);
                  const pct = total > 0 ? (mastered / total) * 100 : 0;  // v2.24：進度條改用「已會」比例（更有成就感）
                  return `
                    <button class="unit-btn" data-unit="${escapeHtml(u)}">
                      <span>${escapeHtml(u)}</span>
                      <span class="muted small">🌳 ${mastered}／${total} 已會 · 今天 ${seen}/${total}</span>
                    </button>
                    <div class="unit-progress-bar"><div class="unit-progress-fill" style="width:${pct}%"></div></div>
                  `;
                }).join('')}
              </div>
            </details>
          `;
        }).join('')
      : '<p class="muted">目前沒有單字資料</p>'
    }

    ${appData.stories && appData.stories.length > 0 ? `
      <button class="read-link-btn" id="bookshelf-btn">📚 閱讀練習（${appData.stories.length} 篇短文）</button>
    ` : ''}
    <button class="read-link-btn" id="dexbook-btn">🏆 我的字典（看自己學會了哪些字）</button>

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
  // v2.25：開啟書架
  const bsBtn = root.querySelector('#bookshelf-btn');
  if (bsBtn) bsBtn.addEventListener('click', renderBookshelf);
  // v2.31：開啟單字圖鑑
  const dexBtn = root.querySelector('#dexbook-btn');
  if (dexBtn) dexBtn.addEventListener('click', () => {
    root.innerHTML = '';
    startDexbook({
      root, appData,
      wordStats: s.wordStats || {},
      onBack: refreshAndRenderHome,
    });
  });
  root.querySelectorAll('.unit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentUnit = btn.dataset.unit;
      renderModePicker();
    });
  });
  // v2.21：拿掉 lastCategoryId 追蹤 — 改用 units-meta.json 的 `current: true` flag
  //         所見即所得：永遠展開當期分類，不會被「某次手滑點到」綁架
}

// v2.26：題數選項（給 en2zh / zh2en 用，match 用 6 對固定，review 一律全部）
//   - 預設 8 題：快練、暖身
//   - 半套：考前複習中量
//   - 全套：考前完整複習
const QUIZ_SIZE_LABELS = [
  { id: 'small', label: '8 題（快練）', calc: total => Math.min(8, total) },
  { id: 'half', label: '半套', calc: total => Math.max(8, Math.ceil(total / 2)) },
  { id: 'all', label: '全套', calc: total => total },
];
let selectedQuizSizeId = 'small';

function renderModePicker() {
  const words = appData.units[currentUnit];
  // 算每個 size 對應幾題（顯示給孩子看）
  const sizeButtons = QUIZ_SIZE_LABELS.map(s => {
    const n = s.calc(words.length);
    const label = s.id === 'small' ? s.label : `${s.label}（${n} 題）`;
    return `<button class="quiz-size-btn ${s.id === selectedQuizSizeId ? 'active' : ''}" data-size="${s.id}">${escapeHtml(label)}</button>`;
  }).join('');

  root.innerHTML = `
    <button class="back" id="back">← 回主畫面</button>
    <h1>${escapeHtml(currentUnit)}</h1>
    <p class="muted">${words.length} 個單字</p>

    <div class="quiz-size-row">
      <span class="quiz-size-label">英翻中／中翻英 題數：</span>
      ${sizeButtons}
    </div>

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
  root.querySelectorAll('.quiz-size-btn').forEach(b => {
    b.addEventListener('click', () => {
      selectedQuizSizeId = b.dataset.size;
      // 重 render 讓 active 狀態更新
      renderModePicker();
    });
  });
  root.querySelectorAll('.mode-card').forEach(b => {
    b.addEventListener('click', () => startMode(b.dataset.mode));
  });
}

// v2.25：書架（閱讀練習列表）
function renderBookshelf() {
  const stories = appData.stories || [];
  root.innerHTML = `
    <button class="back" id="back">← 回主畫面</button>
    <h1>📚 閱讀練習</h1>
    <p class="muted">點任何單字 → 看中文意思。讀完還可以練習剛剛查過的生字。</p>
    <div class="bookshelf">
      ${stories.map(st => `
        <button class="book-card" data-id="${escapeHtml(st.id)}">
          <span class="book-title">${escapeHtml(st.title)}</span>
          <span class="book-meta">${escapeHtml(st.level)} · ${countWords(st.text)} 字</span>
        </button>
      `).join('')}
    </div>
  `;
  root.querySelector('#back').addEventListener('click', refreshAndRenderHome);
  root.querySelectorAll('.book-card').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const story = stories.find(s => s.id === id);
      if (story) startReading(story);
    });
  });
}

function countWords(text) {
  return (String(text || '').match(/[A-Za-z][A-Za-z']*/g) || []).length;
}

function startReading(story) {
  root.innerHTML = '';
  startReadingMode({
    root, story,
    onComplete: (result) => handleReadingComplete(result),
  });
}

function handleReadingComplete(result) {
  const today = state.today();
  const looked = Array.isArray(result.lookedUp) ? result.lookedUp : [];
  const story = result.story || {};
  const compResults = Array.isArray(result.comprehensionResults) ? result.comprehensionResults : [];
  const compCorrect = compResults.filter(r => r.correct).length;
  const compTotal = (story.comprehension && story.comprehension.length) || 0;

  // 查過的字記為「看過」（不算對錯，但會出現在 SRS）
  if (looked.length > 0) srs.recordSeenBatch(s, looked, today);

  // v2.30：閱讀獎金 = 理解測驗答對題數 × $5
  //         中途離開、同篇已領、答對 0 題 → 都 $0
  let readingCalc = { sessionPre: 0, sessionFinal: 0, breakdown: '' };
  if (!result.aborted && story.id) {
    readingCalc = reward.calcReadingReward({
      streak: s.streak || 0,
      todayPreEarned: s.todayPreEarned || 0,
      storyId: story.id,
      readingDoneToday: s.readingDoneToday || [],
      comprehensionCorrect: compCorrect,
    });
    if (readingCalc.sessionPre > 0) {
      s.todayPreEarned = (s.todayPreEarned || 0) + readingCalc.sessionPre;
      s.todayEarned = (s.todayEarned || 0) + readingCalc.sessionFinal;
      s.totalEarned = (s.totalEarned || 0) + readingCalc.sessionFinal;
      s.availableToWithdraw = Math.max(0, (s.totalEarned || 0) - (s.totalWithdrawn || 0) - (s.totalPenalty || 0));
      if (!s.readingDoneToday) s.readingDoneToday = [];
      s.readingDoneToday.push(story.id);
    }
  }
  state.save(s);

  // 寫 Sheet 留紀錄
  logEvent({
    event: result.aborted ? 'v2_reading_abandoned' : 'v2_reading_done',
    unit: story.id || '',
    quizSize: compTotal,
    correct: compCorrect,
    amount: readingCalc.sessionFinal || '',
    note: `v2 閱讀「${story.title || ''}」理解測驗 ${compCorrect}/${compTotal} 對、查 ${looked.length} 字${readingCalc.sessionFinal ? `（+$${readingCalc.sessionFinal}）` : ''}`,
  }, s);

  // 把查過的字轉成有 zh 的 word objects（從 story.vocab 撈）
  const vocab = story.vocab || {};
  const practiceWords = looked
    .map(en => ({ en, zh: vocab[en] }))
    .filter(w => w.zh);

  root.innerHTML = `
    <h1>${result.aborted ? '中途離開' : '✓ 讀完了！'}</h1>
    <p class="muted">「${escapeHtml(story.title || '')}」</p>
    <div class="card">
      <p>你讀了 <b>${countWords(story.text || '')}</b> 個字</p>
      <p>查了 <b>${looked.length}</b> 個生字</p>
      ${compTotal > 0 ? `<p>理解測驗：<b>${compCorrect} / ${compTotal} 題對</b></p>` : ''}
      ${readingCalc.sessionFinal > 0 ? `<p style="color:#6b9080;font-weight:600;">獎金 +$${readingCalc.sessionFinal}</p>` : ''}
      ${readingCalc.breakdown ? `<p class="muted small">${escapeHtml(readingCalc.breakdown)}</p>` : ''}
      ${practiceWords.length >= 4 ? `
        <p class="muted small">這 ${practiceWords.length} 個有翻譯的可以練：${practiceWords.map(w => escapeHtml(w.en)).join('、')}</p>
      ` : looked.length > 0 ? `
        <p class="muted small">${looked.length < 4 ? '生字少於 4 個，沒辦法湊一回練習' : '查過但本篇沒附翻譯的字目前不能練'}</p>
      ` : ''}
    </div>
    ${practiceWords.length >= 4 ? `<button id="practice">📝 練習剛剛的生字（英翻中）</button>` : ''}
    <button class="secondary" id="another">📖 換一篇</button>
    <button class="secondary" id="home">← 回主畫面</button>
  `;
  const pBtn = root.querySelector('#practice');
  if (pBtn) {
    pBtn.addEventListener('click', () => {
      // 用查過的生字當 en2zh 題目，題目來自當篇 vocab，distractor 也用同篇
      root.innerHTML = '';
      startEn2ZhMode({
        root,
        words: practiceWords,
        allWords: practiceWords,
        seenSet: new Set(),
        wordStats: s.wordStats || {},
        onComplete: (qResult) => handleComplete('en2zh', { ...qResult, _fromReading: true }),
      });
    });
  }
  root.querySelector('#another').addEventListener('click', renderBookshelf);
  root.querySelector('#home').addEventListener('click', refreshAndRenderHome);
}

// 追蹤目前進行中的 mode，給 pagehide listener 用
// （孩子直接關瀏覽器時，Sheet 至少能留一筆「沒完成」紀錄）
let currentModeMeta = null;

function startMode(mode) {
  const words = appData.units[currentUnit];
  const seenSet = state.getSeenEns(s, currentUnit);
  const wordStats = s.wordStats || {};
  // v2.26：依使用者選的題數規模計算 roundSize（en2zh / zh2en 才用得到）
  const sizeSpec = QUIZ_SIZE_LABELS.find(x => x.id === selectedQuizSizeId) || QUIZ_SIZE_LABELS[0];
  const roundSize = sizeSpec.calc(words.length);
  root.innerHTML = '';
  currentModeMeta = { mode, unit: currentUnit, totalQuestions: words.length, startedAt: Date.now() };
  const onComplete = (result) => {
    currentModeMeta = null;
    handleComplete(mode, result);
  };
  if (mode === 'match') {
    startMatchMode({ root, words, seenSet, onComplete, wordStats });
  } else if (mode === 'en2zh') {
    startEn2ZhMode({ root, words, seenSet, onComplete, allWords: words, wordStats, roundSize });
  } else if (mode === 'zh2en') {
    startZh2EnMode({ root, words, seenSet, onComplete, wordStats, roundSize });
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
      reviewEarnedToday: s.reviewEarnedToday || 0,   // v2.28：傳今日已賺複習額度做 cap
    });
  } else if (mode === 'match') {
    // v2.15：連連看固定 $5，不依 sessionCorrect 計算（防 brute force 刷錢）
    calc = reward.calcMatchReward({
      todayPreEarned: s.todayPreEarned || 0,
    });
  } else {
    calc = reward.calcSessionReward({
      sessionCorrect,
      streak: s.streak || 0,
      todayPreEarned: s.todayPreEarned || 0,
      baseGivenToday: !!s.baseGivenToday,   // v2.13：傳今天是否已給過基礎獎金
    });
  }

  if (!result.aborted) {
    s.todayPreEarned = (s.todayPreEarned || 0) + calc.sessionPre;
    s.todayEarned = (s.todayEarned || 0) + calc.sessionFinal;
    s.todayCorrect = (s.todayCorrect || 0) + sessionCorrect;
    s.totalEarned = (s.totalEarned || 0) + calc.sessionFinal;
    // v2.20 Bug B 修正：availableToWithdraw 也要跟著漲，不然主畫面「可提領」
    // 要等下次 sync 才更新，孩子賺到錢看不到數字漲。
    s.availableToWithdraw = Math.max(0, (s.totalEarned || 0) - (s.totalWithdrawn || 0) - (s.totalPenalty || 0));
    // v2.13：本回合實際給了基礎獎金 → 設旗標，避免之後再給
    if (calc.gaveBaseThisSession) s.baseGivenToday = true;
    // v2.28：從頭複習領到錢 → 累加 reviewEarnedToday 做 cap
    if (isReview && calc.sessionPre > 0) {
      s.reviewEarnedToday = (s.reviewEarnedToday || 0) + calc.sessionPre;
    }
    // 標記這回合練過的字（給「今天 X/Y」覆蓋追蹤用）
    if (Array.isArray(result.usedWords) && result.usedWords.length) {
      state.markSeenEns(s, currentUnit, result.usedWords.map(w => w.en));
    }
    // v2.24：寫 SRS 記憶。en2zh / zh2en 有 wordResults（含對錯），照 result 寫；
    //        match / review 只有 usedWords（沒測對錯）→ 全部當「看過」記
    if (Array.isArray(result.wordResults) && result.wordResults.length > 0) {
      for (const r of result.wordResults) srs.recordResult(s, r.en, r.correct, today);
    } else if (Array.isArray(result.usedWords) && result.usedWords.length > 0) {
      srs.recordSeenBatch(s, result.usedWords.map(w => w.en), today);
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
