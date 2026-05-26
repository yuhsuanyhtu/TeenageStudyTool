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
        durationMs: Date.now() - started,
      });
    });
    root.querySelector('#finish').addEventListener('click', () => {
      onComplete({
        story, lookedUp: [...lookedUp],
        completed: true,
        durationMs: Date.now() - started,
      });
    });
    root.querySelectorAll('.read-word').forEach(el => {
      el.addEventListener('click', () => showLookup(el.dataset.word, el));
    });
  }

  function renderParagraph(para) {
    // 把英文字（含內部 ' 如 don't）包成 span，標點和空白保留原樣
    return escapeHtml(para).replace(
      /([A-Za-z][A-Za-z']*)/g,
      (m) => `<span class="read-word" data-word="${m.toLowerCase()}">${m}</span>`
    );
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

    // 2. 沒人工翻譯 → fallback API 英文定義
    box.innerHTML = `<div class="lookup-card lookup-loading">查字典中…</div>`;
    const dict = await fetchDictionary(word).catch(() => ({ examples: [], synonyms: [], antonyms: [] }));
    if (!box.isConnected) return;
    if (dict.examples.length > 0) {
      box.innerHTML = `
        <div class="lookup-card">
          <div class="lookup-word">${escapeHtml(word)}</div>
          <div class="lookup-en muted small">${escapeHtml(dict.examples[0].text)}</div>
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
