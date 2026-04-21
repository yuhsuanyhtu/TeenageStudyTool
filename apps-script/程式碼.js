// TeenageStudyTool — 學習紀錄 + 自動雲端備份 Apps Script 端點

const LOG_SHEET_ID = "10B3Cd6o3Bl1JoOgHwpy5rw-LDj419Z6xZPvichEhQqo";
const LOG_SHEET_NAME = "學習紀錄";
const BACKUP_SHEET_NAME = "state_backups";
const LOG_HEADERS = [
  "時間", "事件", "單元", "題數", "對",
  "預測", "獎金", "本期零用錢", "累計已領", "連續打卡天數", "備註", "裝置"
];
const BACKUP_HEADERS = ["時間戳", "keys_count", "payload_json"];

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

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const now = new Date();
    const ts = Utilities.formatDate(now, "Asia/Taipei", "yyyy-MM-dd HH:mm:ss");

    // 狀態備份寫到另一個 tab
    if (body.event === "state_backup") {
      const ws = getBackupSheet_();
      const payloadStr = typeof body.payload === "string" ? body.payload : JSON.stringify(body.payload || {});
      ws.appendRow([ts, body.keysCount || "", payloadStr]);
      return jsonOut({ ok: true, saved: "backup" });
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
      body.device || ""
    ]);
    return jsonOut({ ok: true, saved: "log" });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  }
}

function doGet(e) {
  // 還原端點：回傳最後一筆備份
  if (e && e.parameter && e.parameter.action === "restore") {
    try {
      const ws = getBackupSheet_();
      const vals = ws.getDataRange().getValues();
      if (vals.length <= 1) return jsonOut({ ok: false, error: "尚無備份" });
      const last = vals[vals.length - 1];
      return jsonOut({ ok: true, timestamp: String(last[0]), keysCount: last[1], payload: String(last[2]) });
    } catch (err) {
      return jsonOut({ ok: false, error: String(err) });
    }
  }
  // 健康檢查
  return jsonOut({
    ok: true,
    service: "TeenageStudyTool log endpoint",
    hint: "POST JSON to log, or GET ?action=restore for latest backup"
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
    "test", "testing", 10, 8, 6, 30, 70, 0, 3, "手動測試"
  ]);
}
function testBackup() {
  const ws = getBackupSheet_();
  ws.appendRow([
    Utilities.formatDate(new Date(), "Asia/Taipei", "yyyy-MM-dd HH:mm:ss"),
    2, JSON.stringify({money: 40, streak: 3})
  ]);
}
