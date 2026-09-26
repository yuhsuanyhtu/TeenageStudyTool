// subject-bar.js — 科目列（v2.56）
//
// 為什麼：孩子的書籤直接開 /v2/（英文），進來之後沒有路去國文、數學、自然、社會，
// 國文與會考題上線後零使用。每個「首頁」畫面最上面放一排科目，一鍵換科。
// 只放在首頁畫面（不放在作答中），避免做到一半誤點離開。
//
// 用法：
//   v2：模板裡放 ${subjectBarHTML('en')}（或 'soc'／'sci'／'math'／'cn-hk'＝國文會考）
//   國文：mountSubjectBar(document.getElementById('subjectBar'), 'cn')

// 這支檔在 docs/v2/js/，往上兩層就是 docs/（學習系統首頁）
const BASE = new URL('../../', import.meta.url);

const SUBJECTS = [
  { id: 'en',   emoji: '🔤', label: '英文', href: 'v2/' },
  { id: 'cn',   emoji: '📖', label: '國文', href: 'chinese/' },
  { id: 'cn-hk', emoji: '📜', label: '國文會考', href: 'v2/#hk=cn' },
  { id: 'math', emoji: '📐', label: '數學', href: 'v2/#hk=math' },
  { id: 'sci',  emoji: '🔬', label: '自然', href: 'v2/#hk=sci' },
  { id: 'soc',  emoji: '🌏', label: '社會', href: 'v2/#hk=soc' },
];

const CSS = `
.sbar{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 16px;padding:2px 0 6px}
.sbar a{flex:0 0 auto;display:flex;align-items:center;gap:4px;padding:8px 12px;border-radius:999px;
  background:#fff;border:1px solid #e3dccf;color:#4a4a4a;text-decoration:none;font-size:15px;line-height:1;white-space:nowrap}
.sbar a:hover{border-color:#6b9080}
.sbar a.on{background:#6b9080;border-color:#6b9080;color:#fff;font-weight:600}
.sbar a.home{color:#8a7f6e}
`;

function ensureStyle() {
  if (document.getElementById('sbar-style')) return;
  const st = document.createElement('style');
  st.id = 'sbar-style';
  st.textContent = CSS;
  document.head.appendChild(st);
}

// current：en | cn | cn-hk | math | sci | soc
export function subjectBarHTML(current) {
  ensureStyle();
  const cur = current;
  const links = SUBJECTS.map(s =>
    `<a href="${new URL(s.href, BASE).href}" class="${s.id === cur ? 'on' : ''}"${s.id === cur ? ' aria-current="page"' : ''}>${s.emoji} ${s.label}</a>`
  ).join('');
  return `<nav class="sbar" aria-label="換科目"><a class="home" href="${BASE.href}">🏠 全部</a>${links}</nav>`;
}

export function mountSubjectBar(el, current) {
  if (el) el.innerHTML = subjectBarHTML(current);
}

// v2 的科目頁是同一個 index.html 靠 #hk= 切換，只換 hash 不會重新載入 → 手動 reload。
document.addEventListener('click', (e) => {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;   // 開新分頁照瀏覽器預設
  const a = e.target.closest && e.target.closest('.sbar a');
  if (!a) return;
  const to = new URL(a.href);
  if (to.pathname === location.pathname && to.search === location.search && to.hash && to.hash !== location.hash) {
    e.preventDefault();
    location.href = to.href;
    location.reload();
  }
});
