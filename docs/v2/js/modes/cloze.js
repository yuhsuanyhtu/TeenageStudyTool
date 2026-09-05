// modes/cloze.js — 🧩 克漏字：短文挖空，每格 4 選 1（v2.40）
//
// 老師建議的段考題型（2026-09-05 家長轉達）：
//   一篇短文 3~5 個空格，考時態、連接詞、介系詞與課內字彙的「上下文判斷」。
//
// 題庫：data/cloze-*.json（原創短文，text 內 {1}~{n} 為挖空）。
// 流程：選一篇 → 短文 + 全部空格一次呈現（跟考卷一樣）→ 每格先選（可改）
//        → 全部選完才能送出 → 逐格顯示對錯 + 中文解析，短文空格填回正解。
// 焦慮緩衝：答錯暖橘不紅；解析用「為什麼是這個」的教學語氣；可中途離開。
// 不寫 SRS（考的是文法與語感，不是單一單字的記憶）。

import { speak } from '../tts.js';

export function startClozeMode({ root, passages, onComplete }) {
  if (!Array.isArray(passages) || passages.length === 0) {
    onComplete({ sessionCorrect: 0, totalQuestions: 0, message: '這個單元還沒有克漏字題目', usedWords: [] });
    return;
  }
  if (passages.length === 1) {
    startPassage(passages[0]);
  } else {
    renderChooser();
  }

  function renderChooser() {
    root.innerHTML = `
      <button class="back" id="back">← 回題型選單</button>
      <h2>🧩 克漏字</h2>
      <p class="muted">選一篇短文（跟段考題組一樣：讀短文，每個空格選出最適合的答案）</p>
      <div class="bookshelf">
        ${passages.map((p, i) => `
          <button class="book-card" data-i="${i}">
            <span class="book-title">${escapeHtml(p.title)}</span>
            <span class="book-meta">${escapeHtml(p.zh || '')} · ${p.blanks.length} 格</span>
          </button>
        `).join('')}
      </div>
    `;
    root.querySelector('#back').addEventListener('click', () => {
      onComplete({ sessionCorrect: 0, totalQuestions: 0, aborted: true, silent: true, message: '', usedWords: [] });
    });
    root.querySelectorAll('.book-card').forEach(btn => {
      btn.addEventListener('click', () => startPassage(passages[Number(btn.dataset.i)]));
    });
  }

  function startPassage(passage) {
    // 每格選項洗牌一次（進來重玩順序會不同，防背位置）
    const qs = passage.blanks.map(b => {
      const order = shuffle(b.opts.map((_, i) => i));
      return {
        n: b.n,
        opts: order.map(i => b.opts[i]),
        correctIdx: order.indexOf(b.a),
        why: b.why || '',
        selected: null,
      };
    });
    const state = { answered: false };
    render();

    function textHtml(revealMode) {
      let html = escapeHtml(passage.text);
      for (const q of qs) {
        const mark = escapeHtml(`{${q.n}}`);
        if (revealMode) {
          html = html.replace(mark,
            `<span class="sentence-target">${escapeHtml(q.opts[q.correctIdx])}</span><span class="cloze-no">${circled(q.n)}</span>`);
        } else {
          html = html.replace(mark,
            `<span class="vocab-blank">＿＿＿</span><span class="cloze-no">${circled(q.n)}</span>`);
        }
      }
      return html;
    }

    function render() {
      root.innerHTML = `
        <button class="back" id="back">← 中途離開</button>
        <h2>🧩 克漏字</h2>
        <p class="muted">「${escapeHtml(passage.title)}」${passage.zh ? '（' + escapeHtml(passage.zh) + '）' : ''}　·　每格都選好才能送出，選了還可以改</p>
        <div class="sentence-card cloze-text" style="text-align:left; display:block;">${textHtml(false)}</div>
        ${qs.map((q, qi) => `
          <div class="cloze-q" data-qi="${qi}">
            <p style="margin:14px 0 6px;"><b>${circled(q.n)}</b></p>
            <div class="en2zh-choices">
              ${q.opts.map((o, oi) => `<button class="choice ${q.selected === oi ? 'selected' : ''}" data-qi="${qi}" data-oi="${oi}">${escapeHtml(o)}</button>`).join('')}
            </div>
          </div>
        `).join('')}
        <button id="submit" ${qs.every(q => q.selected !== null) ? '' : 'disabled'}>送出答案${qs.every(q => q.selected !== null) ? '' : `（還有 ${qs.filter(q => q.selected === null).length} 格沒選）`}</button>
      `;
      root.querySelector('#back').addEventListener('click', abortRound);
      root.querySelectorAll('.choice').forEach(el => {
        el.addEventListener('click', () => {
          if (state.answered) return;
          qs[Number(el.dataset.qi)].selected = Number(el.dataset.oi);
          render();
        });
      });
      root.querySelector('#submit').addEventListener('click', handleSubmit);
    }

    function handleSubmit() {
      if (state.answered || !qs.every(q => q.selected !== null)) return;
      state.answered = true;
      const correct = qs.filter(q => q.selected === q.correctIdx).length;
      renderReveal(correct);
    }

    function renderReveal(correct) {
      root.innerHTML = `
        <button class="back" id="back">← 中途離開</button>
        <h2>🧩 克漏字</h2>
        <p class="muted">「${escapeHtml(passage.title)}」　·　${passage.blanks.length} 格答對 ${correct} 格</p>
        <div class="sentence-card cloze-text" style="text-align:left; display:block;">${textHtml(true)}</div>
        <button class="speak-btn" id="speak-all" style="margin:4px 0 10px;">🔊 聽整篇（填好答案的版本）</button>
        ${qs.map(q => {
          const good = q.selected === q.correctIdx;
          return `
            <div class="cloze-q">
              <p style="margin:14px 0 6px;"><b>${circled(q.n)}</b>　${good ? '✓ 答對' : '🌱 下次抓到'}</p>
              <div class="en2zh-choices">
                ${q.opts.map((o, oi) => {
                  const cls = ['choice'];
                  if (oi === q.correctIdx) cls.push('correct');
                  else if (oi === q.selected && !good) cls.push('wrong');
                  return `<button class="${cls.join(' ')}" disabled>${escapeHtml(o)}</button>`;
                }).join('')}
              </div>
              ${q.why ? `<p class="muted small" style="margin:6px 2px 0;">💡 ${escapeHtml(q.why)}</p>` : ''}
            </div>
          `;
        }).join('')}
        <button id="done">看結果</button>
      `;
      root.querySelector('#back').addEventListener('click', abortRound);
      root.querySelector('#speak-all').addEventListener('click', () => {
        let full = passage.text;
        for (const q of qs) full = full.replace(`{${q.n}}`, q.opts[q.correctIdx]);
        speak(full.replace(/\([^)]*\)/g, ''));
      });
      root.querySelector('#done').addEventListener('click', () => {
        onComplete({
          sessionCorrect: correct,
          totalQuestions: passage.blanks.length,
          message: `「${passage.title}」${passage.blanks.length} 格答對 ${correct} 格`,
          usedWords: [],
          passageId: passage.id,
          passageTitle: passage.title,
        });
      });
    }

    function abortRound() {
      onComplete({
        sessionCorrect: 0,
        totalQuestions: passage.blanks.length,
        message: '中途離開',
        aborted: true,
        usedWords: [],
        passageId: passage.id,
        passageTitle: passage.title,
      });
    }
  }
}

function circled(n) {
  const c = ['⓪', '①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨'];
  return c[n] || `(${n})`;
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
