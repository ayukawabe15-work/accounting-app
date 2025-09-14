/***** Google Drive 連携 *****/
const CLIENT_ID = "91348359952-pns9nlvg8tr82p6ht791c31gg5meh98q.apps.googleusercontent.com";
const SCOPES = "https://www.googleapis.com/auth/drive.file";

let tokenClient;
let gapiInited = false;
let gisInited = false;
let accessToken = null;

function gapiLoaded() {
  gapi.load('client', initializeGapiClient);
}
async function initializeGapiClient() {
  await gapi.client.init({
    discoveryDocs: ["https://www.googleapis.com/discovery/v1/apis/drive/v3/rest"],
  });
  gapiInited = true;
}
function gisLoaded() {
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPES,
    callback: (resp) => {
      if (resp.error) throw resp;
      accessToken = resp.access_token;
      document.getElementById("loginStatus").innerText = "ログイン済み";
    },
  });
  gisInited = true;
}
document.getElementById("loginButton").onclick = () => {
  if (tokenClient) tokenClient.requestAccessToken();
};

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

