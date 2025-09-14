// 外部 onload で先にダミーが動いた場合に追随して初期化を完了させる
if (window._gapiReady && typeof window.gapiLoaded === "function") window.gapiLoaded();
if (window._gisReady  && typeof window.gisLoaded  === "function") window.gisLoaded();
/***** Google Drive 連携（堅牢） *****/
const CLIENT_ID = "91348359952-pns9nlvg8tr82p6ht791c31gg5meh98q.apps.googleusercontent.com"; // ←あなたのクライアントID
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
  if (tokenClient) {
    tokenClient.requestAccessToken();
  }
};

/***** 為替レート自動取得 *****/
document.addEventListener("DOMContentLoaded", () => {
  const autoBtn = document.getElementById("autoRateBtn");
  if (autoBtn) {
    autoBtn.addEventListener("click", async () => {
      const currency = document.getElementById("currency").value;
      if (currency === "JPY") {
        alert("JPYの場合は不要です");
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
            document.getElementById("amount").value = (fAmt * rate).toFixed(0);
          }
        } else {
          alert("為替レートの取得に失敗しました");
        }
      } catch (e) {
        alert("APIエラー: " + e.message);
      }
    });
  }
});

/***** データ保存 *****/
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

  const fileInput = document.getElementById("fileInput");
  if (fileInput.files.length > 0 && accessToken) {
    const file = fileInput.files[0];
    const metadata = { name: file.name, mimeType: file.type };
    const formData = new FormData();
    formData.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
    formData.append("file", file);

    const uploadRes = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
      {
        method: "POST",
        headers: { Authorization: "Bearer " + accessToken },
        body: formData
      }
    );
    const result = await uploadRes.json();
    rec.fileId = result.id;
    rec.fileUrl = `https://drive.google.com/file/d/${result.id}/view`;
  }

  saveRecord(rec);
  renderTable();
  form.reset();
});

function saveRecord(rec) {
  const data = JSON.parse(localStorage.getItem("records") || "[]");
  data.push(rec);
  localStorage.setItem("records", JSON.stringify(data));
}

function renderTable() {
  tableBody.innerHTML = "";
  const data = JSON.parse(localStorage.getItem("records") || "[]");
  data.forEach((rec, idx) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${rec.date}</td>
      <td>${rec.type}</td>
      <td>${rec.category}</td>
      <td>${rec.partner}</td>
      <td>${rec.payment}</td>
      <td>${rec.currency}</td>
      <td>${rec.foreignAmount}</td>
      <td>${rec.rate}</td>
      <td>${rec.amount}</td>
      <td>${rec.memo}</td>
      <td>${rec.fileUrl ? `<a href="${rec.fileUrl}" target="_blank">表示</a>` : ""}</td>
      <td><button data-idx="${idx}" class="deleteBtn">削除</button></td>
    `;
    tableBody.appendChild(tr);
  });

  document.querySelectorAll(".deleteBtn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const idx = e.target.dataset.idx;
      const data = JSON.parse(localStorage.getItem("records") || "[]");
      data.splice(idx, 1);
      localStorage.setItem("records", JSON.stringify(data));
      renderTable();
    });
  });
}

document.addEventListener("DOMContentLoaded", renderTable);



