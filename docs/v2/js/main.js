// main.js — 入口、極簡路由、組合各模組
// 路由（手動切，不用 hash router）：
//   home     主畫面：統計 + 規則按鈕 + 單元清單
//   modepick 選題型
//   mode     進行中（連連看 / 英翻中 / 中翻英）
//   result   結果頁
//   rules    規則頁

import * as state from './state.js';
import * as tts from './tts.js';
import * as reward from './reward.js';
import { loadAll } from './data-loader.js';
import { startMatchMode } from './modes/match.js';
import { startEn2ZhMode } from './modes/en2zh.js';
import { startZh2EnMode } from './modes/zh2en.js';
import { startReviewMode } from './modes/review.js';
import { startReadingMode } from './modes/reading.js';
import { startVocabMode } from './modes/vocab.js';   // v2.40：文意字彙
import { startClozeMode } from './modes/cloze.js';   // v2.40：克漏字
import { startDexbook } from './dexbook.js';
import { logEvent, logEventBeacon } from './logger.js';
import { renderRules } from './rules.js';
import { fetchV2Events, recomputeFromEvents } from './sync.js';
import { startPayoutMode } from './modes/payout.js';
import { dictionaryStatus } from './dictionary.js';   // v2.43：主畫面顯示字典 API 狀態
import { loadCapData, eligibleItems, pickRound, startCapMode, flaggedMap, unitIndex } from './modes/cap.js';   // v2.50：會考題
import { remainingPre } from './wallet.js';
import * as srs from './srs.js';

const root = document.getElementById('app');
let s = state.load();
let appData = null;
let currentUnit = null;

// 同步狀態：給 home 畫面顯示「同步中／已同步／離線」
let syncStatus = 'idle';  // idle | syncing | done | failed
let syncMessage = '';

// v2.43：效能量測（主畫面底下顯示「載入 N ms」，讓媽媽在 iPad 上一眼看得出快慢）
// cached 要在模組一開始就判斷：Service Worker 第一次安裝會立刻接管頁面（clients.claim），
// 若等到 loadAll 之後才看 controller，第一次開也會誤標「本機快取」（v2.43.1 修）
const perf = { start: performance.now(), loadMs: 0, cached: !!(navigator.serviceWorker && navigator.serviceWorker.controller) };
let updateAvailable = false;   // Service Worker 發現新版本 → 回主畫面時顯示提示條

// v2.48：全科總上限還剩多少（乘倍率前）；家長沒設（cap.all=0）→ undefined＝不限
function allRemaining() {
  const capAll = Number(s.cfg && s.cfg['cap.all']) || 0;
  if (capAll <= 0) return undefined;
  return Math.max(0, capAll - (s.todayPreAll || 0));
}

// ---------- v2.50：會考題 ----------
// s.hk = { paid:[題id], wrong:{題id: 最近答錯日期}, flagged:["題id~課序號"] }；以人計，從 Sheet 重算後與本機聯集
//   paid：Sheet 的為準；本機只另外記「今天剛付、Sheet 可能還沒寫進去」的（paidToday），跨日就丟掉
//     ——離線時錢沒寫進 Sheet 會消失，已領標記也要跟著消失，不然那幾題永遠領不到（reviewer M2）
//   wrong／flagged：本機與 Sheet 聯集（寧可少付，不可多付）
function mergeHk(local, server, fromServer = false) {
  const a = local || {}, b = server || {};
  const wrong = { ...(a.wrong || {}) };
  for (const [id, d] of Object.entries(b.wrong || {})) if (!wrong[id] || wrong[id] < d) wrong[id] = d;
  const today = state.today();
  const pt = (a.paidToday && a.paidToday.date === today) ? a.paidToday.ids : [];
  return {
    paid: fromServer ? [...(b.paid || [])] : [...new Set([...(a.paid || []), ...(b.paid || [])])],
    paidToday: { date: today, ids: [...new Set([...pt, ...((!fromServer && b.paidToday && b.paidToday.ids) || [])])] },
    wrong,
    flagged: [...new Set([...(a.flagged || []), ...(b.flagged || [])])],
  };
}
const HK_WRONG_COOLDOWN_DAYS = 14;   // 答錯的題 14 天內再答對不給錢（家長 09-24 定案）
function daysBetween(a, b) { return Math.round((Date.parse(b) - Date.parse(a)) / 86400000); }
function hkPayable(id) {
  const hk = s.hk || {};
  if ((hk.paid || []).includes(id)) return false;
  if (hk.paidToday && hk.paidToday.date === state.today() && hk.paidToday.ids.includes(id)) return false;
  const w = (hk.wrong || {})[id];
  return !(w && daysBetween(w, state.today()) < HK_WRONG_COOLDOWN_DAYS);
}

(async function init() {
  try {
    if (s && s.cfg) reward.applyConfig(s.cfg);   // v2.48：先用上次同步到的家長設定，sync 完再更新
    appData = await loadAll();
    perf.loadMs = Math.round(performance.now() - perf.start);
    // 第一次開：先讓使用者命名這台裝置
    if (!state.getDeviceName()) {
      renderNameDevice();
      return;
    }
    // v2.9 起不再 log session_start（雜訊太多，每次刷新都會記一筆）
    // v2.17：URL 帶 #payout 直接進家長提領頁（隱藏入口，孩子在主畫面看不到按鈕）
    // v2.51：首頁「社會」→ v2/#hk=soc（共用錢包、同步、Service Worker）
    const hkm = window.location.hash.match(/^#hk=(soc|sci|math|cn)$/);
    if (hkm) {
      renderHkHome(hkm[1]);
      syncInBackground();
      return;
    }
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
  // v2.48 起：所有裝置合計（錢包綁人）；v2.9–v2.47 是每台裝置只算自己的紀錄
  const computed = recomputeFromEvents(result.events, state.today(), state.getDeviceName());
  // v2.35：Sheet 為唯一真相（取代 v2.20 的 MAX 語意）。
  //
  // 為什麼改：2026-07-10 的「25 → 489」事件。舊 MAX 語意會讓「清資料前的舊帳」
  // 「開很久的殭屍分頁記憶體裡的舊 state」永遠壓過 server 重算值；同時 totalWithdrawn
  // 信任 server，改名後 server 查無新名字的提領紀錄 → 歸 0 → 已提領的錢復活。
  // 兩者疊加 = 憑空多出幾百塊。
  //
  // 新語意：
  //   - totalEarned = server 重算值 + 「今天本地已賺、但還沒出現在 Sheet 的差額」
  //     （差額涵蓋 POST 寫入延遲與今天離線練習；v2.20 原本要救的 race 一樣有救到）
  //   - 跨日的本地舊帳一律不採計：沒寫進 Sheet 的昨天 = 不存在
  //   - 每日上限狀態（todayPreEarned / reviewEarnedToday / baseGivenToday / readingDoneToday）
  //     用 server 事件補齊 → 換瀏覽器、清資料、殭屍分頁都繞不過每日上限
  //   - 殭屍分頁防護：非作答中先重讀 localStorage，丟掉記憶體裡的過期 state
  if (!currentModeMeta) {
    s = state.load();
  }
  const r0 = state.refreshDailyState(s);
  s = r0.state;
  // v2.48：跟「未壓上限」的伺服器今日金額比——上限改比乘前金額後，乘後金額本來就可能超過上限，
  //   拿壓過的值比會把超出的部分誤當成「本地未入帳」再加一次（reviewer H1）
  const todayDelta = Math.max(0, (s.todayEarned || 0) - (computed.rawTodayEarned ?? computed.todayEarned));
  s.totalEarned = computed.totalEarned + todayDelta;
  s.totalWithdrawn = computed.totalWithdrawn;          // 信任 server（只有家長頁能寫）
  s.totalPenalty = computed.totalPenalty || 0;         // v2.34：信任 server
  s.availableToWithdraw = Math.max(0, s.totalEarned - s.totalWithdrawn - (s.totalPenalty || 0));
  s.todayEarned = Math.max(s.todayEarned || 0, computed.todayEarned);
  s.todayPreEarned = Math.max(s.todayPreEarned || 0, computed.todayPreEarned);
  s.todayPreAll = Math.max(s.todayPreAll || 0, computed.todayPreAll || 0);   // v2.48
  s.todayPreBy = s.todayPreBy || {};                                           // v2.51
  for (const [k, v] of Object.entries(computed.todayPreBy || {})) s.todayPreBy[k] = Math.max(s.todayPreBy[k] || 0, v || 0);
  s.streak = Math.max(s.streak || 0, computed.streak);
  // v2.48：錢包綁人後連勝也是跨裝置算。別台今天已打卡 → 這台不要再 +1（reviewer M1）
  if (computed.todayCompleted) s.lastDate = state.today();
  s.reviewEarnedToday = Math.max(s.reviewEarnedToday || 0, computed.todayReviewEarned || 0);
  s.baseGivenToday = !!s.baseGivenToday || !!computed.todayBaseGiven;
  if (Array.isArray(computed.todayReadingDone) && computed.todayReadingDone.length) {
    s.readingDoneToday = [...new Set([...(s.readingDoneToday || []), ...computed.todayReadingDone])];
  }
  // v2.44：克漏字同篇一天一次 → 從 Sheet 補齊
  if (Array.isArray(computed.todayClozeDone) && computed.todayClozeDone.length) {
    s.clozeDoneToday = [...new Set([...(s.clozeDoneToday || []), ...computed.todayClozeDone])];
  }
  // v2.45：同字同題型一天一次／連連看同單元一天一場 → 也從 Sheet 補齊（換裝置、清資料都繞不過）
  if (computed.todayPaid) {
    for (const m of ['en2zh', 'zh2en', 'vocab']) state.markPaid(s, m, computed.todayPaid[m] || []);
  }
  if (Array.isArray(computed.todayMatchPaidUnits) && computed.todayMatchPaidUnits.length) {
    s.matchPaidUnitsToday = [...new Set([...(s.matchPaidUnitsToday || []), ...computed.todayMatchPaidUnits])];
  }
  s.dailyCap = computed.dailyCap;                      // v2.35：家長設定的每日上限（v2.48 起由 wallet.parseConfig 決定）
  s.cfg = computed.cfg;                                // v2.48：家長設定（上限／費率）
  s.hk = mergeHk(s.hk, computed.hk, true);             // v2.50：會考題領過（Sheet 為準＋本機今天）／答錯／還沒教過
  reward.applyConfig(s.cfg);
  s.practiceMode = computed.practiceMode || 0;         // v2.42：練習量模式（家長頁設定，跨裝置同步）
  state.save(s);
  syncStatus = 'done';
  syncMessage = `錢包 ${computed.eventCount} 筆、${computed.completedDayCount} 天`;
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

// v2.43：Service Worker 背景抓到新版本 → 通知。作答中不打擾，回主畫面才顯示。
if (typeof navigator !== 'undefined' && navigator.serviceWorker) {
  navigator.serviceWorker.addEventListener('message', (ev) => {
    if (!ev.data || ev.data.type !== 'sv2-updated') return;
    updateAvailable = true;
    if (!currentModeMeta && document.querySelector('.unit-btn')) showUpdateBar();
  });
}

function showUpdateBar() {
  if (document.getElementById('update-bar')) return;
  const bar = document.createElement('div');
  bar.id = 'update-bar';
  bar.className = 'update-bar';
  bar.innerHTML = `🆕 有新版本 <button id="update-now">更新</button>`;
  root.prepend(bar);
  bar.querySelector('#update-now').addEventListener('click', () => window.location.reload());
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
      <button class="rules-link" id="tts-rate-btn">${tts.rateModeLabel()}</button>
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
    <p class="muted small center perf-row">⚡ 載入 ${perf.loadMs} ms${perf.cached ? '（本機快取）' : ''}${dictLabel()}</p>
    <p class="muted small center sync-row">
      <span id="sync-indicator" class="sync-indicator sync-${syncStatus}">${syncStatus === 'done' ? `✓ 已同步（${escapeHtml(syncMessage)}）` : syncStatus === 'failed' ? `⚠ 離線（${escapeHtml(syncMessage)}）` : syncStatus === 'syncing' ? '🔄 同步中…' : ''}</span>
      <a href="#" id="resync" style="margin-left:8px;">重新同步</a>
    </p>
  `;
  if (updateAvailable) showUpdateBar();
  root.querySelector('#rename').addEventListener('click', e => {
    e.preventDefault();
    state.setDeviceName('');  // 清空就會觸發命名頁
    renderNameDevice();
  });
  root.querySelector('#resync').addEventListener('click', e => {
    e.preventDefault();
    syncInBackground();
  });
  // v2.39：語速切換（慢→正常→快循環），中英共用同一設定
  root.querySelector('#tts-rate-btn').addEventListener('click', (e) => {
    tts.cycleRateMode();
    e.target.textContent = tts.rateModeLabel();
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

// v2.43：字典 API 狀態小字（只在有異常時顯示，平常不佔版面）
function dictLabel() {
  const d = dictionaryStatus();
  if (d.breakerOpen) return ` · 字典 API 暫停 ${d.breakerSecondsLeft}s（題目照出）`;
  if (d.timeouts > 0) return ` · 字典 API 逾時 ${d.timeouts} 次`;
  return '';
}

// v2.26：題數選項（給 en2zh / zh2en / vocab 用，match 用 6 對固定，review 一律全部）
//   - 快練：暖身用（英翻中／中翻英 8 題）
//   - 半套：考前複習中量
//   - 全套：考前完整複習
// v2.46（謙恩 2026-09-08 要求「句子的題目要多一點，四題不夠練習」）：
//   📝 文意字彙的「快練」= 12 題（句子題要讀句子，8 題練不到手感）。
//   英翻中／中翻英維持 8 題——那兩個模式一回合太長會拉高「做不完就關掉」的風險。
const SMALL_SIZE = 8;
const SMALL_SIZE_VOCAB = 12;
const QUIZ_SIZE_LABELS = [
  { id: 'small', label: '快練', calc: (total, mode) => Math.min(mode === 'vocab' ? SMALL_SIZE_VOCAB : SMALL_SIZE, total) },
  { id: 'half', label: '半套', calc: total => Math.max(8, Math.ceil(total / 2)) },
  { id: 'all', label: '全套', calc: total => total },
];
let selectedQuizSizeId = 'small';

function renderModePicker() {
  const words = appData.units[currentUnit];
  // 算每個 size 對應幾題（顯示給孩子看）
  const sizeButtons = QUIZ_SIZE_LABELS.map(s => {
    const n = s.calc(words.length, 'en2zh');
    const label = s.id === 'small' ? s.label : `${s.label}（${n} 題）`;
    return `<button class="quiz-size-btn ${s.id === selectedQuizSizeId ? 'active' : ''}" data-size="${s.id}">${escapeHtml(label)}</button>`;
  }).join('');

  // v2.45：同字同題型一天一次 → 題型卡顯示「今天已領 N／總數」，孩子看得到錢在哪裡
  const paidCount = (mode) => {
    const set = state.getPaidSet(s, mode);
    return words.filter(w => set.has(String(w.en || '').toLowerCase())).length;
  };
  const paidLine = (mode) => {
    const n = paidCount(mode);
    if (n === 0) return '';
    const all = n >= words.length;
    return `<div class="mode-paid ${all ? 'all' : ''}">${all ? '✓ 這單元今天全部領過了（可再練，錢明天再領）' : `今天已領 ${n}／${words.length} 字`}</div>`;
  };
  const matchDone = (s.matchPaidUnitsToday || []).includes(currentUnit);

  root.innerHTML = `
    <button class="back" id="back">← 回主畫面</button>
    <h1>${escapeHtml(currentUnit)}</h1>
    <p class="muted">${words.length} 個單字</p>

    <div class="quiz-size-row">
      <span class="quiz-size-label">英翻中／中翻英／文意字彙 題數：</span>
      ${sizeButtons}
    </div>
    <p class="muted small" style="margin-top:-4px;">快練＝英翻中／中翻英 ${Math.min(SMALL_SIZE, words.length)} 題、📝 文意字彙 ${Math.min(SMALL_SIZE_VOCAB, words.length)} 題（句子題目多練幾題）。半套／全套三種題型一樣。</p>

    <button class="mode-card" data-mode="review">
      <div class="mode-title">📖 從頭複習</div>
      <div class="mode-desc">本課單字一張一張看過，每張會拼字母 + 唸發音。走完一輪自動領基本獎金。</div>
    </button>
    <button class="mode-card" data-mode="match">
      <div class="mode-title">🔗 連連看</div>
      <div class="mode-desc">英中配對 6 組，輕鬆暖身。多個英文對到同個中文不會誤判。</div>
      ${matchDone ? `<div class="mode-paid all">✓ 今天領過了（同單元一天一場，可再練）</div>` : ''}
    </button>
    <button class="mode-card" data-mode="en2zh">
      <div class="mode-title">🇬🇧 → 🇹🇼 英翻中</div>
      <div class="mode-desc">看英文選中文（4 選 1）。系統會先拼字母（A-P-P-L-E）再唸 apple。</div>
      ${paidLine('en2zh')}
    </button>
    <button class="mode-card" data-mode="vocab">
      <div class="mode-title">📝 文意字彙</div>
      <div class="mode-desc">看句子選字（4 選 1）。跟段考第一大題一樣：句子挖空，選出最適合的英文字。這回 ${QUIZ_SIZE_LABELS.find(x => x.id === selectedQuizSizeId).calc(words.length, 'vocab')} 題。</div>
      ${paidLine('vocab')}
    </button>
    ${(appData.clozeByUnit && appData.clozeByUnit[currentUnit] && appData.clozeByUnit[currentUnit].length > 0) ? `
    <button class="mode-card" data-mode="cloze">
      <div class="mode-title">🧩 克漏字</div>
      <div class="mode-desc">讀短文，每個空格選出最適合的答案。考時態、連接詞跟課文單字，跟段考題組一樣。</div>
    </button>
    ` : ''}
    <button class="mode-card" data-mode="cap" id="cap-card" style="display:none">
      <div class="mode-title">🎯 會考題（本課＋之前）</div>
      <div class="mode-desc">歷屆國中教育會考真題，只出用國小＋國一程度的字就看得懂的題目。一卷最多 ${CAP_ROUND_MAX_LABEL} 題，簡單的先來。</div>
      <div class="mode-paid" id="cap-count"></div>
    </button>
    <button class="mode-card" data-mode="zh2en">
      <div class="mode-title">🇹🇼 → 🇬🇧 中翻英</div>
      <div class="mode-desc">把英文拼出來。難度最高，學最深。each / every 都是「每一」這種多答案會兩個都接受。</div>
      ${paidLine('zh2en')}
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
  // v2.50：會考題卡片——題庫非同步載入，這一課有可出的題才顯示
  const unitAtRender = currentUnit;
  loadCapData().then(data => {
    if (currentUnit !== unitAtRender) return;
    const items = eligibleItems(data, currentUnit, flaggedMap(s.hk && s.hk.flagged));
    const card = root.querySelector('#cap-card');
    if (!card || !items.length) return;
    const qs = items.flatMap(it => it.questions);
    const pay = qs.filter(q => hkPayable(q.id)).length;
    card.style.display = '';
    root.querySelector('#cap-count').textContent = `可以做 ${qs.length} 題，其中 ${pay} 題還能領獎金`;
  }).catch(() => {});
}
const CAP_ROUND_MAX_LABEL = 10;

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
      dailyCap: s.dailyCap,   // v2.35：家長可調每日上限
      allRemaining: allRemaining(),   // v2.48
    });
    if (readingCalc.sessionPre > 0) {
      s.todayPreEarned = (s.todayPreEarned || 0) + readingCalc.sessionPre;
      s.todayPreAll = (s.todayPreAll || 0) + readingCalc.sessionPre;   // v2.48
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
    note: `v2 閱讀${readingCalc.sessionFinal ? ` #pre:${readingCalc.sessionPre}` : ''}「${story.title || ''}」理解測驗 ${compCorrect}/${compTotal} 對、查 ${looked.length} 字${readingCalc.sessionFinal ? `（+$${readingCalc.sessionFinal}）` : ''}`,
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

// v2.41：A1 基礎字池（給文意字彙當「向下相容」干擾選項）。
// zh 用 meanings 第一義（避開 ECDICT 主要意思取錯的已知問題，如 one=一致的）。
let _a1PoolCache = null;
function buildA1Pool() {
  if (_a1PoolCache) return _a1PoolCache;
  const pool = [];
  for (const [unitName, list] of Object.entries(appData.units || {})) {
    if (!unitName.startsWith('A1 ')) continue;
    for (const e of list) {
      if (!e.en) continue;
      const zh = (Array.isArray(e.meanings) && e.meanings.length > 0)
        ? e.meanings[0].zh
        : e.zh;
      if (zh) pool.push({ en: e.en, zh });
    }
  }
  _a1PoolCache = pool;
  return pool;
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
  const roundSize = sizeSpec.calc(words.length, mode);   // v2.46：文意字彙的「快練」是 12 題
  root.innerHTML = '';
  currentModeMeta = { mode, unit: currentUnit, totalQuestions: words.length, startedAt: Date.now() };
  const onComplete = (result) => {
    currentModeMeta = null;
    handleComplete(mode, result);
  };
  // v2.43：英翻中／從頭複習也吃本地例句庫（零等待），字典 API 退居補充
  const sentenceMap = (appData.sentencesByUnit && appData.sentencesByUnit[currentUnit]) || {};
  // v2.45：同字同題型一天只付一次 → 出題優先抽今天還沒領過的字
  const paidSet = state.getPaidSet(s, mode);
  if (mode === 'match') {
    startMatchMode({ root, words, seenSet, onComplete, wordStats });
  } else if (mode === 'en2zh') {
    startEn2ZhMode({ root, words, seenSet, onComplete, allWords: words, wordStats, roundSize, sentenceMap, paidSet });
  } else if (mode === 'zh2en') {
    startZh2EnMode({ root, words, seenSet, onComplete, wordStats, roundSize, paidSet });
  } else if (mode === 'review') {
    startReviewMode({ root, words, onComplete, sentenceMap });
  } else if (mode === 'vocab') {
    // v2.40：文意字彙 — 例句庫（sentencesByUnit）優先，沒有的字退回 API 例句／中文提示
    // v2.41：extraPool 傳 A1 基礎字池 → 選項「向下相容」混入 A1 字（家長要求）
    startVocabMode({
      root, words, seenSet, onComplete, allWords: words, wordStats, roundSize,
      sentenceMap,
      extraPool: buildA1Pool(),
      paidSet,
    });
  } else if (mode === 'cap') {
    startCap({ subject: 'en', unit: currentUnit });
  } else if (mode === 'cloze') {
    // v2.40：克漏字 — 只有題庫有這個單元的短文時，題型卡才會出現
    startClozeMode({
      root,
      passages: (appData.clozeByUnit && appData.clozeByUnit[currentUnit]) || [],
      onComplete,
      doneToday: new Set(s.clozeDoneToday || []),   // v2.44：同一篇一天只領一次

    });
  }
}

// 關瀏覽器 / 切到背景時，如果還在 mode 中，送一筆 beacon log
// （fetch keepalive 也加了，但 sendBeacon 是專門設計給這場景，更可靠）
if (typeof window !== 'undefined') {
  // v2.50（reviewer H1）：會考卷做到一半關掉／切走 → 把已答錯的題補送 Sheet（amount 0），換裝置或清資料也繞不過 14 天冷卻。
  //   pagehide 與 visibilitychange(hidden) 都送（iPad／手機上後者比較可靠）；送過的就清掉，不重送。
  const flushCapWrong = () => {
    if (!(currentModeMeta && /^hk_/.test(currentModeMeta.mode) && capPendingWrong.length)) return;
    logEventBeacon({ event: `v2_${currentModeMeta.mode}_paid`, unit: currentModeMeta.unit, quizSize: currentModeMeta.totalQuestions, correct: 0, amount: 0,
      note: `v2 會考題（離開頁面，沒做完） #pre:0 #wrong:${[...new Set(capPendingWrong)].join('|')} #paid:` }, s);
    capPendingWrong = [];
  };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushCapWrong(); });
  window.addEventListener('pagehide', () => {
    if (currentModeMeta && /^hk_/.test(currentModeMeta.mode)) { flushCapWrong(); currentModeMeta = null; return; }
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

// v2.51：會考題通用（英文＝app 課本單元；社會＝分科＋升學王單元）
//   ctx = { subject:'en'|'soc', unit, strand? }
async function startCap(ctx = { subject: 'en', unit: currentUnit }) {
  const back = () => (ctx.subject === 'en' ? renderModePicker() : renderHkHome(ctx.subject, ctx.strand));
  let data;
  try { data = await loadCapData(ctx.subject); }
  catch (e) { root.innerHTML = `<button class="back" id="back">← 回上一頁</button><p class="muted">${escapeHtml(e.message)}，請稍後再試。</p>`;
    root.querySelector('#back').addEventListener('click', back); currentModeMeta = null; return; }
  const items = eligibleItems(data, ctx.unit, flaggedMap(s.hk && s.hk.flagged), ctx.strand);
  const round = pickRound(items, hkPayable);
  if (!round.length) { currentModeMeta = null; back(); return; }
  capPendingWrong = [];
  currentModeMeta = { mode: `hk_${ctx.subject}`, unit: ctx.unit, totalQuestions: round.reduce((n, it) => n + it.questions.length, 0), startedAt: Date.now() };
  startCapMode({
    root, unit: ctx.strand ? `${ctx.strand} ${ctx.unit}` : ctx.unit, round, subject: ctx.subject,
    unitIdx: unitIndex(data, ctx.unit, ctx.strand),   // 「這題還沒教過」記下這一課，選到更後面的課才再出
    // reviewer H1：每題送出就記答錯（本機立刻存；關頁面時補送 Sheet）
    onAnswered: (rs) => {
      const wrong = rs.filter(x => !x.correct).map(x => x.id);
      if (!wrong.length) return;
      s.hk = mergeHk(s.hk, { wrong: Object.fromEntries(wrong.map(id => [id, state.today()])) });
      state.save(s);
      capPendingWrong.push(...wrong);
    },
    onComplete: (r) => { currentModeMeta = null; capPendingWrong = []; handleCapComplete(ctx, r); },
  });
}
let capPendingWrong = [];   // 這一卷已答錯、但還沒寫進 Sheet 的題（pagehide 時補送）

// v2.50：會考題結算——同一題只付一次、答錯 14 天內不付、不乘連勝、不給基礎、不算打卡；吃該科上限＋全科總上限
function handleCapComplete(ctx, result) {
  const subject = ctx.subject;
  // reviewer M1：另一個分頁可能剛結算過 → 先跟 localStorage 對齊，避免同一題付兩次
  const fresh = state.load();
  s.hk = mergeHk(s.hk, fresh.hk);
  if (fresh.todayDate === s.todayDate) {
    s.todayPreEarned = Math.max(s.todayPreEarned || 0, fresh.todayPreEarned || 0);
    s.todayPreAll = Math.max(s.todayPreAll || 0, fresh.todayPreAll || 0);
    const fb = fresh.todayPreBy || {}; s.todayPreBy = s.todayPreBy || {};
    for (const k of Object.keys(fb)) s.todayPreBy[k] = Math.max(s.todayPreBy[k] || 0, fb[k] || 0);
  }
  const r0 = state.refreshDailyState(s); s = r0.state;
  const today = state.today();
  const cfg = s.cfg || {};
  const rate = Number(cfg['rate.hk.per'] ?? 2);
  const answered = result.results.filter(x => !x.skipped);
  const correctIds = answered.filter(x => x.correct).map(x => x.id);
  const wrongIds = answered.filter(x => !x.correct).map(x => x.id);
  const payableIds = result.aborted ? [] : correctIds.filter(hkPayable);
  const todaySubj = subject === 'en' ? (s.todayPreEarned || 0) : ((s.todayPreBy || {})[subject] || 0);
  const left = remainingPre(cfg, subject, todaySubj, s.todayPreAll || 0);
  const nPaid = rate > 0 ? Math.min(payableIds.length, Math.floor(left / rate)) : 0;
  const paidIds = payableIds.slice(0, nPaid);
  const pre = nPaid * rate;
  // 本機狀態
  s.hk = mergeHk(s.hk, { paidToday: { date: today, ids: paidIds }, wrong: Object.fromEntries(wrongIds.map(id => [id, today])), flagged: result.flagged });
  if (pre > 0) {
    if (subject === 'en') {
      s.todayPreEarned = (s.todayPreEarned || 0) + pre;
      s.todayEarned = (s.todayEarned || 0) + pre;   // 英文畫面的「今日獎金」只算英文
    } else {
      s.todayPreBy = s.todayPreBy || {};
      s.todayPreBy[subject] = (s.todayPreBy[subject] || 0) + pre;
    }
    s.todayPreAll = (s.todayPreAll || 0) + pre;
    s.totalEarned = (s.totalEarned || 0) + pre;
    s.availableToWithdraw = Math.max(0, (s.totalEarned || 0) - (s.totalWithdrawn || 0) - (s.totalPenalty || 0));
  }
  state.save(s);
  // Sheet：#paid: 一定放最後
  if (answered.length || result.flagged.length) {
    logEvent({
      event: `v2_hk_${subject}_paid`,
      unit: ctx.strand ? `${ctx.strand} ${ctx.unit}` : ctx.unit,
      quizSize: result.totalQuestions,
      correct: correctIds.length,
      amount: pre,
      note: `v2 會考題${result.aborted ? '（中途離開）' : ''} #pre:${pre}` +
        (wrongIds.length ? ` #wrong:${wrongIds.join('|')}` : '') +
        (result.flagged.length ? ` #flag:${result.flagged.join('|')}` : '') +
        ` #paid:${paidIds.join('|')}`,
    }, s);
  }
  renderCapResult({ ctx, result, correct: correctIds.length, answered: answered.length, pre, payable: payableIds.length, nPaid, rate });
}

function renderCapResult({ ctx, result, correct, answered, pre, payable, nPaid, rate }) {
  const capped = nPaid < payable;
  const money = rate <= 0 ? '會考題目前沒有設定獎金（媽媽可以在家長頁調）。練習本身就很有用！'
    : result.aborted ? '中途離開沒有獎金，下次做完整一卷再來！'
    : pre > 0 ? `答對且第一次領的 ${nPaid} 題 × $${rate} = <b>$${pre}</b>${capped ? '（今天的上限到了，其餘明天再領）' : ''}`
    : correct > 0 ? (capped ? '今天的獎金上限到了，這些題明天答對還能領！' : '答對的題目之前已經領過（或剛答錯過，14 天後再答對才會給錢）。練習本身就很有用！')
    : '這卷沒有新的獎金，下次再來！';
  const isEn = ctx.subject === 'en';
  root.innerHTML = `
    <h1>🎯 會考題結果</h1>
    <div class="stats">
      <div class="stat"><div class="stat-num">${correct} / ${answered}</div><div class="stat-label">答對</div></div>
      <div class="stat"><div class="stat-num">$${pre}</div><div class="stat-label">這卷獎金</div></div>
    </div>
    <div class="card"><p>${money}</p>
      <p class="muted small">會考題：同一題只付一次錢，不乘連勝、沒有基礎獎金。</p></div>
    ${result.reviewUnits.length ? `<h2>📖 回去${isEn ? '複習' : '讀'}</h2>${result.reviewUnits.map(u => isEn ? `
      <button class="mode-card cap-review" data-unit="${escapeHtml(u.unit)}">
        <div class="mode-title">${escapeHtml(u.unit)}</div>
        <div class="mode-desc">答錯的題目用到：${u.words.map(w => escapeHtml(w.en)).join('、')}</div>
      </button>` : `
      <a class="mode-card" href="https://newjall.learning100.com.tw/" target="_blank" rel="noopener">
        <div class="mode-title">${escapeHtml(ctx.strand)}　${escapeHtml(u.unit)}</div>
        <div class="mode-desc">到升學王找這一課的影片看一遍，再回來挑戰（開新分頁）</div>
      </a>`).join('')}` : ''}
    <button id="again">再來一卷</button>
    <button id="home" class="secondary">${isEn ? '回題型選單' : `回${HK_HOME[ctx.subject].label}`}</button>`;
  root.querySelectorAll('.cap-review').forEach(b => b.addEventListener('click', () => {
    if (!appData.units[b.dataset.unit]) return;
    currentUnit = b.dataset.unit;
    renderModePicker();
  }));
  root.querySelector('#again').addEventListener('click', () => { if (isEn) currentUnit = ctx.unit; startCap(ctx); });
  root.querySelector('#home').addEventListener('click', () => { if (isEn) { currentUnit = ctx.unit; renderModePicker(); } else renderHkHome(ctx.subject, ctx.strand); });
}

// v2.51：🌏 社會科會考題——選分科、選單元（七上～八下），點哪一課就出「這一課＋之前」的會考題
// v2.51 社會／v2.52 自然／v2.53 數學／v2.54 國文：會考題首頁——選分科、選課（七上～九下），點哪一課就出「這一課＋之前」的會考題
const HK_HOME = {
  soc: { title: '🌏 社會 會考題', label: '社會科', strands: ['歷史', '地理', '公民'] },
  sci: { title: '🔬 自然 會考題', label: '自然科', strands: ['生物', '理化', '地科'] },
  math: { title: '📐 數學 會考題', label: '數學科', strands: ['數學'] },
  cn: { title: '📜 國文 會考題', label: '國文科', strands: ['國文'] },
};
const HK_MAX_GRADE = ['七上', '七下', '八上', '八下', '九上', '九下'];   // v2.54：做完整個國中（家長 09-24）
const renderSocHome = (strand) => renderHkHome('soc', strand);
async function renderHkHome(subject, strand) {
  const H = HK_HOME[subject];
  strand = strand || H.strands[0];
  root.innerHTML = `<button class="back" id="back">← 回主畫面</button><h1>${H.title}</h1><p class="muted">讀取題庫中…</p>`;
  root.querySelector('#back').addEventListener('click', leaveHk);
  let data;
  try { data = await loadCapData(subject); }
  catch (e) { root.querySelector('p').textContent = `${e.message}，請稍後再試。`; return; }
  const flagged = flaggedMap(s.hk && s.hk.flagged);
  const units = data.strands[strand] || [];
  const grades = data.strandGrades[strand] || [];
  // 不是正式課次的項目（入手方法、例題、圖像畫、統整、實驗…）不列出來——清單太長孩子找不到自己那一課（reviewer L5）
  const NOT_LESSON = /入手方法|例題|圖像畫|統整|大剖析|大解密|大彙整|^\S+\s*實驗|入門先修|前情提要|【補充】|^\S+\s*主題-|重點回顧|難題精選|有趣的數學|^\S+\s*計算機$/;
  const rows = units.map((u, i) => ({ u, g: grades[i] })).filter(r => HK_MAX_GRADE.includes(r.g) && !NOT_LESSON.test(r.u));
  const byGrade = HK_MAX_GRADE.map(g => ({ g, rows: rows.filter(r => r.g === g) }));
  const line = (u) => {
    const qs = eligibleItems(data, u, flagged, strand).flatMap(it => it.questions);
    const pay = qs.filter(q => hkPayable(q.id)).length;
    return { n: qs.length, pay };
  };
  const later = grades.length ? grades[0] : '';
  root.innerHTML = `
    <button class="back" id="back">← 回主畫面</button>
    <h1>${H.title}</h1>
    <p class="muted small">歷屆國中教育會考真題（心測中心）。選你<b>學校上到的那一課</b>，就出「這一課＋之前」的題目。一卷最多 10 題，每題答對 $${(s.cfg && s.cfg['rate.hk.per']) ?? 2}，同一題只付一次。</p>
    <div class="quiz-size-row" ${H.strands.length > 1 ? '' : 'style="display:none"'}>${H.strands.map(x => `<button class="quiz-size-btn ${x === strand ? 'active' : ''}" data-strand="${x}">${x}</button>`).join('')}</div>
    ${rows.length ? '' : `<div class="card"><p>${escapeHtml(strand)}是${escapeHtml(later)}開始的內容，升上那個年級就會出現。</p></div>`}
    ${byGrade.map(({ g, rows }) => rows.length ? `
      <h2>${g}</h2>
      ${rows.map(({ u }) => { const c = line(u); return `
        <button class="mode-card soc-unit" data-unit="${escapeHtml(u)}" ${c.n ? '' : 'disabled'}>
          <div class="mode-title">${escapeHtml(u.replace(/^[七八九][上下]\s*/, ''))}</div>
          <div class="mode-paid">${c.n ? `可以做 ${c.n} 題，其中 ${c.pay} 題還能領獎金` : '到這一課還沒有會考題'}</div>
        </button>`; }).join('')}` : '').join('')}`;
  root.querySelector('#back').addEventListener('click', leaveHk);
  root.querySelectorAll('[data-strand]').forEach(b => b.addEventListener('click', () => renderHkHome(subject, b.dataset.strand)));
  root.querySelectorAll('.soc-unit').forEach(b => b.addEventListener('click', () => startCap({ subject, strand, unit: b.dataset.unit })));
}
function leaveHk() {
  // 社會／自然／數學／國文是從首頁進來的（v2/#hk=soc、sci、math、cn）→ 回首頁
  window.location.href = '../';
}

function handleComplete(mode, result) {
  // v2.40：克漏字「選文頁」按返回 → 靜靜回題型選單（不記獎金、不寫 Sheet）
  if (result && result.silent) {
    renderModePicker();
    return;
  }
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
      dailyCap: s.dailyCap,                          // v2.35：家長可調每日上限
      practiceMode: s.practiceMode || 0,             // v2.42：加練模式（複習 $25→$10）
      allRemaining: allRemaining(),                  // v2.48
    });
  } else if (mode === 'match') {
    // v2.15：連連看固定獎金，不依 sessionCorrect 計算（防 brute force 刷錢）
    const matchRepeat = (s.matchPaidUnitsToday || []).includes(currentUnit);   // v2.45：同單元一天一場
    calc = reward.calcMatchReward({
      todayPreEarned: s.todayPreEarned || 0,
      dailyCap: s.dailyCap,
      practiceMode: s.practiceMode || 0,             // v2.42：加練模式（$5→$2）
      alreadyRewarded: matchRepeat,
      allRemaining: allRemaining(),                  // v2.48
    });
    if (!matchRepeat && calc.sessionPre > 0) {
      if (!s.matchPaidUnitsToday) s.matchPaidUnitsToday = [];
      s.matchPaidUnitsToday.push(currentUnit);
    }
  } else {
    // v2.44：克漏字同一篇一天只領一次獎金（題庫固定 13 篇，防背熟刷錢）
    const clozeRepeat = mode === 'cloze' && !!result.passageId && (s.clozeDoneToday || []).includes(result.passageId);
    // v2.45：同字同題型一天一次——本回合答對的字裡，今天已付過的不再計錢
    const paidSetNow = state.getPaidSet(s, mode);
    const correctEns = Array.isArray(result.wordResults) ? result.wordResults.filter(r => r.correct).map(r => r.en) : [];
    const paidCorrect = correctEns.filter(en => paidSetNow.has(String(en).toLowerCase())).length;
    const newlyPaidEns = correctEns.filter(en => !paidSetNow.has(String(en).toLowerCase()));
    calc = reward.calcSessionReward({
      sessionCorrect,
      streak: s.streak || 0,
      todayPreEarned: s.todayPreEarned || 0,
      baseGivenToday: !!s.baseGivenToday,   // v2.13：傳今天是否已給過基礎獎金
      dailyCap: s.dailyCap,
      practiceMode: s.practiceMode || 0,    // v2.42：加練模式（基礎門檻 5→10 題；連勝門檻不變仍是 5）
      mode,                                 // v2.44：題型分級（文意字彙 $3、克漏字 $3）
      alreadyRewarded: clozeRepeat,
      paidCorrect,                          // v2.45
      allRemaining: allRemaining(),         // v2.48
    });
    if (['en2zh', 'zh2en', 'vocab'].includes(mode) && newlyPaidEns.length && calc.sessionPre > 0) {
      state.markPaid(s, mode, newlyPaidEns);
      result._paidNow = newlyPaidEns;   // 寫進 Sheet 備註，跨裝置同步用
    }
    if (mode === 'cloze' && result.passageId && !clozeRepeat && calc.sessionPre > 0) {
      if (!s.clozeDoneToday) s.clozeDoneToday = [];
      s.clozeDoneToday.push(result.passageId);
    }
  }

  if (!result.aborted) {
    s.todayPreEarned = (s.todayPreEarned || 0) + calc.sessionPre;
    s.todayPreAll = (s.todayPreAll || 0) + calc.sessionPre;   // v2.48
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
    vocab: '文意字彙', cloze: '克漏字',   // v2.40
  }[mode] || mode;
  logEvent({
    event: result.aborted ? `v2_${mode}_abandoned` : `v2_${mode}_done`,
    unit: currentUnit,
    quizSize: totalQuestions,
    correct: sessionCorrect,
    amount: calc.sessionFinal,
    note: result.aborted
      ? `v2 ${modeLabel} 中途離開（做到 ${sessionCorrect}/${totalQuestions}）${result.passageTitle ? `「${result.passageTitle}」` : ''}`
      : `v2 ${modeLabel}${calc.sessionFinal > 0 ? ` #pre:${calc.sessionPre}` : ''}${result.passageTitle ? `「${result.passageTitle}」` : ''}${mode === 'cloze' && result.passageId ? ` #${result.passageId}` : ''}${Array.isArray(result._paidNow) && result._paidNow.length ? ` #paid:${result._paidNow.join('|')}` : ''}`,
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
