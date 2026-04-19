// TeenageStudyTool — 學習紀錄 Apps Script 端點
// 接收 app 送來的事件，寫進學習紀錄 Sheet

const LOG_SHEET_ID = "10B3Cd6o3Bl1JoOgHwpy5rw-LDj419Z6xZPvichEhQqo";
const LOG_SHEET_NAME = "學習紀錄";
const HEADERS = [
  "時間", "事件", "單元", "題數", "對",
  "預測", "獎金", "本期零用錢", "累計已領", "連勝天數", "備註"
];

function getLogSheet_() {
  const ss = SpreadsheetApp.openById(LOG_SHEET_ID);
  let ws = ss.getSheetByName(LOG_SHEET_NAME);
  if (!ws) {
    ws = ss.insertSheet(LOG_SHEET_NAME);
  }
  // 確保有 header
  const lastCol = ws.getLastColumn();
  if (lastCol === 0) {
    ws.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    ws.setFrozenRows(1);
    const range = ws.getRange(1, 1, 1, HEADERS.length);
    range.setFontWeight("bold");
    range.setBackground("#6b9080");
    range.setFontColor("#ffffff");
    ws.setColumnWidth(1, 160);
    ws.setColumnWidth(2, 120);
    ws.setColumnWidth(3, 120);
  }
  return ws;
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const ws = getLogSheet_();
    const now = new Date();
    const row = [
      Utilities.formatDate(now, "Asia/Taipei", "yyyy-MM-dd HH:mm:ss"),
      body.event || "",
      body.unit || "",
      body.quizSize ?? "",
      body.correct ?? "",
      body.prediction ?? "",
      body.amount ?? "",
      body.money ?? "",
      body.totalPaid ?? "",
      body.streak ?? "",
      body.note || ""
    ];
    ws.appendRow(row);
    return ContentService
      .createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  // 健康檢查：打開 URL 用瀏覽器看會看到這段
  return ContentService
    .createTextOutput(JSON.stringify({
      ok: true,
      service: "TeenageStudyTool log endpoint",
      hint: "POST JSON here to log an event."
    }))
    .setMimeType(ContentService.MimeType.JSON);
}

// 手動測試用：在 Apps Script 編輯器點「執行」就會寫一筆測試資料
function testLog() {
  const ws = getLogSheet_();
  ws.appendRow([
    Utilities.formatDate(new Date(), "Asia/Taipei", "yyyy-MM-dd HH:mm:ss"),
    "test",
    "testing",
    10, 8, 6, 30, 70, 0, 3, "手動測試"
  ]);
}
