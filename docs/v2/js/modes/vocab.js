// modes/vocab.js — 📝 文意字彙：例句挖空，4 選 1 選英文字（v2.40，v2.41 全面改版）
//
// v2.41（家長 2026-09-05 要求）：
//   1. 例句不再原創 → 全部取自公共財／開放語料 Tatoeba（CC BY 2.0 FR，附句 id 可溯源），
//      每字最多 3 句、每次隨機抽一句 →「同一個字多次遇到不同句子」＝多個機會學習。
//   2. 答錯時完整解釋：你選的字是什麼意思、為什麼放不進這句、正解是什麼意思，
//      並提醒「答錯的字之後會優先再出現」（SRS 會自動安排重練）。
//   3. 干擾選項「向下相容」混入 A1 基礎字（extraPool）：4 個選項＝正解＋同單元 2 字＋A1 1 字，
//      題目更像考卷（選項不會全是同課的字），也順便複習基礎字。
//
// 題目句子來源（優先順序）：
//   1. sentenceMap[en] = [{t, zh, m, id}]（data/sentences-*.json，Tatoeba 語料）
//      t=句子、zh=該句中文翻譯（也來自 Tatoeba，繁化）、m=句中要挖空的字面（含變化形）
//   2. Free Dictionary API 例句（Wiktionary 系，CC 授權）
//   3. 都沒有 → 顯示中文意思當提示（仍是 4 選 1）
//
// 沿用設計：先選後送出、SRS 出題與記錄、答錯暖橘不紅、作答前不唸目標字。
// 干擾防呆：中文意思重疊的字、英文字已出現在句中的字，都不能當選項。

import { speak } from '../tts.js';
import { fetchDictionary } from '../dictionary.js';
import { pickPreferLearning } from '../srs.js';

const MIN_WORDS_NEEDED = 4;
const QUESTIONS_PER_ROUND = 8;

export function startVocabMode({ root, words, onComplete, allWords, seenSet, wordStats, roundSize, sentenceMap, extraPool }) {
  const usable = words.filter(w => w.en && w.zh);
  if (usable.length < MIN_WORDS_NEEDED) {
    onComplete({ sessionCorrect: 0, totalQuestions: 0, message: '單字不足，無法出題', usedWords: [] });
    return;
  }
  roundSize = roundSize || QUESTIONS_PER_ROUND;
  sentenceMap = sentenceMap || {};
  extraPool = (extraPool || []).filter(w => w.en && w.zh);

  const round = (wordStats && Object.keys(wordStats).length > 0)
    ? pickPreferLearning(usable, Math.min(roundSize, usable.length), wordStats)
    : pickPreferUnseen(usable, Math.min(roundSize, usable.length), seenSet || new Set());

  const wordResults = [];
  const unitPool = (allWords && allWords.length >= MIN_WORDS_NEEDED)
    ? allWords.filter(w => w.en && w.zh)
    : usable;

  const state = { idx: 0, correct: 0, selected: null, answered: false };

  // ---- 題目句子（回傳 {html, revealHtml, plainLower, zh, kind}）----
  function buildFromBank(w) {
    const list = sentenceMap[w.en];
    if (!Array.isArray(list) || list.length === 0) return null;
    const pick = list[Math.floor(Math.random() * list.length)];
    if (!pick || !pick.t || !pick.m) return null;
    const esc = escapeHtml(pick.t);
    const escM = escapeHtml(pick.m);
    const re = new RegExp(escapeRegExp(escM), 'gi');
    if (!re.test(esc)) return null;
    const html = esc.replace(re, '<span class="vocab-blank">＿＿＿＿</span>');
    const revealHtml = esc.replace(re, m => `<span class="sentence-target">${m}</span>`);
    const plainLower = pick.t.toLowerCase().split(pick.m.toLowerCase()).join(' ');
    return { html, revealHtml, plainLower, plain: pick.t, zh: pick.zh || null, kind: 'bank' };
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
    return { html, revealHtml, plainLower, plain: ex.text, zh: null, kind: 'api' };
  }

  function buildZhHint(w) {
    const zhClean = String(w.zh).replace(/（[^）]*）/g, '').trim();
    const html = `中文意思：<b>${escapeHtml(zhClean)}</b>`;
    return { html, revealHtml: html, plainLower: '', zh: null, kind: 'zh-hint' };
  }

  // ---- 干擾選項（回傳 [{en, zh}]）----
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
  function usableDistractor(c, w, plainLower, chosen) {
    if (c.en === w.en) return false;
    if (chosen.some(x => x.en === c.en)) return false;
    if (zhOverlaps(c.zh, w.zh)) return false;
    const base = firstWordOf(c.en);
    if (plainLower && new RegExp(`\\b${escapeRegExp(base)}`, 'i').test(plainLower)) return false;
    return true;
  }
  function pickDistractors(w, plainLower) {
    const isPhrase = w.en.includes(' ');
    const chosen = [];
    // 同單元優先（同型優先：片語配片語、單字配單字）
    const unitOk = shuffle(unitPool).sort((a, b) =>
      (a.en.includes(' ') === isPhrase ? -1 : 1) - (b.en.includes(' ') === isPhrase ? -1 : 1));
    for (const c of unitOk) {
      if (chosen.length >= 2) break;
      if (usableDistractor(c, w, plainLower, chosen)) chosen.push({ en: c.en, zh: c.zh });
    }
    // v2.41：第 3 個選項優先從 A1 基礎字池抽（向下相容、複習基礎字）
    for (const c of shuffle(extraPool)) {
      if (chosen.length >= 3) break;
      if (usableDistractor(c, w, plainLower, chosen)) chosen.push({ en: c.en, zh: c.zh, a1: true });
    }
    // A1 池不夠（或全被防呆排除）→ 回頭用同單元補滿
    for (const c of unitOk) {
      if (chosen.length >= 3) break;
      if (usableDistractor(c, w, plainLower, chosen)) chosen.push({ en: c.en, zh: c.zh });
    }
    return chosen;
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

    const choices = shuffle([{ en: w.en, zh: w.zh, correct: true }, ...pickDistractors(w, q.plainLower)]);
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
      ${q.zh ? `<p class="muted small center" style="margin:-8px 0 12px;">💬 整句意思：${escapeHtml(q.zh)}</p>` : ''}
      <div class="en2zh-choices">
        ${choices.map((c, i) => `<button class="choice" data-i="${i}">${escapeHtml(c.en)}</button>`).join('')}
      </div>
      <button id="submit">送出答案</button>
    `;
    root.querySelector('#back').addEventListener('click', () => abortRound());
    root.querySelectorAll('.choice').forEach(el => {
      el.addEventListener('click', () => {
        if (state.answered) return;
        root.querySelectorAll('.choice').forEach(b => b.classList.remove('selected'));
        el.classList.add('selected');
        state.selected = Number(el.dataset.i);
      });
    });
    root.querySelector('#submit').addEventListener('click', handleSubmit);
    // 作答前不自動唸目標字（唸出來等於直接送答案）
  }

  function handleSubmit() {
    if (state.answered || state.selected === null) return;
    state.answered = true;
    const w = state.currentWord;
    const picked = state.choices[state.selected];
    const isCorrect = !!picked.correct;
    if (isCorrect) state.correct++;
    wordResults.push({ en: w.en, correct: isCorrect });
    renderResult(w, picked, isCorrect);
  }

  // v2.41：答錯的完整解釋 —— 你選的字是什麼意思、為什麼不合、之後還有機會再練
  function explainWrong(w, picked) {
    const pickedZh = zhSegments(picked.zh).slice(0, 2).join('；') || picked.zh;
    const targetZh = zhSegments(w.zh).slice(0, 2).join('；') || w.zh;
    return `
      <div class="card vocab-explain">
        <p>🔍 <b>你選的：${escapeHtml(picked.en)}</b> ＝「${escapeHtml(pickedZh)}」${picked.a1 ? '<span class="muted small">（基礎字）</span>' : ''}</p>
        <p class="muted small">把「${escapeHtml(pickedZh)}」放進這句的意思裡讀讀看——句子就不通了，所以不是它。</p>
        <p style="margin-top:8px;">✅ <b>正確：${escapeHtml(w.en)}</b> ＝「${escapeHtml(targetZh)}」，放進句子剛剛好。</p>
        <p class="muted small" style="margin-top:8px;">🌱 別擔心，這個字之後會<b>優先再出現</b>，多遇到幾句不同的例句就會了。</p>
      </div>
    `;
  }

  function renderResult(w, picked, isCorrect) {
    root.innerHTML = `
      <button class="back" id="back">← 中途離開</button>
      <h2>📝 文意字彙</h2>
      <p class="muted">第 ${state.idx + 1} / ${round.length} 題　·　${isCorrect ? '答對了' : '看解釋'}</p>
      <div class="sentence-card">${state.q.revealHtml}</div>
      ${state.q.zh ? `<p class="muted small center" style="margin:-8px 0 10px;">整句意思：${escapeHtml(state.q.zh)}</p>` : ''}
      <div class="en2zh-word" style="font-size:26px;">
        <div>${escapeHtml(w.en)}</div>
        <div class="muted" style="font-size:16px; font-weight:400; margin-top:6px;">${escapeHtml(w.zh)}</div>
        <div class="speak-row">
          ${state.q.plain ? `<button class="speak-btn" id="speak-sent">🔊 聽整句</button>` : ''}
          <button class="speak-btn" id="speak">🔊 ${state.q.plain ? '聽單字' : '聽發音'}</button>
        </div>
      </div>
      <div class="en2zh-choices">
        ${state.choices.map(c => {
          const cls = ['choice'];
          if (c.correct) cls.push('correct');
          else if (c === picked && !isCorrect) cls.push('wrong');
          return `<button class="${cls.join(' ')}" disabled>${escapeHtml(c.en)}${(!isCorrect || c.correct) ? ` <span class="choice-zh">${escapeHtml(zhSegments(c.zh).slice(0, 1).join('') || '')}</span>` : ''}</button>`;
        }).join('')}
      </div>
      ${!isCorrect ? explainWrong(w, picked) : ''}
      <button id="next">${state.idx === round.length - 1 ? '看結果' : '下一題 →'}</button>
    `;
    root.querySelector('#back').addEventListener('click', () => abortRound());
    root.querySelector('#speak').addEventListener('click', () => speak(w.en));
    const sentBtn = root.querySelector('#speak-sent');
    if (sentBtn) sentBtn.addEventListener('click', () => speak(state.q.plain));
    root.querySelector('#next').addEventListener('click', () => {
      state.idx++;
      renderQuestion();
    });
    // v2.43.2：謙恩要求——揭曉後唸整句（有例句才唸整句，沒例句退回唸單字）
    speak(state.q.plain || w.en);
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
