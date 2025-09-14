// 外部 onload で先にダミーが動いた場合に追随して初期化を完了させる
if (window._gapiReady && typeof window.gapiLoaded === "function") window.gapiLoaded();
if (window._gisReady  && typeof window.gisLoaded  === "function") window.gisLoaded();
/***** Google Drive 連携（堅牢） *****/
const CLIENT_ID = "91348359952-pns9nlvg8tr82p6ht791c31gg5meh98q.apps.googleusercontent.com"; // ←あなたのクライアントID
const SCOPES = "https://www.googleapis.com/auth/drive.file";

let tokenClient = null;
let accessToken = null;
let gapiReady = false;
let gisReady = false;

window.gapiLoaded = function () {
  // gapi の初期化（ここでは discovery は不要）
  gapiReady = true;
};
window.gisLoaded = function () {
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPES,
    callback: (resp) => {
      if (resp.error) {
        console.error(resp);
        alert("Googleログインに失敗しました。");
        return;
      }
      accessToken = resp.access_token;
      document.getElementById("loginStatus").textContent = "ログイン済み";
    },
  });
  gisReady = true;
};

document.getElementById("loginButton").addEventListener("click", () => {
  if (!gisReady) {
    alert("Googleライブラリの読み込み待機中です。数秒後に再度お試しください。");
    return;
  }
  tokenClient.requestAccessToken({ prompt: "consent" });
});

/* ====== DOM参照 ====== */
const form = document.getElementById("entryForm");
const tableBody = document.querySelector("#recordsTable tbody");

const dateEl = document.getElementById("date");
const typeEl = document.getElementById("type");
const categoryEl = document.getElementById("category");
const categoryFreeEl = document.getElementById("categoryFree");
const otherPresetEl = document.getElementById("otherPreset");
const otherFreeEl = document.getElementById("otherFree");
const paymentEl = document.getElementById("payment");
const currencyEl = document.getElementById("currency");
const foreignAmountEl = document.getElementById("foreignAmount");
const rateEl = document.getElementById("rate");
const amountEl = document.getElementById("amount");
const memoEl = document.getElementById("memo");
const fileInput = document.getElementById("fileInput");

/* ====== 使い道＝「その他」で自由入力表示 ====== */
function toggleCategoryFree() {
  const show = categoryEl.value === "その他";
  categoryFreeEl.classList.toggle("hidden", !show);
}
categoryEl.addEventListener("change", toggleCategoryFree);
toggleCategoryFree();

/* ====== 為替自動取得 ====== */
async function fetchExchangeRate(base, target) {
  try {
    // exchangerate.host
    let res = await fetch(`https://api.exchangerate.host/latest?base=${base}&symbols=${target}`);
    if (res.ok) {
      let data = await res.json();
      if (data.rates && data.rates[target]) {
        return data.rates[target];
      }
    }
    // フォールバック: ER-API
    res = await fetch(`https://open.er-api.com/v6/latest/${base}`);
    if (res.ok) {
      let data = await res.json();
      if (data.rates && data.rates[target]) {
        return data.rates[target];
      }
    }
    throw new Error("両方のAPIで失敗");
  } catch (e) {
    console.error("為替レート取得エラー:", e);
    return null;
  }
}
document.getElementById("rateFetch").addEventListener("click", async () => {
  const base = document.getElementById("currency").value; // 例: USD
  const target = "JPY";
  const rate = await fetchExchangeRate(base, target);
  if (rate) {
    document.getElementById("rate").value = rate.toFixed(4);
  } else {
    alert("為替レートの自動取得に失敗しました。手動入力してください。");
  }
});

/* ====== 金額自動計算（外貨×レート） ====== */
function calcAmount() {
  const f = parseFloat(foreignAmountEl.value || "0");
  const r = parseFloat(rateEl.value || "0");
  if (f > 0 && r > 0) {
    amountEl.value = Math.round(f * r);
  }
}
foreignAmountEl.addEventListener("input", calcAmount);
rateEl.addEventListener("input", calcAmount);

/* ====== 保存（Driveアップロード → ローカル保存） ====== */
form.addEventListener("submit", async (e) => {
  e.preventDefault();

  // 使い道最終値
  const category = categoryEl.value === "その他" && categoryFreeEl.value.trim()
    ? categoryFreeEl.value.trim()
    : categoryEl.value;

  // 取引先最終値
  const vendor = (otherFreeEl.value || otherPresetEl.value || "").trim();

  const record = {
    id: crypto.randomUUID(),
    date: dateEl.value,
    type: typeEl.value, // income | expense
    category,
    vendor,
    payment: paymentEl.value,
    currency: currencyEl.value,
    foreignAmount: parseFloat(foreignAmountEl.value || "0"),
    rate: parseFloat(rateEl.value || "0"),
    amount: parseInt(amountEl.value || "0", 10), // JPY
    memo: memoEl.value,
    attachmentName: "",
    attachmentUrl: ""
  };

  // ファイルがあり、ログイン済みならDriveへアップロード
  if (fileInput.files.length > 0) {
    if (!accessToken) {
      alert("ファイルをDriveに保存するには、先に『Googleにログイン』してください。");
    } else {
      try {
        const file = fileInput.files[0];
        const meta = {
          name: `${record.date}_${file.name}`,
          mimeType: file.type || "application/octet-stream"
        };
        const formData = new FormData();
        formData.append("metadata", new Blob([JSON.stringify(meta)], { type: "application/json" }));
        formData.append("file", file);

        const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink",
          {
            method: "POST",
            headers: { Authorization: `Bearer ${accessToken}` },
            body: formData
          }
        );
        const data = await res.json();
        if (data && data.id) {
          record.attachmentName = file.name;
          record.attachmentUrl = data.webViewLink;
        } else {
          console.warn("Drive upload response:", data);
          alert("Driveへのアップロードに失敗しました（レコードは添付なしで保存されます）。");
        }
      } catch (err) {
        console.error(err);
        alert("Driveへのアップロードでエラーが発生しました。");
      }
    }
  }

  // ローカル保存
  const list = loadRecords();
  list.push(record);
  saveRecords(list);

  // クリア
  form.reset();
  toggleCategoryFree();
  document.getElementById("loginStatus").textContent = accessToken ? "ログイン済み" : "未ログイン";

  // 反映
  renderTable();
  alert("登録しました。");
});

/* ====== records ローカル保持 ====== */
const STORAGE_KEY = "records-v2";

function loadRecords() {
  return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
}
function saveRecords(arr) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
}

/* ====== 一覧描画 & 削除 ====== */
function renderTable() {
  const month = document.getElementById("filterMonth").value;
  const fCat = document.getElementById("filterCategory").value.trim();
  const fMethod = document.getElementById("filterMethod").value.trim();
  const fText = document.getElementById("filterText").value.trim().toLowerCase();

  const rows = loadRecords().filter(r => {
    let ok = true;
    if (month) ok = ok && r.date?.startsWith(month);
    if (fCat) ok = ok && r.category === fCat;
    if (fMethod) ok = ok && r.payment === fMethod;
    if (fText) {
      const hay = [r.category, r.vendor, r.memo].join(" ").toLowerCase();
      ok = ok && hay.includes(fText);
    }
    return ok;
  });

  tableBody.innerHTML = "";
  for (const r of rows) {
    const tr = document.createElement("tr");
    const foreign = r.currency === "JPY" ? "" :
      `${r.currency} ${r.foreignAmount} @${r.rate}`;

    tr.innerHTML = `
      <td>${r.date || ""}</td>
      <td>${escapeHtml(r.category || "")}</td>
      <td>${r.type === "income" ? "収入" : "経費"}</td>
      <td style="text-align:right">${formatJPY(r.amount)}</td>
      <td>${foreign}</td>
      <td>${escapeHtml(r.vendor || "")}</td>
      <td>${escapeHtml(r.payment || "")}</td>
      <td>${escapeHtml(r.memo || "")}</td>
      <td>${r.attachmentUrl ? `<a href="${r.attachmentUrl}" target="_blank">開く</a>` : ""}</td>
      <td><button class="btn btn-danger" data-id="${r.id}">削除</button></td>
    `;
    tableBody.appendChild(tr);
  }

  // 削除
  tableBody.querySelectorAll(".btn-danger").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id");
      const list = loadRecords().filter(r => r.id !== id);
      saveRecords(list);
      renderTable();
    });
  });
}

// util
function formatJPY(n){ if(!n && n!==0) return ""; return n.toLocaleString("ja-JP"); }
function escapeHtml(s){ return s.replace(/[&<>"']/g, c =>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c])); }

/* ====== フィルタ/CSV ====== */
document.getElementById("clearFilters").addEventListener("click", ()=>{
  document.getElementById("filterMonth").value = "";
  document.getElementById("filterCategory").value = "";
  document.getElementById("filterMethod").value = "";
  document.getElementById("filterText").value = "";
  renderTable();
});
["filterMonth","filterCategory","filterMethod","filterText"].forEach(id=>{
  document.getElementById(id).addEventListener("input", renderTable);
});

document.getElementById("exportCSV").addEventListener("click", ()=>{
  const rows = [["日付","使い道","区分","金額(JPY)","外貨","取引先","支払方法","メモ","添付URL"]];
  const list = loadRecords();
  list.forEach(r=>{
    rows.push([
      r.date || "",
      r.category || "",
      r.type==="income" ? "収入":"経費",
      r.amount || "",
      r.currency==="JPY" ? "" : `${r.currency} ${r.foreignAmount} @${r.rate}`,
      r.vendor || "",
      r.payment || "",
      r.memo || "",
      r.attachmentUrl || ""
    ]);
  });
  const csv = rows.map(a=>a.map(s=>`"${String(s).replace(/"/g,'""')}"`).join(",")).join("\r\n");
  const blob = new Blob([csv],{type:"text/csv"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "records.csv"; a.click();
  URL.revokeObjectURL(url);
});

/* ====== 集計 ====== */
function recalcSummary(){
  const m = document.getElementById("aggMonth").value; // yyyy-mm or ""
  const y = document.getElementById("aggYear").value;  // yyyy or ""

  const list = loadRecords();
  const byMonth = {}; // { 'yyyy-mm': {income, expense} }

  for(const r of list){
    const ym = (r.date || "").slice(0,7);
    const yr = (r.date || "").slice(0,4);
    if(!ym) continue;

    byMonth[ym] ||= {income:0, expense:0};
    byMonth[ym][r.type] += (r.amount || 0);
  }

  // 月次
  let mi=0, me=0;
  if(m){
    mi = byMonth[m]?.income || 0;
    me = byMonth[m]?.expense || 0;
  }
  document.getElementById("mIncome").textContent = formatJPY(mi);
  document.getElementById("mExpense").textContent = formatJPY(me);
  document.getElementById("mNet").textContent = formatJPY(mi - me);

  // 年次
  let yi=0, ye=0;
  if(y){
    for(const [key,val] of Object.entries(byMonth)){
      if(key.startsWith(y+"-")){ yi += val.income; ye += val.expense; }
    }
  }
  document.getElementById("yIncome").textContent = formatJPY(yi);
  document.getElementById("yExpense").textContent = formatJPY(ye);
  document.getElementById("yNet").textContent = formatJPY(yi - ye);

  // 月別表
  const tbody = document.querySelector("#monthlySummary tbody");
  tbody.innerHTML = "";
  Object.keys(byMonth).sort().forEach(k=>{
    const i = byMonth[k].income, e = byMonth[k].expense;
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${k}</td><td>${formatJPY(i)}</td><td>${formatJPY(e)}</td><td>${formatJPY(i-e)}</td>`;
    tbody.appendChild(tr);
  });
}

document.getElementById("recalc").addEventListener("click", recalcSummary);

/* ====== タブ ====== */
document.querySelectorAll(".tab").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    document.querySelectorAll(".tab").forEach(b=>b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach(p=>p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(btn.dataset.target).classList.add("active");
  });
});

/* ====== 初期描画 ====== */
renderTable();
recalcSummary();



