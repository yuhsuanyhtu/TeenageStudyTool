// modes/en2zh.js — 英文 → 中文 4 選 1
//
// 設計：
//   - 兩階段：先選（可改） → 按「送出」才判定 → 顯示對錯後手動「下一題」
//     （孩子要求：不要點到就當最後答案）
//   - 自動先唸字母拼讀（A-P-P-L-E）→ 再唸整字（apple）
//   - 用 allWords 當干擾選項池，避免單字數少時抽不出 3 個
//   - 完全避開舊版「中翻英只接受唯一答案」的設計缺陷

import { speak, speakEnThenZh, speakSpell } from '../tts.js';

const QUESTIONS_PER_ROUND = 8;
const MIN_DISTRACTORS_NEEDED = 4;  // 1 正解 + 3 干擾

export function startEn2ZhMode({ root, words, onComplete, allWords, seenSet }) {
  const usable = words.filter(w => w.en && w.zh);
  if (usable.length < MIN_DISTRACTORS_NEEDED) {
    onComplete({
      sessionCorrect: 0,
      totalQuestions: 0,
      message: '單字不足，無法出題',
      usedWords: [],
    });
    return;
  }

  // 優先挑「今天還沒練過」的字
  const round = pickPreferUnseen(usable, Math.min(QUESTIONS_PER_ROUND, usable.length), seenSet || new Set());
  const distractorPool = (allWords && allWords.length >= MIN_DISTRACTORS_NEEDED)
    ? allWords.filter(w => w.en && w.zh)
    : usable;

  const state = { idx: 0, correct: 0, selected: null, answered: false };

  function pickDistractors(correctZh) {
    const pool = distractorPool.filter(w => w.zh !== correctZh);
    return shuffle(pool).slice(0, 3).map(w => w.zh);
  }

  function renderQuestion() {
    if (state.idx >= round.length) {
      onComplete({
        sessionCorrect: state.correct,
        totalQuestions: round.length,
        message: `${round.length} 題答對 ${state.correct} 題`,
        usedWords: round,
      });
      return;
    }
    const w = round[state.idx];
    const choices = shuffle([w.zh, ...pickDistractors(w.zh)]);
    state.choices = choices;
    state.currentWord = w;
    state.selected = null;
    state.answered = false;

    root.innerHTML = `
      <button class="back" id="back">← 中途離開</button>
      <h2>🇬🇧 → 🇹🇼 英翻中</h2>
      <p class="muted">第 ${state.idx + 1} / ${round.length} 題</p>
      <div class="en2zh-word">
        <div>${escapeHtml(w.en)}</div>
        <div class="speak-row">
          <button class="speak-btn" id="speak">🔊 再聽一次</button>
          <button class="speak-btn" id="spell">🔤 聽拼字</button>
        </div>
      </div>
      <div class="en2zh-choices">
        ${choices.map(c => `<button class="choice" data-choice="${escapeHtml(c)}">${escapeHtml(c)}</button>`).join('')}
      </div>
      <button id="submit" disabled>送出答案</button>
    `;

    root.querySelector('#back').addEventListener('click', () => {
      onComplete({
        sessionCorrect: state.correct,
        totalQuestions: round.length,
        message: '中途離開',
        aborted: true,
        usedWords: round,
      });
    });
    root.querySelector('#speak').addEventListener('click', () => speak(w.en));
    root.querySelector('#spell').addEventListener('click', () => speakSpell(w.en));

    const submitBtn = root.querySelector('#submit');
    root.querySelectorAll('.choice').forEach(el => {
      el.addEventListener('click', () => {
        if (state.answered) return;
        // 取消其他選項的 selected
        root.querySelectorAll('.choice').forEach(b => b.classList.remove('selected'));
        // 標目前選的
        el.classList.add('selected');
        state.selected = el.dataset.choice;
        submitBtn.disabled = false;
      });
    });
    submitBtn.addEventListener('click', handleSubmit);

    // 自動唸：只唸整字（拼字按 🔤 按鈕觸發，v2.8 起 default 不拼字）
    setTimeout(() => speak(w.en), 200);
  }

  function handleSubmit() {
    if (state.answered || state.selected === null) return;
    state.answered = true;
    const w = state.currentWord;
    const isCorrect = state.selected === w.zh;
    if (isCorrect) state.correct++;
    // v2.13：用全 re-render（而非 outerHTML patch），避免「下一題要按兩次才動」bug
    renderResult(w, isCorrect);
  }

  // v2.13：答案揭曉頁，全 re-render 而非局部 patch
  function renderResult(w, isCorrect) {
    const picked = state.selected;
    root.innerHTML = `
      <button class="back" id="back">← 中途離開</button>
      <h2>🇬🇧 → 🇹🇼 英翻中</h2>
      <p class="muted">第 ${state.idx + 1} / ${round.length} 題　·　${isCorrect ? '答對了' : '看答案'}</p>
      <div class="en2zh-word">
        <div>${escapeHtml(w.en)}</div>
        <div class="speak-row">
          <button class="speak-btn" id="speak">🔊 再聽一次</button>
          <button class="speak-btn" id="spell">🔤 聽拼字</button>
        </div>
      </div>
      <div class="en2zh-choices">
        ${state.choices.map(c => {
          const cls = ['choice'];
          if (c === w.zh) cls.push('correct');
          else if (c === picked && !isCorrect) cls.push('wrong');
          return `<button class="${cls.join(' ')}" disabled>${escapeHtml(c)}</button>`;
        }).join('')}
      </div>
      <button id="next">${state.idx === round.length - 1 ? '看結果' : '下一題 →'}</button>
    `;
    root.querySelector('#back').addEventListener('click', () => {
      onComplete({
        sessionCorrect: state.correct,
        totalQuestions: round.length,
        message: '中途離開',
        aborted: true,
        usedWords: round,
      });
    });
    root.querySelector('#speak').addEventListener('click', () => speak(w.en));
    root.querySelector('#spell').addEventListener('click', () => speakSpell(w.en));
    root.querySelector('#next').addEventListener('click', () => {
      state.idx++;
      renderQuestion();
    });
    // 答對／答錯都唸一次「英→中」雙語，強化記憶
    speakEnThenZh(w.en, w.zh);
  }

  renderQuestion();
}

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
