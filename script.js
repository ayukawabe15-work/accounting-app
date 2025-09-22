/* =========================
   シンプル会計（保存前確認＋編集＋currencyapi自動換算）
   - 保存前にconfirmで最終確認
   - 一覧→編集→更新（添付差し替え可）
   - Googleにログイン済みならDriveへ自動アップロード（公開リンク化）
   - 未ログインでも保存は可能（添付は後から編集で追加可）
   - currencyapiで通貨≠JPY時の為替レートを自動取得し、外貨⇄円を双方向自動計算
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

// ========== 為替：currencyapi 設定 ==========
const CURRENCYAPI_KEY = "cur_live_X8hUbLuHDTzYbSFbZO7awXs5vi4CzVNs45lfmWXS"; // ユーザー提供
const CURRENCYAPI_BASE = "https://api.currencyapi.com/v3";

/** 24時間キャッシュ（localStorage） */
function getCachedRate(key) {
  try {
    const raw = localStorage.getItem("fxcache_v1_" + key);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || !obj.value || !obj.ts) return null;
    const age = Date.now() - obj.ts;
    if (age > 24 * 60 * 60 * 1000) return null;
    return obj.value;
  } catch {
    return null;
  }
}
function setCachedRate(key, value) {
  try {
    localStorage.setItem(
      "fxcache_v1_" + key,
      JSON.stringify({ value, ts: Date.now() })
    );
  } catch {}
}

/** 日付を YYYY-MM-DD に */
function ymd(d) {
  const dt = d ? new Date(d) : new Date();
  const yyyy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/** currencyapiから base->JPY のレートを取得。履歴→失敗時は最新。 */
async function fetchRateToJPY(baseCurrency, dateStr) {
  if (!baseCurrency || baseCurrency === "JPY") return 1;

  const key = `${baseCurrency}_JPY_${dateStr || "latest"}`;
  const cached = getCachedRate(key);
  if (cached) return cached;

  const paramsHist = new URLSearchParams({
    base_currency: baseCurrency,
    currencies: "JPY",
    date: dateStr || ymd(),
    apikey: CURRENCYAPI_KEY,
  });

  // 1) 歴史レート
  try {
    const res = await fetch(`${CURRENCYAPI_BASE}/historical?${paramsHist.toString()}`);
    if (!res.ok) throw new Error("historical not ok");
    const json = await res.json();
    const rate = json?.data?.JPY?.value;
    if (rate && Number.isFinite(rate)) {
      setCachedRate(key, rate);
      return rate;
    }
  } catch (_) {
    // fallthrough
  }

  // 2) 最新レート
  try {
    const paramsLatest = new URLSearchParams({
      base_currency: baseCurrency,
      currencies: "JPY",
      apikey: CURRENCYAPI_KEY,
    });
    const res2 = await fetch(`${CURRENCYAPI_BASE}/latest?${paramsLatest.toString()}`);
    if (!res2.ok) throw new Error("latest not ok");
    const json2 = await res2.json();
    const rate2 = json2?.data?.JPY?.value;
    if (rate2 && Number.isFinite(rate2)) {
      setCachedRate(`${baseCurrency}_JPY_latest`, rate2);
      return rate2;
    }
  } catch (e) {
    console.error("currencyapi error:", e);
  }

  throw new Error("為替レートの取得に失敗しました。");
}

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

  ensureFxFieldsState();
  if (currencyEl.value !== "JPY" && !fxRateEl.value) {
    // レートが空なら日付に合わせて取得
    updateRateAndAutoCalc().catch(()=>{});
  }
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

// ========== 外貨↔円 自動計算（currencyapi連携） ==========
let programmaticUpdate = false;

function ensureFxFieldsState() {
  const isJPY = (currencyEl.value === "JPY");
  amountFxEl.disabled = isJPY;
  fxRateEl.disabled = isJPY;
  if (isJPY) {
    amountFxEl.value = "";
    fxRateEl.value = "";
    amountEl.placeholder = "例: 1200";
  } else {
    amountEl.placeholder = "自動計算されます（外貨金額入力でも円入力でもOK）";
  }
}

/** レート取得 → fxRateElに反映。可能なら両金額も自動計算 */
async function updateRateAndAutoCalc() {
  if (currencyEl.value === "JPY") return;

  const base = currencyEl.value;
  const dateStr = dateEl.value || ymd();
  const rate = await fetchRateToJPY(base, dateStr); // base→JPY
  programmaticUpdate = true;
  fxRateEl.value = Number(rate).toFixed(6);
  programmaticUpdate = false;

  // 既にどちらか金額が入っていれば反対側を更新
  const amtFx = parseFloat(amountFxEl.value);
  const amtJpy = parseInt(amountEl.value || "0", 10);

  if (amtFx && !Number.isNaN(amtFx)) {
    programmaticUpdate = true;
    amountEl.value = Math.round(amtFx * rate);
    programmaticUpdate = false;
  } else if (amtJpy && !Number.isNaN(amtJpy)) {
    programmaticUpdate = true;
    amountFxEl.value = (amtJpy / rate).toFixed(2);
    programmaticUpdate = false;
  }
}

// 通貨・日付が変わったらレート更新
currencyEl.addEventListener("change", async () => {
  ensureFxFieldsState();
  if (currencyEl.value !== "JPY") {
    try { await updateRateAndAutoCalc(); } catch(e){ alert("為替レートの取得に失敗しました。"); }
  }
});

dateEl.addEventListener("change", async () => {
  if (currencyEl.value !== "JPY") {
    try { await updateRateAndAutoCalc(); } catch(e){ /* 後段でsubmit時にも再トライ */ }
  }
});

// 入力相互更新（ループ防止フラグつき）
amountFxEl.addEventListener("input", () => {
  if (programmaticUpdate || currencyEl.value === "JPY") return;
  const fx = parseFloat(amountFxEl.value);
  const rate = parseFloat(fxRateEl.value);
  if (!fx || !rate) return;
  programmaticUpdate = true;
  amountEl.value = Math.round(fx * rate);
  programmaticUpdate = false;
});

amountEl.addEventListener("input", () => {
  if (programmaticUpdate || currencyEl.value === "JPY") return;
  const jpy = parseInt(amountEl.value || "0", 10);
  const rate = parseFloat(fxRateEl.value);
  if (!jpy || !rate) return;
  programmaticUpdate = true;
  amountFxEl.value = (jpy / rate).toFixed(2);
  programmaticUpdate = false;
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
  let amountJPY = parseInt(amountEl.value || "0", 10);
  let amountFx = parseFloat(amountFxEl.value || "0");
  let fxRate   = parseFloat(fxRateEl.value || "0");
  const method = methodEl.value;
  const memo = (memoEl.value || "").trim();

  // 入力チェック（外貨時はどちらかの金額があればOK）
  if (!date) { alert("日付は必須です。"); return; }
  if (!category) { alert("勘定科目は必須です。"); return; }

  if (currency === "JPY") {
    if (!amountJPY) { alert("金額（円）を入力してください。"); return; }
  } else {
    if (!fxRate || !Number.isFinite(fxRate)) {
      try {
        fxRate = await fetchRateToJPY(currency, date || ymd());
        fxRateEl.value = Number(fxRate).toFixed(6);
      } catch {
        alert("為替レートの取得に失敗しました。");
        return;
      }
    }
    if (!amountFx && !amountJPY) {
      alert("外貨または円のどちらかの金額を入力してください。");
      return;
    }
    // 片方しかない場合は自動計算
    if (!amountJPY && amountFx) {
      amountJPY = Math.round(amountFx * fxRate);
      amountEl.value = String(amountJPY);
    } else if (!amountFx && amountJPY) {
      amountFx = Number((amountJPY / fxRate).toFixed(2));
      amountFxEl.value = String(amountFx);
    }
  }

  // 確認メッセージ
  const fxText = (currency !== "JPY" && amountFx && fxRate)
    ? `\n外貨：${currency} ${amountFx} @ ${fxRate}`
    : "";
  const attachText = fileInputEl.files.length ? fileInputEl.files[0].name : "（なし）";
  const confirmMsg =
    `この内容で${editingId ? "更新" : "保存"}しますか？\n\n` +
    `日付：${date}\n` +
    `区分：${type}\n` +
    `勘定科目：${category}\n` +
    `取引先：${partner || "（なし）"}\n` +
    `金額：${fmtNum(amountJPY)} JPY${fxText}\n` +
    `支払方法：${method || "（未選択）"}\n` +
    `メモ：${memo || "（なし）"}\n` +
    `添付：${attachText}\n`;
  if (!confirm(confirmMsg)) return;

  // 添付ファイル（必要時のみアップロード）
  let newFile = { fileName:"", fileUrl:"", fileId:"", previewUrl:"" };
  if (fileInputEl.files.length > 0) {
    const token = (gapi?.client?.getToken && gapi.client.getToken())?.access_token;
    if (!token) {
      const cont = confirm("Googleに未ログインのため、ファイルはDriveへアップロードされません。\nそのまま（添付なしで）保存しますか？");
      if (!cont) return;
    } else {
      try {
        const up = fileInputEl.files[0];
        const meta = { name: up.name, mimeType: up.type || "application/octet-stream" };
        const fd = new FormData();
        fd.append("metadata", new Blob([JSON.stringify(meta)], { type: "application/json" }));
        fd.append("file", up);

        const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", {
          method: "POST",
          headers: { Authorization: "Bearer " + token },
          body: fd
        });
        const data = await res.json();
        if (!data.id) throw new Error("Driveアップロード失敗");
        await makeFilePublic(data.id);

        newFile.fileId = data.id;
        newFile.fileName = up.name;
        newFile.fileUrl = driveViewUrl(data.id);
        newFile.previewUrl = drivePreviewUrl(data.id);
      } catch (err) {
        console.error(err);
        alert("ファイルのアップロードに失敗しました。もう一度お試しください。");
        return;
      }
    }
  }

  // 保存 or 更新
  if (!editingId) {
    const rec = {
      id: crypto.randomUUID(),
      date,
      type,
      category,
      partner,
      currency,
      amount: amountJPY,
      amountFx: currency === "JPY" ? 0 : amountFx,
      fxRate:  currency === "JPY" ? 1 : fxRate,
      method,
      memo,
      fileName: newFile.fileName,
      fileUrl: newFile.fileUrl,
      fileId: newFile.fileId,
      previewUrl: newFile.previewUrl
    };
    records.push(rec);
  } else {
    const idx = records.findIndex(r=>r.id===editingId);
    if (idx === -1) { alert("対象レコードが見つかりませんでした。"); return; }

    // 旧ファイル → 新ファイルで差し替え（新しい添付があるときだけ）
    let { fileName, fileUrl, fileId, previewUrl } = records[idx];
    if (newFile.fileId) {
      const token = (gapi?.client?.getToken && gapi.client.getToken())?.access_token;
      if (fileId && token) {
        try {
          await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`, {
            method: "DELETE",
            headers: { Authorization: "Bearer " + token }
          });
        } catch (_) {}
      }
      fileName = newFile.fileName;
      fileUrl = newFile.fileUrl;
      fileId = newFile.fileId;
      previewUrl = newFile.previewUrl;
    }

    records[idx] = {
      ...records[idx],
      date,
      type,
      category,
      partner,
      currency,
      amount: amountJPY,
      amountFx: currency === "JPY" ? 0 : amountFx,
      fxRate:  currency === "JPY" ? 1 : fxRate,
      method,
      memo,
      fileName,
      fileUrl,
      fileId,
      previewUrl
    };
  }

  saveRecords();
  exitEditMode();
  form.reset();
  ensureFxFieldsState();
  renderTable();
  alert(editingId ? "更新しました！" : "登録しました！");
});

// 編集キャンセル
cancelEditBtn.addEventListener("click", () => {
  form.reset();
  exitEditMode();
  ensureFxFieldsState();
});

// ========== 初期値（日付=今日） ==========
(function setToday(){
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth()+1).padStart(2,"0");
  const dd = String(d.getDate()).padStart(2,"0");
  dateEl.value = `${yyyy}-${mm}-${dd}`;
})();

// JPY/外貨に応じて入力状態を初期反映
ensureFxFieldsState();

// ========== Google 認証まわり ==========
const GOOGLE_CLIENT_ID = "91348359952-pns9nlvg8tr82p6ht791c31gg5meh98q.apps.googleusercontent.com";
const GOOGLE_API_KEY = "";
const GOOGLE_SCOPE = "https://www.googleapis.com/auth/drive.file";

let tokenClient = null;

// gapi（旧JSクライアント）のロード完了時に呼ばれる
window.gapiLoaded = function () {
  gapi.load("client", async () => {
    try {
      await gapi.client.init({
        apiKey: GOOGLE_API_KEY,
        discoveryDocs: ["https://www.googleapis.com/discovery/v1/apis/drive/v3/rest"],
      });
    } catch (_) {}
    updateAuthState();
  });
};

// GSI（新OAuth）のロード完了時に呼ばれる
window.gisLoaded = function(){
  if (!GOOGLE_CLIENT_ID) return;
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: GOOGLE_SCOPE,
    callback: (resp) => {
      // 受け取ったアクセストークンを gapi にも反映
      if (resp && resp.access_token && gapi?.client?.setToken) {
        gapi.client.setToken({ access_token: resp.access_token });
      }
      updateAuthState();
    }
  });
};

// ログイン
gLoginBtn.addEventListener("click", () => {
  if (!tokenClient) {
    alert("Googleログインの初期化に失敗しました。ページを再読込してから再度お試しください。");
    return;
  }
  tokenClient.requestAccessToken({ prompt: "" }); // 初回に同意画面を出したい場合は "consent"
});

// ログアウト
gLogoutBtn.addEventListener("click", () => {
  const tokenObj = gapi?.client?.getToken && gapi.client.getToken();
  const accessToken = tokenObj?.access_token;
  if (accessToken && window.google?.accounts?.oauth2?.revoke) {
    google.accounts.oauth2.revoke(accessToken, () => {});
  }
  if (gapi?.client?.setToken) {
    gapi.client.setToken(null);
  }
  updateAuthState();
});

// 表示の更新
function updateAuthState() {
  const token = gapi?.client?.getToken && gapi.client.getToken();
  if (token?.access_token) {
    authStateEl.textContent = "ログイン中";
    authStateEl.style.color = "var(--ok)";
  } else {
    authStateEl.textContent = "未ログイン";
    authStateEl.style.color = "var(--muted)";
  }
}

// ========== 起動時 ==========
renderTable();
updateAuthState();
