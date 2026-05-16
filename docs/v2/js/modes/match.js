// modes/match.js — 連連看
// 為什麼是「英文 → 中文」單向配對：
//   - 多個英文可能對到同一個中文（every / each / all → 每一）
//   - 我們在每一回合先去重 zh，避免同一個中文出現兩次造成誤判
//   - 配對邏輯：(en, zh) 兩張卡屬於同一個 word 即正確
// 完成回呼：
//   onComplete({ sessionCorrect, totalQuestions, wrongAttempts, message })

import { speak } from '../tts.js';

const PAIRS_PER_ROUND = 6;

export function startMatchMode({ root, words, onComplete, seenSet }) {
  // 去重：同 zh 只取第一個
  const seenZh = new Set();
  const candidates = [];
  for (const w of words) {
    if (!w.zh || !w.en) continue;
    if (seenZh.has(w.zh)) continue;
    seenZh.add(w.zh);
    candidates.push(w);
  }
  if (candidates.length < 2) {
    onComplete({
      sessionCorrect: 0,
      totalQuestions: 0,
      wrongAttempts: 0,
      message: '單字不足',
      usedWords: [],
    });
    return;
  }

  // 優先挑「今天還沒練過」的字
  const round = pickPreferUnseen(candidates, Math.min(PAIRS_PER_ROUND, candidates.length), seenSet || new Set());
  // 左欄是英文（按原順序），右欄是中文（打亂）
  const leftCards = round.map(w => ({ ...w, matched: false }));
  const rightCards = shuffle(round.map(w => ({ ...w, matched: false })));
  const state = {
    selectedEn: null,
    selectedZh: null,
    matchedCount: 0,
    wrongAttempts: 0,
  };

  function render() {
    root.innerHTML = `
      <button class="back" id="back">← 換一個單元</button>
      <h2>🔗 連連看</h2>
      <p class="muted">點英文 → 點中文，配對成功就消除</p>
      <div class="match-grid">
        <div class="match-col" data-side="en">
          ${leftCards.map((c, i) => cardHtml(c, 'en', i, state.selectedEn === i)).join('')}
        </div>
        <div class="match-col" data-side="zh">
          ${rightCards.map((c, i) => cardHtml(c, 'zh', i, state.selectedZh === i)).join('')}
        </div>
      </div>
      <p class="match-progress muted">${state.matchedCount} / ${round.length} 配對成功</p>
    `;
    root.querySelector('#back').addEventListener('click', () => {
      onComplete({
        sessionCorrect: state.matchedCount,
        totalQuestions: round.length,
        wrongAttempts: state.wrongAttempts,
        message: '中途離開',
        aborted: true,
        usedWords: round,
      });
    });
    root.querySelectorAll('.match-card').forEach(el => {
      el.addEventListener('click', handleClick);
    });
  }

  function cardHtml(c, side, i, selected) {
    const cls = ['match-card'];
    if (c.matched) cls.push('matched');
    if (selected) cls.push('selected');
    const text = side === 'en' ? c.en : c.zh;
    return `<button class="${cls.join(' ')}" data-side="${side}" data-idx="${i}">${escapeHtml(text)}</button>`;
  }

  function handleClick(e) {
    const side = e.currentTarget.dataset.side;
    const idx = parseInt(e.currentTarget.dataset.idx, 10);
    const cards = side === 'en' ? leftCards : rightCards;
    if (cards[idx].matched) return;

    if (side === 'en') {
      state.selectedEn = (state.selectedEn === idx) ? null : idx;
      // 點選英文時順便唸出來，建立發音記憶
      if (state.selectedEn === idx) speak(cards[idx].en);
    } else {
      state.selectedZh = (state.selectedZh === idx) ? null : idx;
    }

    if (state.selectedEn !== null && state.selectedZh !== null) {
      const enWord = leftCards[state.selectedEn];
      const zhWord = rightCards[state.selectedZh];
      // 正確 = 兩張卡屬於同一個 (en, zh) pair
      if (enWord.en === zhWord.en && enWord.zh === zhWord.zh) {
        enWord.matched = true;
        zhWord.matched = true;
        state.matchedCount++;
        state.selectedEn = null;
        state.selectedZh = null;
        speak(enWord.en);  // 配對成功再唸一次強化
        render();
        if (state.matchedCount === round.length) {
          setTimeout(() => onComplete({
            sessionCorrect: state.matchedCount,
            totalQuestions: round.length,
            wrongAttempts: state.wrongAttempts,
            message: '通關！',
            usedWords: round,
          }), 500);
        }
      } else {
        // 錯：靜默 deselect（不抖、不紅 → 不觸發焦慮逃避）
        state.wrongAttempts++;
        setTimeout(() => {
          state.selectedEn = null;
          state.selectedZh = null;
          render();
        }, 350);
      }
    } else {
      render();
    }
  }

  render();
}

// 抽選：偏好「今天還沒練過」的字（unseen 先洗、優先選；不夠才補 seen）
function pickPreferUnseen(items, n, seenSet) {
  const unseen = items.filter(w => !seenSet.has(w.en));
  const seen = items.filter(w => seenSet.has(w.en));
  return [...shuffle(unseen), ...shuffle(seen)].slice(0, n);
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}
