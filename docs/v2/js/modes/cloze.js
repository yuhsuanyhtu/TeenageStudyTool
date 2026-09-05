// modes/cloze.js — 🧩 克漏字：短文挖空，每格 4 選 1（v2.40，v2.41 全面改版）
//
// v2.41（家長 2026-09-05 要求）：
//   1. 短文不再原創 → 全部節錄自 VOA Learning English《Let's Learn English》課文對話
//      （美國之音，公共財；資料檔含出處與授權標註）。挖空、選項與中文解析仍為本系統編寫。
//   2. 答錯完整解釋：每個選項都附中文字義（oz），答錯時顯示「你選的 X（意思）」＋為什麼是正解。
//   3. 段落下方附「詞彙註解」（notes）：課文裡超出範圍的字先給中文，看不懂不用怕。
//
// 流程：選一篇 → 對話短文 + 全部空格一次呈現 → 每格先選（可改）→ 全部選完才能送出
//        → 逐格顯示對錯 + 解析，短文空格填回正解，可聽整篇。
// 不寫 SRS（考文法與語感）。選文頁按返回 → silent 返回題型選單（不記錄）。

import { speak } from '../tts.js';

// v2.44：doneToday = 今天已領過獎金的短文 id（Set）；chooser 標示「✓ 今天領過」，讓錢流向沒做過的篇章
//        passage.zhText = 整段中文（家長決定：預設收起，點「💬 看中文」展開，答案仍要自己選）
export function startClozeMode({ root, passages, onComplete, doneToday }) {
  doneToday = doneToday || new Set();
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
      <p class="muted">選一篇（跟段考題組一樣：讀短文，每個空格選出最適合的答案）</p>
      <div class="bookshelf">
        ${passages.map((p, i) => `
          <button class="book-card ${doneToday.has(p.id) ? 'done-today' : ''}" data-i="${i}">
            <span class="book-title">${escapeHtml(p.title)}${doneToday.has(p.id) ? ' <span class="badge-done">✓ 今天領過</span>' : ''}</span>
            <span class="book-meta">${escapeHtml(p.zh || '')} · ${p.blanks.length} 格${doneToday.has(p.id) ? ' · 可再練，獎金明天再領' : ''}</span>
          </button>
        `).join('')}
      </div>
      <p class="muted small">短文出自 VOA Learning English《Let's Learn English》（公共財教材）。</p>
    `;
    root.querySelector('#back').addEventListener('click', () => {
      onComplete({ sessionCorrect: 0, totalQuestions: 0, aborted: true, silent: true, message: '', usedWords: [] });
    });
    root.querySelectorAll('.book-card').forEach(btn => {
      btn.addEventListener('click', () => startPassage(passages[Number(btn.dataset.i)]));
    });
  }

  function startPassage(passage) {
    // 每格選項洗牌（重玩順序不同，防背位置）；oz（中文字義）跟著選項走
    const qs = passage.blanks.map(b => {
      const order = shuffle(b.opts.map((_, i) => i));
      return {
        n: b.n,
        opts: order.map(i => b.opts[i]),
        oz: order.map(i => (b.oz || [])[i] || ''),
        correctIdx: order.indexOf(b.a),
        why: b.why || '',
        selected: null,
      };
    });
    const state = { answered: false, showZh: false };
    render();

    // v2.44：整段中文（預設收起）。render() 每次選項點擊都會重畫，所以開關狀態存在 state.showZh
    function zhHtml() {
      if (!passage.zhText) return '';
      return `
        <div class="cloze-zh-wrap">
          <button class="speak-btn" id="toggle-zh">💬 ${state.showZh ? '收起中文' : '看中文'}</button>
          ${state.showZh ? `<div class="cloze-zh muted small">${escapeHtml(passage.zhText).replace(/\n/g, '<br>')}</div>` : ''}
        </div>`;
    }
    function bindZh() {
      const b = root.querySelector('#toggle-zh');
      if (b) b.addEventListener('click', () => {
        state.showZh = !state.showZh;
        if (state.answered) renderRevealAgain(); else render();
      });
    }

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
      return html.replace(/\n/g, '<br>');
    }

    function notesHtml() {
      if (!Array.isArray(passage.notes) || passage.notes.length === 0) return '';
      return `<p class="muted small cloze-notes">📖 詞彙註解：${passage.notes.map(escapeHtml).join('　')}</p>`;
    }

    function render() {
      const allPicked = qs.every(q => q.selected !== null);
      root.innerHTML = `
        <button class="back" id="back">← 中途離開</button>
        <h2>🧩 克漏字</h2>
        <p class="muted">「${escapeHtml(passage.title)}」${passage.zh ? '（' + escapeHtml(passage.zh) + '）' : ''}　·　每格都選好才能送出，選了還可以改</p>
        <div class="sentence-card cloze-text" style="text-align:left; display:block;">${textHtml(false)}</div>
        ${zhHtml()}
        ${notesHtml()}
        ${qs.map((q, qi) => `
          <div class="cloze-q" data-qi="${qi}">
            <p style="margin:14px 0 6px;"><b>${circled(q.n)}</b></p>
            <div class="en2zh-choices">
              ${q.opts.map((o, oi) => `<button class="choice ${q.selected === oi ? 'selected' : ''}" data-qi="${qi}" data-oi="${oi}">${escapeHtml(o)}</button>`).join('')}
            </div>
          </div>
        `).join('')}
        <button id="submit" ${allPicked ? '' : 'disabled'}>送出答案${allPicked ? '' : `（還有 ${qs.filter(q => q.selected === null).length} 格沒選）`}</button>
      `;
      root.querySelector('#back').addEventListener('click', abortRound);
      bindZh();
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

    let lastCorrect = 0;
    function renderRevealAgain() { renderReveal(lastCorrect); }
    function renderReveal(correct) {
      lastCorrect = correct;
      root.innerHTML = `
        <button class="back" id="back">← 中途離開</button>
        <h2>🧩 克漏字</h2>
        <p class="muted">「${escapeHtml(passage.title)}」　·　${passage.blanks.length} 格答對 ${correct} 格</p>
        <div class="sentence-card cloze-text" style="text-align:left; display:block;">${textHtml(true)}</div>
        ${zhHtml()}
        ${notesHtml()}
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
                  return `<button class="${cls.join(' ')}" disabled>${escapeHtml(o)}${q.oz[oi] ? ` <span class="choice-zh">${escapeHtml(q.oz[oi])}</span>` : ''}</button>`;
                }).join('')}
              </div>
              ${!good ? `<p class="muted small" style="margin:6px 2px 0;">🔍 你選的「${escapeHtml(q.opts[q.selected])}」是「${escapeHtml(q.oz[q.selected] || '')}」的意思，放進這格句子就不通了。</p>` : ''}
              ${q.why ? `<p class="muted small" style="margin:4px 2px 0;">💡 ${escapeHtml(q.why)}</p>` : ''}
            </div>
          `;
        }).join('')}
        <p class="muted small">${escapeHtml(passage.src || '')} · VOA Learning English（公共財）</p>
        <button id="done">看結果</button>
      `;
      root.querySelector('#back').addEventListener('click', abortRound);
      bindZh();
      root.querySelector('#speak-all').addEventListener('click', () => {
        let full = passage.text;
        for (const q of qs) full = full.replace(`{${q.n}}`, q.opts[q.correctIdx]);
        speak(full.replace(/^[A-Z][A-Za-z.'’ ]{0,18}:\s*/gm, '').replace(/\([^)]*\)/g, ''));
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
