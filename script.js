// ===== Google Drive 連携用 =====
const CLIENT_ID = "91348359952-pns9nlvg8tr82p6ht791c31gg5meh98q.apps.googleusercontent.com";
const API_KEY = ""; // 今回は不要
const SCOPES = "https://www.googleapis.com/auth/drive.file";

let tokenClient;
let gapiInited = false;
let gisInited = false;

function gapiLoaded() {
  gapi.load('client', initializeGapiClient);
}

async function initializeGapiClient() {
  await gapi.client.init({
    apiKey: API_KEY,
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

const form = document.getElementById("entryForm");
const tableBody = document.querySelector("#recordsTable tbody");

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const date = document.getElementById("date").value;
  const category = document.getElementById("category").value;
  const customCategory = document.getElementById("customCategory").value;
  const amount = document.getElementById("amount").value;
  const memo = document.getElementById("memo").value;
  const fileInput = document.getElementById("fileInput");

  const finalCategory = customCategory ? customCategory : category;

  let fileName = "";
  let fileUrl = "";

  if (fileInput.files.length > 0) {
    const file = fileInput.files[0];
    fileName = file.name;

    try {
      // ★ Driveにアップロード
      const metadata = {
        name: file.name,
        mimeType: file.type
      };

      const formData = new FormData();
      formData.append(
        "metadata",
        new Blob([JSON.stringify(metadata)], { type: "application/json" })
      );
      formData.append("file", file);

      const accessToken = gapi.client.getToken().access_token;

      const response = await fetch(
        "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id",
        {
          method: "POST",
          headers: new Headers({ Authorization: "Bearer " + accessToken }),
          body: formData,
        }
      );

      const result = await response.json();
      const fileId = result.id;

      // URL作成
      fileUrl = `https://drive.google.com/file/d/${fileId}/view?usp=sharing`;

    } catch (error) {
      console.error("ファイルアップロード失敗:", error);
    }
  }

  // ★ テーブルに追加（ファイル名をリンクにする）
  const row = document.createElement("tr");
  row.innerHTML = `
    <td>${date}</td>
    <td>${finalCategory}</td>
    <td>${amount}</td>
    <td>${memo}</td>
    <td>${fileUrl ? `<a href="${fileUrl}" target="_blank">${fileName}</a>` : ""}</td>
  `;
  tableBody.appendChild(row);

  form.reset();
});

