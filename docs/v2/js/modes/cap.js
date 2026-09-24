// modes/cap.js — 🎯 會考題（v2.50）：歷屆國中教育會考英語（閱讀）真題，依單元向下相容出題
//
// 題庫：cap/en/index.v1.json（tools/cap/build_en.py 從心測中心官方 PDF 建置；答案以官方參考答案為準）
//   每一項（item）＝單題或題組；題組整組出。題目是原卷裁切圖，選項在圖裡，下方按 A／B／C／D 作答。
//
// 出題（家長 2026-09-24 定案）：
//   - 點哪一課就出「這一課＋之前」的會考題（item.minUnitIndex ≤ 這課在 units 裡的位置）
//   - 一卷最多 10 題；還能領錢的題優先，再依官方通過率由易到難
//   - 同一題只付一次錢；答錯的題 14 天內再答對不給錢（防看完答案馬上重做刷錢）——付不付錢由 main.js 結算
//   - 答錯不羞辱：暖橘色、給正確答案、這題考什麼、回去複習哪一課；可以「跳過」「這題還沒教過」
//   - 練習中不顯示錢
//
// 完成回呼：onComplete({ results:[{id, correct, skipped}], flagged:[id], aborted })

export const CAP_ROUND_MAX = 10;
// v2.51：多科目。題庫檔名帶版本（重建要換版本，Service Worker 才不會用舊答案）
export const CAP_SUBJECTS = {
  en:  { label: '英文', data: 'cap/en/index.v1.json',  img: 'cap/en/img/' },
  soc: { label: '社會', data: 'cap/soc/index.v1.json', img: 'cap/soc/img/' },
  sci: { label: '自然', data: 'cap/sci/index.v1.json', img: 'cap/sci/img/' },
  math: { label: '數學', data: 'cap/math/index.v1.json', img: 'cap/math/img/' },
};
const cache = {};

export async function loadCapData(subject = 'en') {
  if (cache[subject]) return cache[subject];
  const res = await fetch(CAP_SUBJECTS[subject].data);
  if (!res.ok) throw new Error(`會考題庫讀取失敗（HTTP ${res.status}）`);
  cache[subject] = await res.json();
  return cache[subject];
}

// 這一課可以出的題目（item 陣列）
//   英文：unit 是 app 的課本單元（不在清單，例：A1 Unit 3 → 空）
//   社會：strand（歷史／地理／公民）＋ unit（升學王單元名），只看同一分科
//   flagged：Map(題id → 按「這題還沒教過」時所選那一課的序號)。選到更後面的課才重新出現（家長 09-24）
export function eligibleItems(data, unit, flagged, strand) {
  const list = strand ? (data.strands[strand] || []) : data.units;
  const idx = list.indexOf(unit);
  if (idx < 0) return [];
  const hidden = (id) => flagged && flagged.has(id) && (typeof flagged.get !== 'function' || idx <= flagged.get(id));   // Set＝永久隱藏
  return data.items.filter(it => (!strand || it.strand === strand) && it.minUnitIndex <= idx && !it.questions.some(q => hidden(q.id)));
}

// s.hk.flagged 的記錄格式「題id~課序號」→ Map（同一題取最大序號；沒有序號的舊格式＝永久隱藏）
export function flaggedMap(tokens) {
  const m = new Map();
  for (const t of tokens || []) {
    const [id, n] = String(t).split('~');
    const v = n === undefined ? Infinity : Number(n);
    if (!m.has(id) || m.get(id) < v) m.set(id, v);
  }
  return m;
}
export function unitIndex(data, unit, strand) {
  return (strand ? (data.strands[strand] || []) : data.units).indexOf(unit);
}

// 組一卷：可領錢的先、通過率高（簡單）的先；題組整組，總題數盡量不超過 max
export function pickRound(items, isPayable, max = CAP_ROUND_MAX) {
  const score = it => {
    const pay = it.questions.some(q => isPayable(q.id)) ? 0 : 1;
    const ps = it.questions.map(q => q.pass ?? 0.5);
    return [pay, -(ps.reduce((a, b) => a + b, 0) / ps.length)];
  };
  const sorted = [...items].sort((a, b) => {
    const [pa, ea] = score(a), [pb, eb] = score(b);
    return pa - pb || ea - eb || (Math.random() - 0.5);
  });
  const round = [];
  let n = 0;
  for (const it of sorted) {
    if (n > 0 && n + it.questions.length > max) continue;
    round.push(it);
    n += it.questions.length;
    if (n >= max) break;
  }
  return round;
}

export function startCapMode({ root, unit, round, onComplete, onAnswered, subject = 'en', unitIdx = 0 }) {
  const IMG_BASE = CAP_SUBJECTS[subject].img;
  // 先把這一卷的圖片都載好（離線或網路慢時不會做到一半破圖）
  for (const it of round) for (const f of it.imgs) { const im = new Image(); im.src = IMG_BASE + encodeURIComponent(f); }
  const results = [];
  const flagged = [];
  let i = 0;
  const totalQ = round.reduce((s, it) => s + it.questions.length, 0);
  let done = 0;

  function header() {
    return `
      <button class="back" id="back">← 中途離開</button>
      <h2>🎯 會考題</h2>
      <p class="muted">${escapeHtml(unit)}＋之前的範圍　·　第 ${done + 1}${round[i].questions.length > 1 ? `–${done + round[i].questions.length}` : ''} / ${totalQ} 題</p>`;
  }

  function imgs(it) {
    return it.imgs.map(f => `<img class="cap-img" src="${IMG_BASE}${encodeURIComponent(f)}" alt="${escapeHtml(it.source)}">`).join('');
  }

  function renderItem() {
    if (i >= round.length) { finish(false); return; }
    const it = round[i];
    const picked = {};
    root.innerHTML = `
      ${header()}
      <div class="cap-paper">${imgs(it)}</div>
      <p class="muted small">${escapeHtml(it.source)}</p>
      ${it.questions.map(q => `
        <div class="cap-q" data-n="${q.n}">
          <div class="cap-qn">${it.questions.length > 1 ? `第 ${q.n} 題` : '選一個答案'}</div>
          <div class="cap-choices">${'ABCD'.split('').map(L => `<button class="choice cap-choice" data-n="${q.n}" data-l="${L}">(${L})</button>`).join('')}</div>
        </div>`).join('')}
      <button id="submit" disabled>送出答案</button>
      <div class="cap-aside">
        <button class="linkish" id="skip">跳過這${it.questions.length > 1 ? '組' : '題'}</button>
        <button class="linkish" id="flag">這${it.questions.length > 1 ? '組' : '題'}還沒教過</button>
      </div>`;
    root.querySelector('#back').addEventListener('click', () => finish(true));
    const submit = root.querySelector('#submit');
    root.querySelectorAll('.cap-choice').forEach(b => b.addEventListener('click', () => {
      const n = b.dataset.n;
      picked[n] = b.dataset.l;
      root.querySelectorAll(`.cap-choice[data-n="${n}"]`).forEach(x => x.classList.toggle('selected', x === b));
      submit.disabled = it.questions.some(q => !picked[q.n]);
    }));
    submit.addEventListener('click', () => reveal(it, picked));
    root.querySelector('#skip').addEventListener('click', () => {
      for (const q of it.questions) results.push({ id: q.id, correct: false, skipped: true });
      next(it);
    });
    root.querySelector('#flag').addEventListener('click', () => {
      for (const q of it.questions) { flagged.push(`${q.id}~${unitIdx}`); results.push({ id: q.id, correct: false, skipped: true }); }
      next(it);
    });
    window.scrollTo(0, 0);
  }

  function reveal(it, picked) {
    const now = [];
    const rows = it.questions.map(q => {
      const ok = picked[q.n] === q.answer;
      results.push({ id: q.id, correct: ok, skipped: false });
      now.push({ id: q.id, correct: ok });
      const btns = 'ABCD'.split('').map(L => {
        const cls = ['choice', 'cap-choice'];
        if (L === q.answer) cls.push('correct');
        else if (L === picked[q.n]) cls.push('wrong');
        return `<button class="${cls.join(' ')}" disabled>(${L})</button>`;
      }).join('');
      return `
        <div class="cap-q">
          <div class="cap-qn">${it.questions.length > 1 ? `第 ${q.n} 題　` : ''}${ok ? '<span class="feedback-correct">答對了 🌟</span>' : '<span class="feedback-soft">🌱 下次抓到</span>'}</div>
          <div class="cap-choices">${btns}</div>
          ${ok ? '' : explain(q)}
        </div>`;
    }).join('');
    // reviewer H1：答錯要「當下」記下來——他答錯常常直接關瀏覽器，等整卷結束才記就會被繞過 14 天冷卻
    if (onAnswered) onAnswered(now);
    root.innerHTML = `
      ${header()}
      <div class="cap-paper">${imgs(it)}</div>
      ${rows}
      <button id="next">${i === round.length - 1 ? '看結果' : '下一題 →'}</button>`;
    root.querySelector('#back').addEventListener('click', () => finish(true));
    root.querySelector('#next').addEventListener('click', () => next(it));
  }

  function explain(q) {
    return `
      <div class="card vocab-explain">
        <p>✅ <b>正確答案：(${q.answer})</b>${q.answerText ? ` ${escapeHtml(q.answerText)}` : ''}</p>
        ${q.goal ? `<p class="muted small">這題考：${escapeHtml(q.goal.replace(/（[^）]*）$/, ''))}</p>` : ''}
        ${q.review ? (q.review.words.length
          ? `<p class="muted small">📖 回去複習 <b>${escapeHtml(q.review.unit)}</b> 的 ${q.review.words.map(w => `<b>${escapeHtml(w.en)}</b>`).join('、')}（結算頁可以直接點過去）</p>`
          : `<p class="muted small">📖 回去讀 <b>${escapeHtml(q.review.unit)}</b>（升學王可以看這一課的影片）</p>`) : ''}
        <p class="muted small">🌱 這題過一陣子會再出現。還沒領過獎金的題，14 天後再答對就能領。</p>
      </div>`;
  }

  function next(it) {
    done += it.questions.length;
    i++;
    renderItem();
  }

  function finish(aborted) {
    const reviewUnits = [];
    for (const r of results) {
      if (r.correct || r.skipped) continue;
      const q = round.flatMap(it => it.questions).find(x => x.id === r.id);
      if (q && q.review && !reviewUnits.some(u => u.unit === q.review.unit)) reviewUnits.push(q.review);
    }
    onComplete({ results, flagged, aborted, reviewUnits, totalQuestions: totalQ });
  }

  renderItem();
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
