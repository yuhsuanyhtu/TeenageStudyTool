// dexbook.js — 我的字典 / 單字圖鑑（v2.31）
//
// 視覺化 SRS 已會的字，給孩子收集成就感：
//   - 頂部：總已會數 + milestone 徽章
//   - 按分類折疊列表（已會 N / 總 M）
//   - 點分類展開 → 看已會字清單
//   - 點任一字 → 看完整 POS 意思
//
// 設計考量：
//   - 不放發音按鈕（從頭複習已經做這件事；圖鑑只是「成就感」用）
//   - 不放「在某天學會」（資料不夠久，等用 30 天後再加）
//   - 焦慮型友善：只顯示「我會了」的部分，不強調「還沒會的」
//   - 純展示頁，沒對錯、沒獎金、沒 sync 影響

import { masteryLevel } from './srs.js';

// 里程碑（純鼓勵用，不影響獎金）
const MILESTONES = [
  { n: 50,   icon: '🥉', name: '銅章' },
  { n: 100,  icon: '🥈', name: '銀章' },
  { n: 200,  icon: '🥇', name: '金章' },
  { n: 500,  icon: '💎', name: '鑽石' },
  { n: 1000, icon: '👑', name: '王者' },
];

export function startDexbook({ root, appData, wordStats, onBack }) {
  wordStats = wordStats || {};
  const categories = appData.categories || [];

  // 算每個分類的已會字（+ 整個分類的總數）
  const catStats = categories.map(cat => {
    const allWords = [];
    for (const unitName in cat.units) {
      for (const w of cat.units[unitName]) {
        allWords.push({ ...w, _unit: unitName });
      }
    }
    const mastered = allWords.filter(w => {
      const stat = wordStats[(w.en || '').toLowerCase()];
      return masteryLevel(stat) === 3;
    });
    // 排序：a-z 比較好找
    mastered.sort((a, b) => a.en.localeCompare(b.en));
    return {
      id: cat.id,
      name: cat.name,
      icon: cat.icon,
      total: allWords.length,
      mastered,
    };
  });

  // 全部已會總數
  const totalMastered = catStats.reduce((s, c) => s + c.mastered.length, 0);
  // 拿到的徽章
  const earnedMilestones = MILESTONES.filter(m => totalMastered >= m.n);
  const nextMilestone = MILESTONES.find(m => totalMastered < m.n);

  let expandedCatId = null;     // 哪個分類目前展開
  let expandedWordEn = null;    // 哪個字目前展開看詳情

  function render() {
    root.innerHTML = `
      <button class="back" id="back">← 回主畫面</button>
      <h1>🏆 我的字典</h1>

      <div class="dex-stat">
        <div class="dex-num">${totalMastered}</div>
        <div class="dex-label">字學會了</div>
        ${earnedMilestones.length > 0
          ? `<div class="dex-badges">${earnedMilestones.map(m => `<span class="dex-badge" title="${m.name} (${m.n} 字)">${m.icon}</span>`).join('')}</div>`
          : ''}
      </div>

      ${nextMilestone
        ? `<p class="dex-next">再 <b>${nextMilestone.n - totalMastered}</b> 個字就拿到 ${nextMilestone.icon} ${escapeHtml(nextMilestone.name)}</p>`
        : `<p class="dex-next">🎉 所有徽章都集滿了，太強了！</p>`}

      ${totalMastered === 0
        ? `<div class="card dex-empty"><p>還沒學會任何字。連續答對 3 次就會出現在這裡。</p><p class="muted small">去主畫面挑一個 unit 開始練吧！</p></div>`
        : catStats.map(cat => renderCategory(cat)).join('')}
    `;

    root.querySelector('#back').addEventListener('click', onBack);

    root.querySelectorAll('.dex-cat-header').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.dataset.id;
        expandedCatId = (expandedCatId === id) ? null : id;
        expandedWordEn = null;
        render();
      });
    });
    root.querySelectorAll('.dex-word').forEach(el => {
      el.addEventListener('click', () => {
        const en = el.dataset.en;
        expandedWordEn = (expandedWordEn === en) ? null : en;
        render();
      });
    });
  }

  function renderCategory(cat) {
    const isOpen = expandedCatId === cat.id;
    const arrow = isOpen ? '▼' : '▶';
    const pct = cat.total > 0 ? (cat.mastered.length / cat.total) * 100 : 0;

    return `
      <div class="dex-cat">
        <button class="dex-cat-header" data-id="${escapeHtml(cat.id)}">
          <span class="dex-cat-arrow">${arrow}</span>
          <span class="dex-cat-title">${cat.icon} ${escapeHtml(cat.name)}</span>
          <span class="dex-cat-count"><b>${cat.mastered.length}</b> / ${cat.total} 已會</span>
        </button>
        <div class="dex-cat-bar"><div class="dex-cat-fill" style="width:${pct}%"></div></div>
        ${isOpen ? renderWordList(cat) : ''}
      </div>
    `;
  }

  function renderWordList(cat) {
    if (cat.mastered.length === 0) {
      return `<div class="dex-word-list dex-empty-list"><p class="muted">這個分類還沒有學會的字</p></div>`;
    }
    return `
      <div class="dex-word-list">
        ${cat.mastered.map(w => {
          const isExpanded = expandedWordEn === w.en;
          return `
            <div class="dex-word-row">
              <button class="dex-word" data-en="${escapeHtml(w.en)}">
                <span class="dex-word-en">${escapeHtml(w.en)}</span>
                <span class="dex-word-zh">${escapeHtml(w.zh || '')}</span>
              </button>
              ${isExpanded ? renderWordDetail(w) : ''}
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  function renderWordDetail(w) {
    // 有 meanings array → 顯示所有 POS；沒有就只顯示 zh
    if (Array.isArray(w.meanings) && w.meanings.length > 0) {
      return `
        <div class="dex-word-detail">
          ${w.meanings.map(m =>
            `<div class="dex-meaning"><span class="dex-pos">${escapeHtml(m.pos)}.</span> ${escapeHtml(m.zh)}</div>`
          ).join('')}
        </div>
      `;
    }
    return `
      <div class="dex-word-detail">
        <div class="dex-meaning">${escapeHtml(w.zh || '')}</div>
      </div>
    `;
  }

  render();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}
