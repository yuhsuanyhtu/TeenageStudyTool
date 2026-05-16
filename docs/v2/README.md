# v2 — 乾淨重寫版

舊版 `docs/index.html` 完全不動。這裡是平行開發的新版，預覽網址：
`https://yuhsuanyhtu.github.io/TeenageStudyTool/v2/`

## 設計原則

1. **零框架、零 build step** — 純 vanilla JS + ES modules，`git push` 就部署
2. **每檔 < 200 行** — 改 A 不會壞 B
3. **資料 / 邏輯 / UI 分層** — JSON 字庫獨立於程式碼
4. **獎金規則來自第一階段研究報告**（基礎 10 + 每答對 +2 + 連勝階梯加成 + 保護卡）

## 目錄

```
v2/
├─ index.html              極簡 shell
├─ css/style.css           樣式
├─ js/
│  ├─ main.js              入口、路由、組合
│  ├─ state.js             localStorage 狀態
│  ├─ reward.js            獎金計算與連勝（純函式，可單測）
│  ├─ tts.js               文字轉語音 + 高品質 voice 挑選
│  ├─ data-loader.js       載入 data/*.json
│  ├─ logger.js            POST 事件到既有 Google Sheet（用舊端點）
│  ├─ rules.js             規則頁（從 reward.js 自動生成）
│  └─ modes/
│     ├─ match.js          連連看
│     ├─ en2zh.js          英→中 4 選 1
│     └─ zh2en.js          中→英 拼字（多正解，解決 each/every 問題）
└─ data/
   ├─ units-meta.json      列出有哪些字庫檔
   ├─ textbook-y1-fall.json   一上字庫（從舊版 VOCAB 抽出）
   └─ textbook-y1-spring.json 一下字庫
```

## 怎麼新增字庫

1. 在 `data/` 放新的 `.json`，格式：
   ```json
   {
     "我的單元名": [
       { "en": "apple", "zh": "蘋果" },
       ...
     ]
   }
   ```
2. 把檔名加進 `data/units-meta.json` 的 `files` 陣列
3. 重新整理頁面，新單元自動出現在主畫面

不用動任何程式碼。

## 怎麼新增題型

1. 在 `js/modes/` 新建 `<新模式>.js`，匯出一個 `start<NewMode>Mode({ root, words, onComplete })`
2. 在 `js/main.js` import 並在 `renderModePicker()` 與 `startMode()` 加按鈕
3. 完成回呼必須回傳 `{ sessionCorrect, totalQuestions, message }`，獎金與連勝會自動算

## 本地測試

ES modules 不能用 `file://` 開，要起一個 server：

```bash
cd docs/v2
python3 -m http.server 8000
# 瀏覽器開 http://localhost:8000
```

或者直接 push 到 GitHub Pages 看。

## 已知尚未實作（v2 之後再加）

- SRS（間隔複習）排程：下次該複習哪些字
- ECDICT 字典資料疊加，自動補正翻譯
- ABC 互動英語雜誌字庫（等找到無痛單字來源）
- GEPT 初級 / 教育部 2000 字 字庫（同上）
- 自動發音的 mp3 快取（Free Dictionary API），降低對裝置 TTS 品質的依賴
- 設定頁：手動切換 voice、調整獎金、查看歷史紀錄
- 家長端 dashboard
- pagehide log 中途離開（目前 v2 只在按「中途離開」按鈕時才 log，關瀏覽器不 log）

## Google Sheet 紀錄

每次完成或中途離開都 POST 到既有的 Apps Script 端點，事件名加 `v2_` 前綴方便和舊版區分：
- `v2_match_done` / `v2_match_abandoned`
- `v2_en2zh_done` / `v2_en2zh_abandoned`
- `v2_zh2en_done` / `v2_zh2en_abandoned`

Sheet 網址：https://docs.google.com/spreadsheets/d/10B3Cd6o3Bl1JoOgHwpy5rw-LDj419Z6xZPvichEhQqo/

## 與舊版的關係

舊版位於 `docs/index.html`，**完全不動**。當 v2 經過實際使用驗證 OK 後，可選擇：
- 把 `docs/index.html` 改為導向 `v2/`
- 或把 v2 內容上提到 `docs/` 根目錄取代舊版
