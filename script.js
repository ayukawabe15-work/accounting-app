/***** Google Drive 連携 *****/
const CLIENT_ID = "91348359952-pns9nlvg8tr82p6ht791c31gg5meh98q.apps.googleusercontent.com";
const SCOPES = "https://www.googleapis.com/auth/drive.file";

let tokenClient;
let gapiInited = false;
let gisInited = false;
let accessToken = null;

// ① ログインボタンを初期化（準備完了まで無効）
const loginBtn = document.getElementById("loginButton");
const loginStatus = document.getElementById("loginStatus");

if (loginBtn) {
  loginBtn.disabled = true; // 初期化完了まで押せない
  loginBtn.classList.add("is-disabled");
}

// onload から参照できるようにグローバル公開
window.gapiLoaded = function () {
  gapi.load("client", async () => {
    await gapi.client.init({
      discoveryDocs: ["https://www.googleapis.com/discovery/v1/apis/drive/v3/rest"],
    });
    gapiInited = true;
    maybeEnableLogin();
  });
};

// onload から参照できるようにグローバル公開
window.gapiLoaded = function () {
  gapi.load("client", async () => {
    await gapi.client.init({
      discoveryDocs: ["https://www.googleapis.com/discovery/v1/apis/drive/v3/rest"],
    });
    gapiInited = true;
    maybeEnableLogin();
  });
};

window.gisLoaded = function () {
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPES,
    callback: (resp) => {
      if (resp.error) {
        console.error(resp);
        alert("Google認証でエラーが発生しました");
        return;
      }
      accessToken = resp.access_token;
      if (loginStatus) loginStatus.textContent = "ログイン済み";
    },
  });
  gisInited = true;
  maybeEnableLogin();
};

function maybeEnableLogin() {
  if (gapiInited && gisInited && loginBtn) {
    loginBtn.disabled = false;
    loginBtn.classList.remove("is-disabled");
  }
}

if (loginBtn) {
  loginBtn.addEventListener("click", () => {
    if (!tokenClient) {
      alert("初期化中です。数秒後にもう一度お試しください。");
      return;
    }
    tokenClient.requestAccessToken({ prompt: "" });
  });
}
/***** 使い道 / 取引先：プリセット + 自由入力 *****/
// プリセット（必要に応じて編集・追加OK）
const CATEGORY_PRESETS = [
  "(選択しない)",
  "サーバー代",
  "スクリプト購入",
  "機材購入",
  "雑費",
  "人件費",
  "会食費",
  "広告費",
  "その他",
  "――",
  "自由入力（任意）"
];

const PARTNER_PRESETS = [
  "(選択しない)",
  "Tebex",
  "VibeGAMES",
  "Ko-fi",
  "Killstore",
  "Etsy",
  "FANBOX",
  "ZAP HOSTING",
  "その他",
  "――",
  "自由入力（任意）"
];

// セレクトと入力の同期ユーティリティ
function setupCombo(selectId, inputId, presets) {
  const sel = document.getElementById(selectId);
  const inp = document.getElementById(inputId);
  if (!sel || !inp) return;

  // optionを動的生成
  sel.innerHTML = "";
  presets.forEach((label) => {
    const opt = document.createElement("option");
    opt.value = label;
    opt.textContent = label;
    sel.appendChild(opt);
  });

  // 初期状態
  sel.value = "(選択しない)";
  inp.value = "";
  // “自由入力（任意）” 以外を選んだら入力欄に反映、自由入力を選んだら入力欄フォーカス
  sel.addEventListener("change", () => {
    if (sel.value === "自由入力（任意）" || sel.value === "その他") {
      inp.focus();
      inp.select();
    } else if (sel.value === "(選択しない)" || sel.value === "――") {
      // 何もしない
    } else {
      inp.value = sel.value;
    }
  });

  // 入力欄を手で変えた場合：セレクトを“自由入力（任意）”に切り替え
  inp.addEventListener("input", () => {
    if (inp.value && sel.value !== "自由入力（任意）") {
      sel.value = "自由入力（任意）";
    }
  });
}

// 保存時に読み取るユーティリティ（あなたの保存ロジックで利用）
function getComboValue(selectId, inputId) {
  const sel = document.getElementById(selectId);
  const inp = document.getElementById(inputId);
  if (!sel || !inp) return "";
  const v = inp.value.trim();
  if (v) return v;
  if (sel.value && sel.value !== "(選択しない)" && sel.value !== "――" && sel.value !== "自由入力（任意）") {
    return sel.value;
  }
  return ""; // 未入力扱い
}

/***** 初期化 *****/
document.addEventListener("DOMContentLoaded", () => {
  setupCombo("categorySelect", "categoryFree", CATEGORY_PRESETS);
  setupCombo("partnerSelect",  "partnerFree",  PARTNER_PRESETS);

  // 例：保存時に値を取得するなら
  const saveBtn = document.getElementById("saveBtn"); // あれば
  if (saveBtn) {
    saveBtn.addEventListener("click", () => {
      const category = getComboValue("categorySelect", "categoryFree");
      const partner  = getComboValue("partnerSelect",  "partnerFree");

      // あなたの既存保存ロジックに紐づけ
      // e.g. formData.category = category; formData.partner = partner;
      console.log("使い道:", category, "取引先:", partner);
    });
  }
});

/***** タブ切替 *****/
document.addEventListener("click", (e)=>{
  const btn = e.target.closest(".tab");
  if(!btn) return;
  document.querySelectorAll(".tab").forEach(t=>t.classList.remove("active"));
  document.querySelectorAll(".tab-content").forEach(c=>c.classList.remove("active"));
  btn.classList.add("active");
  const id = btn.dataset.tab;
  document.getElementById(id).classList.add("active");
});

/***** 為替レート自動取得 *****/
document.addEventListener("DOMContentLoaded", () => {
  const autoBtn = document.getElementById("autoRateBtn");
  if (autoBtn) {
    autoBtn.addEventListener("click", fetchRateAndCalc);
  }
  renderTable();  // 初期レンダリング
});

async function fetchRateAndCalc(){
  const currency = document.getElementById("currency").value;
  if (currency === "JPY") {
    alert("JPYの場合はレート不要です。");
    return;
  }
  try {
    const res = await fetch(`https://open.er-api.com/v6/latest/${currency}`);
    const data = await res.json();
    if (data.result === "success" && data.rates.JPY) {
      const rate = data.rates.JPY;
      document.getElementById("rate").value = `1${currency}=${rate.toFixed(2)}JPY`;
      const fAmt = parseFloat(document.getElementById("foreignAmount").value || "0");
      if (fAmt) {
        document.getElementById("amount").value = Math.round(fAmt * rate);
      }
    } else {
      alert("為替レートの取得に失敗しました。");
    }
  } catch (e) {
    alert("APIエラー: " + e.message);
  }
}

/***** 保存ロジック *****/
const form = document.getElementById("entryForm");
const tableBody = document.querySelector("#recordsTable tbody");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const rec = {
    date: document.getElementById("date").value,
    type: document.getElementById("type").value,
    category: document.getElementById("category").value,
    partner: document.getElementById("partner").value,
    payment: document.getElementById("payment").value,
    currency: document.getElementById("currency").value,
    foreignAmount: document.getElementById("foreignAmount").value,
    rate: document.getElementById("rate").value,
    amount: document.getElementById("amount").value,
    memo: document.getElementById("memo").value,
    fileId: null,
    fileUrl: null
  };

  // 添付をDriveへ
  const fileInput = document.getElementById("fileInput");
  if (fileInput.files.length > 0 && accessToken) {
    const file = fileInput.files[0];
    const metadata = { name: file.name, mimeType: file.type };
    const formData = new FormData();
    formData.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
    formData.append("file", file);

    const uploadRes = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
      { method: "POST", headers: { Authorization: "Bearer " + accessToken }, body: formData }
    );
    const result = await uploadRes.json();
    rec.fileId = result.id;
    rec.fileUrl = `https://drive.google.com/file/d/${result.id}/view`;
  }

  saveRecord(rec);
  renderTable();
  form.reset();
});

function saveRecord(rec){
  const data = JSON.parse(localStorage.getItem("records") || "[]");
  data.push(rec);
  localStorage.setItem("records", JSON.stringify(data));
}

function renderTable(){
  tableBody.innerHTML = "";
  const data = JSON.parse(localStorage.getItem("records") || "[]");
  data.forEach((rec, idx) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${rec.date || ""}</td>
      <td>${rec.type || ""}</td>
      <td>${rec.category || ""}</td>
      <td>${rec.partner || ""}</td>
      <td>${rec.payment || ""}</td>
      <td>${rec.currency || ""}</td>
      <td>${rec.foreignAmount || ""}</td>
      <td>${rec.rate || ""}</td>
      <td>${rec.amount || ""}</td>
      <td>${rec.memo || ""}</td>
      <td>${rec.fileUrl ? `<a href="${rec.fileUrl}" target="_blank">表示</a>` : ""}</td>
      <td><button class="btn btn-outline" data-idx="${idx}">削除</button></td>
    `;
    tableBody.appendChild(tr);
  });

  tableBody.querySelectorAll("button[data-idx]").forEach(btn=>{
    btn.addEventListener("click", (e)=>{
      const i = Number(e.currentTarget.dataset.idx);
      const arr = JSON.parse(localStorage.getItem("records") || "[]");
      arr.splice(i,1);
      localStorage.setItem("records", JSON.stringify(arr));
      renderTable();
    });
  });
}




