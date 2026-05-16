# Stage 2 驗收：問名字 + 舊資料搬家（前端）

> **目前狀態：已 commit，還沒 push。**
> GitHub Pages 還是舊版，謙恩打開 App 還是舊畫面。
> **妳決定什麼時候 push 上線。**

---

## 我做完的事

- 改好 `docs/index.html`（前端）
- 本機已 commit（commit 訊息：`Stage 2: Story F 使用者名字 + localStorage key 遷移`）
- 已用 Node 模擬 localStorage 跑過 **6 項自動測試全通過**：
  1. 謙恩電腦有 deviceName=「謙恩」→ 無縫升級不彈窗
  2. 全空 → 彈窗預設「謙恩」
  3. 空白會重問直到有效
  4. deviceName=「未命名」→ 彈窗預設「謙恩」
  5. 第二次打開 App → 不會重搬
  6. 名字前後空格自動去除

---

## 為什麼要妳決定 push 時機

一 push，GitHub Pages 大約 1 分鐘後會部署，**謙恩下次打開就是新版**。
建議挑「謙恩不在旁邊 / 妳可以先自己開一次」的時機，例如他上學時。

---

## 建議流程

1. 妳回我「push」兩個字 → 我 push
2. 等 1–2 分鐘讓 GitHub 部署
3. **妳自己用謙恩的電腦打開他平常的 App 網址**（不要讓他看）
4. 對照下面清單

---

## 驗收清單

### A. 謙恩的電腦第一次打開

- [ ] **不會跳彈窗問名字**（因為從舊的 `deviceName="謙恩"` 無縫升級）
- [ ] 首頁副標改成「👤 謙恩」（原本是「🖥️ 謙恩 的電腦」）
- [ ] **待領零用錢、累計已領、連續打卡的數字跟昨天完全一樣** ← 這條最重要
- [ ] 家長總覽開頭改成「謙恩 的紀錄」
- [ ] 設定頁看得到「👤 使用者：謙恩」，「改名」按鈕不見了

### B. 雲端確認（開 Google Sheet）

- [ ] `migration_snapshots` 分頁多一列：使用者 = `謙恩`、備註 = `Stage 2 自動遷移舊 localStorage key` ← 這筆是謙恩資料的保險備份
- [ ] `state_backups_v2` 分頁多一列：使用者 = `謙恩`、payload 內容是 `{"謙恩:money":"...","謙恩:streak":"...",...}`

### C. 看 localStorage（可選，如果妳懂 F12）

打開 Chrome DevTools（F12）→ Application → Local Storage：
- [ ] `userName` = `"謙恩"`
- [ ] 看到很多 `謙恩:xxx` 開頭的 key
- [ ] 看得到 `__migration_backup_謙恩`（本機保險備份）
- [ ] **舊的沒前綴的 key（`money`, `streak`, `deviceName` 等）應該全不見了**

---

## ❌ 看到這些就停下來告訴我

- 待領零用錢變 $0 或數字不對
- 連續打卡變 0
- 首頁彈出「你是誰？」的 prompt（表示無縫升級沒跑）
- 畫面空白 / 卡住 / 一片亂碼

---

## 出問題 → 我自己處理

妳**只要說一聲**「Stage 2 有問題」，我會：
1. `git revert && git push` 回舊版（謙恩下次打開就恢復）
2. 查本機 `__migration_backup_謙恩` + 雲端 `migration_snapshots` 確認原值
3. 如果真的要手動修數字我會給妳一個「貼一行到 console」的指令

**妳不用碰 git、不用抄數字、不用自己復原。**

---

## 驗收通過 → 回「Stage 2 OK」

我就開始 Stage 3（完整雲端同步：每次做題自動上雲、無痕模式打開能還原）。
