// modes/vocab.js — 📝 文意字彙：例句挖空，4 選 1 選英文字（v2.40）
//
// 老師建議的段考題型（2026-09-05 家長轉達）：
//   看句子的「文意」選出正確的英文字，比純背翻譯更接近考卷。
//
// 題目句子來源（優先順序）：
//   1. sentenceMap — data/sentences-*.json 的原創例句庫（二上 283 句全覆蓋）。
//      句中 ⟨…⟩ 標記挖空目標（可多段，如 not... at all）。
//   2. Free Dictionary API 例句（dictionary.js，其他字庫的字退回這裡）
//   3. 都沒有 → 顯示中文意思當提示（仍是 4 選 1 選英文字）
//
// 設計沿用 en2zh：先選（可改）→ 送出才判定 → 手動下一題；SRS 出題與記錄；
// 焦慮緩衝：答錯暖橘不紅、無音效驚嚇；作答前不唸目標字（唸了等於送答案）。
//
// 干擾選項防呆：
//   - 排除「英文字出現在句子裡」的字（答案早就寫在題目上）
//   - 排除中文意思重疊的字（如 motorcycle 機車；摩托車 vs scooter 機車 → 兩個都對，不公平）
//   - 片語目標優先配片語干擾、單字配單字（版面與難度都比較像考卷）

import { speak } from '../tts.js';
import { fetchDictionary } from '../dictionary.js';
import { pickPreferLearning } from '../srs.js';

const MIN_WORDS_NEEDED = 4;
const QUESTIONS_PER_ROUND = 8;

export function startVocabMode({ root, words, onComplete, allWords, seenSet, wordStats, roundSize, sentenceMap }) {
  const usable = words.filter(w => w.en && w.zh);
  if (usable.length < MIN_WORDS_NEEDED) {
    onComplete({ sessionCorrect: 0, totalQuestions: 0, message: '單字不足，無法出題', usedWords: [] });
    return;
  }
  roundSize = roundSize || QUESTIONS_PER_ROUND;
  sentenceMap = sentenceMap || {};

  const round = (wordStats && Object.keys(wordStats).length > 0)
    ? pickPreferLearning(usable, Math.min(roundSize, usable.length), wordStats)
    : pickPreferUnseen(usable, Math.min(roundSize, usable.length), seenSet || new Set());

  const wordResults = [];
  const pool = (allWords && allWords.length >= MIN_WORDS_NEEDED)
    ? allWords.filter(w => w.en && w.zh)
    : usable;

  const state = { idx: 0, correct: 0, selected: null, answered: false };

  // ---- 題目句子 ----
  // 回傳 { html, plainLower, kind }：
  //   html: 已把目標挖空成底線的句子 HTML（挖空處 class=vocab-blank）
  //   revealHtml: 目標填回、加底線色的句子 HTML
  //   kind: 'bank' | 'api' | 'zh-hint'
  function buildFromBank(w) {
    const raw = sentenceMap[w.en];
    if (!raw || raw.indexOf('⟨') === -1) return null;
    let html = '';
    let revealHtml = '';
    let plain = '';
    const parts = raw.split(/(⟨[^⟩]*⟩)/);
    for (const p of parts) {
      if (p.startsWith('⟨')) {
        const surface = p.slice(1, -1);
        html += `<span class="vocab-blank">＿＿＿＿</span>`;
        revealHtml += `<span class="sentence-target">${escapeHtml(surface)}</span>`;
        plain += ' ';           // 挖空處不洩漏目標字
      } else {
        html += escapeHtml(p);
        revealHtml += escapeHtml(p);
        plain += p;
      }
    }
    return { html, revealHtml, plainLower: plain.toLowerCase(), kind: 'bank' };
  }

  function buildFromApi(w, dict) {
    const ex = (dict.examples || []).find(e => e.text);
    if (!ex) return null;
    const base = firstWordOf(w.en);
    const re = new RegExp(`\\b${escapeRegExp(base)}\\w{0,3}\\b`, 'gi');
    if (!re.test(ex.text)) return null;
    const html = escapeHtml(ex.text).replace(
      new RegExp(`\\b(${escapeRegExp(base)}\\w{0,3})\\b`, 'gi'),
      '<span class="vocab-blank">＿＿＿＿</span>'
    );
    const revealHtml = escapeHtml(ex.text).replace(
      new RegExp(`\\b(${escapeRegExp(base)}\\w{0,3})\\b`, 'gi'),
      '<span class="sentence-target">$1</span>'
    );
    const plainLower = ex.text.toLowerCase().replace(re, ' ');
    return { html, revealHtml, plainLower, kind: 'api' };
  }

  function buildZhHint(w) {
    const zhClean = String(w.zh).replace(/（[^）]*）/g, '').trim();
    const html = `中文意思：<b>${escapeHtml(zhClean)}</b>`;
    return { html, revealHtml: html, plainLower: '', kind: 'zh-hint' };
  }

  // ---- 干擾選項 ----
  function zhSegments(zh) {
    return String(zh).replace(/（[^）]*）/g, '').split(/[；、，,/]/).map(s => s.trim()).filter(Boolean);
  }
  function zhOverlaps(zhA, zhB) {
    const a = zhSegments(zhA), b = zhSegments(zhB);
    for (const x of a) for (const y of b) {
      if (!x || !y) continue;
      if (x === y || x.includes(y) || y.includes(x)) return true;
    }
    return false;
  }
  function pickDistractors(w, plainLower) {
    const isPhrase = w.en.includes(' ');
    const ok = pool.filter(c => {
      if (c.en === w.en) return false;
      if (zhOverlaps(c.zh, w.zh)) return false;
      // 選項的英文字出現在句子裡 → 排除（答案寫在題目上不公平，
      //   也避免「句中已有 pants」時 pants 當干擾）
      const base = firstWordOf(c.en);
      if (plainLower && new RegExp(`\\b${escapeRegExp(base)}`, 'i').test(plainLower)) return false;
      return true;
    });
    const same = shuffle(ok.filter(c => c.en.includes(' ') === isPhrase));
    const rest = shuffle(ok.filter(c => c.en.includes(' ') !== isPhrase));
    return [...same, ...rest].slice(0, 3).map(c => c.en);
  }

  async function renderQuestion() {
    if (state.idx >= round.length) {
      onComplete({
        sessionCorrect: state.correct,
        totalQuestions: round.length,
        message: `${round.length} 題答對 ${state.correct} 題`,
        usedWords: round,
        wordResults,
      });
      return;
    }
    const w = round[state.idx];

    let q = buildFromBank(w);
    if (!q) {
      root.innerHTML = `
        <button class="back" id="back">← 中途離開</button>
        <h2>📝 文意字彙</h2>
        <p class="muted">第 ${state.idx + 1} / ${round.length} 題</p>
        <p class="muted center">準備題目中…</p>
      `;
      root.querySelector('#back').addEventListener('click', () => abortRound());
      const dict = await fetchDictionary(w.en).catch(() => ({ examples: [] }));
      if (state.idx >= round.length || round[state.idx] !== w) return;
      q = buildFromApi(w, dict) || buildZhHint(w);
    }

    const choices = shuffle([w.en, ...pickDistractors(w, q.plainLower)]);
    state.q = q;
    state.choices = choices;
    state.currentWord = w;
    state.selected = null;
    state.answered = false;

    root.innerHTML = `
      <button class="back" id="back">← 中途離開</button>
      <h2>📝 文意字彙</h2>
      <p class="muted">第 ${state.idx + 1} / ${round.length} 題　·　選出最適合放進句子的字</p>
      <div class="sentence-card vocab-question">${q.html}</div>
      <div class="en2zh-choices">
        ${choices.map(c => `<button class="choice" data-choice="${escapeHtml(c)}">${escapeHtml(c)}</button>`).join('')}
      </div>
      <button id="submit">送出答案</button>
    `;
    root.querySelector('#back').addEventListener('click', () => abortRound());
    root.querySelectorAll('.choice').forEach(el => {
      el.addEventListener('click', () => {
        if (state.answered) return;
        root.querySelectorAll('.choice').forEach(b => b.classList.remove('selected'));
        el.classList.add('selected');
        state.selected = el.dataset.choice;
      });
    });
    root.querySelector('#submit').addEventListener('click', handleSubmit);
    // 注意：作答前不自動唸目標字（唸出來等於直接送答案）
  }

  function handleSubmit() {
    if (state.answered || state.selected === null) return;
    state.answered = true;
    const w = state.currentWord;
    const isCorrect = state.selected === w.en;
    if (isCorrect) state.correct++;
    wordResults.push({ en: w.en, correct: isCorrect });
    renderResult(w, isCorrect);
  }

  function renderResult(w, isCorrect) {
    const picked = state.selected;
    root.innerHTML = `
      <button class="back" id="back">← 中途離開</button>
      <h2>📝 文意字彙</h2>
      <p class="muted">第 ${state.idx + 1} / ${round.length} 題　·　${isCorrect ? '答對了' : '看答案'}</p>
      <div class="sentence-card">${state.q.revealHtml}</div>
      <div class="en2zh-word" style="font-size:26px;">
        <div>${escapeHtml(w.en)}</div>
        <div class="muted" style="font-size:16px; font-weight:400; margin-top:6px;">${escapeHtml(w.zh)}</div>
        <div class="speak-row">
          <button class="speak-btn" id="speak">🔊 聽發音</button>
        </div>
      </div>
      <div class="en2zh-choices">
        ${state.choices.map(c => {
          const cls = ['choice'];
          if (c === w.en) cls.push('correct');
          else if (c === picked && !isCorrect) cls.push('wrong');
          return `<button class="${cls.join(' ')}" disabled>${escapeHtml(c)}</button>`;
        }).join('')}
      </div>
      <button id="next">${state.idx === round.length - 1 ? '看結果' : '下一題 →'}</button>
    `;
    root.querySelector('#back').addEventListener('click', () => abortRound());
    root.querySelector('#speak').addEventListener('click', () => speak(w.en));
    root.querySelector('#next').addEventListener('click', () => {
      state.idx++;
      renderQuestion();
    });
    speak(w.en);
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
      wordResults,
    });
  }

  renderQuestion();
}

function firstWordOf(en) {
  const m = String(en).toLowerCase().match(/[a-z]+(?:'[a-z]+)?/);
  return m ? m[0] : String(en).toLowerCase();
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

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}
