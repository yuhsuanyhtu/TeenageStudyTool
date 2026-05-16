# Stage 1 驗收：Apps Script 改動

> **後端改動已由 clasp 自動部署完成，URL 沒變（還是原本那個 AKfycbw1...）。**
> 我也自己跑過端點測試，全部通過。
> 你只要打開 Google Sheet 確認一眼就好，約 1 分鐘。

---

## 我已經做完的事

- ✅ 改寫 `apps-script/程式碼.js`（加 user 欄位、新增兩個分頁、restore 按使用者）
- ✅ `clasp push` 上傳 + `clasp deploy` 更新既有部署（v3 → v4，URL 不變）
- ✅ 自動端點測試：
  - 健康檢查回應正常
  - `restore?user=阿貓阿狗` → 回 `{empty:true}` ✓
  - `POST state_backup` 寫入 v2 分頁 ✓（後續 restore 能撈回驗證）
  - `POST migration_snapshot` 寫入快照分頁 ✓
  - `POST` 一般事件帶 `user` 欄位 ✓

---

## 你要做的事（1 分鐘）

打開「謙恩的學習紀錄」Google Sheet，**檢查這三件事**：

### 檢查 ①：多了兩個新分頁

底下分頁列應該多出：
- [ ] `state_backups_v2`
- [ ] `migration_snapshots`

### 檢查 ②：兩個新分頁各有一筆測試資料

- [ ] `state_backups_v2` 分頁最後一列：使用者 = `測試自動化`，payload 裡面寫 `{"money":99,"streak":1}`
- [ ] `migration_snapshots` 分頁最後一列：使用者 = `測試自動化`，備註 = `claude 自動測`

### 檢查 ③：原本的資料沒被動到

- [ ] 「學習紀錄」分頁最後會多一列 `事件=test_automation / 使用者=測試自動化 / 備註=claude 自動驗證 L 欄`（這是我剛測的，無害）
- [ ] **更早以前**的紀錄全部還在、沒被動到、欄位沒錯位
- [ ] 舊的 `state_backups` 分頁也沒被動

---

## 可選：清掉測試資料

想把 `測試自動化` 那幾筆刪掉也行（不刪也沒事）。

---

## 驗收通過 → 回「Stage 1 OK」

三個檢查都過 → 回我「Stage 1 OK」，我開始做 Stage 2（前端問名字 + 舊資料搬家）。

## 出事了怎麼辦？

**任何一項對不上**：截圖給我，不要自己修。

**最壞情況 rollback**：跟我說一聲，我會用 clasp 回退到 v3 部署（URL 不變）。
