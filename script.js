/***** Google Drive 連携（必要箇所のみ差し替え可） *****/
const CLIENT_ID = "91348359952-pns9nlvg8tr82p6ht791c31gg5meh98q.apps.googleusercontent.com"; // 例）xxxxxxxxx.apps.googleusercontent.com
const SCOPES = "https://www.googleapis.com/auth/drive.file";

let tokenClient, gapiInited=false, gisInited=false;
window.addEventListener('load', () => {
  // Google ライブラリのロード完了を待ってから初期化
  const gapiCheck = setInterval(()=>{
    if (window.gapi && window.google) {
      clearInterval(gapiCheck);
      initGoogle();
    }
  }, 200);
});

function initGoogle(){
  gapi.load('client', async ()=>{
    await gapi.client.init({
      apiKey: "", // 使わない
      discoveryDocs: ["https://www.googleapis.com/discovery/v1/apis/drive/v3/rest"]
    });
    gapiInited = true;
    setupGIS();
  });
}

function setupGIS(){
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPES,
    callback: (resp) => {
      if (resp.error) return;
      document.getElementById('loginStatus').innerText = "ログイン済み";
    }
  });
  gisInited = true;
  document.getElementById('loginButton').addEventListener('click', ()=> {
    if (!tokenClient) return alert("Googleライブラリの読み込み待機中です。少し待って再試行してください。");
    tokenClient.requestAccessToken({prompt:"consent"});
  });
}

/***** ストレージ（ローカル） *****/
const STORAGE_KEY = "turtlecity_accounting_records_v2";

/***** UI 要素参照 *****/
const tabs = document.querySelectorAll('.tab');
const panels = document.querySelectorAll('.tab-panel');

const form = document.getElementById('entryForm');
const dateEl = document.getElementById('date');
const sectionTypeEl = document.getElementById('sectionType');
const categoryEl = document.getElementById('category');
const vendorSelectEl = document.getElementById('vendorSelect');
const vendorFreeEl = document.getElementById('vendorFree');
const methodEl = document.getElementById('method');
const currencyEl = document.getElementById('currency');
const amountFxEl = document.getElementById('amountFx');
const fxRateEl = document.getElementById('fxRate');
const amountEl = document.getElementById('amount');
const memoEl = document.getElementById('memo');
const fileInput = document.getElementById('fileInput');

const tableBody = document.querySelector('#recordsTable tbody');

const filterMonth = document.getElementById('filterMonth');
const filterCategory = document.getElementById('filterCategory');
const filterMethod = document.getElementById('filterMethod');
const filterText = document.getElementById('filterText');
const clearFiltersBtn = document.getElementById('clearFilters');
const exportCSVBtn = document.getElementById('exportCSV');

const aggMonth = document.getElementById('aggMonth');
const aggYear  = document.getElementById('aggYear');
const recalcBtn = document.getElementById('recalc');
const mIncome = document.getElementById('mIncome');
const mExpense= document.getElementById('mExpense');
const mNet    = document.getElementById('mNet');
const yIncome = document.getElementById('yIncome');
const yExpense= document.getElementById('yExpense');
const yNet    = document.getElementById('yNet');
const monthlySummaryBody = document.querySelector('#monthlySummary tbody');

const previewModal = document.getElementById('previewModal');
const previewContainer = document.getElementById('previewContainer');
document.getElementById('closePreview').onclick = ()=> previewModal.close();

/***** タブ切替 *****/
tabs.forEach(btn=>{
  btn.addEventListener('click', ()=>{
    tabs.forEach(b=>b.classList.remove('active'));
    panels.forEach(p=>p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.target).classList.add('active');
  });
});

/***** 取引先の選択⇔自由入力 連動 *****/
vendorSelectEl.addEventListener('change', ()=>{
  if (vendorSelectEl.value === "__free__") {
    vendorFreeEl.value = "";
    vendorFreeEl.focus();
  } else if (vendorSelectEl.value) {
    vendorFreeEl.value = vendorSelectEl.value;
  }
});

/***** 為替の自動取得（フォールバック付き） *****/
async function fetchFxRate(){
  try{
    const base = currencyEl.value || 'USD';
    if (base === 'JPY') { fxRateEl.value = 1; convertIfPossible(); return; }
    // 1. exchangerate.host
    let res = await fetch(`https://api.exchangerate.host/latest?base=${encodeURIComponent(base)}&symbols=JPY`);
    if (res.ok){
      let j = await res.json();
      if (j && j.rates && j.rates.JPY){
        fxRateEl.value = j.rates.JPY.toFixed(6);
        convertIfPossible(); return;
      }
    }
    // 2. open.er-api.com
    res = await fetch(`https://open.er-api.com/v6/latest/${encodeURIComponent(base)}`);
    if (res.ok){
      let j = await res.json();
      if (j && j.rates && j.rates.JPY){
        fxRateEl.value = Number(j.rates.JPY).toFixed(6);
        convertIfPossible(); return;
      }
    }
    alert("為替レートの自動取得に失敗しました。レートを手入力してください。");
  }catch(e){
    alert("為替レートの自動取得に失敗しました。レートを手入力してください。");
  }
}
window.fetchFxRate = fetchFxRate;

function convertIfPossible(){
  const fx = parseFloat(amountFxEl.value);
  const rate = parseFloat(fxRateEl.value);
  if (!isNaN(fx) && !isNaN(rate) && rate>0){
    amountEl.value = Math.round(fx*rate);
  }
}
amountFxEl.addEventListener('input', convertIfPossible);
fxRateEl.addEventListener('input', convertIfPossible);

/***** レコードの読み書き *****/
function loadRecords(){
  try{
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  }catch{ return []; }
}
function saveRecords(arr){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
}

/***** Driveへアップロード（簡易） *****/
async function uploadToDrive(file){
  if (!file) return {id:null, name:null, mimeType:null, webViewLink:null};
  if (!gapiInited || !gisInited){
    alert("Googleライブラリの読み込み待機中です。ログイン後にもう一度保存してください。");
    throw new Error("not ready");
  }
  // アクセストークン要求（すでに許可されていれば即時）
  tokenClient.requestAccessToken({prompt:''});

  const metadata = {
    name: file.name,
    mimeType: file.type || 'application/octet-stream'
  };
  const boundary = "-------turtlecityboundary" + Math.random().toString(16).slice(2);
  const delimiter = "--" + boundary + "\r\n";
  const closeDelim = "--" + boundary + "--";

  const metaPart = `Content-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`;
  const filePart = `Content-Type: ${metadata.mimeType}\r\n\r\n`;
  const body = new Blob([
    delimiter, metaPart,
    delimiter, filePart, file,
    "\r\n", closeDelim
  ], {type: `multipart/related; boundary=${boundary}`});

  const res = await gapi.client.request({
    path: 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
    method: 'POST',
    headers: {'Content-Type': `multipart/related; boundary=${boundary}`},
    body
  });
  const fileId = res.result.id;

  // 権限を自分だけにしたい場合はここで終了。共有リンクを使う場合は permissions を設定。
  const getRes = await gapi.client.drive.files.get({
    fileId,
    fields: 'id,name,mimeType,webViewLink,webContentLink'
  });
  return getRes.result;
}

/***** 送信処理 *****/
form.addEventListener('submit', async (e)=>{
  e.preventDefault();

  const record = {
    id: "r_" + Date.now(),
    date: dateEl.value || "",
    sectionType: sectionTypeEl.value || "支出", // 収入 or 支出
    category: categoryEl.value || "",
    vendor: (vendorFreeEl.value || "").trim(),
    method: methodEl.value || "",
    currency: currencyEl.value || "JPY",
    amountFx: amountFxEl.value ? Number(amountFxEl.value) : null,
    fxRate: fxRateEl.value ? Number(fxRateEl.value) : null,
    amount: amountEl.value ? Number(amountEl.value) : 0,
    memo: memoEl.value || "",
    file: null // {id,name,mimeType,webViewLink}
  };
  const rec = {
    id: crypto.randomUUID(),
    date,
    category: finalCategory,
    type,
    amount: amountJPY,
    currency,
    amountFx: (currency === "JPY" ? 0 : amountFx),
    fxRate:  (currency === "JPY" ? 1 : fxRate),
    method,
    memo,
    fileName, 
    fileUrl,     // ← 既存：viewリンク
    fileId,      // ← 既存：削除時に使用
    previewUrl: (typeof _previewUrl !== "undefined" ? _previewUrl : "") // ← 追加：埋め込み用
  };

  // ファイルアップロード
  let fileName = "", fileUrl = "", fileId = "";
  if (fileInput.files.length > 0) {
    const file = fileInput.files[0];
    try {
      const accessToken = gapi.client.getToken()?.access_token;
      if (!accessToken) { alert("先に『Googleにログイン』してください"); return; }

      const metadata = { name: file.name, mimeType: file.type };
      const fd = new FormData();
      fd.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
      fd.append("file", file);

      // 1) アップロード（idのみ受け取る）
      const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", {
        method: "POST",
        headers: new Headers({ Authorization: "Bearer " + accessToken }),
        body: fd
      });
      const data = await res.json();
      if (!data.id) throw new Error("Google Driveへのアップロードに失敗");
      fileId = data.id;
      fileName = file.name;

      // 2) 共有権限を anyone:reader に変更
      await makeFilePublic(fileId);

      // 3) URLをプレビュー用と表示用の両方で保持
      fileUrl = driveViewUrl(fileId);             // 新規タブで開く用
      const previewUrl = drivePreviewUrl(fileId); // iframeプレビュー用

      // 後で使うために両方持っておく（既存構造に合わせるなら fileUrl に view を入れてOK）
      // ここではレコード保存時に previewUrl を r.previewUrl として追加します↓
      var _previewUrl = previewUrl;

      // ↓ この下の rec オブジェクトを作る所で _previewUrl を使います
    } catch (err) {
      console.error(err);
      alert("ファイルのアップロードに失敗しました。もう一度お試しください。");
      return;
    }
  }

  // 保存
  const list = loadRecords();
  list.push(record);
  saveRecords(list);

  // 初期化
  form.reset();
  sectionTypeEl.value = "支出";
  currencyEl.value = "JPY";

  renderTable();
  recalcAll();

  alert("保存しました。");
});

/***** 表の描画 *****/
function fmt(n){ return (n==null || isNaN(n)) ? "" : n.toLocaleString(); }

function matchFilters(rec){
  if (filterMonth.value){
    const ym = filterMonth.value; // "YYYY-MM"
    if (!rec.date?.startsWith(ym)) return false;
  }
  if (filterCategory.value && rec.category !== filterCategory.value) return false;
  if (filterMethod.value && rec.method !== filterMethod.value) return false;

  if (filterText.value){
    const t = filterText.value.toLowerCase();
    const s = [rec.category, rec.memo, rec.vendor].join(" ").toLowerCase();
    if (!s.includes(t)) return false;
  }
  return true;
}

function renderTable(){
  tableBody.innerHTML = "";
  const rows = records.filter(passesFilters).sort((a,b)=>a.date.localeCompare(b.date));
  for(const r of rows){
    const tr = document.createElement("tr");
    const fxCell = (r.currency && r.currency!=="JPY")
      ? `${r.currency} ${Number(r.amountFx).toLocaleString(undefined,{maximumFractionDigits:4})} @ ${Number(r.fxRate).toLocaleString(undefined,{maximumFractionDigits:6})}`
      : "";

    const previewLink = r.previewUrl || (r.fileId ? drivePreviewUrl(r.fileId) : "");
    const linkHtml = r.fileUrl 
      ? `<a href="${r.fileUrl}" target="_blank" data-preview="${previewLink}" data-name="${r.fileName}" class="preview-link">${r.fileName || "開く"}</a>`
      : "";

    tr.innerHTML = `
      <td>${r.date}</td>
      <td>${r.category}</td>
      <td>${r.type}</td>
      <td>${Number(r.amount||0).toLocaleString()}</td>
      <td>${fxCell}</td>
      <td>${r.method||""}</td>
      <td>${r.memo||""}</td>
      <td>${linkHtml}</td>
      <td><button class="btn-danger delete-btn" data-id="${r.id}">削除</button></td>
    `;
    tableBody.appendChild(tr);
  }
  bindPreviewLinks();
}
// Drive: ファイルを「リンクを知っている全員が閲覧可」にする
async function makeFilePublic(fileId) {
  const token = gapi.client.getToken()?.access_token;
  if (!token) throw new Error("No access token");

  // 権限付与（anyone, reader）
  const permRes = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/permissions`, {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + token,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      role: "reader",
      type: "anyone"
    })
  });

  if (!permRes.ok) {
    const t = await permRes.text().catch(() => "");
    throw new Error("Set permission failed: " + t);
  }
}

// Drive: 埋め込み用のプレビューURL（iframe向け）
function drivePreviewUrl(fileId) {
  return `https://drive.google.com/file/d/${fileId}/preview`;
}
// 新規タブでの閲覧URL（普通の共有リンク）
function driveViewUrl(fileId) {
  return `https://drive.google.com/file/d/${fileId}/view?usp=sharing`;
}

/***** フィルタ／CSV *****/
clearFiltersBtn.addEventListener('click', ()=>{
  filterMonth.value = filterCategory.value = filterMethod.value = filterText.value = "";
  renderTable();
});

exportCSVBtn.addEventListener('click', ()=>{
  const rows = [["id","日付","区分","使い道","金額JPY","外貨金額","通貨","レート","支払方法","取引先","メモ","ファイルURL"]];
  loadRecords().filter(matchFilters).forEach(r=>{
    rows.push([
      r.id, r.date, r.sectionType, r.category, r.amount,
      r.amountFx??"", r.currency??"", r.fxRate??"",
      r.method??"", r.vendor??"", r.memo??"",
      r.file?.webViewLink??""
    ]);
  });
  const csv = rows.map(row=>row.map(v=>{
    v = (v==null)?"":String(v);
    if (v.includes('"')||v.includes(',')||v.includes('\n')) v = `"${v.replace(/"/g,'""')}"`;
    return v;
  }).join(",")).join("\n");

  const blob = new Blob([csv],{type:"text/csv"});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = "records.csv";
  a.click();
});

/***** 集計 *****/
function recalcAll(){
  const arr = loadRecords();
  // 月次
  if (aggMonth.value){
    const ym = aggMonth.value;
    const monthArr = arr.filter(r=>r.date?.startsWith(ym));
    const inc = monthArr.filter(r=>r.sectionType==="収入").reduce((s,r)=>s+(r.amount||0),0);
    const exp = monthArr.filter(r=>r.sectionType==="支出").reduce((s,r)=>s+(r.amount||0),0);
    mIncome.textContent = fmt(inc);
    mExpense.textContent= fmt(exp);
    mNet.textContent    = fmt(inc-exp);
  }else{
    mIncome.textContent = mExpense.textContent = mNet.textContent = "-";
  }

  // 年次
  if (aggYear.value){
    const y = String(aggYear.value);
    const yArr = arr.filter(r=>r.date?.startsWith(y+"-"));
    const inc = yArr.filter(r=>r.sectionType==="収入").reduce((s,r)=>s+(r.amount||0),0);
    const exp = yArr.filter(r=>r.sectionType==="支出").reduce((s,r)=>s+(r.amount||0),0);
    yIncome.textContent = fmt(inc);
    yExpense.textContent= fmt(exp);
    yNet.textContent    = fmt(inc-exp);

    // 月別
    monthlySummaryBody.innerHTML = "";
    for (let m=1;m<=12;m++){
      const mm = y+"-"+String(m).padStart(2,"0");
      const mmArr = yArr.filter(r=>r.date?.startsWith(mm));
      const mi = mmArr.filter(r=>r.sectionType==="収入").reduce((s,r)=>s+(r.amount||0),0);
      const me = mmArr.filter(r=>r.sectionType==="支出").reduce((s,r)=>s+(r.amount||0),0);
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${mm}</td><td style="text-align:right">${fmt(mi)}</td><td style="text-align:right">${fmt(me)}</td><td style="text-align:right">${fmt(mi-me)}</td>`;
      monthlySummaryBody.appendChild(tr);
    }
  }else{
    monthlySummaryBody.innerHTML = "";
  }
}

recalcBtn.addEventListener('click', recalcAll);

/***** 初期化 *****/
renderTable();
recalcAll();


