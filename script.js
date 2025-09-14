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

  // 添付アップロード
  const file = fileInput.files?.[0];
  if (file){
    try{
      const uploaded = await uploadToDrive(file);
      record.file = uploaded;
    }catch(err){
      console.error(err);
      alert("ファイルのアップロードに失敗しました。ファイルなしで記録します。");
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
  const list = loadRecords();
  tableBody.innerHTML = "";

  list.filter(matchFilters).forEach(rec=>{
    const tr = document.createElement('tr');
    const fxStr = (rec.amountFx && rec.currency) ? `${rec.amountFx} ${rec.currency}` : "";
    const vendorStr = rec.vendor || "";

    tr.innerHTML = `
      <td>${rec.date||""}</td>
      <td>${rec.category||""}</td>
      <td>${rec.sectionType||""}</td>
      <td style="text-align:right">${fmt(rec.amount)}</td>
      <td>${fxStr}</td>
      <td>${rec.method||""}</td>
      <td>${vendorStr}</td>
      <td>${rec.memo||""}</td>
      <td>${rec.file && rec.file.webViewLink ? `<a href="#" data-preview="${rec.file.webViewLink}">プレビュー</a>` : ""}</td>
      <td><button class="btn btn-danger" data-del="${rec.id}">削除</button></td>
    `;
    tableBody.appendChild(tr);
  });

  // 削除
  tableBody.querySelectorAll('button[data-del]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const id = btn.dataset.del;
      const arr = loadRecords().filter(r=>r.id!==id);
      saveRecords(arr);
      renderTable();
      recalcAll();
    });
  });

  // プレビュー
  tableBody.querySelectorAll('a[data-preview]').forEach(a=>{
    a.addEventListener('click', (ev)=>{
      ev.preventDefault();
      const url = a.dataset.preview;
      previewContainer.innerHTML = `<iframe src="${url}"></iframe>`;
      previewModal.showModal();
    });
  });
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
