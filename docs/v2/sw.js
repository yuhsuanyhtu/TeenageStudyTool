// sw.js — v2.43 Service Worker：讓第二次開始「秒開」＋離線也能練
//
// 為什麼需要：
//   GitHub Pages 的快取只有 10 分鐘（max-age=600）。超過 10 分鐘再開，瀏覽器要把
//   33 個檔（20 個 JS 模組 + 13 個字庫 JSON）逐一回伺服器確認，ES module 又是一層一層
//   抓（6 層），量到主畫面出來要 3.5–4.4 秒。孩子每天開一次就每天等一次。
//
// 策略（零維護：改版不用來這裡改版本號）：
//   - index.html（導覽請求）：網路優先、3 秒沒回就用快取 → 上線新版時立刻拿到新首頁，斷網也開得起來
//   - js/css/data 同源檔：快取優先、背景重新驗證（stale-while-revalidate）
//       → 畫面永遠用本機快取秒開；背景抓到新版（ETag 不同）就通知頁面顯示「有新版本」
//   - 跨網域（Google Apps Script、字典 API）：一律不碰，直接走網路
//
// 版本：只有在「快取格式」要換時才需要改 CACHE_NAME；一般改版不用動這裡。

const CACHE_NAME = 'sv2-runtime-v1';
const NAV_TIMEOUT_MS = 3000;

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

function isSameOrigin(url) {
  return url.origin === self.location.origin;
}

// 只快取 scope 底下的靜態資源（js / css / data / html）
function isCacheable(url) {
  if (!isSameOrigin(url)) return false;
  const scope = new URL(self.registration.scope).pathname;
  if (!url.pathname.startsWith(scope)) return false;
  return /\.(js|css|json|html)$/.test(url.pathname) || url.pathname.endsWith('/');
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (!isCacheable(url)) return;

  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(req));
  } else {
    event.respondWith(staleWhileRevalidate(req));
  }
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), NAV_TIMEOUT_MS);
    const res = await fetch(req, { signal: ctrl.signal });
    clearTimeout(timer);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (e) {
    const cached = await cache.match(req, { ignoreSearch: true });
    if (cached) return cached;
    throw e;
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(req);
  const refresh = fetch(req).then(async (res) => {
    if (!res || !res.ok) return res;
    if (cached && changed(cached, res)) notifyClients(req.url);
    await cache.put(req, res.clone());
    return res;
  }).catch(() => null);
  if (cached) return cached;
  const fresh = await refresh;
  if (fresh) return fresh;
  return new Response('', { status: 504, statusText: 'offline' });
}

// 用 ETag / Last-Modified / Content-Length 判斷檔案有沒有變
function changed(oldRes, newRes) {
  const keys = ['etag', 'last-modified', 'content-length'];
  for (const k of keys) {
    const a = oldRes.headers.get(k);
    const b = newRes.headers.get(k);
    if (a && b) return a !== b;
  }
  return false;
}

let notified = false;
async function notifyClients(url) {
  if (notified) return;   // 一次改版只通知一次
  notified = true;
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const c of clients) c.postMessage({ type: 'sv2-updated', url });
}
