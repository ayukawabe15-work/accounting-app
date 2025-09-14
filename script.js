/***** Google Drive 連携セットアップ（堅牢版） *****/
const CLIENT_ID = "91348359952-pns9nlvg8tr82p6ht791c31gg5meh98q.apps.googleusercontent.com";
const SCOPES = "https://www.googleapis.com/auth/drive.file";

let tokenClient = null;
let gapiReady = false;
let gisReady = false;

// UI: 準備できるまでログインボタンを無効化
const loginBtn = document.getElementById("loginButton");
const statusEl = document.getElementById("loginStatus");
if (loginBtn) { loginBtn.disabled = true; loginBtn.title = "読み込み中…"; }

function setReady() {
  if (gapiReady && gisReady) {
    if (loginBtn) { loginBtn.disabled = false; loginBtn.title = ""; }
  }
}

// 1) gapi(client) 初期化
async function gapiLoaded() {
  try {
    await new Promise((resolve) => gapi.load("client", resolve));
    await gapi.client.init({
      discoveryDocs: ["https://www.googleapis.com/discovery/v1/apis/drive/v3/rest"],
    });
    gapiReady = true;
    setReady();
  } catch (e) {
    console.error("[APP] gapi init failed", e);
  }
}

// 2) Google Identity Services 初期化
function gisLoaded() {
  try {
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPES,
      callback: (resp) => {
        if (resp.error) { console.error(resp); return; }
        statusEl.textContent = "ログイン済み";
      },
    });
    gisReady = true;
    setReady();
  } catch (e) {
    console.error("[APP] gis init failed", e);
  }
}

// 3) クリック時
if (loginBtn) {
  loginBtn.onclick = () => {
    if (!tokenClient) {
      alert("まだ準備中です。数秒後に再度お試しください。");
      return;
    }
    tokenClient.requestAccessToken();
  };
}

// SDKの読み込み完了待ち（index.html側の順序に依存しない）
window.addEventListener("load", async () => {
  await waitFor(() => window.gapi && typeof gapi.load === "function");
  await gapiLoaded();
  await waitFor(() => window.google && google.accounts && google.accounts.oauth2);
  gisLoaded();
});
function waitFor(cond, timeoutMs = 10000, intervalMs = 100) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const timer = setInterval(() => {
      if (cond()) { clearInterval(timer); resolve(); }
      else if (Date.now() - start > timeoutMs) { clearInterval(timer); reject(new Error("timeout")); }
    }, intervalMs);
  });
}

/***** タブ切替 *****/
document.querySelectorAll(".tab").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    document.querySelectorAll(".tab").forEach(b=>b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach(p=>p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(btn.dataset.target).classList.add("active");
  });
});

/***** データ保存（localStorage） *****/
const STORAGE_KEY = "tc_accounting_records_v1";
let records = loadRecords();
function loadRecords(){ try{ return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }catch{ return []; } }
function saveRecords(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(records)); }

/***** 多通貨：UI要素とロジック *****/
const currencyEl = document.getElementById("currency");
const amountFxEl = document.getElementById("amountFx");
const fxRateEl   = document.getElementById("fxRate");
const autoRateBtn = document.getElementById("autoRateBtn");
const amountJpyEl = document.getElementById("amount");

// 通貨がJPYなら外貨項目をクリア＆無視、JPY以外なら自動で円換算
currencyEl.addEventListener("change", () => {
  if (currencyEl.value === "JPY") {
    amountFxEl.value = "";
    fxRateEl.value = "";
  }
  recalcJPY();
});
[amountFxEl, fxRateEl].forEach(el => el.addEventListener("input", recalcJPY));
amountJpyEl.addEventListener("input", () => {
  // 手動でJPYを直したいケースも許容（外貨入力が空でもOK）
});

function recalcJPY(){
  if (currencyEl.value === "JPY") return; // そのままJPY直接入力
  const fx = parseFloat(amountFxEl.value || "0");
  const rate = parseFloat(fxRateEl.value || "0");
  if (fx>0 && rate>0){
    amountJpyEl.value = Math.round(fx * rate);
  }
}

// 為替レートをCurrencyAPIから取得
async function fetchExchangeRate(baseCurrency, targetCurrency = "JPY") {
  const API_KEY = "cur_live_X8hUbLuHDTzYbSFbZO7awXs5vi4CzVNs45lfmWXS";
  const url = `https://api.currencyapi.com/v3/latest?apikey=${API_KEY}&base_currency=${baseCurrency}&currencies=${targetCurrency}`;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error("API error");
    const data = await res.json();
    return data.data[targetCurrency].value; // レート数値を返す
  } catch (err) {
    console.error("為替レート取得失敗:", err);
    alert("為替レートの取得に失敗しました。レートを手入力してください。");
    return null;
  }
}

// グローバル公開（HTMLの onclick からも呼べるように）
async function fetchFxRate() {
  try {
    const ccy = currencyEl.value;
    if (ccy === "JPY") {
      alert("通貨がJPYのため為替は不要です。");
      return;
    }
    const date = document.getElementById("date").value || new Date().toISOString().slice(0,10);

    // 1st: 指定日のレート（exchangerate.host）
    // 例: https://api.exchangerate.host/convert?from=USD&to=JPY&date=2025-09-14
    let rate = null;
    try {
      const url1 = `https://api.exchangerate.host/convert?from=${encodeURIComponent(ccy)}&to=JPY&date=${date}`;
      const r1 = await fetch(url1);
      const j1 = await r1.json();
      if (j1 && typeof j1.result === "number") rate = j1.result;
    } catch (_) {}

    // 2nd: フォールバック（最新レートのみ）
    if (!rate) {
      const url2 = `https://open.er-api.com/v6/latest/${encodeURIComponent(ccy)}`;
      const r2 = await fetch(url2);
      const j2 = await r2.json();
      if (j2 && j2.result === "success" && j2.rates && typeof j2.rates.JPY === "number") {
        rate = j2.rates.JPY;
      }
    }

    if (!rate) throw new Error("rate not found");

    fxRateEl.value = Number(rate).toFixed(6);
    recalcJPY();
  } catch (e) {
    console.error(e);
    alert("為替レートの自動取得に失敗しました。レートを手入力してください。");
  }
}

/***** 入力フォーム処理（Driveアップロード→登録） *****/
const form = document.getElementById("entryForm");
const tableBody = document.querySelector("#recordsTable tbody");

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const date = document.getElementById("date").value;
  const category = document.getElementById("category").value;
  const customCategory = document.getElementById("customCategory").value.trim();
  const method = document.getElementById("method").value;

  const currency = currencyEl.value || "JPY";
  const amountFx = parseFloat(amountFxEl.value || "0");
  const fxRate   = parseFloat(fxRateEl.value || "0");
  const amountJPY = parseInt(document.getElementById("amount").value || "0", 10);

  const memo = document.getElementById("memo").value.trim();
  const fileInput = document.getElementById("fileInput");

  // 入力チェック
  if(!date){ alert("日付は必須です"); return; }
  if(currency === "JPY"){
    if(!amountJPY){ alert("金額（円）は必須です"); return; }
  }else{
    if(!amountFx || !fxRate){ alert("外貨金額とレートを入力してください（自動取得も可）"); return; }
  }

  const finalCategory = (customCategory || category);
  const type = (finalCategory.includes("収益") ? "収入" : "経費");

  // ファイルアップロード
  let fileName = "", fileUrl = "", fileId = "";   // ← fileId を保持
  if(fileInput.files.length>0){
    const file = fileInput.files[0];
    try{
      const accessToken = gapi.client.getToken()?.access_token;
      if(!accessToken){ alert("先に『Googleにログイン』してください"); return; }

      const metadata = { name: file.name, mimeType: file.type };
      const fd = new FormData();
      fd.append("metadata", new Blob([JSON.stringify(metadata)], {type:"application/json"}));
      fd.append("file", file);

      const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", {
        method:"POST",
        headers: new Headers({ Authorization: "Bearer " + accessToken }),
        body: fd
      });
      const data = await res.json();
      if(!data.id) throw new Error("Google Driveへのアップロードに失敗");
      fileId = data.id; // ← ここでID取得
      fileUrl = `https://drive.google.com/file/d/${fileId}/view?usp=sharing`;
      fileName = file.name;
    }catch(err){
      console.error(err);
      alert("ファイルのアップロードに失敗しました。もう一度お試しください。");
      return;
    }
  }

  const rec = {
    id: crypto.randomUUID(),
    date,
    category: finalCategory,
    type,
    amount: amountJPY,
    currency,
    amountFx: (currency==="JPY" ? 0 : amountFx),
    fxRate:  (currency==="JPY" ? 1 : fxRate),
    method,
    memo,
    fileName, fileUrl,
    fileId // ← 追加（Drive側削除に使う）
  };
  records.push(rec);
  saveRecords();
  form.reset();
  renderTable();
  calcAggregates();
  alert("登録しました！");
});


/***** 一覧描画 + フィルタ *****/
const filterMonth = document.getElementById("filterMonth");
const filterCategory = document.getElementById("filterCategory");
const filterMethod = document.getElementById("filterMethod");
const filterText = document.getElementById("filterText");
document.getElementById("clearFilters").onclick = ()=>{
  filterMonth.value = ""; filterCategory.value=""; filterMethod.value=""; filterText.value="";
  renderTable();
};
[filterMonth, filterCategory, filterMethod, filterText].forEach(el=>el.addEventListener("input", renderTable));

function passesFilters(r){
  if(filterMonth.value){
    const ym = filterMonth.value; // "YYYY-MM"
    if(!r.date?.startsWith(ym)) return false;
  }
  if(filterCategory.value && r.category!==filterCategory.value) return false;
  if(filterMethod.value && r.method!==filterMethod.value) return false;
  const q = filterText.value.trim();
  if(q){
    const hay = `${r.category} ${r.memo}`.toLowerCase();
    if(!hay.includes(q.toLowerCase())) return false;
  }
  return true;
}

function renderTable(){
  tableBody.innerHTML = "";
  const rows = records.filter(passesFilters).sort((a,b)=>a.date.localeCompare(b.date));
  for(const r of rows){
    const tr = document.createElement("tr");
    // 外貨表示（JPY以外なら "USD 25.99 @ 151.23" など）
    const fxCell = (r.currency && r.currency!=="JPY")
      ? `${r.currency} ${Number(r.amountFx).toLocaleString(undefined,{maximumFractionDigits:4})} @ ${Number(r.fxRate).toLocaleString(undefined,{maximumFractionDigits:6})}`
      : "";
    const linkHtml = r.fileUrl ? `<a href="${r.fileUrl}" target="_blank" data-preview="${r.fileUrl}" data-name="${r.fileName}" class="preview-link">${r.fileName||"開く"}</a>` : "";
    tr.innerHTML = `
      <td>${r.date}</td>
      <td>${r.category}</td>
      <td>${r.type}</td>
      <td>${Number(r.amount||0).toLocaleString()}</td>
      <td>${fxCell}</td>
      <td>${r.method||""}</td>
      <td>${r.memo||""}</td>
      <td>${linkHtml}</td>
    `;
    tableBody.appendChild(tr);
  }
  bindPreviewLinks();
}
function renderTable(){
  tableBody.innerHTML = "";
  const rows = records.filter(passesFilters).sort((a,b)=>a.date.localeCompare(b.date));
  for(const r of rows){
    const tr = document.createElement("tr");
    // 外貨表示
    const fxCell = (r.currency && r.currency!=="JPY")
      ? `${r.currency} ${Number(r.amountFx).toLocaleString(undefined,{maximumFractionDigits:4})} @ ${Number(r.fxRate).toLocaleString(undefined,{maximumFractionDigits:6})}`
      : "";
    const linkHtml = r.fileUrl ? `<a href="${r.fileUrl}" target="_blank" data-preview="${r.fileUrl}" data-name="${r.fileName}" class="preview-link">${r.fileName||"開く"}</a>` : "";
    tr.innerHTML = `
      <td>${r.date}</td>
      <td>${r.category}</td>
      <td>${r.type}</td>
      <td>${Number(r.amount||0).toLocaleString()}</td>
      <td>${fxCell}</td>
      <td>${r.method||""}</td>
      <td>${r.memo||""}</td>
      <td>${linkHtml}</td>
      <!-- ▼ 削除ボタン列 -->
      <td><button class="delete-btn" data-id="${r.id}">削除</button></td>
    `;
    tableBody.appendChild(tr);
  }
  bindPreviewLinks();
}


/***** CSVエクスポート *****/
document.getElementById("exportCSV").onclick = ()=>{
  const rows = records.filter(passesFilters).sort((a,b)=>a.date.localeCompare(b.date));
  const header = ["ID","日付","使い道","区分","金額JPY","通貨","外貨金額","為替レート","支払方法","メモ","ファイル名","ファイルURL"];
  const csv = [header.join(",")].concat(
    rows.map(r=>[
      r.id, r.date, esc(r.category), r.type, r.amount,
      r.currency||"JPY", r.amountFx||0, r.fxRate||1,
      esc(r.method||""), esc(r.memo||""), esc(r.fileName||""), r.fileUrl||""
    ].join(","))
  ).join("\r\n");

  const blob = new Blob([csv], {type:"text/csv"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "records.csv";
  a.click();
  URL.revokeObjectURL(a.href);
};
function esc(s){ return `"${String(s).replace(/"/g,'""')}"`; }

/***** 集計（月次/年次） *****/
const aggMonth = document.getElementById("aggMonth");
const aggYear = document.getElementById("aggYear");
document.getElementById("recalc").onclick = calcAggregates;

function calcAggregates(){
  const ym = aggMonth.value; // "YYYY-MM" or ""
  const year = aggYear.value ? String(aggYear.value) : "";

  // 月次（JPY金額で集計）
  if(ym){
    const monthRecs = records.filter(r=>r.date?.startsWith(ym));
    const mIncome = sumByType(monthRecs,"収入");
    const mExpense = sumByType(monthRecs,"経費");
    setText("mIncome", yen(mIncome));
    setText("mExpense", yen(mExpense));
    setText("mNet", yen(mIncome - mExpense));
  }else{
    setText("mIncome","-"); setText("mExpense","-"); setText("mNet","-");
  }

  // 年次
  if(year){
    const yearRecs = records.filter(r=>r.date?.startsWith(year+"-"));
    const yIncome = sumByType(yearRecs,"収入");
    const yExpense = sumByType(yearRecs,"経費");
    setText("yIncome", yen(yIncome));
    setText("yExpense", yen(yExpense));
    setText("yNet", yen(yIncome - yExpense));

    // 月別テーブル
    const tbody = document.querySelector("#monthlySummary tbody");
    tbody.innerHTML = "";
    for(let m=1;m<=12;m++){
      const mm = String(m).padStart(2,"0");
      const list = records.filter(r=>r.date?.startsWith(`${year}-${mm}`));
      const inc = sumByType(list,"収入");
      const exp = sumByType(list,"経費");
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${m}月</td><td>${yen(inc)}</td><td>${yen(exp)}</td><td>${yen(inc-exp)}</td>`;
      tbody.appendChild(tr);
    }
  }else{
    setText("yIncome","-"); setText("yExpense","-"); setText("yNet","-");
    document.querySelector("#monthlySummary tbody").innerHTML="";
  }
}
function sumByType(list,type){ return list.filter(r=>r.type===type).reduce((s,r)=>s+Number(r.amount||0),0); }
function yen(n){ return Number(n||0).toLocaleString(); }
function setText(id,txt){ document.getElementById(id).innerText = txt; }

/***** Driveプレビュー（画像/PDFなら埋め込み） *****/
function bindPreviewLinks(){
  document.querySelectorAll("a.preview-link").forEach(a=>{
    a.addEventListener("click",(e)=>{
      if(e.ctrlKey || e.metaKey || e.button===1) return; // 新規タブ優先
      e.preventDefault();
      openPreview(a.dataset.preview, a.dataset.name);
    });
  });
}
const modal = document.getElementById("previewModal");
const closeBtn = document.getElementById("closePreview");
if (closeBtn) closeBtn.onclick = ()=>modal.close();

function openPreview(url, name){
  const cont = document.getElementById("previewContainer");
  cont.innerHTML = "";
  const iframe = document.createElement("iframe");
  iframe.src = url;
  iframe.title = name||"preview";
  cont.appendChild(iframe);
  modal.showModal();
}

/***** 初期描画 *****/
renderTable();
calcAggregates();

/***** 行の削除（レコードのみ or Drive添付も同時） *****/
// 一覧テーブル内の削除ボタンに対するイベント委譲
document.getElementById("recordsTable").addEventListener("click", async (e) => {
  const btn = e.target.closest(".delete-btn");
  if (!btn) return;

  const id = btn.dataset.id;
  const rec = records.find(r => r.id === id);
  if (!rec) return;

  const ok = confirm(
    `このレコードを削除しますか？\n\n` +
    `・日付：${rec.date}\n` +
    `・使い道：${rec.category}\n` +
    `・金額：${Number(rec.amount||0).toLocaleString()} JPY` +
    `${rec.currency && rec.currency !== "JPY" ? `（${rec.currency} ${rec.amountFx} @ ${rec.fxRate}）` : ""}\n\n` +
    `※添付があればDriveファイルも可能なら削除します。`
  );
  if (!ok) return;

  // 添付のDriveファイルも削除（fileIdがある場合のみ）
  if (rec.fileId) {
    try {
      const token = gapi.client.getToken()?.access_token;
      if (token) {
        await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(rec.fileId)}`, {
          method: "DELETE",
          headers: { Authorization: "Bearer " + token }
        });
      }
    } catch (err) {
      console.warn("Driveファイルの削除に失敗（レコードは削除します）：", err);
    }
  }

  // ローカル保存から削除 → 再描画・再集計
  records = records.filter(r => r.id !== id);
  saveRecords();
  renderTable();
  calcAggregates();
});



