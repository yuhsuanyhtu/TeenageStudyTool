// modes/review.js — 從頭複習（單字卡翻閱）
//
// 設計：
//   - 整課單字一張一張看，自動唸字母拼讀 + 整字發音
//   - 不考試、無對錯壓力 → 適合每天暖身
//   - 走完整輪 = 拿固定獎金（reward.calcReviewReward）
//   - 中途離開 = 沒獎金（避免只翻一兩張就刷錢）
//
// v2.23：單字卡升級成「學習導向」豐富顯示
//   - 字若有 meanings 陣列（CEFR 字庫）→ 顯示全部 POS 意思（adj/n/v 分行）
//   - 從 Free Dictionary API 抓近義字 / 反義字 / 各 POS 的例句一起顯示
//   - 舊 textbook 字庫只有 zh → 行為與之前相同，外加 API 補的資訊
//
// 完成回呼帶 mode:'review' → main.handleComplete 會 dispatch 到 calcReviewReward

import { speak, speakSpell } from '../tts.js';
import { fetchDictionary, highlightWord, ecdictPosToApi } from '../dictionary.js';

export function startReviewMode({ root, words, onComplete }) {
  const list = (words || []).filter(w => w.en && w.zh);
  if (list.length === 0) {
    onComplete({
      sessionCorrect: 0, totalQuestions: 0,
      message: '單字不足', mode: 'review', usedWords: [],
    });
    return;
  }

  // v2.23：先非阻塞地預抓全部字典資料，每張卡 cache hit 就秒開
  Promise.all(list.map(w => fetchDictionary(w.en).catch(() => null)));

  const state = { idx: 0 };

  async function render() {
    const w = list[state.idx];
    const isLast = state.idx === list.length - 1;
    const isFirst = state.idx === 0;
    const pct = ((state.idx + 1) / list.length) * 100;

    // 先畫骨架（含基本字 + 主要意思）；近義字／反義字／例句等字典資料 async 補上
    root.innerHTML = `
      <button class="back" id="back">← 中途離開（沒獎金）</button>
      <h2>📖 從頭複習</h2>
      <p class="muted">${state.idx + 1} / ${list.length}</p>

      <div class="review-card" id="card">
        <div class="review-en">${escapeHtml(w.en)}</div>
        ${renderMeaningsBlock(w)}
        <div class="speak-row">
          <button class="speak-btn" id="speak">🔊 唸發音</button>
          <button class="speak-btn" id="spell">🔤 聽拼字</button>
        </div>
        <div class="review-extra" id="review-extra" data-target="${escapeHtml(w.en.toLowerCase())}">
          <div class="review-extra-loading">查字典中…</div>
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
        usedWords: list.slice(0, state.idx + 1),
      });
    });
    root.querySelector('#speak').addEventListener('click', e => {
      e.stopPropagation();
      speak(w.en);
    });
    root.querySelector('#spell').addEventListener('click', e => {
      e.stopPropagation();
      speakSpell(w.en);
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

    setTimeout(() => speak(w.en), 150);

    // async 補字典資料
    const dict = await fetchDictionary(w.en).catch(() => ({ examples: [], synonyms: [], antonyms: [] }));
    const live = document.getElementById('review-extra');
    if (!live || !live.isConnected) return;
    if (live.dataset.target !== w.en.toLowerCase()) return;  // 換卡了，不更新舊卡
    live.innerHTML = renderExtraBlock(w, dict);
  }

  render();
}

// 主要意思區塊：有 meanings 就分行列全部，沒有就單行 zh
function renderMeaningsBlock(w) {
  if (Array.isArray(w.meanings) && w.meanings.length > 0) {
    return `<div class="review-meanings">
      ${w.meanings.map(m =>
        `<div class="review-meaning"><span class="review-pos">${escapeHtml(m.pos)}.</span> ${escapeHtml(m.zh)}</div>`
      ).join('')}
    </div>`;
  }
  return `<div class="review-zh">${escapeHtml(w.zh)}</div>`;
}

// API 補的資訊：每個 POS 的例句、同義字、反義字
function renderExtraBlock(w, dict) {
  const blocks = [];

  // 例句：每個 POS 配一個例句（如果有）
  if (dict.examples.length > 0) {
    // 依字本身的 POS 順序排例句；textbook 字無 meanings → 直接放 API 順序
    const examplesByPos = new Map();
    for (const ex of dict.examples) {
      const key = (ex.pos || '').toLowerCase();
      if (!examplesByPos.has(key)) examplesByPos.set(key, ex);
    }
    const ordered = [];
    if (Array.isArray(w.meanings) && w.meanings.length > 0) {
      for (const m of w.meanings) {
        const ex = examplesByPos.get(ecdictPosToApi(m.pos));
        if (ex) {
          ordered.push({ pos: m.pos, ex });
          examplesByPos.delete(ecdictPosToApi(m.pos));
        }
      }
      // 剩下沒配對的 POS 例句也加上（API 可能比 ECDICT 多 POS）
      for (const [, ex] of examplesByPos) {
        ordered.push({ pos: '', ex });
      }
    } else {
      for (const [, ex] of examplesByPos) {
        ordered.push({ pos: '', ex });
      }
    }
    if (ordered.length > 0) {
      blocks.push(`
        <div class="review-extra-section">
          <div class="review-extra-label">例句</div>
          ${ordered.map(({ ex }) =>
            `<div class="review-example">${highlightWord(ex.text, w.en)}</div>`
          ).join('')}
        </div>
      `);
    }
  }

  // 近義字
  if (dict.synonyms.length > 0) {
    blocks.push(`
      <div class="review-extra-section">
        <div class="review-extra-label">近義字</div>
        <div class="review-extra-words">
          ${dict.synonyms.map(s => `<span class="review-extra-word">${escapeHtml(s)}</span>`).join('')}
        </div>
      </div>
    `);
  }

  // 反義字
  if (dict.antonyms.length > 0) {
    blocks.push(`
      <div class="review-extra-section">
        <div class="review-extra-label">反義字</div>
        <div class="review-extra-words">
          ${dict.antonyms.map(s => `<span class="review-extra-word">${escapeHtml(s)}</span>`).join('')}
        </div>
      </div>
    `);
  }

  if (blocks.length === 0) {
    return '';  // 完全沒資料 → 隱藏（CSS 也允許 review-extra 空白）
  }
  return blocks.join('');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}
