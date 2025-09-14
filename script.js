/***** Google Drive 連携（堅牢） *****/
const CLIENT_ID = "YOUR_OAUTH_CLIENT_ID.apps.googleusercontent.com"; // ←あなたのクライアントID
const SCOPES = "https://www.googleapis.com/auth/drive.file";

let tokenClient = null;
let gapiReady = false;
let gisReady  = false;

const loginBtn = document.getElementById("loginButton");
const statusEl = document.getElementById("loginStatus");
if (loginBtn) { loginBtn.disabled = true; loginBtn.title = "読み込み中…"; }

function setReady(){ if (gapiReady && gisReady) { loginBtn.disabled = false; loginBtn.title = ""; } }

// gapi 初期化
async function gapiLoaded(){
  try{
    await new Promise(res => gapi.load("client", res));
    await gapi.client.init({
      discoveryDocs:["https://www.googleapis.com/discovery/v1/apis/drive/v3/rest"],
    });
    gapiReady = true; setReady();
  }catch(e){ console.error("[gapi] init failed", e); }
}
// GIS 初期化
function gisLoaded(){
  try{
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPES,
      callback: (resp)=>{ if (!resp.error) statusEl.textContent = "ログイン済み"; }
    });
    gisReady = true; setReady();
  }catch(e){ console.error("[gis] init failed", e); }
}

// ===== 使い道（その他）トグル表示 =====
const category = getFinalCategory();

function updateCategoryFreeVisibility() {
  const show = categoryEl.value === 'その他';
  categoryFreeEl.classList.toggle('hidden', !show);
}
function getFinalCategory() {
  const c = categoryEl.value;
  if (c === 'その他') {
    const free = categoryFreeEl.value.trim();
    return free || 'その他';
  }
  return c;
}
categoryEl.addEventListener('change', updateCategoryFreeVisibility);
updateCategoryFreeVisibility(); // 初期状態の反映

// ログイン要求
if (loginBtn) loginBtn.onclick = () => {
  if (!tokenClient) return alert("準備中です。数秒後に再試行してください。");
  tokenClient.requestAccessToken();
};
// SDKロード順に依存しない待機
window.addEventListener("load", async ()=>{
  await waitFor(()=>window.gapi && typeof gapi.load==="function");
  await gapiLoaded();
  await waitFor(()=>window.google && google.accounts && google.accounts.oauth2);
  gisLoaded();
});
function waitFor(cond, timeout=10000, interval=100){
  return new Promise((resolve, reject)=>{
    const st = Date.now();
    const t = setInterval(()=>{
      if (cond()) { clearInterval(t); resolve(); }
      else if (Date.now() - st > timeout) { clearInterval(t); reject(new Error("timeout")); }
    }, interval);
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

/***** localStorage *****/
const STORAGE_KEY = "tc_accounting_records_v1";
let records = loadRecords();
function loadRecords(){ try{ return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }catch{ return []; } }
function saveRecords(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(records)); }

/***** 多通貨 UI *****/
const currencyEl  = document.getElementById("currency");
const amountFxEl  = document.getElementById("amountFx");
const fxRateEl    = document.getElementById("fxRate");
const amountJpyEl = document.getElementById("amount");

currencyEl.addEventListener("change", ()=>{
  if (currencyEl.value === "JPY") { amountFxEl.value = ""; fxRateEl.value = ""; }
  recalcJPY();
});
[amountFxEl, fxRateEl].forEach(el=>el.addEventListener("input", recalcJPY));

function recalcJPY(){
  if (currencyEl.value === "JPY") return;   // 直接JPY入力も許可
  const fx   = parseFloat(amountFxEl.value || "0");
  const rate = parseFloat(fxRateEl.value   || "0");
  if (fx>0 && rate>0) amountJpyEl.value = Math.round(fx * rate);
}

/***** 為替レート（API フェイルオーバー） *****/
const CURRENCY_API_KEY = "PUT_YOUR_CURRENCYAPI_KEY_HERE"; // 任意：あれば精度↑

async function fetchExchangeRate(baseCurrency, targetCurrency="JPY"){
  if (!CURRENCY_API_KEY || CURRENCY_API_KEY.includes("PUT_YOUR")) return null;
  const url = `https://api.currencyapi.com/v3/latest?apikey=${CURRENCY_API_KEY}&base_currency=${baseCurrency}&currencies=${targetCurrency}`;
  try{
    const r = await fetch(url);
    if (!r.ok) throw new Error("api error");
    const j = await r.json();
    return j.data[targetCurrency].value;
  }catch(e){ console.warn("currencyapi fail", e); return null; }
}

async function fetchFxRate(){
  try{
    const ccy = currencyEl.value;
    if (ccy === "JPY") return alert("通貨がJPYのため為替は不要です。");
    let rate = await fetchExchangeRate(ccy,"JPY");

    if (!rate) {
      const date = document.getElementById("date").value || new Date().toISOString().slice(0,10);
      const u = `https://api.exchangerate.host/convert?from=${encodeURIComponent(ccy)}&to=JPY&date=${date}`;
      try { const r = await fetch(u); const j = await r.json(); if (j && typeof j.result === "number") rate = j.result; } catch {}
    }

    if (!rate) {
      const u2 = `https://open.er-api.com/v6/latest/${encodeURIComponent(ccy)}`;
      const r2 = await fetch(u2); const j2 = await r2.json();
      if (j2 && j2.result === "success" && j2.rates && typeof j2.rates.JPY === "number") rate = j2.rates.JPY;
    }

    if (!rate) throw new Error("rate not found");
    fxRateEl.value = Number(rate).toFixed(6);
    recalcJPY();
  }catch(e){
    console.error(e);
    alert("為替レートの自動取得に失敗しました。手入力してください。");
  }
}
document.getElementById("autoRateBtn").addEventListener("click", fetchFxRate);

/***** Drive utils *****/
async function makeFilePublic(fileId){
  const token = gapi.client.getToken()?.access_token;
  if (!token) throw new Error("No token");
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/permissions`,{
    method:"POST",
    headers:{ "Authorization":"Bearer "+token, "Content-Type":"application/json" },
    body:JSON.stringify({role:"reader", type:"anyone"})
  });
  if (!res.ok) throw new Error(await res.text());
}
const drivePreviewUrl = (id)=>`https://drive.google.com/file/d/${id}/preview`;
const driveViewUrl    = (id)=>`https://drive.google.com/file/d/${id}/view?usp=sharing`;

/***** 入力送信 *****/
const form      = document.getElementById("entryForm");
const tableBody = document.querySelector("#recordsTable tbody");

form.addEventListener("submit", async (e)=>{
  e.preventDefault();

  const date     = document.getElementById("date").value;
  const category = document.getElementById("category").value;

  const otherPreset = document.getElementById("otherPreset").value;
  const otherFree   = document.getElementById("otherFree").value.trim();
  const other       = otherFree || otherPreset || "";  // ← その他の内容 最終値

  const method   = document.getElementById("method").value;
  const currency = currencyEl.value || "JPY";
  const amountFx = parseFloat(amountFxEl.value || "0");
  const fxRate   = parseFloat(fxRateEl.value   || "0");
  const amount   = parseInt(document.getElementById("amount").value || "0", 10);
  const memo     = document.getElementById("memo").value.trim();
  const fileInput= document.getElementById("fileInput");

  if (!date) return alert("日付は必須です。");
  if (currency === "JPY"){
    if (!amount) return alert("金額（円）は必須です。");
  }else{
    if (!amountFx || !fxRate) return alert("外貨金額とレートを入力してください（自動取得も可）。");
  }

  const type = category.includes("収益") ? "収入" : "経費";

  // 添付（任意）
  let fileName="", fileUrl="", fileId="", previewUrl="";
  if (fileInput.files.length > 0){
    try{
      const token = gapi.client.getToken()?.access_token;
      if (!token) return alert("先に『Googleにログイン』してください。");

      const file = fileInput.files[0];
      const metadata = { name:file.name, mimeType:file.type };
      const fd = new FormData();
      fd.append("metadata", new Blob([JSON.stringify(metadata)], {type:"application/json"}));
      fd.append("file", file);

      const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id",{
        method:"POST", headers:new Headers({Authorization:"Bearer "+token}), body:fd
      });
      const j = await res.json();
      if (!j.id) throw new Error("Driveアップロード失敗");
      fileId = j.id; fileName = file.name;

      await makeFilePublic(fileId);
      fileUrl    = driveViewUrl(fileId);
      previewUrl = drivePreviewUrl(fileId);
    }catch(err){
      console.error(err);
      return alert("ファイルのアップロードに失敗しました。再度お試しください。");
    }
  }

  const rec = {
    id: crypto.randomUUID(),
    date, category, type,
    amount,
    currency,
    amountFx: (currency==="JPY" ? 0 : amountFx),
    fxRate:   (currency==="JPY" ? 1 : fxRate),
    other, method, memo,
    fileName, fileUrl, fileId, previewUrl
  };

  records.push(rec); saveRecords();
  form.reset(); renderTable(); calcAggregates();
  alert("登録しました！");
});

/***** フィルタ＆描画 *****/
const filterMonth    = document.getElementById("filterMonth");
const filterCategory = document.getElementById("filterCategory");
const filterMethod   = document.getElementById("filterMethod");
const filterText     = document.getElementById("filterText");
document.getElementById("clearFilters").onclick = ()=>{
  filterMonth.value = ""; filterCategory.value=""; filterMethod.value=""; filterText.value="";
  renderTable();
};
[filterMonth, filterCategory, filterMethod, filterText].forEach(el=>el.addEventListener("input", renderTable));

function passesFilters(r){
  if (filterMonth.value && !r.date?.startsWith(filterMonth.value)) return false;
  if (filterCategory.value && r.category !== filterCategory.value) return false;
  if (filterMethod.value && r.method !== filterMethod.value) return false;
  const q = filterText.value.trim().toLowerCase();
  if (q){
    const hay = `${r.category} ${r.other||""} ${r.memo||""}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

function renderTable(){
  tableBody.innerHTML = "";
  const rows = records.filter(passesFilters).sort((a,b)=>a.date.localeCompare(b.date));
  for (const r of rows){
    const fxCell = (r.currency && r.currency!=="JPY")
      ? `${r.currency} ${Number(r.amountFx).toLocaleString(undefined,{maximumFractionDigits:4})} @ ${Number(r.fxRate).toLocaleString(undefined,{maximumFractionDigits:6})}`
      : "";
    const linkHtml = r.fileUrl ? `<a href="${r.fileUrl}" target="_blank" data-preview="${r.previewUrl || r.fileUrl}" data-name="${r.fileName}" class="preview-link">${r.fileName||"開く"}</a>` : "";

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r.date}</td>
      <td>${r.category}</td>
      <td>${r.type}</td>
      <td>${Number(r.amount||0).toLocaleString()}</td>
      <td>${fxCell}</td>
      <td>${r.other||""}</td>
      <td>${r.method||""}</td>
      <td>${r.memo||""}</td>
      <td>${linkHtml}</td>
      <td><button class="btn-danger delete-btn" data-id="${r.id}">削除</button></td>
    `;
    tableBody.appendChild(tr);
  }
  bindPreviewLinks();
}

/***** CSV *****/
document.getElementById("exportCSV").onclick = ()=>{
  const rows = records.filter(passesFilters).sort((a,b)=>a.date.localeCompare(b.date));
  const header = ["ID","日付","使い道","区分","金額JPY","通貨","外貨金額","為替レート","その他の内容","支払方法","メモ","ファイル名","ファイルURL"];
  const csv = [header.join(",")].concat(
    rows.map(r=>[
      r.id,r.date,esc(r.category),r.type,r.amount,
      r.currency||"JPY",r.amountFx||0,r.fxRate||1,
      esc(r.other||""),esc(r.method||""),esc(r.memo||""),esc(r.fileName||""),r.fileUrl||""
    ].join(","))
  ).join("\r\n");
  const blob = new Blob([csv],{type:"text/csv"});
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "records.csv"; a.click();
  URL.revokeObjectURL(a.href);
};
const esc = (s)=>`"${String(s).replace(/"/g,'""')}"`;

/***** 集計（月/年） *****/
const aggMonth = document.getElementById("aggMonth");
const aggYear  = document.getElementById("aggYear");
document.getElementById("recalc").onclick = calcAggregates;

function calcAggregates(){
  const ym   = aggMonth.value;
  const year = aggYear.value ? String(aggYear.value) : "";

  if (ym){
    const list = records.filter(r=>r.date?.startsWith(ym));
    setText("mIncome", yen(sumByType(list,"収入")));
    setText("mExpense",yen(sumByType(list,"経費")));
    setText("mNet",    yen(sumByType(list,"収入") - sumByType(list,"経費")));
  }else{ setText("mIncome","-"); setText("mExpense","-"); setText("mNet","-"); }

  if (year){
    const yList = records.filter(r=>r.date?.startsWith(year+"-"));
    const inc = sumByType(yList,"収入"), exp = sumByType(yList,"経費");
    setText("yIncome", yen(inc)); setText("yExpense", yen(exp)); setText("yNet", yen(inc-exp));
    const tbody = document.querySelector("#monthlySummary tbody"); tbody.innerHTML = "";
    for(let m=1;m<=12;m++){
      const mm = String(m).padStart(2,"0");
      const li = records.filter(r=>r.date?.startsWith(`${year}-${mm}`));
      const i  = sumByType(li,"収入"), e = sumByType(li,"経費");
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${m}月</td><td>${yen(i)}</td><td>${yen(e)}</td><td>${yen(i-e)}</td>`;
      tbody.appendChild(tr);
    }
  }else{
    setText("yIncome","-"); setText("yExpense","-"); setText("yNet","-");
    document.querySelector("#monthlySummary tbody").innerHTML = "";
  }
}
const sumByType=(list,type)=>list.filter(r=>r.type===type).reduce((s,r)=>s+Number(r.amount||0),0);
const yen=(n)=>Number(n||0).toLocaleString();
const setText=(id,txt)=>document.getElementById(id).innerText = txt;

/***** Driveプレビュー *****/
function bindPreviewLinks(){
  document.querySelectorAll("a.preview-link").forEach(a=>{
    a.addEventListener("click",(e)=>{
      if (e.ctrlKey || e.metaKey || e.button===1) return;
      e.preventDefault();
      openPreview(a.dataset.preview, a.dataset.name);
    });
  });
}
const modal   = document.getElementById("previewModal");
const closeBtn= document.getElementById("closePreview");
if (closeBtn) closeBtn.onclick = ()=>modal.close();
function openPreview(url, name){
  const cont = document.getElementById("previewContainer");
  cont.innerHTML = "";
  const iframe = document.createElement("iframe");
  iframe.src = url; iframe.title = name || "preview";
  cont.appendChild(iframe);
  modal.showModal();
}

/***** 初期描画 *****/
renderTable(); calcAggregates();

/***** 削除（Driveも可能なら削除） *****/
document.getElementById("recordsTable").addEventListener("click", async (e)=>{
  const btn = e.target.closest(".delete-btn");
  if (!btn) return;
  const id = btn.dataset.id;
  const rec = records.find(r=>r.id===id);
  if (!rec) return;

  const ok = confirm(
    `このレコードを削除しますか？\n\n` +
    `・日付：${rec.date}\n・使い道：${rec.category}\n・金額：${Number(rec.amount||0).toLocaleString()} JPY` +
    `${rec.currency && rec.currency!=="JPY" ? `（${rec.currency} ${rec.amountFx} @ ${rec.fxRate}）` : ""}\n` +
    `${rec.other ? `・その他の内容：${rec.other}\n` : ""}\n` +
    `※添付があればDriveファイルも可能なら削除します。`
  );
  if (!ok) return;

  if (rec.fileId){
    try{
      const token = gapi.client.getToken()?.access_token;
      if (token){
        await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(rec.fileId)}`,{
          method:"DELETE", headers:{Authorization:"Bearer "+token}
        });
      }
    }catch(err){ console.warn("Drive削除失敗（レコードは削除します）:", err); }
  }

  records = records.filter(r=>r.id!==id); saveRecords(); renderTable(); calcAggregates();
});

