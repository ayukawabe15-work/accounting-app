/***** Google Drive 連携（元の厳密版） *****/
const CLIENT_ID = "91348359952-pns9nlvg8tr82p6ht791c31gg5meh98q.apps.googleusercontent.com"; // ←必ずご自身のIDに
const SCOPES = "https://www.googleapis.com/auth/drive.file";

let tokenClient = null;
let gapiInited = false;
let gisInited = false;

const loginBtn = document.getElementById("loginBtn");
const loginStatus = document.getElementById("loginStatus");

// gapi 読み込み完了で呼ばれる（index.html の onload から）
function gapiLoaded() {
  try {
    gapi.load("client", initializeGapiClient);
  } catch (e) {
    console.error("gapiLoaded error:", e);
  }
}

async function initializeGapiClient() {
  try {
    await gapi.client.init({});
    await gapi.client.load("drive", "v3"); // Drive の discovery をロード
    gapiInited = true;
    maybeEnableLogin();
  } catch (e) {
    console.error("initializeGapiClient error:", e);
  }
}

// GIS 読み込み完了で呼ばれる（index.html の onload から）
function gisLoaded() {
  try {
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPES,
      callback: (resp) => {
        if (resp.error) {
          console.error(resp);
          alert("Google 連携でエラーが発生しました。");
          return;
        }
        if (loginStatus) loginStatus.textContent = "ログイン済み";
      },
    });
    gisInited = true;
    maybeEnableLogin();
  } catch (e) {
    console.error("gisLoaded error:", e);
  }
}

// ★ 元の仕様：gapi と GIS が両方 ready になったらボタンを有効化
function maybeEnableLogin() {
  if (gapiInited && gisInited && loginBtn) {
    loginBtn.disabled = false;
    loginBtn.classList.remove("is-disabled");
  }
}

// ログインボタン
if (loginBtn) {
  loginBtn.addEventListener("click", () => {
    if (!tokenClient) {
      alert("Google ライブラリの読み込み待機中です。少し待って再度お試しください。");
      return;
    }
    tokenClient.requestAccessToken({ prompt: "" }); // 既存許可なら無言取得
  });
}

/** Drive アップロード（従来前提: gapi は既にロード済み） */
async function uploadToDrive(file) {
  if (!file) return null;

  // アクセストークンが無い場合は事前にログインしてもらう
  if (!gapi.client.getToken()) {
    alert("Drive にアップロードするには Google にログインしてください。");
    return null;
  }

  const metadata = {
    name: file.name,
    mimeType: file.type || "application/octet-stream",
  };
  const boundary = "-------314159265358979323846";
  const delimiter = "\r\n--" + boundary + "\r\n";
  const closeDelimiter = "\r\n--" + boundary + "--";

  const reader = await file.arrayBuffer();
  const base64Data = btoa(String.fromCharCode(...new Uint8Array(reader)));
  const multipartRequestBody =
    delimiter +
    "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
    JSON.stringify(metadata) +
    delimiter +
    "Content-Type: " + (file.type || "application/octet-stream") + "\r\n" +
    "Content-Transfer-Encoding: base64\r\n\r\n" +
    base64Data +
    closeDelimiter;

  try {
    const res = await gapi.client.request({
      path: "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
      method: "POST",
      headers: {
        "Content-Type": "multipart/related; boundary=" + boundary,
      },
      body: multipartRequestBody,
    });
    // 共有リンクを返す（必要なら共有設定 API 呼び出しを追加）
    const fileId = res.result.id;
    return `https://drive.google.com/file/d/${fileId}/view`;
  } catch (e) {
    console.error("uploadToDrive error:", e);
    alert("Drive へのアップロードに失敗しました。");
    return null;
  }
}

/* ====== DOM / UI ====== */
const tabs = document.querySelectorAll(".tab");
const contents = document.querySelectorAll(".tab-content");
tabs.forEach((t) => {
  t.addEventListener("click", () => {
    tabs.forEach((x) => x.classList.remove("active"));
    contents.forEach((c) => c.classList.remove("active"));
    t.classList.add("active");
    document.getElementById(t.dataset.tab).classList.add("active");
  });
});

/* 入力フォーム要素 */
const form           = document.getElementById("entryForm");
const dateEl         = document.getElementById("date");
const typeEl         = document.getElementById("type");
const paymentEl      = document.getElementById("payment");
const currencyEl     = document.getElementById("currency");
const foreignAmtEl   = document.getElementById("foreignAmount");
const rateEl         = document.getElementById("rate");
const autoRateBtn    = document.getElementById("autoRateBtn");
const amountEl       = document.getElementById("amount");
const memoEl         = document.getElementById("memo");
const fileInput      = document.getElementById("fileInput");

/* 使い道 / 取引先（コンボ） */
const categorySelect = document.getElementById("categorySelect");
const categoryFree   = document.getElementById("categoryFree");
const partnerSelect  = document.getElementById("partnerSelect");
const partnerFree    = document.getElementById("partnerFree");

/* セレクトに入れるプリセット */
const CATEGORY_OPTIONS = [
  "(選択しない)",
  "サーバー代",
  "スクリプト購入",
  "機材購入",
  "雑費",
  "人件費",
  "会食費",
  "その他",
];
const PARTNER_OPTIONS = [
  "(選択しない)",
  "Tebex",
  "VibeGAMES",
  "Ko-fi",
  "Killstore",
  "Etsy",
  "FANBOX",
  "ZAP HOSTING",
];

/* セレクトを生成 */
function populateSelect(select, options) {
  select.innerHTML = "";
  options.forEach((v) => {
    const op = document.createElement("option");
    op.value = v;
    op.textContent = v;
    select.appendChild(op);
  });
}
populateSelect(categorySelect, CATEGORY_OPTIONS);
populateSelect(partnerSelect, PARTNER_OPTIONS);

/* セレクトと自由入力の同期（片方を触ったらもう片方を空に） */
function wireCombo(selectEl, freeEl) {
  selectEl.addEventListener("change", () => {
    if (selectEl.value !== "(選択しない)") freeEl.value = "";
  });
  freeEl.addEventListener("input", () => {
    if (freeEl.value.trim() !== "") selectEl.value = "(選択しない)";
  });
}
wireCombo(categorySelect, categoryFree);
wireCombo(partnerSelect, partnerFree);

/* ====== 外貨レート自動取得 ======
 * 無料API： https://open.er-api.com/v6/latest/{BASE}
 * レートは JPY を参照
 */
autoRateBtn?.addEventListener("click", async () => {
  try {
    const base = currencyEl.value;
    if (base === "JPY") {
      alert("通貨が JPY の場合、為替レートは不要です。");
      return;
    }
    const res = await fetch(`https://open.er-api.com/v6/latest/${base}`);
    const data = await res.json();
    if (data.result !== "success" || !data.rates?.JPY) {
      throw new Error("rate API error");
    }
    const r = data.rates.JPY;
    rateEl.value = `1${base}=${r.toFixed(3)}JPY`;

    // 外貨金額があれば自動計算
    const fa = parseFloat(foreignAmtEl.value);
    if (!isNaN(fa)) {
      amountEl.value = (fa * r).toFixed(2);
    }
  } catch (e) {
    console.error(e);
    alert("為替レートの自動取得に失敗しました。レートを手入力してください。");
  }
});

/* ====== データ保存（テーブル表示＋Drive アップロード） ====== */
const tableBody = document.querySelector("#recordsTable tbody");
let records = [];

function resolveCombo(selectEl, freeEl) {
  const s = selectEl.value;
  const f = freeEl.value.trim();
  return f !== "" ? f : (s === "(選択しない)" ? "" : s);
}

async function uploadToDrive(file) {
  // 未ログインならスキップ（ユーザー保存だけ行う）
  if (!gapiInited || !tokenClient) return null;
  try {
    // トークンがない場合は取得しておく（2回目以降は使い回し）
    tokenClient.callback = () => {};
    google.accounts.oauth2.hasGrantedAllScopes(
      google.accounts.oauth2.getToken(),
      SCOPES
    ) || tokenClient.requestAccessToken({ prompt: "" });

    const metadata = {
      name: file.name,
      mimeType: file.type || "application/octet-stream",
    };
    const boundary = "-------314159265358979323846";
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelim = `\r\n--${boundary}--`;
    const reader = await file.arrayBuffer();
    const base64Data = btoa(String.fromCharCode(...new Uint8Array(reader)));
    const contentType = file.type || "application/octet-stream";

    const multipartRequestBody =
      delimiter +
      "Content-Type: application/json\r\n\r\n" +
      JSON.stringify(metadata) +
      delimiter +
      "Content-Type: " +
      contentType +
      "\r\n" +
      "Content-Transfer-Encoding: base64\r\n" +
      "\r\n" +
      base64Data +
      closeDelim;

    const res = await gapi.client.request({
      path: "/upload/drive/v3/files",
      method: "POST",
      params: { uploadType: "multipart" },
      headers: {
        "Content-Type": `multipart/related; boundary="${boundary}"`,
      },
      body: multipartRequestBody,
    });
    return `https://drive.google.com/file/d/${res.result.id}/view`;
  } catch (e) {
    console.warn("Drive upload skipped:", e);
    return null;
  }
}

function renderTable() {
  tableBody.innerHTML = "";
  records.forEach((r, idx) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r.date}</td>
      <td>${r.type}</td>
      <td>${r.category}</td>
      <td>${r.partner}</td>
      <td>${r.payment}</td>
      <td>${r.currency}</td>
      <td>${r.foreignAmount ?? ""}</td>
      <td>${r.rate ?? ""}</td>
      <td>${r.amount ?? ""}</td>
      <td>${r.memo ?? ""}</td>
      <td>${r.fileUrl ? `<a href="${r.fileUrl}" target="_blank">添付</a>` : ""}</td>
      <td><button data-del="${idx}" class="btn btn-outline">削除</button></td>
    `;
    tableBody.appendChild(tr);
  });
}

tableBody.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-del]");
  if (!btn) return;
  const i = Number(btn.dataset.del);
  records.splice(i, 1);
  renderTable();
});

form?.addEventListener("submit", async (e) => {
  e.preventDefault();

  // 金額の自動計算（外貨×レート → 円） – rate が "1USD=xxxJPY" 形式の場合もOK
  if (!amountEl.value && foreignAmtEl.value && rateEl.value) {
    const m = String(rateEl.value).match(/=(\d+(\.\d+)?)JPY/i);
    const rateNum = m ? Number(m[1]) : Number(rateEl.value);
    const fa = Number(foreignAmtEl.value);
    if (!isNaN(rateNum) && !isNaN(fa)) {
      amountEl.value = (rateNum * fa).toFixed(2);
    }
  }

  const record = {
    date: dateEl.value,
    type: typeEl.value,
    category: resolveCombo(categorySelect, categoryFree),
    partner: resolveCombo(partnerSelect, partnerFree),
    payment: paymentEl.value,
    currency: currencyEl.value,
    foreignAmount: foreignAmtEl.value || "",
    rate: rateEl.value || "",
    amount: amountEl.value || "",
    memo: memoEl.value || "",
    fileUrl: "",
  };

  // Drive アップロード（ログイン済み＋ファイル指定時）
  const file = fileInput.files?.[0];
  if (file) {
    const url = await uploadToDrive(file);
    if (url) record.fileUrl = url;
  }

  records.push(record);
  renderTable();

  // 入力クリア
  form.reset();
  categorySelect.value = "(選択しない)";
  partnerSelect.value  = "(選択しない)";
});

/* 初期値：今日 */
(function initToday() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  if (dateEl) dateEl.value = `${yyyy}-${mm}-${dd}`;
})();



