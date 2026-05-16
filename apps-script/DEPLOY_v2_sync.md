# v2 跨裝置同步：Apps Script 部署步驟

v2.5 加了「從 Google Sheet 重算累計獎金 / 連勝」功能，需要重新部署 Apps Script 一次（之後不用每次都做）。

---

## 方法 A：用 clasp（推薦，3 個指令搞定）

你 `.clasp.json` 都設好了，直接：

```bash
cd ~/GitHub/TeenageStudyTool/apps-script

# 1. 推本機 程式碼.js 到雲端
clasp push

# 2. 列出現有部署，找 Web App 那個的 deploymentId
clasp deployments
# 會看到一行像：
#   - AKfycbw1-aQQF4goCDF6X7_oIHEk4rVIbRrDADkq5ZQ1kopePXVehu9EGkkCNnj3Z4Hxd1aW7w @1 - "..."
# 那串 AKfyc... 就是 deploymentId（也是現在 LOG_WEBAPP_URL 中段那串）

# 3. 用同一個 deploymentId 部署新版本（URL 保持不變）
clasp deploy \
  --deploymentId AKfycbw1-aQQF4goCDF6X7_oIHEk4rVIbRrDADkq5ZQ1kopePXVehu9EGkkCNnj3Z4Hxd1aW7w \
  --description "Add v2_events action"
```

關鍵：**用 `--deploymentId` 才會更新「現有那個 URL」**，不指定的話會建新部署、URL 會變、v2 連不到。

如果 `clasp` 沒裝過：`npm install -g @google/clasp` 然後 `clasp login` 一次。

---

## 方法 B：手動（如果 clasp 出狀況才用）

1. 開 https://script.google.com 找 TeenageStudyTool 專案
2. 把 `apps-script/程式碼.js` 全選複製 → 貼到編輯器蓋掉
3. Cmd+S 儲存
4. 右上「部署」→「管理部署作業」→ 編輯（鉛筆）→ **版本選「新版本」** → 部署
5. URL 保持不變 ✓

---

## 確認部署成功

瀏覽器打開：
```
https://script.google.com/macros/s/AKfycbw1-aQQF4goCDF6X7_oIHEk4rVIbRrDADkq5ZQ1kopePXVehu9EGkkCNnj3Z4Hxd1aW7w/exec?action=v2_events
```

正常會回：
```json
{ "ok": true, "count": NN, "events": [...] }
```

如果回 health check 訊息（`hint: "POST JSON to log, ..."`），表示新版沒部署成功 → 重做。

到 v2 重新整理，主畫面下方應該看到 **「✓ 已同步（XX 筆事件、X 天打卡）」**。

---

## 失敗也沒關係

v2 偵測不到新端點時會自動退回「離線模式」，主畫面下方顯示 **「⚠ 離線」**。系統照常能用，只是兩台裝置看到的數字不會自動一致。下次有空再部署即可。
