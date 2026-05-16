# v2 跨裝置同步：Apps Script 部署步驟

v2.5 加了「從 Google Sheet 重算累計獎金 / 連勝」功能，讓兩台裝置看到的數字一致。

**這需要重新部署 Apps Script 一次**（之後不用每次都做）。

---

## 為什麼需要部署

v2 會打 `?action=v2_events` 去你的 Apps Script 端點，把所有事件抓回來重新加總。
這個 action 是新加的，現在的舊端點還沒有，**你不部署的話 v2 會「離線模式」用本地數字**（不會壞，但跨裝置不會一致）。

---

## 步驟（5 分鐘）

### 1. 打開 Apps Script 編輯器

到 https://script.google.com → 找「TeenageStudyTool」（或當初命名的）專案打開。

### 2. 用新版程式碼取代

把 `apps-script/程式碼.js` 整個檔案的內容 **全選複製** → 貼到 Apps Script 編輯器，**蓋掉舊內容**。

（差異只有新增一個 `if (action === "v2_events")` 區塊，其餘完全相同。如果你想保守，也可以只插那一段，但整檔覆蓋最不會出錯。）

### 3. 存檔 + 部署

1. 點工具列的儲存（💾 圖示，或 Cmd+S）
2. 右上角點 **「部署」→「管理部署作業」**
3. 找到現在那個 Web 應用程式部署 → 點旁邊的 ✏️ 鉛筆圖示「編輯」
4. **「版本」下拉選「新版本」**
5. 描述欄填「Add v2_events action」（隨便寫，自己看得懂就好）
6. 點「部署」
7. URL 保持不變 ✓（重點：用「編輯」不是「新增部署」，URL 才會一樣）

### 4. 確認

瀏覽器打開：
```
https://script.google.com/macros/s/AKfycbw1-aQQF4goCDF6X7_oIHEk4rVIbRrDADkq5ZQ1kopePXVehu9EGkkCNnj3Z4Hxd1aW7w/exec?action=v2_events
```

正常會回傳：
```json
{ "ok": true, "count": 12, "events": [...] }
```

如果還是回 health check 訊息 `{ "ok": true, "service": "...", "hint": "..." }`，表示部署沒成功（沒新版本），重做步驟 3。

### 5. 回 v2 確認

到 https://yuhsuanyhtu.github.io/TeenageStudyTool/v2/ 重新整理。
主畫面下方應該看到 **「✓ 已同步（XX 筆事件、X 天打卡）」**。
看到這個就表示成功了。

---

## 失敗也沒關係

如果部署失敗，v2 會自動退回「離線模式」（用本地 localStorage 的數字），主畫面下方會顯示 **「⚠ 離線（HTTP 404）」** 或類似訊息。

整個系統還是能用，只是兩台裝置看到的數字不會自動一致。
你下次有空再來部署即可，不會搞壞東西。
