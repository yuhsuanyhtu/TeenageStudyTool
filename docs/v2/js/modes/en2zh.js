// modes/en2zh.js — 英文 → 中文 4 選 1
// 為什麼有這個模式：
//   - 對基礎弱的孩子，「識字」比「拼字」門檻低、信心更穩
//   - 自動唸發音 + 4 選 1 → 視聽結合
//   - 完全避開舊版「中翻英只接受唯一答案」的設計缺陷

import { speak } from '../tts.js';

const QUESTIONS_PER_ROUND = 8;
const MIN_DISTRACTORS_NEEDED = 4;  // 1 正解 + 3 干擾

export function startEn2ZhMode({ root, words, onComplete, allWords }) {
  const usable = words.filter(w => w.en && w.zh);
  if (usable.length < MIN_DISTRACTORS_NEEDED) {
    onComplete({
      sessionCorrect: 0,
      totalQuestions: 0,
      message: '單字不足，無法出題',
    });
    return;
  }

  const round = shuffle(usable).slice(0, Math.min(QUESTIONS_PER_ROUND, usable.length));
  const distractorPool = (allWords && allWords.length >= MIN_DISTRACTORS_NEEDED)
    ? allWords.filter(w => w.en && w.zh)
    : usable;

  const state = { idx: 0, correct: 0, answered: false };

  function pickDistractors(correctZh) {
    const pool = distractorPool.filter(w => w.zh !== correctZh);
    return shuffle(pool).slice(0, 3).map(w => w.zh);
  }

  function render() {
    if (state.idx >= round.length) {
      onComplete({
        sessionCorrect: state.correct,
        totalQuestions: round.length,
        message: `${round.length} 題答對 ${state.correct} 題`,
      });
      return;
    }
    const w = round[state.idx];
    const choices = shuffle([w.zh, ...pickDistractors(w.zh)]);

    root.innerHTML = `
      <button class="back" id="back">← 中途離開</button>
      <h2>🇬🇧 → 🇹🇼 英翻中</h2>
      <p class="muted">第 ${state.idx + 1} / ${round.length} 題</p>
      <div class="en2zh-word">
        <div>${escapeHtml(w.en)}</div>
        <button class="speak-btn" id="speak">🔊 再聽一次</button>
      </div>
      <div class="en2zh-choices">
        ${choices.map(c => `<button class="choice" data-choice="${escapeHtml(c)}">${escapeHtml(c)}</button>`).join('')}
      </div>
    `;

    root.querySelector('#back').addEventListener('click', () => {
      onComplete({
        sessionCorrect: state.correct,
        totalQuestions: round.length,
        message: '中途離開',
        aborted: true,
      });
    });
    root.querySelector('#speak').addEventListener('click', () => speak(w.en));

    state.answered = false;
    root.querySelectorAll('.choice').forEach(el => {
      el.addEventListener('click', () => {
        if (state.answered) return;
        state.answered = true;
        const picked = el.dataset.choice;
        if (picked === w.zh) {
          el.classList.add('correct');
          state.correct++;
          setTimeout(() => { state.idx++; render(); }, 600);
        } else {
          el.classList.add('wrong');
          // 同時把正解標出來，讓孩子學到正確答案
          root.querySelectorAll('.choice').forEach(b => {
            if (b.dataset.choice === w.zh) b.classList.add('correct');
          });
          setTimeout(() => { state.idx++; render(); }, 1600);
        }
      });
    });

    // 自動唸題目（首次顯示時），略延遲讓畫面先 render
    setTimeout(() => speak(w.en), 200);
  }

  render();
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
