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
      if (resp.error !== undefined) {
        throw (resp);
      }
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

/***** データ保存処理 *****/
const form = document.getElementById("entryForm");
const tableBody = document.querySelector("#recordsTable tbody");

let records = JSON.parse(localStorage.getItem("records") || "[]");

function saveRecords() {
  localStorage.setItem("records", JSON.stringify(records));
}

/***** Driveアップロード *****/
async function uploadFile(file) {
  if (!accessToken) {
    alert("Googleにログインしてください");
    return null;
  }
  const metadata = {
    name: file.name,
    mimeType: file.type,
  };
  const formData = new FormData();
  formData.append(
    "metadata",
    new Blob([JSON.stringify(metadata)], { type: "application/json" })
  );
  formData.append("file", file);

  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id",
    {
      method: "POST",
      headers: new Headers({ Authorization: "Bearer " + accessToken }),
      body: formData,
    }
  );
  const data = await res.json();
  if (data.id) {
    return {
      fileId: data.id,
      fileUrl: `https://drive.google.com/file/d/${data.id}/view`,
      previewUrl: `https://drive.google.com/file/d/${data.id}/preview`,
    };
  }
  return null;
}

/***** テーブル描画 *****/
function renderTable() {
  tableBody.innerHTML = "";
  records.forEach((r, idx) => {
    const row = document.createElement("tr");
    const linkHtml = r.fileUrl
      ? `<a href="${r.fileUrl}" target="_blank" data-preview="${r.previewUrl}" class="preview-link">${r.fileName || "開く"}</a>`
      : "";

    row.innerHTML = `
      <td>${r.date}</td>
      <td>${r.category}</td>
      <td>${r.amount}</td>
      <td>${r.memo}</td>
      <td>${r.other || ""}</td>
      <td>${linkHtml}</td>
      <td><button class="delete-btn" data-idx="${idx}">削除</button></td>
    `;
    tableBody.appendChild(row);
  });
}
renderTable();

/***** 削除処理 *****/
tableBody.addEventListener("click", async (e) => {
  if (e.target.classList.contains("delete-btn")) {
    const idx = e.target.dataset.idx;
    if (confirm("削除してよろしいですか？")) {
      const fileId = records[idx].fileId;
      if (fileId && accessToken) {
        try {
          await gapi.client.drive.files.delete({ fileId: fileId });
        } catch (err) {
          console.error("Drive削除エラー", err);
        }
      }
      records.splice(idx, 1);
      saveRecords();
      renderTable();
    }
  }
});

/***** フォーム送信 *****/
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const date = document.getElementById("date").value;
  const category = document.getElementById("category").value;
  const customCategory = document.getElementById("customCategory").value.trim();
  const amount = document.getElementById("amount").value;
  const memo = document.getElementById("memo").value;
  const other = document.getElementById("otherFree").value.trim();
  const fileInput = document.getElementById("fileInput");

  const finalCategory = customCategory ? customCategory : category;

  let fileData = {};
  if (fileInput.files.length > 0) {
    fileData = await uploadFile(fileInput.files[0]) || {};
    fileData.fileName = fileInput.files[0].name;
  }

  const rec = {
    date,
    category: finalCategory,
    amount,
    memo,
    other,
    ...fileData,
  };

  records.push(rec);
  saveRecords();
  renderTable();
  form.reset();
});

/***** CSVエクスポート *****/
document.getElementById("exportCsv").addEventListener("click", () => {
  let csv = "日付,使い道,金額,メモ,その他の内容,ファイルURL\n";
  records.forEach((r) => {
    csv += `${r.date},${r.category},${r.amount},${r.memo},${r.other || ""},${r.fileUrl || ""}\n`;
  });
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "records.csv";
  a.click();
});

/***** 為替レート取得（autoRateBtn対応） *****/
async function fetchExchangeRate(base, target) {
  try {
    let res = await fetch(`https://api.exchangerate.host/latest?base=${base}&symbols=${target}`);
    if (res.ok) {
      let data = await res.json();
      if (data.rates && data.rates[target]) {
        return data.rates[target];
      }
    }
    // フォールバック
    res = await fetch(`https://open.er-api.com/v6/latest/${base}`);
    if (res.ok) {
      let data = await res.json();
      if (data.rates && data.rates[target]) {
        return data.rates[target];
      }
    }
    return null;
  } catch (e) {
    console.error(e);
    return null;
  }
}

document.getElementById("autoRateBtn").addEventListener("click", async () => {
  const base = document.getElementById("currency").value;
  const target = "JPY";
  const rate = await fetchExchangeRate(base, target);
  if (rate) {
    document.getElementById("rate").value = rate.toFixed(4);
  } else {
    alert("為替レートの自動取得に失敗しました。手動入力してください。");
  }
});




