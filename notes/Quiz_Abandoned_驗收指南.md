# quiz_abandoned 驗收指南（測驗中途離開追蹤）

> 因為謙恩昨天「做錯一個就關瀏覽器」導致 Sheet 查無紀錄，加個機制讓媽媽以後看得到他的嘗試。

---

## 我做完的事

### 前端（[docs/index.html](../docs/index.html)）

1. **`logQuizAbandoned(reason)`** — 新函式
   - 用 `navigator.sendBeacon` 確保頁面關閉前真的送出
   - fallback: `fetch(..., { keepalive: true })`
   - 事件名：`quiz_abandoned`（弱字模式是 `weak_quiz_abandoned`）
   - 備註欄：`中途離開（關瀏覽器/切換畫面，做到第 N/M 題）`

2. **兩個觸發點**
   - **關瀏覽器 / 關分頁 / 按 F5 重整**：`window.addEventListener('pagehide', ...)`
   - **按「回首頁」或其他返回按鈕**：`go(screen)` 偵測從 `quizQuestion` 切到非 `quizResult`

3. **防重複**
   - `_abandonedSent` 旗標，同一次測驗只送一次
   - 新測驗開始時 `resetAbandonedFlag()` 清除
   - 已答完整套（做到最後一題）不算 abandoned

4. **後端不用改**
   - `doPost` 通用事件處理已會把 `quiz_abandoned` 寫到「學習紀錄」分頁
   - `?action=events&user=謙恩` 會看到
   - `?action=all&days=N` 會看到

### 不會誤觸發的情況
- ✗ 打開 App 但還沒開始測驗
- ✗ 測驗開始但還沒答任何一題
- ✗ 完整做完（即使到結果頁才關）
- ✗ 非測驗畫面關瀏覽器

### 會觸發的情況
- ✓ 測驗中（至少答 1 題）→ 關瀏覽器
- ✓ 測驗中 → 按「回首頁」、「換模式」等返回按鈕
- ✓ 測驗中 → 按 F5 重整

---

## 這改動追溯嗎？

**不追溯**。謙恩昨天 4/22 的行為永遠查不到了。
**今天之後**他做的每一次中途放棄都會進 Sheet。

---

## 妳要做的事（1 分鐘，回家後做）

### 驗證方法

1. 妳自己打開 App（自己電腦也可以）
2. 隨便選一課 → 進測驗
3. **答對 1 題、答錯 1 題**
4. **直接關瀏覽器**（或按 F5、或按返回按鈕）
5. 重開 App → 家長總覽 → 「完整紀錄（自動上傳）」→ 按「開啟學習紀錄 Sheet」
6. Sheet 最下面應該多一列：
   ```
   事件: quiz_abandoned
   單元: 一下 Unit 3（或妳選的那課）
   題數: 6（妳測驗的總題數）
   對: 1
   預測: 妳預測的數字
   備註: 中途離開（關瀏覽器，做到第 2/6 題）
   使用者: 妳的名字
   ```

### 驗收條件
- ✓ Sheet 真的多了一列 `quiz_abandoned`
- ✓ 題數、對、預測、做到第幾題 都對
- ✓ 用「測試-媽媽」名字測試，驗完可手動刪列

---

## 之後怎麼幫謙恩

Sheet 累積一段時間後，妳可以看：
- **他每天嘗試幾次**（數 quiz_abandoned 事件）
- **每次做到第幾題放棄**（看備註）
- **哪一課讓他特別挫折**（看單元欄位）
- **哪些題數他能撐完 vs 放棄**（對照 quiz_done vs quiz_abandoned）

有數據後比較好跟他談，不是感覺對感覺。

---

## ❌ 看到這些就停下來告訴我

- 明明做完整套測驗（有看到結果頁），Sheet 還是多一筆 `quiz_abandoned`（誤觸發）
- 中途關瀏覽器，Sheet 沒多任何東西（sendBeacon 失效）
- 正常的 `quiz_done` 紀錄消失（回歸）

## 驗收通過 → 回「abandoned OK」
