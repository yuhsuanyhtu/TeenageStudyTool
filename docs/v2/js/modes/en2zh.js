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
// v2.43（效能）：字典 API 不再擋出題。
//        - 例句優先用本地 Tatoeba 例句庫（sentenceMap，v2.41 起就載好了，零等待）
//        - 沒有例句庫的字才用字典 API，而且題目先出、例句回來再補（不再 await）
//        - 正解一律用主要意思（meanings[0] / zh），不再靠 API 例句的 POS 決定
//          （對還在打底的孩子，同一個字每次答案一致比較不混亂；A1/A2 例句庫本來就照主要意思選句）

import { speak, speakSpell } from '../tts.js';
import { fetchDictionary, prefetchDictionary, highlightSurface, ecdictPosToApi } from '../dictionary.js';
import { pickPreferLearningAvoid } from '../srs.js';

const QUESTIONS_PER_ROUND = 8;
const MIN_DISTRACTORS_NEEDED = 4;

export function startEn2ZhMode({ root, words, onComplete, allWords, seenSet, wordStats, roundSize, sentenceMap, paidSet }) {
  sentenceMap = sentenceMap || {};
  const usable = words.filter(w => w.en && w.zh);
  if (usable.length < MIN_DISTRACTORS_NEEDED) {
    onComplete({
      sessionCorrect: 0, totalQuestions: 0,
      message: '單字不足，無法出題', usedWords: [],
    });
    return;
  }
  roundSize = roundSize || QUESTIONS_PER_ROUND;

  // v2.24：用 SRS 策略挑題（v2.26 修：cap wrong 到 1/3 避免被弱點卡死）
  const round = (wordStats && Object.keys(wordStats).length > 0)
    ? pickPreferLearningAvoid(usable, Math.min(roundSize, usable.length), wordStats, paidSet)   // v2.45：先抽今天沒領過的
    : pickPreferUnseen(usable, Math.min(roundSize, usable.length), seenSet || new Set());

  // 累積每題對錯結果，最後 onComplete 傳回去讓 main.js 寫進 SRS
  const wordResults = [];
  const distractorPool = (allWords && allWords.length >= MIN_DISTRACTORS_NEEDED)
    ? allWords.filter(w => w.en && w.zh)
    : usable;

  // v2.23 prefetch：開場背景抓題目的字典（v2.43：改兩條線慢慢抓，有 timeout／熔斷，不會卡）
  prefetchDictionary(round);

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

  // v2.43：正解 = 主要意思（有 meanings 用第一義，否則 zh）
  function primaryZh(w) {
    if (Array.isArray(w.meanings) && w.meanings.length > 0 && w.meanings[0].zh) return w.meanings[0].zh;
    return w.zh;
  }

  // v2.43：本地例句庫（Tatoeba）隨機挑一句；沒有 → null
  function pickBankSentence(w) {
    const list = sentenceMap[w.en] || sentenceMap[String(w.en).toLowerCase()];
    if (!Array.isArray(list) || list.length === 0) return null;
    const pick = list[Math.floor(Math.random() * list.length)];
    if (!pick || !pick.t) return null;
    return { text: pick.t, surface: pick.m || '', zh: pick.zh || '' };
  }

  // 字典 API 例句：有 meanings 的字只接受「跟正解同詞性」的例句（避免例句是另一個意思誤導）
  function pickApiExample(w, dict, correctZh) {
    const examples = (dict && dict.examples) || [];
    if (examples.length === 0) return null;
    if (Array.isArray(w.meanings) && w.meanings.length > 0) {
      const m = w.meanings.find(x => x.zh === correctZh) || w.meanings[0];
      const apiPos = ecdictPosToApi(m.pos);
      const matched = examples.find(e => (e.pos || '').toLowerCase() === apiPos);
      return matched ? { text: matched.text, surface: '' } : null;
    }
    return { text: examples[0].text, surface: '' };
  }

  function sentenceCardHtml(example, w) {
    if (!example) return `<div class="sentence-card empty" id="sentence-card"></div>`;
    return `<div class="sentence-card" id="sentence-card">${highlightSurface(example.text, example.surface, w.en)}</div>`;
  }

  function renderQuestion() {
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

    // v2.43：題目立刻出。例句：本地例句庫優先；沒有就先留空，字典回來再補。
    const correctZh = primaryZh(w);
    const example = pickBankSentence(w);
    const choices = shuffle([correctZh, ...pickDistractors(correctZh, w)]);
    state.choices = choices;
    state.currentWord = w;
    state.correctZh = correctZh;
    state.example = example;
    state.dict = { examples: [], synonyms: [], antonyms: [] };
    state.selected = null;
    state.answered = false;

    root.innerHTML = `
      <button class="back" id="back">← 中途離開</button>
      <h2>🇬🇧 → 🇹🇼 英翻中</h2>
      <p class="muted">第 ${state.idx + 1} / ${round.length} 題</p>
      ${sentenceCardHtml(example, w)}
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

    // 字典資料（同反義字、沒例句庫時的例句）背景補上，不擋題目；3 秒沒回就算了
    fetchDictionary(w.en).then(dict => {
      if (state.currentWord !== w) return;   // 已經換題
      state.dict = dict || state.dict;
      if (!state.example) {
        const ex = pickApiExample(w, dict, correctZh);
        if (ex) {
          state.example = ex;
          const card = root.querySelector('#sentence-card');
          if (card && !state.answered) {
            card.className = 'sentence-card';
            card.innerHTML = highlightSurface(ex.text, '', w.en);
          }
        }
      }
    }).catch(() => {});
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
      ${sentenceCardHtml(state.example, w)}
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
