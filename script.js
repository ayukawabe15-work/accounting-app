/***********************
 * 会計アプリ – フロント完全版
 * 1) Google Drive 連携（ログイン）
 * 2) 使い道／取引先：プリセット＋自由入力のコンボ
 * 3) タブ切替／一覧表示／削除
 * 4) 外貨レート自動取得（open.er-api.com）
 * 5) 添付ファイルを Drive にアップロード（drive.file 権限）
 ************************/

/* ====== Google Drive 連携（変更ポイントは CLIENT_ID のみ） ====== */
const CLIENT_ID = "91348359952-pns9nlvg8tr82p6ht791c31gg5meh98q.apps.googleusercontent.com"; // ← 転記してください
const SCOPES   = "https://www.googleapis.com/auth/drive.file";

let tokenClient;
let gapiInited = false;
let gisInited  = false;

const loginBtn    = document.getElementById("loginButton");
const loginStatus = document.getElementById("loginStatus");
if (loginBtn) {
  loginBtn.classList.add("is-disabled");
  loginBtn.disabled = true;
  loginBtn.addEventListener("click", () => {
    if (!tokenClient) return;
    tokenClient.callback = (resp) => {
      if (resp.error) {
        alert("ログインに失敗しました");
        return;
      }
      loginStatus.textContent = "ログイン済み";
    };
    tokenClient.requestAccessToken({ prompt: "consent" });
  });
}

/* gapi & gis の onload コールバック（index.html から呼ばれる） */
window.gapiLoaded = async () => {
  try {
    await new Promise((resolve) => gapi.load("client", resolve));
    await gapi.client.init({});
    await gapi.client.load("drive", "v3");
    gapiInited = true;
    maybeEnableLogin();
  } catch (e) {
    console.error(e);
    alert("Googleライブラリの読み込み待機中です。数秒後に再試行してください。");
  }
};
window.gisLoaded = () => {
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPES,
    callback: () => {},
  });
  gisInited = true;
  maybeEnableLogin();
};
async function ensureGapiReady() {
  if (gapiInited) return;
  await new Promise((resolve) => gapi.load("client", resolve));
  await gapi.client.init({});
  await gapi.client.load("drive", "v3");
  gapiInited = true;
}
async function ensureGapiReady() {
  if (gapiInited) return;
  await new Promise((resolve) => gapi.load("client", resolve));
  await gapi.client.init({});
  await gapi.client.load("drive", "v3");
  gapiInited = true;
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

