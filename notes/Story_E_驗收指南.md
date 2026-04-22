# Story E 驗收指南（雲端同步 Loading — A 方案）

> **目前狀態**：已 commit + push。GitHub Pages 1 分鐘後上線。
> 謙恩下次打開 App 就是新版，但**日常使用完全看不出差別**（因為他本機有資料，會直接進首頁）。
> 只有**無痕模式開啟**或**新裝置**會看到 loading 畫面。

---

## 我做完的事

### 前端（[docs/index.html](../docs/index.html)）
- `tryFetchBackupOrFail(user, timeoutMs)` — 帶 AbortController 超時的 fetch，回 `{status: 'found'|'empty'|'timeout'|'error'}`
- `renderLoading(user)` — 顯示「✨ 正在從雲端載入進度…」
- `renderRestoreError(user, result)` — 雲端連不上時顯示重試 / 以空白繼續按鈕
- `bootApp()` 改 A 方案流程：
  - 本機有資料 → 立刻進首頁（**日常情境**，不等雲端）
  - 本機空 → 顯示 loading，等雲端回（timeout 8 秒）
  - 雲端有資料 → apply 後進首頁
  - 雲端也空 → 進首頁（空狀態，新使用者）
  - 超時／錯誤 → 顯示錯誤頁（重試 or 以空白繼續）

### 自驗測試（Node 跑真實 Apps Script 端點，5/5 過）
- ✓ user=謙恩 → status: found（雲端有備份）
- ✓ user=不存在的人 → status: empty
- ✓ timeout=1ms 故意過小 → status: timeout（AbortController 有效）
- ✓ 無效 URL → status: error
- ✓ user=null → status: error, reason: no-user

> 測試檔 `/tmp/test-boot-fetch.js`，跑 `node /tmp/test-boot-fetch.js` 可重現

---

## 一個需要妳決策的偏離

**規格 §4.1 嚴格寫**：「打開 App → 先顯示 loading 畫面 → 資料回來才進首頁」

**我實作成**：
- 本機有資料 → **跳過 loading**，直接進首頁
- 本機空 → 走完整 loading → 等雲端

**理由**：規格「先 loading」的動機是「無痕模式 localStorage 永遠是空的，不讓孩子看到 $0 打擊士氣」。本機有資料時這個動機不存在。謙恩日常打開 App 會多等 2-4 秒看 loading 轉圈是不必要的。

**如果妳要嚴格 A 方案**（每次打開都 loading）→ 跟我說「E 改成每次都 loading」，我改一行即可。

---

## 妳要做的事（30 秒，回家再做也行）

### 驗證情境：無痕模式打開應該先看到 loading

1. 瀏覽器開**無痕視窗**（Chrome: Cmd/Ctrl + Shift + N）
2. 貼網址：`https://yuhsuanyhtu.github.io/TeenageStudyTool/`
3. 會跳「👤 你是誰？」彈窗 → 直接按 Enter（預設謙恩）
4. 按完 Enter 後：
   - **預期**：看到「✨ 謙恩，正在從雲端載入進度…」幾秒 → 自動進首頁，顯示 $20 / 連續 1 天（謙恩雲端備份的狀態）
   - **不預期**：先看到 $0 → 才變 $20（這是舊版的 B 方案，不該發生）
5. 如果看到 loading 然後進首頁顯示對的數字 → **Story E 驗收通過**
6. 關掉無痕視窗（裡面的 state 會丟，不影響謙恩）

### 日常使用不會看到 loading

謙恩正常打開 App（本機有資料），**看不到 loading 也是正常的**——因為新流程是「本機有資料直接進首頁」。

---

## ❌ 看到這些就停下來告訴我

- 無痕模式打開後，畫面卡在 loading 超過 10 秒
- 看到 loading 後進首頁顯示 $0（應該顯示雲端 $20）
- 看到 😵 錯誤頁：代表 Apps Script 或網路有問題，**按「重試」**即可。如果重試 3 次還是錯誤 → 告訴我

---

## 驗收通過 → 回「E 通過」

我繼續下一個（Story C 可選金額發放，$100 倍數選擇）。

## 回退指引

Story E 只改啟動流程，**不會動資料**。出事的話直接 `git revert` 就還原。
