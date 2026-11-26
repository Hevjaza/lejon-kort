/* Lejon Kort – Kortskanning (kamera + OCR på telefonen, inget laddas upp) */
'use strict';
const SC = { stream: null, busy: false, status: '', res: null, photo: null, text: '', typed: '', idx: null, worker: null, pct: 0 };
const TESS = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';

function vScan() {
  const lb = (v, l) => `<button data-scanlang="${v}" class="${S.scanLang === v ? 'on' : ''}">${l}</button>`;
  return `<h2>Skanna kort</h2><p class="lead">Fota kortet rakt framifrån. Appen läser <b>kortnummer</b> (t.ex. 199/165 eller OP05-119), <b>setkod</b> (t.ex. SV2a) och <b>graderingsetikett</b> (PSA/BGS/CGC) och hittar kortet.</p>
  <div class="seg lseg">${lb('auto', 'Auto')}${lb('en', 'Engelska (EN)')}${lb('ja', '🇯🇵 Japanska (JP)')}</div>
  <div class="card scanbox" id="scanview">
   <div class="cam ${SC.stream ? 'on' : ''}"><video id="scanvid" playsinline muted autoplay></video><div class="frame"><i></i></div>
    ${SC.stream ? '' : `<div class="camoff"><b>📷</b><span>Kameran är av</span></div>`}</div>
   <div class="btns" style="margin-top:10px">${SC.stream ? `<button class="btn pri" data-act="snap" style="flex:2">📸 Ta bild & sök</button><button class="btn" data-act="camoff">Stäng</button>` : `<button class="btn pri" data-act="camon" style="flex:2">📷 Starta kameran</button>`}
    <label class="btn">🖼️ Välj bild<input type="file" accept="image/*" id="scanfile" hidden></label></div>
   <div id="scanstat" class="muted" style="margin-top:8px">${esc(SC.status)}</div>
  </div>
  <form id="scanform" class="qs" style="margin-bottom:6px"><input id="scanq" class="inp" type="search" autocomplete="off" placeholder="Eller skriv: OP05-119, SV2a 201, 199/165, Charizard" value="${esc(SC.typed)}"><button class="btn pri" type="submit">Sök</button></form>
  <div class="muted" style="margin-bottom:12px">Tips i butik i Japan: skriv koden som står längst ner på kortet – snabbast och säkrast.</div>
  <div id="scanres"></div>`;
}
function stopCamera() {
  if (SC.stream) { SC.stream.getTracks().forEach(t => t.stop()); SC.stream = null; }
}
async function startCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { toast('Kameran stöds inte här – välj en bild'); return; }
  try {
    SC.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
    $('#app').innerHTML = vScan(); renderScanResults();
    const v = $('#scanvid'); v.srcObject = SC.stream; await v.play().catch(() => { });
  } catch (e) { SC.stream = null; toast('Fick inte använda kameran – välj en bild i stället'); }
}
function scanStatus(t) { SC.status = t; const el = $('#scanstat'); if (el) el.textContent = t; }

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
async function ocrCanvas(src) {
  const w = await getWorker(); const W = src.width, H = src.height; const out = [];
  const rec = async (c, psm) => { await w.setParameters({ tessedit_pageseg_mode: psm || '6' }); const r = await w.recognize(c); out.push(r.data.text); };
  await rec(prep(src, 0, 0, W, H, Math.min(2, 1600 / Math.max(W, H))));
  // kortnummer & setkod står smått längst ner – förstora remsorna
  await rec(prep(src, 0, H * 0.78, W, H * 0.22, Math.min(3, 2400 / W)));
  await rec(prep(src, 0, H * 0.86, W * 0.6, H * 0.14, Math.min(4, 2000 / (W * 0.6))), '6');
  await rec(prep(src, W * 0.4, H * 0.86, W * 0.6, H * 0.14, Math.min(4, 2000 / (W * 0.6))), '6');
  // graderingsetikett överst
  await rec(prep(src, 0, 0, W, H * 0.25, Math.min(3, 2400 / W)));
  let jtext = '';
  if (S.scanLang !== 'en') { // japanskt kortnamn (överst på kortet)
    try { const jw = await getJpWorker(); scanStatus('Läser japanskt namn…'); const r = await jw.recognize(prep(src, 0, 0, W, H * 0.16, Math.min(2, 1600 / W))); jtext = r.data.text; } catch (e) { }
  }
  return { text: out.join('\n'), jtext };
}
async function scanImage(src, photo) {
  if (SC.busy) return; SC.busy = true; SC.photo = photo || null;
  try {
    scanStatus('Startar läsaren…');
    const o = await ocrCanvas(src);
    SC.text = o.text + (o.jtext ? '\n' + o.jtext : ''); SC.jtext = o.jtext; scanStatus('Söker efter kortet…');
    await runMatch(o.text, false, o.jtext);
  } catch (e) { console.warn(e); scanStatus('Kunde inte läsa bilden. Prova igen eller skriv koden nedan.'); }
  finally { SC.busy = false; }
}
async function snapCamera() {
  const v = $('#scanvid'); if (!v || !v.videoWidth) { toast('Kameran är inte redo'); return; }
  const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight; c.getContext('2d').drawImage(v, 0, 0);
  // beskär till ramen (kortformat i mitten)
  const fh = c.height * 0.9, fw = Math.min(c.width * 0.9, fh * 63 / 88);
  const cc = document.createElement('canvas'); cc.width = Math.round(fw); cc.height = Math.round(fh);
  cc.getContext('2d').drawImage(c, (c.width - fw) / 2, (c.height - fh) / 2, fw, fh, 0, 0, fw, fh);
  const full = cc.toDataURL('image/jpeg', 0.8);
  const t = document.createElement('canvas'); const ts = 160 / Math.max(cc.width, cc.height); t.width = cc.width * ts; t.height = cc.height * ts; t.getContext('2d').drawImage(cc, 0, 0, t.width, t.height);
  await scanImage(cc, { full, thumb: t.toDataURL('image/jpeg', 0.7) });
}
async function scanFile(file) {
  const ph = await compressPhoto(file, 1600, 0.85);
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = ph.full; });
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; c.getContext('2d').drawImage(img, 0, 0);
  const small = await compressPhoto(file); await scanImage(c, small);
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
  const T = String(text || '').replace(/[|]/g, ' ').replace(/\b0P(?=\s?\d)/g, 'OP').replace(/\b(OP|EB|ST)[Oo](?=\d\s?-)/gi, '$10');
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
  const r = await fetch('data/search.json'); SC.idx = await r.json(); return SC.idx;
}
async function runMatch(text, typed, jtext) {
  const P = parseScan(text); SC.jt = jtext || ''; const JT = String(jtext || (typed ? text : '')).replace(/\s+/g, ''); const X = await loadSearchIdx();
  const pref = S.scanLang; const cands = new Map();
  const add = (ci, score, why) => { const c = X.c[ci]; const k = c[0] + ':' + c[1]; const o = cands.get(k); if (!o || o.score < score) cands.set(k, { c, score, why }); };
  const jpsetU = new Set(P.jpsets);
  const qlow = String(text).toLowerCase().trim();
  X.c.forEach((c, i) => {
    const st = X.sets[c[0]]; const cat = st[1], off = st[2], api = (st[3] || '').toUpperCase(), lang = st[4] || 'en';
    const num = String(c[2] || ''); let sc = 0, why = [];
    if (cat === 'onepiece' && (P.op.length || P.opn.length)) { const base = num.replace(/_.*/, '').toUpperCase(); if (P.op.includes(base)) { sc += 100; why.push(base); } else if (P.opn.includes(base.slice(-3))) sc += 18; if (sc && num.includes('_')) sc -= 3; }
    if (cat === 'pokemon' && P.nums.length) {
      const n = parseInt(num, 10);
      for (const x of P.nums) if (n === x.n) {
        if (x.t && off === x.t) { sc += 60; why.push(`${num}/${off}`); }
        else if (!x.t && jpsetU.has(api)) { sc += 55; why.push(`#${num}`); }
        else if (x.t && Math.abs(off - x.t) <= 2) { sc += 20; }
      }
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
    }
    if (!sc) return;
    if (pref !== 'auto' && cat === 'pokemon') sc += lang === pref ? 8 : -25;
    add(i, sc, why.join(' · '));
  });
  let list = [...cands.values()].sort((a, b) => b.score - a.score);
  const best = list.length ? list[0].score : 0;
  list = list.filter(x => x.score >= Math.max(typed ? 15 : 30, best - 40)).slice(0, 12);
  SC.res = { P, list, typed };
  if (!list.length && P.words.length && !typed) scanStatus('Hittade inget exakt. Rätta texten eller fyll i som eget kort.');
  else scanStatus(list.length ? `Hittade ${list.length} ${list.length === 1 ? 'kort' : 'möjliga kort'}${P.grade ? ' · ' + P.grade.gco + ' ' + P.grade.gv : ''}` : 'Hittade inget. Prova en skarpare bild eller skriv koden.');
  // ladda seten för träffarna (för priser och bilder)
  await Promise.all([...new Set(list.map(x => X.sets[x.c[0]][0]))].map(id => loadSet(id).catch(() => null)));
  renderScanResults();
}
function scanOpLang() { return S.scanLang === 'ja' ? 'ja' : S.scanLang === 'en' ? 'en' : S.oplang; }
function renderScanResults() {
  const box = $('#scanres'); if (!box) return;
  const R = SC.res; if (!R) { box.innerHTML = ''; return; }
  const X = SC.idx; const P = R.P;
  let h = '';
  const found = [P.op.join(', '), P.jpsets.join(', '), P.nums.map(x => x.n + (x.t ? '/' + x.t : '')).join(', '), P.grade ? P.grade.gco + ' ' + P.grade.gv : ''].filter(Boolean).join(' · ');
  if (found) h += `<div class="muted" style="margin-bottom:8px">Läste: <b style="color:var(--txt)">${esc(found)}</b></div>`;
  for (const x of R.list) {
    const st = X.sets[x.c[0]]; const set = S.sets[st[0]]; if (!set) continue; const card = set.cards[x.c[1]]; if (!card) continue;
    const opJ = set.cat === 'onepiece' && scanOpLang() === 'ja'; const jp = set.lang === 'ja' || opJ;
    const mp = marketPrice(card, defaultVariant(card, set), opJ ? { cat: 'onepiece', jp: 1 } : set);
    const src = cardImgSrc(card, set);
    const owned = (S.items.get(ikey(card.id, defaultVariant(card, set), opJ)) || {}).qty || 0;
    const gtxt = P.grade ? `${P.grade.gco} ${P.grade.gv}` : 'PSA 10';
    h += `<div class="scard"><div class="th">${src ? imgTag(src, set.cat) : `<div class="phd ${set.cat}"><b>#${esc(card.n)}</b></div>`}</div>
     <div class="mid"><b>${jp ? JPCHIP + ' ' : ''}${esc(card.name)}</b><div class="muted">${esc(set.name)} · #${esc(card.n)}${set.official && set.cat === 'pokemon' ? '/' + String(set.official).padStart(3, '0') : ''}</div>
      <div class="sp">${mp ? `<b>${money(conv(mp.v, mp.c))}</b> <span class="muted">${esc(mp.src)}</span>` : `<span class="muted">${opJ ? '🇯🇵 Inget API-pris – tryck Pris' : 'Inget marknadspris – tryck Pris'}</span>`}${owned ? ` · <span style="color:var(--grn)">du har ${owned}</span>` : ''}</div>
      <div class="sbtn"><button class="btn sm grn" data-sadd="raw" data-sset="${esc(set.id)}" data-scard="${esc(card.id)}">+ Ogradat</button><button class="btn sm" data-sadd="graded" data-sset="${esc(set.id)}" data-scard="${esc(card.id)}">🏅 + ${esc(gtxt)}</button><button class="btn sm" data-sadd="open" data-sset="${esc(set.id)}" data-scard="${esc(card.id)}">Pris</button></div></div></div>`;
  }
  {
    h += `<div class="card" style="margin-top:8px"><b>Hittar du inte rätt kort?</b><p class="muted" style="margin:4px 0 8px">Skriv koden ovan (t.ex. <b>SV2a 201</b> eller <b>OP05-119</b>) – eller lägg till som eget kort med det appen läste.</p>
     <button class="btn full" data-act="scancustom">✎ Fyll i som eget kort</button></div>`;
  }
  if (SC.text && !R.typed) h += `<details class="ocrtxt"><summary>Visa läst text</summary><pre>${esc(SC.text.slice(0, 1200))}</pre></details>`;
  box.innerHTML = h;
}
async function scanAdd(kind, setId, cardId) {
  const set = await loadSet(setId); const card = set.byId.get(cardId); if (!card) return;
  const P = SC.res ? SC.res.P : {}; const v = defaultVariant(card, set);
  if (set.cat === 'onepiece') setOpLang(scanOpLang());
  if (kind === 'raw') {
    const it = S.items.get(ikey(card.id, v, set.cat === 'onepiece' && S.oplang === 'ja'));
    await setQty(card, set, v, (it ? it.qty : 0) + 1);
    const nit = S.items.get(ikey(card.id, v, set.cat === 'onepiece' && S.oplang === 'ja'));
    if (SC.photo && nit && !nit.photo) { const pid = 'p-' + nit.k.replace(/[^\w-]/g, '_'); await DB.put('photos', SC.photo.full, pid); nit.photo = pid; nit.photoThumb = SC.photo.thumb; await saveItem(nit); }
    toast('✓ ' + card.name + ' (Ogradat' + (nit && nit.lang === 'ja' ? ', JP' : '') + ')'); renderScanResults(); updHeader(); return;
  }
  if (kind === 'graded') { await openCard(card.id, set.id, { gpre: { gco: P.grade ? P.grade.gco : 'PSA', gv: P.grade ? P.grade.gv : '10' }, photo: SC.photo, cert: P.cert }); if (P.cert) { const f = document.querySelector('#gform [name=cert]'); if (f) f.value = P.cert; } return; }
  await openCard(card.id, set.id, {});
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
  const t = e.target.closest('[data-sadd],[data-scanlang],[data-act="camon"],[data-act="camoff"],[data-act="snap"],[data-act="scancustom"]'); if (!t) return;
  e.stopImmediatePropagation();
  try {
    const d = t.dataset;
    if (d.scanlang) { S.scanLang = d.scanlang; LS.set('scanLang', d.scanlang); document.querySelectorAll('[data-scanlang]').forEach(b => b.classList.toggle('on', b.dataset.scanlang === d.scanlang)); if (SC.res) await runMatch(SC.text, SC.res.typed, SC.jt); return; }
    if (d.sadd) { await scanAdd(d.sadd, d.sset, d.scard); return; }
    if (d.act === 'camon') { await startCamera(); return; }
    if (d.act === 'camoff') { stopCamera(); $('#app').innerHTML = vScan(); renderScanResults(); return; }
    if (d.act === 'snap') { t.disabled = true; await snapCamera(); t.disabled = false; return; }
    if (d.act === 'scancustom') { scanCustom(); return; }
  } catch (err) { console.warn(err); toast('Något gick fel – försök igen'); }
}, true);
document.addEventListener('change', async e => {
  if (e.target.id === 'scanfile' && e.target.files[0]) { e.stopImmediatePropagation(); const f = e.target.files[0]; e.target.value = ''; try { await scanFile(f); } catch (err) { scanStatus('Kunde inte läsa bilden.'); } }
}, true);
