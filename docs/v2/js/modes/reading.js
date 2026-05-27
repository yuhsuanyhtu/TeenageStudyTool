// modes/reading.js — 閱讀練習
//
// 設計：
//   - 顯示一篇短文（Aesop's Fables 改編，公有領域）
//   - 點任何單字 → 跳出翻譯小卡（先看 story.vocab，沒有就 fetch API）
//   - 查過的字 → 記到 SRS（recordSeen），標示為「今日生字」
//   - 讀完按「✓ 讀完了」→ 顯示生字清單，可選「練習剛剛的生字」直接跳 en2zh
//
// 與 quiz mode 不同：
//   - 沒有對錯計分，只有「讀完」/「中途離開」
//   - 獎金：讀完一篇 = 固定獎金（避免刷字洗錢）
//   - usedWords 帶查過的生字回去（main.js 會做 recordSeen + 累加獎金）
//
// 為什麼 vocab 內建在 story JSON 而不是 ondemand API：
//   - 確保有正確繁中翻譯（API 只有英文定義）
//   - 文章長度有限，作者（=我）可以預先標好難字
//   - 點到 vocab 沒有的字 → fallback API 顯示英文定義

import { fetchDictionary } from '../dictionary.js';

export function startReadingMode({ root, story, onComplete }) {
  const lookedUp = new Set();       // 查過的字（lowercased en）
  let started = Date.now();
  // v2.30：理解測驗結果（一篇有幾題就有幾筆 {answer:N, correct:bool}）
  const comprehensionResults = [];

  function render() {
    // 把文章內的每個英文字包成 .read-word span 讓使用者點
    const html = story.text.split('\n').map(para =>
      `<p class="read-para">${renderParagraph(para)}</p>`
    ).join('');

    root.innerHTML = `
      <button class="back" id="back">← 回書架</button>
      <div class="read-header">
        <h2>📖 ${escapeHtml(story.title)}</h2>
        <span class="read-level">${escapeHtml(story.level)}</span>
      </div>
      <div class="read-text">${html}</div>
      <div id="read-lookup" class="read-lookup"></div>
      <p class="muted small read-hint">點任何單字 → 看中文意思</p>
      <button id="finish">✓ 讀完了</button>
    `;

    root.querySelector('#back').addEventListener('click', () => {
      onComplete({
        story, lookedUp: [...lookedUp],
        aborted: true,
        comprehensionResults,
        durationMs: Date.now() - started,
      });
    });
    root.querySelector('#finish').addEventListener('click', () => {
      // v2.30：讀完按鈕 → 如果故事有理解測驗，先做題；沒有就直接收尾
      if (Array.isArray(story.comprehension) && story.comprehension.length > 0) {
        startComprehension();
      } else {
        finalize();
      }
    });
    root.querySelectorAll('.read-word').forEach(el => {
      el.addEventListener('click', () => showLookup(el.dataset.word, el));
    });
  }

  // v2.30：理解測驗階段
  function startComprehension() {
    let idx = 0;
    const qs = story.comprehension;
    renderQuestion();

    function renderQuestion() {
      if (idx >= qs.length) { finalize(); return; }
      const q = qs[idx];
      // shuffle choices 但記住原本正確答案的位置
      const indexed = q.choices.map((c, i) => ({ text: c, isCorrect: i === q.answer }));
      const shuffled = shuffle(indexed);
      let selected = null;
      let answered = false;

      function render() {
        root.innerHTML = `
          <button class="back" id="back">← 中途離開</button>
          <h2>📖 ${escapeHtml(story.title)}</h2>
          <p class="muted">理解測驗 ${idx + 1} / ${qs.length}　·　答對 1 題 +$5</p>
          <div class="comp-q">${escapeHtml(q.q)}</div>
          <div class="comp-choices">
            ${shuffled.map((c, i) => {
              let cls = 'choice';
              if (answered) {
                if (c.isCorrect) cls += ' correct';
                else if (i === selected && !c.isCorrect) cls += ' wrong';
              } else if (i === selected) cls += ' selected';
              return `<button class="${cls}" data-i="${i}" ${answered ? 'disabled' : ''}>${escapeHtml(c.text)}</button>`;
            }).join('')}
          </div>
          ${answered
            ? `<button id="next">${idx === qs.length - 1 ? '看分數' : '下一題 →'}</button>`
            : `<button id="submit">送出答案</button>`}
        `;
        root.querySelector('#back').addEventListener('click', () => {
          onComplete({
            story, lookedUp: [...lookedUp],
            aborted: true,
            comprehensionResults,
            durationMs: Date.now() - started,
          });
        });
        if (!answered) {
          root.querySelectorAll('.choice').forEach(b => {
            b.addEventListener('click', () => {
              selected = +b.dataset.i;
              render();
            });
          });
          root.querySelector('#submit').addEventListener('click', () => {
            if (selected === null) return;
            answered = true;
            const isCorrect = shuffled[selected].isCorrect;
            comprehensionResults.push({ correct: isCorrect });
            render();
          });
        } else {
          root.querySelector('#next').addEventListener('click', () => {
            idx++;
            renderQuestion();
          });
        }
      }
      render();
    }
  }

  function finalize() {
    onComplete({
      story, lookedUp: [...lookedUp],
      completed: true,
      comprehensionResults,
      durationMs: Date.now() - started,
    });
  }

  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function renderParagraph(para) {
    // 把英文字（含內部 ' 如 don't）包成 span，標點和空白保留原樣。
    //
    // ⚠ Bug 修正（v2.25 hotfix）：原本先 escapeHtml 再 regex，但 regex `[A-Za-z]+` 會
    // 把 `&quot;` 裡的 `quot` 也當成「字」包進 span，結果變成 `&<span>quot</span>;`，
    // 瀏覽器看到 `&` 後面不是有效 entity 就當文字顯示 → 螢幕跑出 `&quot;` 原文。
    // 正解：規範化用 token-by-token，word 跟非 word 分開 escape，最後拼起來。
    let result = '';
    let lastIdx = 0;
    const regex = /([A-Za-z][A-Za-z']*)/g;
    let m;
    while ((m = regex.exec(para)) !== null) {
      if (m.index > lastIdx) {
        result += escapeHtml(para.slice(lastIdx, m.index));
      }
      const word = m[0];
      result += `<span class="read-word" data-word="${escapeHtml(word.toLowerCase())}">${escapeHtml(word)}</span>`;
      lastIdx = regex.lastIndex;
    }
    if (lastIdx < para.length) {
      result += escapeHtml(para.slice(lastIdx));
    }
    return result;
  }

  async function showLookup(word, clickedEl) {
    if (!word) return;
    const box = document.getElementById('read-lookup');
    if (!box) return;
    lookedUp.add(word);
    // 標記已查過的字（視覺：底色換）
    if (clickedEl) clickedEl.classList.add('looked-up');
    // 把同一個字其他出現也標一下
    root.querySelectorAll(`.read-word[data-word="${cssEscape(word)}"]`)
      .forEach(el => el.classList.add('looked-up'));

    // 1. 先查 story.vocab（人工翻譯，最準）
    const zh = (story.vocab || {})[word];
    if (zh) {
      box.innerHTML = `
        <div class="lookup-card">
          <div class="lookup-word">${escapeHtml(word)}</div>
          <div class="lookup-zh">${escapeHtml(zh)}</div>
        </div>
      `;
      return;
    }

    // 2. 沒人工翻譯 → fallback API 英文「定義」（definition），不是例句（example）
    //    v2.25 hotfix：原本顯示 example，但 API 給的 example 常是冷僻用法
    //    （如 mouse 給「Captain Higgins moused the hook with...」航海動詞用法）
    //    定義比較像「這個字是什麼意思」，對學習者比較有幫助
    box.innerHTML = `<div class="lookup-card lookup-loading">查字典中…</div>`;
    const dict = await fetchDictionary(word).catch(() => EMPTY_DICT);
    if (!box.isConnected) return;
    if (dict.definitions && dict.definitions.length > 0) {
      const d = dict.definitions[0];
      box.innerHTML = `
        <div class="lookup-card">
          <div class="lookup-word">${escapeHtml(word)}</div>
          <div class="lookup-en muted small"><i>${escapeHtml(d.pos || '')}</i> ${escapeHtml(d.text)}</div>
        </div>
      `;
    } else {
      box.innerHTML = `
        <div class="lookup-card lookup-empty">
          <div class="lookup-word">${escapeHtml(word)}</div>
          <div class="muted small">字典裡沒找到</div>
        </div>
      `;
    }
  }

  const EMPTY_DICT = { examples: [], definitions: [], synonyms: [], antonyms: [] };

  render();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}
function cssEscape(s) {
  return String(s).replace(/[^\w-]/g, '\\$&');
}
