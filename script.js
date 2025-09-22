/* =========================
   シンプル会計（保存前確認＋編集）
   - 保存前にconfirmで最終確認
   - 一覧→編集→更新（添付差し替え可）
   - Googleにログイン済みならファイルをDriveへ自動アップロード（公開リンク化）
   - 未ログインでも保存は可能（添付は後から編集で追加可）
========================= */

// ========== DOM取得 ==========
const form = document.getElementById("entryForm");
const saveBtn = document.getElementById("saveBtn");
const cancelEditBtn = document.getElementById("cancelEdit");
const editingIdInput = document.getElementById("editingId");
const tbody = document.getElementById("recordsTbody");

// 入力要素
const dateEl = document.getElementById("date");
const typeEl = document.getElementById("type");
const categoryEl = document.getElementById("category");
const partnerSelectEl = document.getElementById("partnerSelect");
const partnerCustomEl = document.getElementById("partnerCustom");
const currencyEl = document.getElementById("currency");
const amountEl = document.getElementById("amount");         // 円
const amountFxEl = document.getElementById("amountFx");     // 外貨金額
const fxRateEl = document.getElementById("fxRate");         // 為替レート
const methodEl = document.getElementById("method");
const memoEl = document.getElementById("memo");
const fileInputEl = document.getElementById("fileInput");

// 認証UI
const gLoginBtn = document.getElementById("gLogin");
const gLogoutBtn = document.getElementById("gLogout");
const authStateEl = document.getElementById("authState");

// ========== 状態 ==========
let records = loadRecords();
let editingId = null;

// ========== ユーティリティ ==========
function loadRecords() {
  try {
    const raw = localStorage.getItem("records_v1");
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.warn("loadRecords error:", e);
    return [];
  }
}
function saveRecords() {
  localStorage.setItem("records_v1", JSON.stringify(records));
}

function fmtNum(n) {
  const v = Number(n || 0);
  return v.toLocaleString();
}

function driveViewUrl(id) {
  return `https://drive.google.com/file/d/${encodeURIComponent(id)}/view`;
}
function drivePreviewUrl(id) {
  return `https://drive.google.com/uc?export=preview&id=${encodeURIComponent(id)}`;
}

async function makeFilePublic(fileId) {
  const token = (gapi?.client?.getToken && gapi.client.getToken())?.access_token;
  if (!token) return; // 未ログインならスキップ
  await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/permissions`, {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + token,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ role: "reader", type: "anyone" })
  });
}

// ========== 一覧レンダリング ==========
function renderTable() {
  tbody.innerHTML = "";
  const sorted = [...records].sort((a,b)=> (a.date||"").localeCompare(b.date||""));
  for (const r of sorted) {
    const tr = document.createElement("tr");

    const fxCell = (r.currency && r.currency !== "JPY")
      ? `${r.currency} ${Number(r.amountFx||0)} @ ${Number(r.fxRate||0)}`
      : "";

    const linkHtml = r.fileUrl
      ? `<a href="${r.fileUrl}" target="_blank" rel="noopener">開く</a>` +
        (r.previewUrl ? ` / <a href="${r.previewUrl}" target="_blank" rel="noopener">プレビュー</a>` : "")
      : `<span class="muted">なし</span>`;

    tr.innerHTML = `
      <td>${r.date||""}</td>
      <td>${r.category||""}</td>
      <td>${r.type||""}</td>
      <td>${r.partner||""}</td>
      <td>${fmtNum(r.amount)}</td>
      <td>${fxCell}</td>
      <td>${r.method||""}</td>
      <td>${r.memo||""}</td>
      <td>${linkHtml}</td>
      <td>
        <button class="btn edit-btn" data-id="${r.id}">編集</button>
        <button class="btn btn-danger delete-btn" data-id="${r.id}">削除</button>
      </td>
    `;
    tbody.appendChild(tr);
  }
}

// ========== 編集モード ==========
function startEdit(id) {
  const rec = records.find(r => r.id === id);
  if (!rec) return;

  editingId = id;
  editingIdInput.value = id;

  dateEl.value = rec.date || "";
  typeEl.value = rec.type || "支出";
  categoryEl.value = rec.category || "";
  partnerSelectEl.value = ""; // 選択は空
  partnerCustomEl.value = rec.partner || "";
  currencyEl.value = rec.currency || "JPY";
  amountEl.value = rec.amount || "";
  if (rec.currency && rec.currency !== "JPY") {
    amountFxEl.value = rec.amountFx || "";
    fxRateEl.value = rec.fxRate || "";
  } else {
    amountFxEl.value = "";
    fxRateEl.value = "";
  }
  methodEl.value = rec.method || "";
  memoEl.value = rec.memo || "";
  fileInputEl.value = "";

  saveBtn.textContent = "更新";
  cancelEditBtn.style.display = "";
}

function exitEditMode() {
  editingId = null;
  editingIdInput.value = "";
  saveBtn.textContent = "保存（Driveへ自動アップロード）";
  cancelEditBtn.style.display = "none";
}

// ========== クリック（編集・削除） ==========
document.getElementById("recordsTable").addEventListener("click", (e) => {
  const editBtn = e.target.closest(".edit-btn");
  if (editBtn) {
    startEdit(editBtn.dataset.id);
    return;
  }
  const delBtn = e.target.closest(".delete-btn");
  if (delBtn) {
    const id = delBtn.dataset.id;
    const rec = records.find(r=>r.id===id);
    if (!rec) return;
    if (!confirm(`このレコードを削除しますか？\n\n日付:${rec.date}\n勘定科目:${rec.category}\n金額:${fmtNum(rec.amount)} JPY`)) return;

    // Driveのファイルがある場合は削除を試みる（失敗しても続行）
    if (rec.fileId) {
      const token = (gapi?.client?.getToken && gapi.client.getToken())?.access_token;
      if (token) {
        fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(rec.fileId)}`, {
          method: "DELETE",
          headers: { Authorization: "Bearer " + token }
        }).catch(()=>{});
      }
    }

    records = records.filter(r=>r.id!==id);
    saveRecords();
    renderTable();
  }
});

// ========== フォーム保存（確認→アップロード→保存/更新） ==========
form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const date = dateEl.value;
  const type = typeEl.value;
  const category = categoryEl.value;
  const partnerSelect = partnerSelectEl.value;
  const partnerCustom = (partnerCustomEl.value || "").trim();
  const partner = partnerCustom || partnerSelect;
  const currency = currencyEl.value || "JPY";
  const amountJPY = parseInt(amountEl.value || "0", 10);
  const amountFx = parseFloat(amountFxEl.value || "0");
  const fxRate   = parseFloat(fxRateEl.value || "0");
  const method = methodEl.value;
  const memo = (memoEl.value || "").trim();

  // 入力チェック
  if (!date) { alert("日付は必須です。"); return; }
  if (!category) { alert("勘定科目は必須です。"); return; }
  if (currency === "JPY") {
    if (!amountJPY) { alert("金額（円）を入力してください。"); return; }
  } else {
    if (!amountFx || !fxRate) { alert("外貨金額と為替レートを入力してください。"); return; }
  }

  // 確認メッセージ
  const fxText = (currency !== "JPY" && amountFx && fxRate)
    ? `\n外貨：${currency} ${amountFx} @ ${fxRate}`
    : "";
  const attachText = fileInputEl.files.length ? fileInputEl.files[0].name : "（なし）";
  const confirmMsg =
    `この内容で${editin
