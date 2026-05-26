// srs.js — 每字記憶追蹤（Spaced Repetition Lite）
//
// 設計：
//   - localStorage（每台裝置一份；跨裝置 sync 留 v2.25）
//   - 每字記 5 個欄位（用短 key 省 localStorage 空間）：
//       s: seen（出現過幾次）
//       c: correct（答對幾次累計）
//       w: wrong（答錯幾次累計）
//       k: streak（目前連續答對；答錯歸 0）
//       t: 最後一次練的日期 YYYY-MM-DD
//   - 「已會」門檻 = streak >= 3（連對 3 次）
//
// 出題策略（pickPreferLearning）：
//   優先順序：答錯過 > 沒見過 > 學習中（streak<3）> 已會（streak>=3 偶爾回測）
//   先湊滿 n 個從前三類；不夠的話從已會加，避免遺忘。
//
// 哪些模式追蹤對錯：
//   - en2zh / zh2en：用 recordResult(en, isCorrect)
//   - match：用 recordSeen(en) — 容錯高，不算對錯
//   - review：用 recordSeen(en) — 不考試，只算看過
//
// 為什麼短 key (s/c/w/k/t) 而不是 seen/correct/...：
//   1900 字 × ~50 bytes = 95KB；改短 key 約 30KB，省 65% localStorage 空間。

const MASTERY_STREAK = 3;        // 連對 3 次 = 已會
const REVIEW_RECENT_DAYS = 30;   // 「最近」定義

export function recordResult(state, en, isCorrect, todayStr) {
  if (!en) return;
  if (!state.wordStats) state.wordStats = {};
  const key = en.toLowerCase();
  const stat = state.wordStats[key] || { s: 0, c: 0, w: 0, k: 0, t: null };
  stat.s += 1;
  if (isCorrect) { stat.c += 1; stat.k += 1; }
  else            { stat.w += 1; stat.k = 0; }
  stat.t = todayStr || stat.t;
  state.wordStats[key] = stat;
}

export function recordSeen(state, en, todayStr) {
  if (!en) return;
  if (!state.wordStats) state.wordStats = {};
  const key = en.toLowerCase();
  const stat = state.wordStats[key] || { s: 0, c: 0, w: 0, k: 0, t: null };
  stat.s += 1;
  stat.t = todayStr || stat.t;
  state.wordStats[key] = stat;
}

export function recordSeenBatch(state, ens, todayStr) {
  for (const en of ens || []) recordSeen(state, en, todayStr);
}

// 0 = 沒見過、1 = 練過但 streak=0（剛答錯或剛重置）、2 = 學習中、3 = 已會
export function masteryLevel(stat) {
  if (!stat || stat.s === 0) return 0;
  if (stat.k >= MASTERY_STREAK) return 3;
  if (stat.k >= 1) return 2;
  return 1;
}

// 給單元用：算單元裡有幾個字「已會」
export function countMasteredIn(words, wordStats) {
  if (!Array.isArray(words) || !wordStats) return 0;
  let n = 0;
  for (const w of words) {
    const stat = wordStats[(w.en || '').toLowerCase()];
    if (masteryLevel(stat) === 3) n++;
  }
  return n;
}

// 取代舊的 pickPreferUnseen — 加上「答錯過」、「已會」分桶
//
// 桶位：
//   wrong:    上次答錯（streak === 0 且 w > 0）→ 最優先（剛踩雷的字要趕快補）
//   unseen:   完全沒見過
//   learning: 練過但還沒會（streak 1..2）
//   mastered: 已會（streak >= 3）→ 只在前三桶不夠時加入
export function pickPreferLearning(words, n, wordStats) {
  if (!Array.isArray(words) || words.length === 0) return [];
  wordStats = wordStats || {};
  const wrong = [];
  const unseen = [];
  const learning = [];
  const mastered = [];
  for (const w of words) {
    const stat = wordStats[(w.en || '').toLowerCase()];
    if (!stat || stat.s === 0) { unseen.push(w); continue; }
    if (stat.k === 0 && stat.w > 0) { wrong.push(w); continue; }
    if (stat.k < MASTERY_STREAK) { learning.push(w); continue; }
    mastered.push(w);
  }
  const result = [];
  for (const bucket of [shuffle(wrong), shuffle(unseen), shuffle(learning)]) {
    for (const w of bucket) {
      if (result.length >= n) break;
      result.push(w);
    }
    if (result.length >= n) break;
  }
  // 不夠就加 mastered 回測（避免遺忘）
  if (result.length < n) {
    for (const w of shuffle(mastered)) {
      if (result.length >= n) break;
      result.push(w);
    }
  }
  return result;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 給 debug / 未來統計用
export function getStats(state) {
  const stats = state.wordStats || {};
  let total = 0, mastered = 0, learning = 0, wrong = 0;
  for (const k in stats) {
    total++;
    const lv = masteryLevel(stats[k]);
    if (lv === 3) mastered++;
    else if (lv === 1 && stats[k].w > 0) wrong++;
    else learning++;
  }
  return { total, mastered, learning, wrong };
}
