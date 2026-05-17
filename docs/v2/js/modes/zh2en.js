// modes/zh2en.js — 中翻英拼字
//
// 解決舊版「中翻英只接受唯一答案」的核心痛點：
//   先建反向 map: cleanZh → [所有對應的 word object]
//   送出時，只要使用者輸入的字串符合「該 zh 對應到的任一 en」就算對。
//   例如 every / each 都是「每一」→ 兩個都接受。
//
// 另外處理：
//   - 大小寫無視
//   - 多空白合併
//   - 結尾標點 .!? 忽略
//   - 帶括號的單字（如 "pencil case (= pencil box)"）允許括號內外兩種寫法
//   - "year(s) old" 允許 year old / years old
//   - v2.18：zh 含「(= 英文)」註記時，顯示去掉、判答時把英文當 alternative
//     例：zh="給你。 (= Here you go.)" → 顯示「給你。」，Here you are / Here you go 都接受

import { speak, speakSpell } from '../tts.js';

const QUESTIONS_PER_ROUND = 8;

// v2.18：去掉 zh 裡的「(= 英文)」/「（= 英文）」註記（半形+全形都認），純中文題目顯示用
function cleanZhForDisplay(zh) {
  return String(zh || '').replace(/\s*[(（]=\s*[^)）]+[)）]/g, '').replace(/\s+/g, ' ').trim();
}

// v2.18：抽出 zh 裡的「(= xxx)」內的英文（半形+全形都認），當作可接受的替代答案
function extractZhAlts(zh) {
  const matches = [...String(zh || '').matchAll(/[(（]=\s*([^)）]+)[)）]/g)];
  return matches.map(m => m[1].trim()).filter(Boolean);
}

export function startZh2EnMode({ root, words, onComplete, seenSet }) {
  // 建反向 map: cleanZh（去除「(= xxx)」註記後）→ 所有對應的 word
  // 這樣不同的 zh「給你。」「給你。 (= Here you go.)」會合併到同一題
  const zhToWords = new Map();
  for (const w of words) {
    if (!w.zh || !w.en) continue;
    const clean = cleanZhForDisplay(w.zh);
    if (!clean) continue;
    if (!zhToWords.has(clean)) zhToWords.set(clean, []);
    zhToWords.get(clean).push(w);
  }
  const uniqueZh = Array.from(zhToWords.keys());
  if (uniqueZh.length < 1) {
    onComplete({ sessionCorrect: 0, totalQuestions: 0, message: '單字不足', usedWords: [] });
    return;
  }

  // 一個 zh 算「練過」的條件：它對應的 en 通通都已練過
  const seen = seenSet || new Set();
  const isZhSeen = zh => zhToWords.get(zh).every(w => seen.has(w.en));
  const round = pickPreferUnseen(uniqueZh, Math.min(QUESTIONS_PER_ROUND, uniqueZh.length), isZhSeen);
  // 算這回合用到的單字（所有 zh 對應的所有 en）
  const usedWords = round.flatMap(zh => zhToWords.get(zh));
  const state = { idx: 0, correct: 0 };

  function renderQuestion() {
    if (state.idx >= round.length) {
      onComplete({
        sessionCorrect: state.correct,
        totalQuestions: round.length,
        message: `${round.length} 題答對 ${state.correct} 題`,
        usedWords,
      });
      return;
    }
    const zh = round[state.idx];

    root.innerHTML = `
      <button class="back" id="back">← 中途離開</button>
      <h2>🇹🇼 → 🇬🇧 中翻英</h2>
      <p class="muted">第 ${state.idx + 1} / ${round.length} 題　·　把英文拼出來</p>
      <div class="zh2en-prompt">${escapeHtml(zh)}</div>
      <input type="text" id="answer" class="zh2en-input"
        placeholder="輸入英文" autocomplete="off" autocapitalize="off"
        autocorrect="off" spellcheck="false">
      <button id="submit">送出</button>
      <button class="secondary" id="skip">不會（看答案）</button>
    `;

    const input = root.querySelector('#answer');
    input.focus();
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); handleSubmit(false); }
    });
    root.querySelector('#submit').addEventListener('click', () => handleSubmit(false));
    root.querySelector('#skip').addEventListener('click', () => handleSubmit(true));
    root.querySelector('#back').addEventListener('click', () => {
      onComplete({
        sessionCorrect: state.correct,
        totalQuestions: round.length,
        message: '中途離開',
        aborted: true,
        usedWords,
      });
    });

    // 中文提示不唸（媽媽 2026-05-16 要求）
  }

  function handleSubmit(skip) {
    const zh = round[state.idx];
    const wordsForZh = zhToWords.get(zh);

    // 集合所有可接受答案
    const accepted = new Set();
    for (const w of wordsForZh) {
      for (const a of acceptedAnswersOf(w)) accepted.add(a);
    }

    const input = root.querySelector('#answer');
    const userInput = skip ? '' : (input ? input.value : '');
    const isCorrect = !skip && accepted.has(normalize(userInput));
    if (isCorrect) state.correct++;

    // 顯示所有可接受的英文寫法（人類友好版本，不是 normalize 後的）
    // v2.18：把 zh 內的「(= xxx)」alt 也算進可接受答案列表
    const allEnSet = new Set();
    for (const w of wordsForZh) {
      allEnSet.add(w.en);
      for (const alt of extractZhAlts(w.zh)) allEnSet.add(alt);
    }
    const allEn = [...allEnSet];
    // 不論對錯都唸英文（中文不唸 — 媽媽 2026-05-16 要求）
    speak(allEn[0]);

    // 軟化錯誤回饋：不用 ❌、不用「再記一次」這類羞辱性字眼
    const headerCls = isCorrect ? 'feedback-correct' : (skip ? 'feedback-skip' : 'feedback-soft');
    const headerText = isCorrect ? '✅ 答對了！' : (skip ? '🆗 答案是' : '🌱 下次抓到');

    root.innerHTML = `
      <h2 class="${headerCls}">${headerText}</h2>
      <div class="zh2en-prompt">${escapeHtml(zh)}</div>
      <div class="card">
        ${!skip ? `
          <p class="muted small">你寫的：</p>
          <p class="zh2en-userinput ${isCorrect ? 'correct' : 'wrong'}">${escapeHtml(userInput || '（空白）')}</p>
        ` : ''}
        <p class="muted small" style="margin-top:${skip ? '0' : '12px'};">
          ${isCorrect && allEn.length === 1 ? '正解：' : (isCorrect ? '正解（這個中文也接受其他寫法）：' : '正確答案：')}
        </p>
        <p class="zh2en-answers">${allEn.map(escapeHtml).join('　／　')}</p>
        <div class="speak-row">
          <button class="speak-btn" id="speak">🔊 再聽一次</button>
          <button class="speak-btn" id="spell">🔤 聽拼字</button>
        </div>
      </div>
      <button id="next">${state.idx === round.length - 1 ? '看結果' : '下一題 →'}</button>
    `;
    root.querySelector('#speak').addEventListener('click', () => speak(allEn[0]));
    root.querySelector('#spell').addEventListener('click', () => speakSpell(allEn[0]));
    root.querySelector('#next').addEventListener('click', () => {
      state.idx++;
      renderQuestion();
    });
  }

  renderQuestion();
}

function normalize(s) {
  return (s || '').trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.!?]+$/, '');
}

function acceptedAnswersOf(word) {
  const set = new Set();
  const add = s => { if (s) set.add(normalize(s)); };
  add(word.en);

  // 模式 1：en 含「(= xxx)」同義替代格式
  //   例：pencil case (= pencil box) → 接受 "pencil case" 與 "pencil box"
  //       the USA (= the United States of America) → 接受兩種寫法
  const eqMatch = word.en.match(/\(=\s*([^)]+)\)/);
  if (eqMatch) {
    add(eqMatch[1]);                                                  // 等號後的替代寫法
    add(word.en.replace(/\(=\s*[^)]+\)/, '').replace(/\s+/g, ' '));   // 去掉整個 (= xxx) 後的本體
  } else if (word.en.includes('(')) {
    // 模式 2：一般括號（選擇性字元）
    //   例：year(s) old → 接受 "year old" 與 "years old"
    add(word.en.replace(/\([^)]*\)/g, '').replace(/\s+/g, ' '));
    add(word.en.replace(/\(([^)]*)\)/g, '$1'));
  }

  // v2.18：zh 含「(= 英文)」也算可接受答案
  //   例：zh="給你。 (= Here you go.)" → "Here you go" 也算對
  for (const alt of extractZhAlts(word.zh)) {
    add(alt);
  }

  // 顯式備援：word.alts = ["alt1", "alt2"]
  if (Array.isArray(word.alts)) {
    for (const a of word.alts) add(a);
  }
  return set;
}

function pickPreferUnseen(items, n, isSeenFn) {
  const unseen = items.filter(x => !isSeenFn(x));
  const seen = items.filter(x => isSeenFn(x));
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
