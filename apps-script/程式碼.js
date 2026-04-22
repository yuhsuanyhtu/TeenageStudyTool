// TeenageStudyTool — 學習紀錄 + 自動雲端備份 Apps Script 端點

const LOG_SHEET_ID = "10B3Cd6o3Bl1JoOgHwpy5rw-LDj419Z6xZPvichEhQqo";
const LOG_SHEET_NAME = "學習紀錄";
const BACKUP_SHEET_NAME = "state_backups";       // 舊分頁（3 欄，保留給歷史資料）
const BACKUP_V2_SHEET_NAME = "state_backups_v2"; // 新分頁（含「使用者」欄位）
const SNAPSHOT_SHEET_NAME = "migration_snapshots"; // 遷移前快照，永不覆蓋，出事 rollback 用
const LOG_HEADERS = [
  "時間", "事件", "單元", "題數", "對",
  "預測", "獎金", "待領零用錢", "累計已領", "連續打卡天數", "備註", "使用者"
];
const BACKUP_HEADERS = ["時間戳", "keys_count", "payload_json"]; // 舊 header，僅供建立空白分頁時使用
const BACKUP_V2_HEADERS = ["時間戳", "使用者", "keys_count", "payload_json"];
const SNAPSHOT_HEADERS = ["時間戳", "使用者", "keys_count", "payload_json", "備註"];

function getLogSheet_() {
  const ss = SpreadsheetApp.openById(LOG_SHEET_ID);
  let ws = ss.getSheetByName(LOG_SHEET_NAME);
  if (!ws) {
    ws = ss.insertSheet(LOG_SHEET_NAME);
  }
  if (ws.getLastColumn() === 0) {
    ws.getRange(1, 1, 1, LOG_HEADERS.length).setValues([LOG_HEADERS]);
    ws.setFrozenRows(1);
    const range = ws.getRange(1, 1, 1, LOG_HEADERS.length);
    range.setFontWeight("bold");
    range.setBackground("#6b9080");
    range.setFontColor("#ffffff");
  }
  return ws;
}

function getBackupSheet_() {
  const ss = SpreadsheetApp.openById(LOG_SHEET_ID);
  let ws = ss.getSheetByName(BACKUP_SHEET_NAME);
  if (!ws) {
    ws = ss.insertSheet(BACKUP_SHEET_NAME);
  }
  if (ws.getLastColumn() === 0) {
    ws.getRange(1, 1, 1, BACKUP_HEADERS.length).setValues([BACKUP_HEADERS]);
    ws.setFrozenRows(1);
    const range = ws.getRange(1, 1, 1, BACKUP_HEADERS.length);
    range.setFontWeight("bold");
    range.setBackground("#8b7aa0");
    range.setFontColor("#ffffff");
    ws.setColumnWidth(1, 160);
    ws.setColumnWidth(2, 90);
    ws.setColumnWidth(3, 600);
  }
  return ws;
}

function getBackupV2Sheet_() {
  const ss = SpreadsheetApp.openById(LOG_SHEET_ID);
  let ws = ss.getSheetByName(BACKUP_V2_SHEET_NAME);
  if (!ws) {
    ws = ss.insertSheet(BACKUP_V2_SHEET_NAME);
  }
  if (ws.getLastColumn() === 0) {
    ws.getRange(1, 1, 1, BACKUP_V2_HEADERS.length).setValues([BACKUP_V2_HEADERS]);
    ws.setFrozenRows(1);
    const range = ws.getRange(1, 1, 1, BACKUP_V2_HEADERS.length);
    range.setFontWeight("bold");
    range.setBackground("#8b7aa0");
    range.setFontColor("#ffffff");
    ws.setColumnWidth(1, 160);
    ws.setColumnWidth(2, 100);
    ws.setColumnWidth(3, 90);
    ws.setColumnWidth(4, 600);
  }
  return ws;
}

function getSnapshotSheet_() {
  const ss = SpreadsheetApp.openById(LOG_SHEET_ID);
  let ws = ss.getSheetByName(SNAPSHOT_SHEET_NAME);
  if (!ws) {
    ws = ss.insertSheet(SNAPSHOT_SHEET_NAME);
  }
  if (ws.getLastColumn() === 0) {
    ws.getRange(1, 1, 1, SNAPSHOT_HEADERS.length).setValues([SNAPSHOT_HEADERS]);
    ws.setFrozenRows(1);
    const range = ws.getRange(1, 1, 1, SNAPSHOT_HEADERS.length);
    range.setFontWeight("bold");
    range.setBackground("#c97b6b");
    range.setFontColor("#ffffff");
    ws.setColumnWidth(1, 160);
    ws.setColumnWidth(2, 100);
    ws.setColumnWidth(3, 90);
    ws.setColumnWidth(4, 600);
    ws.setColumnWidth(5, 200);
  }
  return ws;
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const now = new Date();
    const ts = Utilities.formatDate(now, "Asia/Taipei", "yyyy-MM-dd HH:mm:ss");
    const user = (body.user || "").toString().trim();
    const payloadStr = typeof body.payload === "string" ? body.payload : JSON.stringify(body.payload || {});
    const keysCount = body.keysCount || "";

    // 遷移前快照：獨立分頁，每位使用者第一次上雲時存一份，永不覆蓋
    if (body.event === "migration_snapshot") {
      const ws = getSnapshotSheet_();
      ws.appendRow([ts, user, keysCount, payloadStr, body.note || ""]);
      return jsonOut({ ok: true, saved: "snapshot" });
    }

    // 狀態備份：寫到 v2 分頁（含使用者欄位）
    if (body.event === "state_backup") {
      const ws = getBackupV2Sheet_();
      ws.appendRow([ts, user, keysCount, payloadStr]);
      return jsonOut({ ok: true, saved: "backup_v2" });
    }

    // 一般學習紀錄
    const ws = getLogSheet_();
    ws.appendRow([
      ts,
      body.event || "",
      body.unit || "",
      body.quizSize ?? "",
      body.correct ?? "",
      body.prediction ?? "",
      body.amount ?? "",
      body.money ?? "",
      body.totalPaid ?? "",
      body.streak ?? "",
      body.note || "",
      user || body.device || ""  // 優先用 user，舊版相容 device
    ]);
    return jsonOut({ ok: true, saved: "log" });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  }
}

function doGet(e) {
  // 事件清單端點：給前端重算狀態用
  // ?action=events&user=XXX → 回傳該使用者所有學習紀錄事件（由舊到新）
  if (e && e.parameter && e.parameter.action === "events") {
    try {
      const wantUser = (e.parameter.user || "").toString().trim();
      if (!wantUser) {
        return jsonOut({ ok: false, error: "missing user param" });
      }
      const ws = getLogSheet_();
      const vals = ws.getDataRange().getValues();
      // vals[0] = header：時間、事件、單元、題數、對、預測、獎金、待領零用錢、累計已領、連續打卡天數、備註、使用者
      const events = [];
      for (let i = 1; i < vals.length; i++) {
        const row = vals[i];
        const rowUser = (row[11] || "").toString().trim();
        if (rowUser !== wantUser) continue; // 過濾其他人 & 空 user（系統測試）
        const eventName = (row[1] || "").toString();
        if (!eventName) continue;
        // 過濾 test*/diag* 事件（雙保險）
        if (/^(test|diag)/i.test(eventName)) continue;
        // 時間欄：Sheet 可能把字串轉成 Date 物件，統一格式化成 yyyy-MM-dd HH:mm:ss
        const tsRaw = row[0];
        const tsStr = (tsRaw instanceof Date)
          ? Utilities.formatDate(tsRaw, "Asia/Taipei", "yyyy-MM-dd HH:mm:ss")
          : String(tsRaw);
        events.push({
          timestamp: tsStr,
          event: eventName,
          unit: row[2] === "" ? null : String(row[2]),
          quizSize: row[3] === "" ? null : Number(row[3]),
          correct: row[4] === "" ? null : Number(row[4]),
          prediction: row[5] === "" ? null : Number(row[5]),
          amount: row[6] === "" ? null : Number(row[6]),
          note: row[10] === "" ? "" : String(row[10]),
        });
      }
      // 附表頭時間已是順序寫入（appendRow 都追加在最後），時間字串可直接比字典序（yyyy-MM-dd HH:mm:ss）
      events.sort(function (a, b) { return a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0; });
      return jsonOut({ ok: true, user: wantUser, count: events.length, events: events });
    } catch (err) {
      return jsonOut({ ok: false, error: String(err) });
    }
  }

  // 還原端點：按使用者撈最後一筆備份
  if (e && e.parameter && e.parameter.action === "restore") {
    try {
      const wantUser = (e.parameter.user || "").toString().trim();

      // 先從 v2 分頁按使用者倒著找
      if (wantUser) {
        const wsV2 = getBackupV2Sheet_();
        const valsV2 = wsV2.getDataRange().getValues();
        // valsV2[0] = header, 從最後一列倒著找
        for (let i = valsV2.length - 1; i >= 1; i--) {
          const row = valsV2[i];
          const rowUser = (row[1] || "").toString().trim();
          if (rowUser === wantUser) {
            return jsonOut({
              ok: true,
              found: true,
              timestamp: String(row[0]),
              user: rowUser,
              keysCount: row[2],
              payload: String(row[3]),
            });
          }
        }
        // 查無此使用者 → 明確回 empty，前端才知道要保留本機
        return jsonOut({ ok: true, found: false, empty: true });
      }

      // 沒帶 user（舊客戶端相容）→ 回 v2 分頁最後一筆
      const wsV2 = getBackupV2Sheet_();
      const valsV2 = wsV2.getDataRange().getValues();
      if (valsV2.length > 1) {
        const last = valsV2[valsV2.length - 1];
        return jsonOut({
          ok: true,
          found: true,
          timestamp: String(last[0]),
          user: String(last[1] || ""),
          keysCount: last[2],
          payload: String(last[3]),
        });
      }
      // v2 也空 → fallback 看舊 v1 分頁（歷史相容）
      const ws = getBackupSheet_();
      const vals = ws.getDataRange().getValues();
      if (vals.length <= 1) return jsonOut({ ok: true, found: false, empty: true });
      const last = vals[vals.length - 1];
      return jsonOut({
        ok: true,
        found: true,
        timestamp: String(last[0]),
        keysCount: last[1],
        payload: String(last[2]),
        legacy: true,
      });
    } catch (err) {
      return jsonOut({ ok: false, error: String(err) });
    }
  }

  // 健康檢查
  return jsonOut({
    ok: true,
    service: "TeenageStudyTool log endpoint",
    hint: "POST JSON to log, GET ?action=restore&user=xxx for latest backup, GET ?action=events&user=xxx for event list"
  });
}

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// 手動測試用
function testLog() {
  const ws = getLogSheet_();
  ws.appendRow([
    Utilities.formatDate(new Date(), "Asia/Taipei", "yyyy-MM-dd HH:mm:ss"),
    "test", "testing", 10, 8, 6, 30, 70, 0, 3, "手動測試", ""
  ]);
}
function testBackup() {
  const ws = getBackupV2Sheet_();
  ws.appendRow([
    Utilities.formatDate(new Date(), "Asia/Taipei", "yyyy-MM-dd HH:mm:ss"),
    "測試人", 2, JSON.stringify({money: 40, streak: 3})
  ]);
}
function testSnapshot() {
  const ws = getSnapshotSheet_();
  ws.appendRow([
    Utilities.formatDate(new Date(), "Asia/Taipei", "yyyy-MM-dd HH:mm:ss"),
    "測試人", 3, JSON.stringify({money: 40, totalPaid: 0, streak: 3}), "手動測試快照"
  ]);
}
