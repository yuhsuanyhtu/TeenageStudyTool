// modes/review.js — 從頭複習（單字卡翻閱）
//
// 設計：
//   - 整課單字一張一張看，自動唸字母拼讀 + 整字發音
//   - 不考試、無對錯壓力 → 適合每天暖身
//   - 走完整輪 = 拿固定獎金（reward.calcReviewReward）
//   - 中途離開 = 沒獎金（避免只翻一兩張就刷錢）
//
// 完成回呼帶 mode:'review' → main.handleComplete 會 dispatch 到 calcReviewReward

import { speak, speakSpell } from '../tts.js';

export function startReviewMode({ root, words, onComplete }) {
  const list = (words || []).filter(w => w.en && w.zh);
  if (list.length === 0) {
    onComplete({
      sessionCorrect: 0,
      totalQuestions: 0,
      message: '單字不足',
      mode: 'review',
      usedWords: [],
    });
    return;
  }

  const state = { idx: 0 };

  function render() {
    const w = list[state.idx];
    const isLast = state.idx === list.length - 1;
    const isFirst = state.idx === 0;
    const pct = ((state.idx + 1) / list.length) * 100;

    root.innerHTML = `
      <button class="back" id="back">← 中途離開（沒獎金）</button>
      <h2>📖 從頭複習</h2>
      <p class="muted">${state.idx + 1} / ${list.length}</p>

      <div class="review-card" id="card">
        <div class="review-en">${escapeHtml(w.en)}</div>
        <div class="review-zh">${escapeHtml(w.zh)}</div>
        <div class="speak-row">
          <button class="speak-btn" id="speak">🔊 唸發音</button>
          <button class="speak-btn" id="spell">🔤 聽拼字</button>
        </div>
      </div>

      <div class="review-controls">
        <button class="secondary" id="prev" ${isFirst ? 'disabled' : ''}>← 上一個</button>
        <button id="next">${isLast ? '✅ 完成領獎金' : '下一個 →'}</button>
      </div>

      <div class="review-progress-bar">
        <div class="review-progress-fill" style="width:${pct}%"></div>
      </div>
    `;

    root.querySelector('#back').addEventListener('click', () => {
      onComplete({
        sessionCorrect: 0,
        totalQuestions: list.length,
        message: '中途離開',
        aborted: true,
        mode: 'review',
        usedWords: list.slice(0, state.idx + 1),  // 已翻過的部分算練過
      });
    });
    root.querySelector('#speak').addEventListener('click', e => {
      e.stopPropagation();
      speak(w.en);
    });
    root.querySelector('#card').addEventListener('click', () => speak(w.en));
    root.querySelector('#prev').addEventListener('click', () => {
      if (state.idx > 0) { state.idx--; render(); }
    });
    root.querySelector('#next').addEventListener('click', () => {
      if (isLast) {
        onComplete({
          sessionCorrect: list.length,
          totalQuestions: list.length,
          message: `🎉 ${list.length} 個單字複習完了！`,
          mode: 'review',
          completed: true,
          usedWords: list,
        });
      } else {
        state.idx++;
        render();
      }
    });

    // 自動唸這張卡
    setTimeout(() => speak(w.en), 150);
  }

  render();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}
