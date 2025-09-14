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
    console.log("[APP] gapi client ready");
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
    console.log("[APP] tokenClient initialized");
  } catch (e) {
    console.error("[APP] gis init failed", e);
  }
}

// 3) クリック時（準備できていないときは分かりやすく通知）
if (loginBtn) {
  loginBtn.onclick = () => {
    if (!tokenClient) {
      alert("まだ準備中です。数秒後に再度お試しください。");
      console.warn("[APP] tokenClient is not ready yet");
      return;
    }
    tokenClient.requestAccessToken();
  };
}

// 4) ページ読み込み後、外部SDKの読み込み完了を待つ（index.htmlでonload属性が無くても動く）
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

/***** 入力フォーム処理（Driveアップロード→登録） *****/
const form = document.getElementById("entryForm");
const tableBody = document.querySelector("#recordsTable tbody");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const date = document.getElementById("date").value;
  const category = document.getElementById("category").value;
  const customCategory = document.getElementById("customCategory").value.trim();
  const method = document.getElementById("method").value;
  const amount = Number(document.getElementById("amount").value || 0);
  const memo = document.getElementById("memo").value.trim();
  const fileInput = document.getElementById("fileInput");

  if(!date || !amount){ alert("日付と金額は必須です"); return; }
  const finalCategory = customCategory || category;
  const type = (finalCategory.includes("収益") ? "収入" : "経費");

  let fileName = "", fileUrl = "";
  if(fileInput.files.length>0){
    const file = fileInput.files[0];
    try{
      // Driveアップロード
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
      const fileId = data.id;

      // 共有リンク（閲覧用URL）
      fileUrl = `https://drive.google.com/file/d/${fileId}/view?usp=sharing`;
      fileName = file.name;
    }catch(err){
      console.error(err);
      alert("ファイルのアップロードに失敗しました。もう一度お試しください。");
      return;
    }
  }

  const rec = { id: crypto.randomUUID(), date, category: finalCategory, type, amount, method, memo, fileName, fileUrl };
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
    const linkHtml = r.fileUrl ? `<a href="${r.fileUrl}" target="_blank" data-preview="${r.fileUrl}" data-name="${r.fileName}" class="preview-link">${r.fileName||"開く"}</a>` : "";
    tr.innerHTML = `
      <td>${r.date}</td>
      <td>${r.category}</td>
      <td>${r.type}</td>
      <td>${r.amount.toLocaleString()}</td>
      <td>${r.method||""}</td>
      <td>${r.memo||""}</td>
      <td>${linkHtml}</td>
    `;
    tableBody.appendChild(tr);
  }
  bindPreviewLinks();
}

/***** CSVエクスポート *****/
document.getElementById("exportCSV").onclick = ()=>{
  const rows = records.filter(passesFilters).sort((a,b)=>a.date.localeCompare(b.date));
  const header = ["ID","日付","使い道","区分","金額","支払方法","メモ","ファイル名","ファイルURL"];
  const csv = [header.join(",")].concat(
    rows.map(r=>[
      r.id, r.date, esc(r.category), r.type, r.amount, esc(r.method||""), esc(r.memo||""), esc(r.fileName||""), r.fileUrl||""
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

  // 月次
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
      // Ctrl/⌘クリックや中クリックは新規タブを優先
      if(e.ctrlKey || e.metaKey || e.button===1) return;
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
