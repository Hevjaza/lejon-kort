/* Lejon Kort – Kortskanning v6 (kamera + OCR på telefonen, inget laddas upp) */
'use strict';
const SC = { stream: null, busy: false, status: '', res: null, photo: null, text: '', typed: '', idx: null, worker: null, pct: 0, hint: '', hintK: '', read: '', zoom: 1, caps: {}, frameN: 0 };
const TESS = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
const STRIP_WL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789/-';
const BLUR_T = 60; // under detta (Laplace-varians på 160 px bredd) räknas bilden som suddig
const zz = ms => new Promise(r => setTimeout(r, ms));

const RINGTXT = { idle: 'Lägg kortet i rutan', load: 'Laddar skanner…', scan: 'Skannar automatiskt…', read: 'Läser kortet…', found: 'Kort hittat!', none: 'Hittade inget – försök igen', off: '' };
function ringHtml() {
  const st = SC.ring || 'idle'; const mini = SC.stream && st !== 'found' && st !== 'none';
  return `<div class="sring ${st}${mini ? ' mini' : ''}" id="sring"><svg class="arc" viewBox="0 0 100 100" aria-hidden="true"><circle class="bg" cx="50" cy="50" r="45"/><circle class="fg" cx="50" cy="50" r="45" pathLength="100"/></svg><div class="core">${st === 'found' ? '<b>✓</b>' : st === 'none' ? '<b>?</b>' : '<b>📷</b>'}<span id="sringtxt">${esc(SC.ringTxt || RINGTXT[st] || '')}</span></div></div>`;
}
function setRing(st, txt) {
  const wasMini = SC.stream && SC.ring !== 'found' && SC.ring !== 'none';
  SC.ring = st; SC.ringTxt = txt || RINGTXT[st] || '';
  const el = $('#sring'); if (el) el.outerHTML = ringHtml();
  const hs = $('#hudst'); if (hs) hs.textContent = SC.ringTxt;
  const nowMini = SC.stream && st !== 'found' && st !== 'none';
  if (SC.stream && wasMini !== nowMini) rerenderScan(); // knapparna byts (Fota nu ↔ Skanna nästa)
}
function setHint(h, k) {
  SC.hint = h; SC.hintK = k || '';
  const el = $('#scanhint'); if (el) { el.textContent = h; el.className = 'hint ' + SC.hintK; }
  const fr = $('#camframe'); if (fr) fr.className = 'frame ' + SC.hintK;
}
function setRead(t) { SC.read = t; const el = $('#scanread'); if (el) el.innerHTML = t ? 'Läste: <b>' + esc(t) + '</b>' : ''; }
function tipHtml() {
  return `<div class="tipcard"><b>Svårt att hitta kortet?</b><ul>
   <li>Lägg kortet på bordet i bra ljus och <b>fyll den streckade rutan</b> med kortet</li>
   <li>Håll telefonen still ca <b>15–20 cm</b> ovanför – iPhone fokuserar inte närmare</li>
   <li>Vinkla kortet lite om det blänker</li></ul>
   <div class="btns"><button class="btn pri" data-act="still">📸 Fota nu</button><button class="btn" data-act="typenum">⌨️ Skriv kortnummer</button></div>
   <label class="btn full" style="margin-top:8px">📱 Fota med iPhone-kameran (skarpast)<input type="file" accept="image/*" capture="environment" id="scanfile2" hidden></label></div>`;
}
function vScan() {
  const lb = (v, l) => `<button data-scanlang="${v}" class="${S.scanLang === v ? 'on' : ''}">${l}</button>`;
  const auto = S.autoScan !== false; const showRing = SC.stream || SC.preview || SC.busy;
  const found = SC.ring === 'found';
  const zoomBtn = SC.stream && SC.caps && SC.caps.zoom && SC.caps.zoom.max >= 1.5 ? `<button class="camzoom" data-act="zoom">🔍 ${SC.zoom > 1 ? '1x' : '2x'}</button>` : '';
  return `<h2>Skanna kort</h2><p class="lead">Lägg kortet i rutan – appen <b>skannar automatiskt</b> och läser kortnumret längst ner (201/165, OP01-001) och setkoden (SV2a).</p>
  <div class="seg lseg">${lb('auto', 'Auto')}${lb('en', 'Engelska (EN)')}${lb('ja', '🇯🇵 Japanska (JP)')}</div>
  <div class="card scanbox" id="scanview">
   <div class="cam ${SC.stream ? 'on' : ''}"><video id="scanvid" playsinline muted autoplay></video>${SC.stream ? `<div class="frame ${SC.hintK}" id="camframe"><i></i></div>` : ''}
    ${!SC.stream && SC.preview ? `<img class="camprev" src="${esc(SC.preview)}" alt="">` : ''}
    ${!SC.stream && !SC.preview ? `<div class="camoff"><b>📷</b><span>Starta kameran eller fota/välj en bild</span></div>` : ''}
    ${showRing ? ringHtml() : ''}${zoomBtn}</div>
   ${SC.stream ? `<div class="camhud" id="camhud"><div class="hst" id="hudst">${esc(SC.ringTxt || RINGTXT[SC.ring || 'idle'])}</div><div class="hint ${SC.hintK}" id="scanhint">${esc(SC.hint || 'Lägg kortet i den streckade rutan')}</div><div class="hread" id="scanread">${SC.read ? 'Läste: <b>' + esc(SC.read) + '</b>' : ''}</div></div>` : ''}
   <div class="btns" style="margin-top:10px">${SC.stream ? `${found ? `<button class="btn grn big" data-act="scannext" style="flex:2">↻ Skanna nästa</button>` : `<button class="btn pri big" data-act="still" style="flex:2">📸 Fota nu</button>`}<button class="btn" data-act="camoff">Stäng kamera</button>` : `<button class="btn pri big" data-act="camon" style="flex:2">📷 Starta kameran</button>`}</div>
   <form id="scanform" class="qs numq"><input id="scanq" class="inp" type="search" autocapitalize="characters" autocorrect="off" spellcheck="false" autocomplete="off" placeholder="⌨️ Kortnummer, t.ex. 201/165" value="${esc(SC.typed)}"><button class="btn pri" type="submit">Sök</button></form>
   <div id="scantip">${SC.tip && SC.stream && !found ? tipHtml() : ''}</div>
   <label class="btn full" style="margin-top:10px">🖼️ Fota / välj bild<input type="file" accept="image/*" id="scanfile" hidden></label>
   <label class="atog"><input type="checkbox" id="autoscan" ${auto ? 'checked' : ''}><span class="sw"></span><b>Auto-skanning: <em>${auto ? 'PÅ' : 'AV'}</em></b><small>${auto ? 'skannar hela tiden tills kortet hittas' : 'tryck 📸 Fota nu'}</small></label>
   <label class="atog"><input type="checkbox" id="autosave" ${S.autoSave !== false ? 'checked' : ''}><span class="sw"></span><b>Auto-spara i pärmen: <em>${S.autoSave !== false ? 'PÅ' : 'AV'}</em></b><small>${S.autoSave !== false ? 'säker träff sparas direkt (+1 ogradat)' : 'du trycker + Spara i pärmen'}</small></label>
   <div id="scanstat" class="muted" style="margin-top:8px">${esc(SC.status)}</div>
  </div>
  <div class="muted" style="margin-bottom:12px">Tips: koden längst ner på kortet (t.ex. <b>201/165</b> eller <b>OP01-001</b>) räcker – skriv den om kameran inte hittar kortet.</div>
  <div id="scanres"></div>`;
}
function rerenderScan() { if (S.tab !== 'scan') return; const ae = document.activeElement; const typing = ae && ae.id === 'scanq'; $('#app').innerHTML = vScan(); renderScanResults(); const nv = $('#scanvid'); if (SC.stream && nv) { nv.srcObject = SC.stream; nv.play().catch(() => { }); } if (typing) { const q = $('#scanq'); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } } }
function stopCamera() {
  SC.loopId = (SC.loopId || 0) + 1; clearTimeout(SC.loopT); SC.prevY = null;
  if (SC.stream) { SC.stream.getTracks().forEach(t => t.stop()); SC.stream = null; }
}
async function startCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { toast('Kameran stöds inte här – fota/välj en bild'); return; }
  try {
    SC.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
    const tr = SC.stream.getVideoTracks()[0]; SC.caps = {};
    try { // kontinuerlig autofokus/exponering/vitbalans om kameran stöder det
      const caps = tr.getCapabilities ? tr.getCapabilities() : {}; SC.caps = caps || {}; const adv = {};
      for (const k of ['focusMode', 'exposureMode', 'whiteBalanceMode']) if (Array.isArray(caps[k]) && caps[k].includes('continuous')) adv[k] = 'continuous';
      if (Object.keys(adv).length) await tr.applyConstraints({ advanced: [adv] }).catch(() => { });
    } catch (e) { }
    SC.zoom = 1; SC.preview = null; SC.ring = 'idle'; SC.tip = false; SC.hint = ''; SC.hintK = ''; SC.read = ''; SC.prevY = null; rerenderScan();
    startLoop();
  } catch (e) { SC.stream = null; toast('Fick inte använda kameran – fota/välj en bild i stället'); }
}
async function toggleZoom() {
  const tr = SC.stream && SC.stream.getVideoTracks()[0]; const zc = SC.caps && SC.caps.zoom; if (!tr || !zc) return;
  const z = SC.zoom > 1 ? Math.max(1, zc.min || 1) : Math.min(2, zc.max); try { await tr.applyConstraints({ advanced: [{ zoom: z }] }); SC.zoom = z; } catch (e) { toast('Zoom stöds inte'); }
  rerenderScan();
}
/* ---------- bildkvalitet: skärpa, ljus, blänk, rörelse ---------- */
function frameQuality(c) {
  const w = 160, h = Math.max(8, Math.round(c.height * w / c.width)); const t = document.createElement('canvas'); t.width = w; t.height = h;
  const g = t.getContext('2d', { willReadFrequently: true }); g.drawImage(c, 0, 0, w, h); const p = g.getImageData(0, 0, w, h).data;
  const n = w * h, Y = new Float32Array(n); let sum = 0, glare = 0;
  for (let i = 0, j = 0; j < n; i += 4, j++) { const y = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2]; Y[j] = y; sum += y; if (y >= 248) glare++; }
  let ls = 0, ls2 = 0, m = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x; const l = 4 * Y[i] - Y[i - 1] - Y[i + 1] - Y[i - w] - Y[i + w]; ls += l; ls2 += l * l; m++; }
  const lm = ls / m; let motion = 0;
  if (SC.prevY && SC.prevY.length === n) { let d = 0; for (let j = 0; j < n; j++) d += Math.abs(Y[j] - SC.prevY[j]); motion = d / n; }
  SC.prevY = Y;
  return { mean: sum / n, glare: glare / n, sharp: ls2 / m - lm * lm, motion };
}
function qualityHint(q) { // [text, klass, okAttLäsa]
  if (q.mean < 45) return ['💡 Mer ljus – tänd lampan eller gå till ett fönster', 'warn', false];
  if (q.motion > 22) return ['✋ Håll stilla…', 'warn', false];
  if (q.sharp < BLUR_T) return ['✋ Håll stilla – bilden är suddig. Håll kortet ca 15–20 cm bort', 'warn', false];
  if (q.glare > 0.06) return ['✨ Undvik blänk – vinkla kortet lite', 'warn', true];
  return ['✓ Bra bild – läser kortet…', 'ok', true];
}
/* ---------- beskärning till den streckade rutan ---------- */
function frameBox(vw, vh) {
  const v = $('#scanvid'), fr = $('#camframe i');
  if (v && fr) {
    const vr = v.getBoundingClientRect(), r = fr.getBoundingClientRect();
    if (vr.width > 10 && r.width > 10) {
      const s = Math.max(vr.width / vw, vr.height / vh); const ox = (vr.width - vw * s) / 2, oy = (vr.height - vh * s) / 2; // object-fit: cover
      let x = (r.left - vr.left - ox) / s, y = (r.top - vr.top - oy) / s, w = r.width / s, h = r.height / s;
      const px = w * 0.07, py = h * 0.05; x -= px; y -= py; w += 2 * px; h += 2 * py; // lite marginal om kortet ligger snett
      x = Math.max(0, x); y = Math.max(0, y); w = Math.min(vw - x, w); h = Math.min(vh - y, h);
      if (w > 40 && h > 40) return { x, y, w, h };
    }
  }
  const fw = Math.min(vw * 0.9, vh * 0.9 * 63 / 88), fh = fw * 88 / 63; return { x: (vw - fw) / 2, y: (vh - fh) / 2, w: fw, h: fh };
}
async function grabFrame(still) {
  const v = $('#scanvid'); if (!v || !v.videoWidth) return null;
  const vw = v.videoWidth, vh = v.videoHeight; let src = v, k = 1;
  if (still && window.ImageCapture && SC.stream) { // full upplösning om webbläsaren kan (inte Safari)
    try {
      const ic = new ImageCapture(SC.stream.getVideoTracks()[0]); const blob = await Promise.race([ic.takePhoto(), zz(4000).then(() => { throw new Error('t'); })]);
      const bmp = await createImageBitmap(blob); if (Math.abs(bmp.width / bmp.height - vw / vh) < 0.03 && bmp.width > vw) { src = bmp; k = bmp.width / vw; }
    } catch (e) { }
  }
  const b = frameBox(vw, vh); const maxW = 1400; const outK = Math.min(1, maxW / (b.w * k));
  const cc = document.createElement('canvas'); cc.width = Math.round(b.w * k * outK); cc.height = Math.round(b.h * k * outK);
  const g = cc.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(src, b.x * k, b.y * k, b.w * k, b.h * k, 0, 0, cc.width, cc.height);
  return cc;
}
function canvasPhoto(cc) {
  const fk = Math.min(1, 1600 / Math.max(cc.width, cc.height)); const f = document.createElement('canvas'); f.width = Math.round(cc.width * fk); f.height = Math.round(cc.height * fk); f.getContext('2d').drawImage(cc, 0, 0, f.width, f.height);
  const t = document.createElement('canvas'); const ts = 160 / Math.max(cc.width, cc.height); t.width = Math.round(cc.width * ts); t.height = Math.round(cc.height * ts); t.getContext('2d').drawImage(cc, 0, 0, t.width, t.height);
  return { full: f.toDataURL('image/jpeg', 0.82), thumb: t.toDataURL('image/jpeg', 0.7) };
}
// Automatisk skanning: kollar skärpa/ljus på varje bild, läser bara bra bilder, en OCR-omgång i taget
function startLoop() {
  const id = SC.loopId = (SC.loopId || 0) + 1; clearTimeout(SC.loopT);
  SC.loopStart = Date.now(); SC.skips = 0; SC.buf = []; SC.ambig = 0; SC.tip = false; const tp = $('#scantip'); if (tp) tp.innerHTML = '';
  if (S.autoScan === false || !SC.stream) { setRing('idle', 'Auto-skanning är av – tryck 📸 Fota nu'); return; }
  setRing(SC.worker ? 'scan' : 'load');
  const tick = async () => {
    if (id !== SC.loopId || !SC.stream || S.autoScan === false || S.tab !== 'scan') return;
    const ae = document.activeElement;
    if (SC.busy || SC.holdLoop || (ae && ae.id === 'scanq')) { SC.loopT = setTimeout(tick, 400); return; }
    const v = $('#scanvid');
    if (!v || !v.videoWidth) { SC.loopT = setTimeout(tick, 500); return; }
    let found = false;
    try {
      const cc = await grabFrame(false); const q = frameQuality(cc); SC.lastQ = q; const [h, k, ok] = qualityHint(q);
      if (!ok && ++SC.skips < 4) { setHint(h, k); checkTip(); SC.loopT = setTimeout(tick, 350); return; } // suddigt → vänta på skarpare bild
      SC.skips = 0; setHint(h, ok ? k : 'warn');
      found = await scanImage(cc, null, 'auto', cc);
      if (id !== SC.loopId) return;
      if (!found) {
        const P = parseScan(SC.lastText || '');
        if (!ok) setHint(h, k);
        else if (!P.op.length && !P.nums.length && !P.jpsets.length && !P.fz.length) setHint('🔎 Närmare: fyll rutan med kortet (nummer längst ner)', 'warn');
        else setHint('Nästan! Läste koden – håll stilla en sekund till', 'ok');
      }
    } catch (e) { console.warn(e); }
    if (id !== SC.loopId) return;
    if (found && SC.res && !SC.res.unique && !SC.saved && (SC.ambig = (SC.ambig || 0) + 1) <= 3) { setHint('Flera kort passar – håller kvar för att avgöra…', 'ok'); SC.loopT = setTimeout(tick, 400); return; } // några bilder till kan avgöra
    if (found) { SC.ambig = 0; setHint(SC.res && !SC.res.unique ? 'Flera kort passar – välj rätt kort nedan' : '✓ Kortet hittat', 'ok'); setRing('found', SC.saved ? 'Sparat i pärmen!' : SC.res && !SC.res.unique ? 'Välj rätt kort nedan' : 'Kort hittat!'); rerenderScan(); try { navigator.vibrate && navigator.vibrate(60); } catch (e) { } return; }
    checkTip(); if (SC.ring !== 'scan') setRing('scan'); SC.loopT = setTimeout(tick, 800);
  };
  SC.loopT = setTimeout(tick, 700);
}
function checkTip() {
  if (SC.tip || !SC.stream || SC.ring === 'found' || Date.now() - SC.loopStart < 10000) return;
  SC.tip = true; const el = $('#scantip'); if (el) el.innerHTML = tipHtml();
}
async function takeStill() {
  if (!SC.stream) return false;
  SC.holdLoop = true;
  try {
    const t0 = Date.now(); while (SC.busy && Date.now() - t0 < 20000) await zz(150);
    setRing('read', 'Fotar…'); setHint('📸 Fotar och läser kortet…', 'ok');
    const cc = await grabFrame(true); if (!cc) { toast('Kameran är inte redo'); return false; }
    const found = await scanImage(cc, canvasPhoto(cc), 'still');
    if (found) { SC.loopId++; clearTimeout(SC.loopT); setHint('✓ Kortet hittat', 'ok'); }
    else if (!(SC.res && SC.res.list.length)) setHint('Hittade inget – fyll rutan med kortet eller skriv numret', 'warn');
    return found;
  } finally { SC.holdLoop = false; }
}
function scanStatus(t) { SC.status = t; const el = $('#scanstat'); if (el) el.textContent = t; if (/Laddar/.test(t) && SC.ring !== 'found') setRing('load', t); }

/* ---------- OCR ---------- */
async function loadTess() {
  if (window.Tesseract) return;
  await new Promise((res, rej) => { const s = document.createElement('script'); s.src = TESS; s.onload = res; s.onerror = () => rej(new Error('ocr')); document.head.appendChild(s); });
}
async function getWorker() {
  if (SC.worker) return SC.worker;
  await loadTess();
  SC.worker = await Tesseract.createWorker('eng', 1, { logger: m => { if (m.status === 'recognizing text') scanStatus('Läser kortet… ' + Math.round(m.progress * 100) + ' %'); else if (/load/.test(m.status)) scanStatus('Laddar läsaren (första gången)…'); } });
  return SC.worker;
}
function prep(src, sx, sy, sw, sh, scale, bin) {
  const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(sw * scale)); c.height = Math.max(1, Math.round(sh * scale));
  const g = c.getContext('2d', { willReadFrequently: true }); g.imageSmoothingQuality = 'high'; g.drawImage(src, sx, sy, sw, sh, 0, 0, c.width, c.height);
  const d = g.getImageData(0, 0, c.width, c.height); const p = d.data; const hist = new Array(256).fill(0); let n = 0;
  for (let i = 0; i < p.length; i += 4) { const y = Math.round(0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2]); p[i] = y; hist[y]++; n++; }
  if (bin === 'sh') { // kontrast + skärpning (unsharp) för små, mjuka siffror
    const w = c.width, h = c.height, Y = new Float32Array(w * h); for (let j = 0; j < w * h; j++) Y[j] = p[j * 4];
    let lo = 255, hi = 0; for (let j = 0; j < w * h; j += 7) { if (Y[j] < lo) lo = Y[j]; if (Y[j] > hi) hi = Y[j]; } const sp = Math.max(30, hi - lo);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const j = y * w + x; const n = (x > 0 ? Y[j - 1] : Y[j]) + (x < w - 1 ? Y[j + 1] : Y[j]) + (y > 0 ? Y[j - w] : Y[j]) + (y < h - 1 ? Y[j + w] : Y[j]);
      let v = Y[j] + 0.9 * (Y[j] - n / 4) * 4; v = (v - lo) * 255 / sp; v = v < 0 ? 0 : v > 255 ? 255 : v; p[j * 4] = p[j * 4 + 1] = p[j * 4 + 2] = v; }
    g.putImageData(d, 0, 0); return c;
  }
  if (bin === 'ad') { // adaptiv tröskel (lokalt medelvärde) – klarar ojämnt ljus, blänk och färgad bakgrund
    const w = c.width, h = c.height, I = new Float64Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) { let row = 0; for (let x = 0; x < w; x++) { row += p[(y * w + x) * 4]; I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row; } }
    const r = Math.max(8, Math.round(Math.min(w, h) / 14)); const out = new Uint8ClampedArray(w * h); let dark = 0;
    for (let y = 0; y < h; y++) { const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1); for (let x = 0; x < w; x++) { const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
      const m = (I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0]) / ((y1 - y0) * (x1 - x0));
      const v = p[(y * w + x) * 4] < m - 10 ? 0 : 255; out[y * w + x] = v; if (!v) dark++; } }
    for (let j = 0; j < w * h; j++) { const v = out[j]; p[j * 4] = p[j * 4 + 1] = p[j * 4 + 2] = v; }
    g.putImageData(d, 0, 0); return c;
  }
  let thr = 128;
  if (bin) { // Otsu-tröskel → svart text på vit botten
    let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sB = 0, wB = 0, best = 0; for (let i = 0; i < 256; i++) { wB += hist[i]; if (!wB) continue; const wF = n - wB; if (!wF) break; sB += i * hist[i]; const mB = sB / wB, mF = (sum - sB) / wF; const v = wB * wF * (mB - mF) * (mB - mF); if (v > best) { best = v; thr = i; } }
  }
  let dark = 0; if (bin) for (let i = 0; i < p.length; i += 4) if (p[i] < thr) dark++;
  const inv = bin && dark > n / 2; // ljus text på mörk botten → invertera
  for (let i = 0; i < p.length; i += 4) { let y = p[i]; if (bin) { y = y < thr ? 0 : 255; if (inv) y = 255 - y; } else y = Math.max(0, Math.min(255, (y - 128) * 1.5 + 128)); p[i] = p[i + 1] = p[i + 2] = y; }
  g.putImageData(d, 0, 0); return c;
}
async function getJpWorker() {
  if (SC.jworker) return SC.jworker;
  await loadTess(); scanStatus('Laddar japansk textläsning (första gången)…');
  SC.jworker = await Tesseract.createWorker('jpn'); return SC.jworker;
}
// Kortet (beskuret till rutan): nummerremsan längst ner förstoras 2–3x med vitlista + helkortspass för namnet
async function ocrCard(src, full, nameToo, variant) {
  const w = await getWorker(); const W = src.width, H = src.height; const strip = [], rest = [];
  const rec = async (c, psm, wl) => { await w.setParameters({ tessedit_pageseg_mode: psm, tessedit_char_whitelist: wl || '' }); const r = await w.recognize(c); return r.data.text; };
  const sc = Math.max(1, Math.min(3, 2400 / W));
  const S0 = prep(src, 0, H * 0.76, W, H * 0.24, sc, false); // gråskala + kontrast, 2–3x förstorad
  const vr = full ? 0 : (variant || 0) % 3; // automatiskt: olika förbehandling varannan bild – bilderna röstar tillsammans
  if (vr === 0) { strip.push(await rec(S0, '6', STRIP_WL)); strip.push(await rec(S0, '6')); }
  else if (vr === 1) { const B = prep(src, 0, H * 0.76, W, H * 0.24, sc, true); strip.push(await rec(B, '6')); strip.push(await rec(B, '6', STRIP_WL)); }
  else { strip.push(await rec(S0, '11', STRIP_WL)); strip.push(await rec(prep(src, 0, H * 0.76, W, H * 0.24, sc, 'ad'), '6', STRIP_WL)); }
  if (full) {
    strip.push(await rec(prep(src, 0, H * 0.76, W, H * 0.24, sc, true), '6')); // Otsu-tröskel
    strip.push(await rec(S0, '11', STRIP_WL));
    strip.push(await rec(prep(src, 0, H * 0.76, W, H * 0.24, sc, 'ad'), '6', STRIP_WL)); // adaptiv tröskel
    const s4 = Math.max(1, Math.min(4, 2000 / (W * 0.6)));
    strip.push(await rec(prep(src, 0, H * 0.84, W * 0.6, H * 0.16, s4, true), '6', STRIP_WL));
    strip.push(await rec(prep(src, W * 0.4, H * 0.84, W * 0.6, H * 0.16, s4, true), '6', STRIP_WL));
    strip.push(await rec(prep(src, 0, H * 0.6, W, H * 0.26, sc, true), '11', STRIP_WL)); // om kortet ligger högre än rutan
    rest.push(await rec(prep(src, 0, 0, W, H * 0.25, Math.min(3, 2400 / W)), '6')); // graderingsetikett
  }
  if (full || nameToo) rest.push(await rec(prep(src, 0, 0, W, H, Math.min(2, 1400 / Math.max(W, H))), '6')); // namn
  let jtext = '';
  if ((full || nameToo) && S.scanLang !== 'en') {
    try { const jw = await getJpWorker(); const r = await jw.recognize(prep(src, 0, 0, W, H * 0.2, Math.min(3, 2400 / W))); jtext = r.data.text; } catch (e) { }
  }
  const st = strip.join('\n'); return { strip: st, text: st + '\n' + rest.join('\n'), jtext };
}
async function ocrCanvas(src, lite) {
  const w = await getWorker(); const W = src.width, H = src.height; const out = [];
  const rec = async (c, psm) => { await w.setParameters({ tessedit_pageseg_mode: psm || '6', tessedit_char_whitelist: '' }); const r = await w.recognize(c); out.push(r.data.text); };
  await rec(prep(src, 0, 0, W, H, Math.min(2, 1600 / Math.max(W, H))));
  // kortnummer & setkod står smått längst ner – förstora remsorna
  await rec(prep(src, 0, H * 0.78, W, H * 0.22, Math.min(3, 2400 / W)));
  if (!lite) {
    await rec(prep(src, 0, H * 0.86, W * 0.6, H * 0.14, Math.min(4, 2000 / (W * 0.6))), '6');
    await rec(prep(src, W * 0.4, H * 0.86, W * 0.6, H * 0.14, Math.min(4, 2000 / (W * 0.6))), '6');
    // graderingsetikett överst
    await rec(prep(src, 0, 0, W, H * 0.25, Math.min(3, 2400 / W)));
  }
  let jtext = '';
  if (S.scanLang !== 'en') { // japanskt kortnamn (överst på kortet)
    try { const jw = await getJpWorker(); scanStatus('Läser japanskt namn…'); const r = await jw.recognize(prep(src, 0, 0, W, H * 0.16, Math.min(2, 1600 / W))); jtext = r.data.text; } catch (e) { }
  }
  return { text: out.join('\n'), jtext };
}
function readSummary(o) {
  const P = parseScan(o.text);
  const okN = x => !x.t || !SC.offs || SC.offs.has(String(x.t)); const fz = P.fz.slice().sort((a, b) => b.w - a.w).slice(0, 2).map(x => x.s + '/' + x.t); const codes = [...P.op, ...P.jpsets, ...fz, ...(fz.length ? [] : P.nums.filter(okN).map(x => x.n + (x.t ? '/' + x.t : '')))];
  if (codes.length) return [...new Set(codes)].slice(0, 5).join(' · ');
  const s = String(o.strip || '').replace(/\s+/g, ' ').trim(); return s ? s.slice(0, 42) : '…';
}
function cardShaped(c) { const a = c.width / c.height; return a > 0.62 && a < 0.8; }
function centerCard(src) { // kortformad mittbit av ett vanligt foto
  const W = src.width, H = src.height; const fh = Math.min(H * 0.8, W * 0.8 * 88 / 63), fw = fh * 63 / 88;
  const c = document.createElement('canvas'); const k = Math.min(1, 1400 / fw); c.width = Math.round(fw * k); c.height = Math.round(fh * k);
  c.getContext('2d').drawImage(src, (W - fw) / 2, (H - fh) / 2, fw, fh, 0, 0, c.width, c.height); return c;
}
// mode: 'auto' (kamerans loop), 'still' (Fota nu), 'file' (vald bild)
async function scanImage(src, photo, mode, photoSrc) {
  const auto = mode === 'auto';
  if (SC.busy) return false; SC.busy = true; if (!auto) SC.photo = photo || null;
  try {
    if (!auto) { scanStatus('Startar läsaren…'); setRing('read', mode === 'still' ? 'Läser fotot…' : undefined); }
    let o;
    if (mode === 'file' && !cardShaped(src)) { const a = await ocrCanvas(src); const b = await ocrCard(centerCard(src), true, false); o = { text: a.text + '\n' + b.text, strip: b.strip, jtext: a.jtext }; }
    else { const fn = SC.frameN++; o = await ocrCard(src, !auto, auto ? fn % 2 === 0 : true, fn); }
    SC.lastText = o.text; setRead(readSummary(o));
    let mt = o.text, mj = o.jtext;
    if (auto) { SC.buf = (SC.buf || []).concat([{ t: o.text, j: o.jtext }]).slice(-3); mt = SC.buf.map(b => b.t).join('\n'); mj = SC.buf.map(b => b.j || '').join('\n'); } // flera bilder i rad röstar tillsammans
    if (!auto) { SC.text = o.text + (o.jtext ? '\n' + o.jtext : ''); SC.jtext = o.jtext; scanStatus('Söker efter kortet…'); }
    const found = await runMatch(mt, false, mj, auto ? { auto: 1, photoSrc, full: mt + (mj ? '\n' + mj : '') } : null);
    if (!auto) { setRing(found || (SC.res && SC.res.list.length) ? 'found' : 'none', SC.saved ? 'Sparat i pärmen!' : found ? 'Kort hittat!' : SC.res && SC.res.list.length ? 'Möjliga kort nedan' : RINGTXT.none); rerenderScan(); }
    return found;
  } catch (e) { console.warn(e); scanStatus('Kunde inte läsa bilden. Prova igen eller skriv koden nedan.'); if (!auto) setRing('none'); return false; }
  finally { SC.busy = false; }
}
async function snapCamera() { return takeStill(); }
async function scanFile(file) {
  stopCamera();
  const ph = await compressPhoto(file, 2000, 0.88);
  SC.preview = ph.full; SC.ring = 'read'; SC.ringTxt = 'Skannar bilden…'; rerenderScan();
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = ph.full; });
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; c.getContext('2d').drawImage(img, 0, 0);
  const small = await compressPhoto(file); await scanImage(c, small, 'file');
}
function scanTyped() {
  const q = ($('#scanq') || {}).value || ''; SC.typed = q; if (!q.trim()) return;
  SC.photo = null; SC.text = q; runMatch(q, true);
}

/* ---------- tolkning ---------- */
const OP_RE = /(?:^|[^A-Za-z])(OP|EB|ST|PRB)\s?[-–_]?\s?(\d{1,2})\s?[-–_ ]\s?(\d{3})(?!\d)/gi;
const NUM_RE = /(?:^|[^\d])(\d{1,3})\s?\/\s?(\d{2,3})(?!\d)/g;
const JPSET_RE = /\b((?:SV|S|SM|M)\s?\d{1,2}[a-zA-Z]?|SV-?P|M-?P|S-?P)\b/gi;
function parseScan(text) {
  const T = String(text || '').replace(/[|]/g, ' ').replace(/\b0P(?=\s?\d)/g, 'OP').replace(/\b(OP|EB|ST)[Oo](?=\d\s?-)/gi, '$10').replace(/\b[5$]V(?=\d{1,2}[a-zA-Z]?\b)/g, 'SV');
  const r = { op: [], opn: [], nums: [], jpsets: [], grade: null, cert: null, words: [] };
  let m;
  OP_RE.lastIndex = 0; while ((m = OP_RE.exec(T))) { const pre = m[1].toUpperCase(); const code = `${pre}${m[2].padStart(2, '0')}-${m[3]}`; if (!r.op.includes(code)) r.op.push(code); }
  // osäker läsning, t.ex. "OPO2-119" → minst kortnumret 119
  for (const mm of T.matchAll(/(?:OP|EB|ST|PRB)\s?[O0-9]{0,2}[A-Za-z]?\s?[-–]\s?(\d{3})/gi)) if (!r.opn.includes(mm[1])) r.opn.push(mm[1]);
  // vanliga OCR-förväxlingar i setkoden: OPOS-119 → OP05-119
  const FX = { O: '0', o: '0', Q: '0', D: '0', S: '5', s: '5', B: '8', b: '6', I: '1', l: '1', i: '1', Z: '2', z: '2', G: '6', g: '9' };
  for (const mm of T.matchAll(/(?:^|[^A-Za-z])(OP|0P|EB|ST)\s?([0-9OoQDSsBbIliZzGg]{2})\s?[-–]\s?(\d{3})/gi)) {
    const code = mm[1].toUpperCase().replace('0P', 'OP') + mm[2].split('').map(ch => FX[ch] || ch).join('') + '-' + mm[3];
    if (/^\w{2}\d{2}-\d{3}$/.test(code) && !r.op.includes(code)) r.op.push(code);
  }
  NUM_RE.lastIndex = 0; while ((m = NUM_RE.exec(T))) { const n = parseInt(m[1], 10), t = parseInt(m[2], 10); if (n > 0 && t >= 10 && !r.nums.some(x => x.n === n && x.t === t)) r.nums.push({ n, t }); }
  // snedstrecket läses ofta fel ("2017,165" = 201/165) – godta bara om det inte redan finns ett riktigt nummer
  if (!r.nums.length) for (const mm of T.matchAll(/(?:^|[^\d])(\d{1,3})\s?[7Il1\\,.]{1,2}\s?(\d{2,3})(?!\d)/g)) { const n = parseInt(mm[1], 10), t = parseInt(mm[2], 10); if (n > 0 && t >= 10 && !r.nums.some(x => x.n === n && x.t === t)) r.nums.push({ n, t }); }
  // ihopklistrade nummer ("2017165", "2077,165", "12017165") → kortnummer + setets totala antal
  r.fz = [];
  if (SC.offs) for (const mm of T.matchAll(/\d[\d,.\/\\|]{2,10}\d/g)) {
    const R = mm[0].replace(/\D/g, ''); if (R.length < 4 || R.length > 9) continue;
    const sep = /[,.\/\\|]/.test(mm[0]) ? 0 : 3; // ihopklistrat utan tecken emellan → lite osäkrare
    for (let k = 1; k <= R.length - 2; k++) {
      const t = R.slice(k); if (t.length > 3 || !SC.offs.has(t)) continue; const pre = R.slice(0, k);
      const addv = (v, w) => { if (!v) return; if (v.length > 3) { v = v.slice(-3); w -= 5; } const n = parseInt(v, 10); if (!(n >= 10)) return; const sv = String(n); w -= sep + (t.length < 3 ? 8 : 0);
        const o = r.fz.find(x => x.s === sv && x.t === +t); if (o) { o.k++; if (w > o.w) { o.w = w; o.raw = pre; } } else r.fz.push({ s: sv, t: +t, w, raw: pre, k: 1 }); };
      addv(pre, 55); if (/[71]$/.test(pre)) { addv(pre.slice(0, -1), 52); if (/[71]{2}$/.test(pre)) addv(pre.slice(0, -2), 48); }
    }
  }
  // en kortare läsning som är slutet av en längre ("017" i "2017") har troligen tappat en siffra
  for (const f of r.fz) f.w += Math.min(10, (f.k - 1) * 5); // samma läsning i flera pass/bilder
  for (const f of r.fz) if (r.fz.some(g => g !== f && g.t === f.t && g.raw.length > f.raw.length && g.raw.endsWith(f.raw))) f.w -= 10;
  JPSET_RE.lastIndex = 0; while ((m = JPSET_RE.exec(T))) { const c = m[1].replace(/\s/g, '').toUpperCase(); if (!r.jpsets.includes(c)) r.jpsets.push(c); }
  // ensamt nummer, t.ex. "SV2a 201" eller "#12"
  const lone = T.match(/(?:#|\b(?:SV|S|M)\d{1,2}[a-z]?\s+)(\d{1,3})\b/i); if (lone && !r.nums.length) r.nums.push({ n: parseInt(lone[1], 10), t: 0 });
  const g = T.match(/\b(PSA|BGS|CGC|TAG|BECKETT)\b[\s\S]{0,40}?\b(10|9\.5|9|8\.5|8|7\.5|7|6\.5|6|5|4|3|2|1)\b/i) || T.match(/\b(GEM\s?MT|GEM\s?MINT|PRISTINE|MINT|NM-MT|NM)\s*(10|9\.5|9|8\.5|8|7)\b/i);
  if (g) { let co = g[1].toUpperCase().replace('BECKETT', 'BGS'); if (!GCOS.includes(co)) co = /PRISTINE/.test(co) ? 'BGS' : 'PSA'; r.grade = { gco: co, gv: g[2] }; }
  if (r.grade) { const c = T.match(/\b(\d{7,10})\b/); if (c) r.cert = c[1]; }
  r.words = [...new Set((T.match(/[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’\-]{2,}/g) || []).map(w => w.toLowerCase()))].filter(w => !/^(the|and|pokemon|pokémon|basic|stage|trainer|energy|psa|bgs|cgc|gem|mint|cert|illus|weakness|resistance|retreat|ability|damage|your|this|card|from|each|for|with|that|opponent|attack|turn)$/.test(w));
  return r;
}
async function loadSearchIdx() {
  if (SC.idx) return SC.idx;
  const r = await fetch('data/search.json'); SC.idx = await r.json(); SC.offs = new Set(SC.idx.sets.filter(s => s[1] === 'pokemon' && s[2] >= 10).map(s => String(s[2]))); return SC.idx;
}
async function runMatch(text, typed, jtext, auto) {
  const X = await loadSearchIdx(); const P = parseScan(text); if (typed) P.fz = []; SC.jt = jtext || ''; const JT = String(jtext || (typed ? text : '')).replace(/\s+/g, '');
  if (!typed && P.words.length) fuzzyWords(P, X);
  const pref = S.scanLang; const cands = new Map();
  const add = (ci, score, why) => { const c = X.c[ci]; const k = c[0] + ':' + c[1]; const o = cands.get(k); if (!o || o.score < score) cands.set(k, { c, score, why }); };
  const jpsetU = new Set(P.jpsets);
  const qlow = String(text).toLowerCase().trim();
  X.c.forEach((c, i) => {
    const st = X.sets[c[0]]; const cat = st[1], off = st[2], api = (st[3] || '').toUpperCase(), lang = st[4] || 'en';
    const num = String(c[2] || ''); let sc = 0, why = [];
    if (cat === 'onepiece' && (P.op.length || P.opn.length)) { const base = num.replace(/_.*/, '').toUpperCase(); if (P.op.includes(base)) { sc += 100; why.push(base); } else if (P.opn.includes(base.slice(-3))) sc += 18; if (sc && num.includes('_')) sc -= 3; }
    if (cat === 'pokemon' && (P.nums.length || P.fz.length)) {
      const n = parseInt(num, 10);
      for (const x of P.nums) if (n === x.n) {
        if (x.t && off === x.t) { sc += 60; why.push(`${num}/${off}`); }
        else if (!x.t && jpsetU.has(api)) { sc += 55; why.push(`#${num}`); }
        else if (x.t && Math.abs(off - x.t) <= 2) { sc += 20; }
      }
      if (!sc && P.fz.length) { const ns = String(parseInt(num, 10)); let b = 0; for (const f of P.fz) if (f.t === off) { if (f.s === ns) b = Math.max(b, f.w); else if (ns.length >= 2 && f.s.length >= 2 && lev(f.s, ns, 1) <= 1) b = Math.max(b, 25); } if (b) { sc += b; why.push(`~${num}/${off}`); } }
      if (sc && lang === 'ja' && jpsetU.has(api)) { sc += 45; why.push(st[3]); }
    }
    if (P.words.length && c[3]) {
      const nm = c[3].toLowerCase(); const nw = nm.split(/[\s\-–().]+/).filter(w => w.length > 2);
      const hit = nw.filter(w => P.words.includes(w)).length;
      if (hit) { sc += Math.min(30, hit * 15); }
      else if (typed && qlow.length > 2 && nm.includes(qlow)) sc += 30;
      if (typed && c[3] === text.trim()) sc += 30;
    }
    if (lang === 'ja' && JT.length >= 3 && c[3]) { // japanskt namn i bilden (eller i sökrutan)
      const core = c[3].replace(/(ex|EX|GX|V|VMAX|VSTAR|Vmax)$/, '').replace(/\s+/g, '');
      if (core.length >= 3 && /[\u3040-\u30ff\u4e00-\u9fff]/.test(core) && JT.includes(core)) { sc += 30 + Math.min(10, core.length); if (JT.includes(c[3].replace(/\s+/g, ''))) sc += 5; }
      else if (!typed && core.length >= 4 && /[\u3040-\u30ff\u4e00-\u9fff]/.test(core) && jpFuzzy(JT, core)) sc += 25; // en felläst tecken (リワードン ≈ リザードン)
    }
    if (!sc) return;
    if (pref !== 'auto' && cat === 'pokemon') sc += lang === pref ? 8 : -25;
    add(i, sc, why.join(' · '));
  });
  let list = [...cands.values()].sort((a, b) => b.score - a.score);
  const best = list.length ? list[0].score : 0;
  list = list.filter(x => x.score >= Math.max(typed ? 15 : 30, best - 40)).slice(0, 12);
  const strong = list.length && best >= 55;
  if (auto) { // automatisk skanning: byt bara resultat när kortet säkert hittats
    if (!strong) return false;
    SC.photo = auto.photo || (auto.photoSrc ? canvasPhoto(auto.photoSrc) : null); SC.text = auto.full; SC.jtext = jtext || '';
  }
  const unique = !!strong && (list.length === 1 || list[0].score - list[1].score >= 10);
  SC.saved = null;
  SC.res = { P, list, typed, unique };
  if (!list.length && P.words.length && !typed) scanStatus('Hittade inget exakt. Rätta texten eller fyll i som eget kort.');
  else scanStatus(list.length ? `Hittade ${list.length} ${list.length === 1 ? 'kort' : 'möjliga kort'}${P.grade ? ' · ' + P.grade.gco + ' ' + P.grade.gv : ''}` : 'Hittade inget. Prova en skarpare bild eller skriv koden.');
  // ladda seten för träffarna (för priser och bilder)
  await Promise.all([...new Set(list.map(x => X.sets[x.c[0]][0]))].map(id => loadSet(id).catch(() => null)));
  renderScanResults();
  if (!typed && unique) await autoSaveTop();
  return !!strong;
}
// OCR-fel i namnet ("Charizarb" → charizard): ord som ligger 1–2 bokstäver från ett riktigt kortnamn
function lev(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1; let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) { const cur = [i]; let mn = i; for (let j = 1; j <= b.length; j++) { cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); if (cur[j] < mn) mn = cur[j]; } if (mn > max) return max + 1; prev = cur; }
  return prev[b.length];
}
function jpFuzzy(JT, core) {
  const L = core.length; let hit = 0; for (const ch of core) if (JT.includes(ch)) hit++; if (hit < L - 1) return false;
  for (let len = L - 1; len <= L + 1; len++) for (let i = 0; i + len <= JT.length; i++) if (lev(JT.slice(i, i + len), core, 1) <= 1) return true;
  return false;
}
function fuzzyWords(P, X) {
  if (!SC.nameW) { SC.nameW = new Map(); for (const c of X.c) if (c[3]) for (const w of c[3].toLowerCase().split(/[\s\-–().]+/)) if (w.length > 3 && /^[a-zà-ÿ'’]+$/.test(w)) { const k = w[0]; if (!SC.nameW.has(k)) SC.nameW.set(k, new Set()); SC.nameW.get(k).add(w); } }
  const add = [];
  for (const w of P.words) {
    if (w.length < 5) continue; const b = SC.nameW.get(w[0]); if (!b || b.has(w)) continue;
    const max = w.length >= 8 ? 2 : 1; let best = null, bd = max + 1;
    for (const x of b) { const d = lev(w, x, max); if (d < bd) { bd = d; best = x; if (d === 1 && max === 1) break; } }
    if (best && !P.words.includes(best)) add.push(best);
  }
  P.words.push(...new Set(add));
}
function scanOpLang() { return S.scanLang === 'ja' ? 'ja' : S.scanLang === 'en' ? 'en' : S.oplang; }
function resCard(x, i) {
  const X = SC.idx; const R = SC.res; const P = R.P;
  const st = X.sets[x.c[0]]; const set = S.sets[st[0]]; if (!set) return ''; const card = set.cards[x.c[1]]; if (!card) return '';
  const opJ = set.cat === 'onepiece' && scanOpLang() === 'ja'; const jp = set.lang === 'ja' || opJ;
  const dv = defaultVariant(card, set);
  const mp = marketPrice(card, dv, opJ ? { cat: 'onepiece', jp: 1 } : set);
  const src = cardImgSrc(card, set); const cph = !src && cardPhotoThumb(card.id);
  const raw = S.items.get(ikey(card.id, dv, opJ)); const owned = raw ? raw.qty : 0;
  const gl = [...S.items.values()].filter(it => it.graded && it.cardId === card.id && (set.cat !== 'onepiece' || (it.lang || 'en') === (opJ ? 'ja' : 'en')));
  const gtxt = P.grade ? `${P.grade.gco} ${P.grade.gv}` : 'PSA 10';
  const saved = SC.saved && SC.saved.cardId === card.id && SC.saved.setId === set.id;
  const num = '#' + card.n + (set.official && set.cat === 'pokemon' ? '/' + String(set.official).padStart(3, '0') : '');
  const loading = SC.pxLoading && SC.pxLoading.has(card.id);
  const priceTxt = mp ? `<b class="pv">${money(conv(mp.v, mp.c))}</b> <span class="muted">${esc(mp.src)}${mp.date ? ' · ' + fmtDate(mp.date) : ''}</span>`
    : loading ? '<span class="muted">Hämtar livepris…</span>'
    : `<span class="muted">${opJ ? '🇯🇵 Inget API-pris för japanska One Piece' : isSport(set.cat) ? 'Sportkort har inget API-pris' : 'Inget marknadspris hos källan'} → </span><button class="lnk" data-sadd="open" data-sset="${esc(set.id)}" data-scard="${esc(card.id)}">Kolla pris</button>`;
  const gInfo = gl.length ? `<div class="muted">🏅 ${gl.map(g => esc(gLabel(g)) + (g.my ? ' ' + money(conv(g.my.v, g.my.c)) : '')).join(' · ')}</div>` : '';
  const thumb = src ? imgTag(src, set.cat) : cph ? `<img src="${esc(cph)}" alt="">` : sportBadge(card, set, true);
  const imgNote = src ? '' : cph ? '<span class="ibadge own">📷 Egen bild</span>' : '<span class="ibadge no">Ingen bild</span>';
  const photoBtn = !src ? (SC.photo && !cph ? `<button class="btn sm" data-scphoto="${esc(set.id)}|${esc(card.id)}">📷 Spara skannad bild som kortets bild</button>` : `<label class="btn sm">📷 ${cph ? 'Byt bild' : 'Fota / lägg till bild'}<input type="file" accept="image/*" hidden data-scfile="${esc(set.id)}|${esc(card.id)}"></label>`) : '';
  return `<div class="scard ${saved ? 'saved' : ''} ${i === 0 && R.unique ? 'top' : ''}"><div class="th">${thumb}${imgNote}</div>
   <div class="mid"><b>${jp ? JPCHIP + ' ' : ''}${esc(card.name)}</b>
    <div class="muted">${esc(set.name)} · ${esc(num)}${card.r ? ' · ' + esc(card.r) : ''}</div>
    <div class="sp">${priceTxt}</div>${gInfo}
    ${saved ? `<div class="savedbar">✓ I pärmen (${owned} st) · Pärmens värde ${money(totals().v)}${SC.saved.add ? ` <span class="plus">+${money(SC.saved.add)}</span>` : ''}</div>`
      : owned ? `<div class="muted" style="color:var(--grn)">✓ I pärmen (${owned} st)</div>` : ''}
    <div class="sbtn">${saved ? `<button class="btn sm red" data-act="scanundo">↶ Ångra</button><button class="btn sm grn" data-act="scannext">↻ Skanna nästa</button>`
      : `<button class="btn sm grn" data-sadd="raw" data-sset="${esc(set.id)}" data-scard="${esc(card.id)}">+ Spara i pärmen</button>`}<button class="btn sm" data-sadd="graded" data-sset="${esc(set.id)}" data-scard="${esc(card.id)}">🏅 + ${esc(gtxt)}</button><button class="btn sm" data-sadd="open" data-sset="${esc(set.id)}" data-scard="${esc(card.id)}">💰 Pris & info</button></div>
    ${photoBtn ? `<div class="sbtn" style="margin-top:6px">${photoBtn}</div>` : ''}</div></div>`;
}
function renderScanResults() {
  const box = $('#scanres'); if (!box) return;
  const R = SC.res; if (!R) { box.innerHTML = ''; return; }
  const P = R.P; let h = '';
  const found = [P.op.join(', '), P.jpsets.join(', '), [...P.nums.map(x => x.n + (x.t ? '/' + x.t : '')), ...(P.fz || []).slice(0, 2).map(x => '~' + x.s + '/' + x.t)].join(', '), P.grade ? P.grade.gco + ' ' + P.grade.gv : ''].filter(Boolean).join(' · ');
  if (found) h += `<div class="muted" style="margin-bottom:8px">Läste: <b style="color:var(--txt)">${esc(found)}</b></div>`;
  if (R.list.length > 1 && !R.unique) h += `<div class="note" style="margin-bottom:8px">Flera kort passar – tryck <b>+ Spara i pärmen</b> på rätt kort.</div>`;
  h += R.list.map(resCard).join('');
  h += `<div class="card" style="margin-top:8px"><b>Hittar du inte rätt kort?</b><p class="muted" style="margin:4px 0 8px">Skriv koden ovan (t.ex. <b>SV2a 201</b> eller <b>OP05-119</b>) – eller lägg till som eget kort med det appen läste.</p>
   <button class="btn full" data-act="scancustom">✎ Fyll i som eget kort</button></div>`;
  if (SC.text && !R.typed) h += `<details class="ocrtxt"><summary>Visa läst text</summary><pre>${esc(SC.text.slice(0, 1200))}</pre></details>`;
  box.innerHTML = h;
  fetchScanPrices();
}
// Livepris för träffar som saknar pris (Pokémon + engelska One Piece) – bara riktiga API-priser
async function fetchScanPrices() {
  if (!SC.res || !navigator.onLine) return; SC.pxDone = SC.pxDone || new Set(); SC.pxLoading = SC.pxLoading || new Set();
  const X = SC.idx; const todo = [];
  for (const x of SC.res.list.slice(0, 4)) {
    const set = S.sets[X.sets[x.c[0]][0]]; const card = set && set.cards[x.c[1]]; if (!card) continue;
    if (!(set.cat === 'pokemon' || (set.cat === 'onepiece' && scanOpLang() !== 'ja'))) continue;
    if (SC.pxDone.has(card.id) || marketPrice(card, defaultVariant(card, set), set)) continue;
    SC.pxDone.add(card.id); SC.pxLoading.add(card.id); todo.push([card, set]);
  }
  if (!todo.length) return;
  await Promise.all(todo.map(([c, s]) => liveCardPrice(c, s).catch(() => null).finally(() => SC.pxLoading.delete(c.id))));
  await kvSet('pxl', S.pxl); renderScanResults();
}
async function addRaw(card, set) {
  if (set.cat === 'onepiece') setOpLang(scanOpLang());
  const v = defaultVariant(card, set); const jpOp = set.cat === 'onepiece' && S.oplang === 'ja';
  const before = S.items.get(ikey(card.id, v, jpOp)); const prev = before ? before.qty : 0;
  await setQty(card, set, v, prev + 1);
  const nit = S.items.get(ikey(card.id, v, jpOp)); let photoAdded = false;
  if (SC.photo && nit && !nit.photo) { const pid = 'p-' + nit.k.replace(/[^\w-]/g, '_'); await DB.put('photos', SC.photo.full, pid); nit.photo = pid; nit.photoThumb = SC.photo.thumb; await saveItem(nit); photoAdded = true; }
  const val = nit ? itemValue(Object.assign({}, nit, { qty: 1 })) : null;
  SC.saved = { cardId: card.id, setId: set.id, v, prev, k: nit && nit.k, photoAdded, add: val ? val.v : 0 };
  return nit;
}
async function autoSaveTop() {
  const R = SC.res; if (!R || !R.unique || R.typed || S.autoSave === false) return false;
  const x = R.list[0]; const set = S.sets[SC.idx.sets[x.c[0]][0]]; const card = set && set.cards[x.c[1]]; if (!card) return false;
  await addRaw(card, set); updHeader(); toast('✓ Sparat i pärmen: ' + card.name, () => undoSave()); renderScanResults(); return true;
}
async function undoSave() {
  const sv = SC.saved; if (!sv) return; const set = await loadSet(sv.setId); const card = set.byId.get(sv.cardId);
  const it = sv.k && S.items.get(sv.k);
  if (it && sv.photoAdded && sv.prev > 0) { await DB.del('photos', it.photo).catch(() => { }); delete it.photo; delete it.photoThumb; await saveItem(it); }
  if (it) await setQty(card, set, sv.v, sv.prev, it.lang || 'en');
  SC.saved = null; updHeader(); toast('Ångrat – kortet togs bort ur pärmen'); setRing(SC.stream ? 'idle' : 'off', 'Ångrat'); rerenderScan();
}
async function scanAdd(kind, setId, cardId) {
  const set = await loadSet(setId); const card = set.byId.get(cardId); if (!card) return;
  const P = SC.res ? SC.res.P : {};
  if (kind === 'raw') {
    const nit = await addRaw(card, set);
    toast('✓ Sparat i pärmen: ' + card.name + (nit && nit.lang === 'ja' ? ' (JP)' : ''), () => undoSave()); renderScanResults(); updHeader(); return;
  }
  if (set.cat === 'onepiece') setOpLang(scanOpLang());
  if (kind === 'graded') { await openCard(card.id, set.id, { gpre: { gco: P.grade ? P.grade.gco : 'PSA', gv: P.grade ? P.grade.gv : '10' }, photo: SC.photo, cert: P.cert }); if (P.cert) { const f = document.querySelector('#gform [name=cert]'); if (f) f.value = P.cert; } return; }
  await openCard(card.id, set.id, {});
}
function scanNext() {
  SC.saved = null;
  if (SC.stream) { SC.res = null; rerenderScan(); startLoop(); return; }
  SC.res = null; SC.preview = null; SC.ring = null; rerenderScan(); const f = $('#scanfile'); if (f) f.click();
}
function scanCustom() {
  const P = SC.res ? SC.res.P : {}; const lang = S.scanLang === 'ja' ? 'ja' : 'en';
  const n = (P.op && P.op[0]) || (P.nums && P.nums[0] ? P.nums[0].n + (P.nums[0].t ? '/' + P.nums[0].t : '') : '');
  const cat = P.op && P.op.length ? 'onepiece' : (P.nums && P.nums.length) || (P.jpsets && P.jpsets.length) ? 'pokemon' : S.cat;
  const name = SC.res && SC.res.typed ? SC.typed : '';
  openCustom(null, { fromScan: 1, cat, n, name, setName: (P.jpsets || [])[0] || '', gco: P.grade ? P.grade.gco : 'Ogradat', gv: P.grade ? P.grade.gv : '10', lang, photo: SC.photo });
  if (P.cert) { const f = document.querySelector('#cform [name=cert]'); if (f) f.value = P.cert; }
}
document.addEventListener('click', async e => {
  const t = e.target.closest('[data-sadd],[data-scanlang],[data-scphoto],[data-act="camon"],[data-act="camoff"],[data-act="snap"],[data-act="still"],[data-act="zoom"],[data-act="typenum"],[data-act="scancustom"],[data-act="scanundo"],[data-act="scannext"]'); if (!t) return;
  e.stopImmediatePropagation();
  try {
    const d = t.dataset;
    if (d.scanlang) { S.scanLang = d.scanlang; LS.set('scanLang', d.scanlang); document.querySelectorAll('[data-scanlang]').forEach(b => b.classList.toggle('on', b.dataset.scanlang === d.scanlang)); if (SC.res) await runMatch(SC.text, SC.res.typed, SC.jt); return; }
    if (d.sadd) { await scanAdd(d.sadd, d.sset, d.scard); return; }
    if (d.act === 'camon') { await startCamera(); return; }
    if (d.act === 'camoff') { stopCamera(); $('#app').innerHTML = vScan(); renderScanResults(); return; }
    if (d.act === 'snap' || d.act === 'still') { if (!SC.stream) { await startCamera(); return; } document.querySelectorAll('[data-act="still"]').forEach(b => b.disabled = true); await takeStill(); document.querySelectorAll('[data-act="still"]').forEach(b => b.disabled = false); return; }
    if (d.act === 'zoom') { await toggleZoom(); return; }
    if (d.act === 'typenum') { const q = $('#scanq'); if (q) { q.scrollIntoView({ block: 'center' }); q.focus(); } return; }
    if (d.act === 'scancustom') { scanCustom(); return; }
    if (d.act === 'scanundo') { await undoSave(); return; }
    if (d.act === 'scannext') { scanNext(); return; }
    if (d.scphoto && SC.photo) { const [sid, cid] = d.scphoto.split('|'); await saveCardPhoto(cid, sid, SC.photo); toast('Bild sparad på kortet ✓'); renderScanResults(); return; }
  } catch (err) { console.warn(err); toast('Något gick fel – försök igen'); }
}, true);
document.addEventListener('change', async e => {
  if (e.target.id === 'autoscan') { e.stopImmediatePropagation(); S.autoScan = e.target.checked; LS.set('autoScan', S.autoScan); rerenderScan(); if (SC.stream) { if (S.autoScan) startLoop(); else { SC.loopId++; clearTimeout(SC.loopT); setRing('idle', 'Tryck Skanna nu'); } } return; }
  if (e.target.id === 'autosave') { e.stopImmediatePropagation(); S.autoSave = e.target.checked; LS.set('autoSave', S.autoSave); rerenderScan(); return; }
  if (e.target.dataset && e.target.dataset.scfile && e.target.files[0]) { e.stopImmediatePropagation(); const [sid, cid] = e.target.dataset.scfile.split('|'); const ph = await compressPhoto(e.target.files[0]); await saveCardPhoto(cid, sid, ph); toast('Bild sparad på kortet ✓'); renderScanResults(); return; }
  if ((e.target.id === 'scanfile' || e.target.id === 'scanfile2') && e.target.files[0]) { e.stopImmediatePropagation(); const f = e.target.files[0]; e.target.value = ''; try { await scanFile(f); } catch (err) { scanStatus('Kunde inte läsa bilden.'); } }
}, true);
// Skriv kortnummer: sök direkt medan man skriver
document.addEventListener('input', e => {
  if (e.target.id !== 'scanq') return; clearTimeout(SC.typeT);
  const v = e.target.value.trim(); if (v.length < 3) return;
  SC.typeT = setTimeout(() => { if (($('#scanq') || {}).value === e.target.value) scanTyped(); }, 350);
});
