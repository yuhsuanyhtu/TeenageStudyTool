// modes/en2zh.js — 英文 → 中文 4 選 1
//
// 設計：
//   - 兩階段：先選（可改）→ 按「送出」才判定 → 顯示對錯後手動「下一題」
//     （孩子要求：不要點到就當最後答案）
//   - 自動先唸字母拼讀（v2.8 起改成按 🔤 才唸）→ 再唸整字
//   - 用 allWords 當干擾選項池，避免單字數少時抽不出 3 個
//   - 完全避開舊版「中翻英只接受唯一答案」的設計缺陷
//
// v2.22：題目上方加例句（Free Dictionary API），目標字加底線
// v2.23：多意思支援 — 字若有 `meanings` 陣列（CEFR 字庫），會根據例句的 POS
//        動態挑「對的中文意思」當正解。例：well 例句說 "I'm well now" → 正解=健康的；
//        例句說 "the well ran dry" → 正解=井。答案頁加「其他意思」expandable 區塊。
//        舊 textbook 字庫只有 zh、沒 meanings → 行為與 v2.22 相同。

import { speak, speakSpell } from '../tts.js';
import { fetchDictionary, highlightWord, ecdictPosToApi } from '../dictionary.js';
import { pickPreferLearning } from '../srs.js';

const QUESTIONS_PER_ROUND = 8;
const MIN_DISTRACTORS_NEEDED = 4;

export function startEn2ZhMode({ root, words, onComplete, allWords, seenSet, wordStats }) {
  const usable = words.filter(w => w.en && w.zh);
  if (usable.length < MIN_DISTRACTORS_NEEDED) {
    onComplete({
      sessionCorrect: 0, totalQuestions: 0,
      message: '單字不足，無法出題', usedWords: [],
    });
    return;
  }

  // v2.24：用 SRS 策略挑題（答錯過 > 沒見過 > 學習中 > 已會回測）
  //        wordStats 沒給或空 → 退回沒見過優先（行為等同 v2.23 之前）
  const round = (wordStats && Object.keys(wordStats).length > 0)
    ? pickPreferLearning(usable, Math.min(QUESTIONS_PER_ROUND, usable.length), wordStats)
    : pickPreferUnseen(usable, Math.min(QUESTIONS_PER_ROUND, usable.length), seenSet || new Set());

  // 累積每題對錯結果，最後 onComplete 傳回去讓 main.js 寫進 SRS
  const wordResults = [];
  const distractorPool = (allWords && allWords.length >= MIN_DISTRACTORS_NEEDED)
    ? allWords.filter(w => w.en && w.zh)
    : usable;

  // v2.23 prefetch：開場時一次背景抓所有題目的字典，後續 renderQuestion cache hit
  Promise.all(round.map(w => fetchDictionary(w.en).catch(() => null)));

  const state = { idx: 0, correct: 0, selected: null, answered: false };

  // pickDistractors：避免把同一字的「其他意思」當干擾（會誤導）
  function pickDistractors(correctZh, currentWord) {
    const excludedZh = new Set([correctZh]);
    if (Array.isArray(currentWord.meanings)) {
      for (const m of currentWord.meanings) excludedZh.add(m.zh);
    }
    const pool = distractorPool.filter(w => !excludedZh.has(w.zh));
    return shuffle(pool).slice(0, 3).map(w => w.zh);
  }

  // 根據 API 抓到的例句，挑「對的」中文意思當正解
  // 沒例句 / 沒 meanings → 退回 w.zh（=主要意思）
  function decideCorrect(w, dict) {
    let correctMeaning = null;
    let example = null;
    if (Array.isArray(w.meanings) && w.meanings.length > 0 && dict.examples.length > 0) {
      for (const m of w.meanings) {
        const apiPos = ecdictPosToApi(m.pos);
        const matched = dict.examples.find(e => (e.pos || '').toLowerCase() === apiPos);
        if (matched) {
          correctMeaning = m;
          example = matched;
          break;
        }
      }
    }
    if (!correctMeaning) {
      correctMeaning = { pos: '', zh: w.zh };
      // 沒 POS 配對成功 → 退回任一例句（前提：textbook 模式沒 meanings 時可顯示任何例句）
      if (!Array.isArray(w.meanings) && dict.examples.length > 0) {
        example = dict.examples[0];
      }
    }
    return { correctZh: correctMeaning.zh, correctPos: correctMeaning.pos, example };
  }

  async function renderQuestion() {
    if (state.idx >= round.length) {
      onComplete({
        sessionCorrect: state.correct,
        totalQuestions: round.length,
        message: `${round.length} 題答對 ${state.correct} 題`,
        usedWords: round,
        wordResults,                 // v2.24：傳給 main.js 寫 SRS
      });
      return;
    }
    const w = round[state.idx];

    // 先顯示骨架，等字典回來再填細節（cache hit 通常 <5ms 不會閃）
    root.innerHTML = `
      <button class="back" id="back">← 中途離開</button>
      <h2>🇬🇧 → 🇹🇼 英翻中</h2>
      <p class="muted">第 ${state.idx + 1} / ${round.length} 題</p>
      <p class="muted center" id="loading-hint">準備題目中…</p>
    `;
    root.querySelector('#back').addEventListener('click', () => abortRound());

    const dict = await fetchDictionary(w.en).catch(() => ({ examples: [], synonyms: [], antonyms: [] }));
    // 若使用者中途離開，state.idx 會被 onComplete 帶走 → 不再 render 後續
    if (state.idx >= round.length || round[state.idx] !== w) return;

    const { correctZh, example } = decideCorrect(w, dict);
    const choices = shuffle([correctZh, ...pickDistractors(correctZh, w)]);
    state.choices = choices;
    state.currentWord = w;
    state.correctZh = correctZh;
    state.example = example;
    state.dict = dict;
    state.selected = null;
    state.answered = false;

    root.innerHTML = `
      <button class="back" id="back">← 中途離開</button>
      <h2>🇬🇧 → 🇹🇼 英翻中</h2>
      <p class="muted">第 ${state.idx + 1} / ${round.length} 題</p>
      ${example
        ? `<div class="sentence-card">${highlightWord(example.text, w.en)}</div>`
        : `<div class="sentence-card empty"></div>`}
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
      <button id="submit">送出答案</button>
    `;
    // 預抓下一題（fire-and-forget，cache）
    const nextW = round[state.idx + 1];
    if (nextW) fetchDictionary(nextW.en).catch(() => null);

    root.querySelector('#back').addEventListener('click', () => abortRound());
    root.querySelector('#speak').addEventListener('click', () => speak(w.en));
    root.querySelector('#spell').addEventListener('click', () => speakSpell(w.en));
    root.querySelectorAll('.choice').forEach(el => {
      el.addEventListener('click', () => {
        if (state.answered) return;
        root.querySelectorAll('.choice').forEach(b => b.classList.remove('selected'));
        el.classList.add('selected');
        state.selected = el.dataset.choice;
      });
    });
    root.querySelector('#submit').addEventListener('click', handleSubmit);

    setTimeout(() => speak(w.en), 200);
  }

  function abortRound() {
    const idx = state.idx;
    state.idx = round.length;
    onComplete({
      sessionCorrect: state.correct,
      totalQuestions: round.length,
      message: '中途離開',
      aborted: true,
      usedWords: round.slice(0, idx + 1),
      wordResults,                   // v2.24：中途離開也要寫已答的結果到 SRS
    });
  }

  function handleSubmit() {
    if (state.answered || state.selected === null) return;
    state.answered = true;
    const w = state.currentWord;
    const isCorrect = state.selected === state.correctZh;
    if (isCorrect) state.correct++;
    // v2.24：記錄每題結果讓 SRS 學習
    wordResults.push({ en: w.en, correct: isCorrect });
    renderResult(w, isCorrect);
  }

  function renderResult(w, isCorrect) {
    const picked = state.selected;
    const otherMeanings = (w.meanings || []).filter(m => m.zh !== state.correctZh);
    const syns = state.dict.synonyms || [];
    const ants = state.dict.antonyms || [];

    root.innerHTML = `
      <button class="back" id="back">← 中途離開</button>
      <h2>🇬🇧 → 🇹🇼 英翻中</h2>
      <p class="muted">第 ${state.idx + 1} / ${round.length} 題　·　${isCorrect ? '答對了' : '看答案'}</p>
      ${state.example
        ? `<div class="sentence-card">${highlightWord(state.example.text, w.en)}</div>`
        : `<div class="sentence-card empty"></div>`}
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
          if (c === state.correctZh) cls.push('correct');
          else if (c === picked && !isCorrect) cls.push('wrong');
          return `<button class="${cls.join(' ')}" disabled>${escapeHtml(c)}</button>`;
        }).join('')}
      </div>
      ${renderExtraInfo(otherMeanings, syns, ants)}
      <button id="next">${state.idx === round.length - 1 ? '看結果' : '下一題 →'}</button>
    `;
    root.querySelector('#back').addEventListener('click', () => abortRound());
    root.querySelector('#speak').addEventListener('click', () => speak(w.en));
    root.querySelector('#spell').addEventListener('click', () => speakSpell(w.en));
    root.querySelector('#next').addEventListener('click', () => {
      state.idx++;
      renderQuestion();
    });
    speak(w.en);
  }

  // v2.23：答案頁底下的「其他意思 / 同／反義字」小卡
  function renderExtraInfo(otherMeanings, syns, ants) {
    const hasOther = otherMeanings.length > 0;
    const hasSyn = syns.length > 0;
    const hasAnt = ants.length > 0;
    if (!hasOther && !hasSyn && !hasAnt) return '';
    return `
      <details class="extra-info">
        <summary>📖 順便看看其他意思 / 同反義字</summary>
        ${hasOther ? `
          <div class="extra-section">
            <div class="extra-label">這個字其他意思：</div>
            ${otherMeanings.map(m => `<div class="extra-meaning"><b>${escapeHtml(m.pos)}.</b> ${escapeHtml(m.zh)}</div>`).join('')}
          </div>
        ` : ''}
        ${hasSyn ? `
          <div class="extra-section">
            <div class="extra-label">近義字：</div>
            <div class="extra-words">${syns.map(s => `<span class="extra-word">${escapeHtml(s)}</span>`).join('')}</div>
          </div>
        ` : ''}
        ${hasAnt ? `
          <div class="extra-section">
            <div class="extra-label">反義字：</div>
            <div class="extra-words">${ants.map(s => `<span class="extra-word">${escapeHtml(s)}</span>`).join('')}</div>
          </div>
        ` : ''}
      </details>
    `;
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
