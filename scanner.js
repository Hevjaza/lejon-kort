/* Lejon Kort – Kortskanning (kamera + OCR på telefonen, inget laddas upp) */
'use strict';
const SC = { stream: null, busy: false, status: '', res: null, photo: null, text: '', typed: '', idx: null, worker: null, pct: 0 };
const TESS = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';

const RINGTXT = { idle: 'Rikta kameran mot kortet', load: 'Laddar skanner…', scan: 'Skannar automatiskt…', read: 'Läser kortet…', found: 'Kort hittat!', none: 'Hittade inget – försök igen', off: '' };
function ringHtml() {
  const st = SC.ring || 'idle';
  return `<div class="sring ${st}" id="sring"><div class="arc"></div><div class="core">${st === 'found' ? '<b>✓</b>' : st === 'none' ? '<b>?</b>' : '<b>📷</b>'}<span id="sringtxt">${esc(SC.ringTxt || RINGTXT[st] || '')}</span></div></div>`;
}
function setRing(st, txt) {
  SC.ring = st; SC.ringTxt = txt || RINGTXT[st] || '';
  const el = $('#sring'); if (el) el.outerHTML = ringHtml();
}
function vScan() {
  const lb = (v, l) => `<button data-scanlang="${v}" class="${S.scanLang === v ? 'on' : ''}">${l}</button>`;
  const auto = S.autoScan !== false; const showRing = SC.stream || SC.preview || SC.busy;
  return `<h2>Skanna kort</h2><p class="lead">Håll kortet framför kameran – appen <b>skannar automatiskt</b> och läser kortnummer (199/165, OP05-119), setkod (SV2a) och PSA/BGS/CGC-etiketter.</p>
  <div class="seg lseg">${lb('auto', 'Auto')}${lb('en', 'Engelska (EN)')}${lb('ja', '🇯🇵 Japanska (JP)')}</div>
  <div class="card scanbox" id="scanview">
   <div class="cam ${SC.stream ? 'on' : ''}"><video id="scanvid" playsinline muted autoplay></video>${SC.stream ? '<div class="frame"><i></i></div>' : ''}
    ${!SC.stream && SC.preview ? `<img class="camprev" src="${esc(SC.preview)}" alt="">` : ''}
    ${!SC.stream && !SC.preview ? `<div class="camoff"><b>📷</b><span>Starta kameran eller fota/välj en bild</span></div>` : ''}
    ${showRing ? ringHtml() : ''}</div>
   <label class="atog"><input type="checkbox" id="autoscan" ${auto ? 'checked' : ''}><span class="sw"></span><b>Auto-skanning: <em>${auto ? 'PÅ' : 'AV'}</em></b><small>${auto ? 'skannar var 1,5 s tills kortet hittas' : 'tryck Skanna nu'}</small></label>
   <label class="atog"><input type="checkbox" id="autosave" ${S.autoSave !== false ? 'checked' : ''}><span class="sw"></span><b>Auto-spara i pärmen: <em>${S.autoSave !== false ? 'PÅ' : 'AV'}</em></b><small>${S.autoSave !== false ? 'säker träff sparas direkt (+1 ogradat)' : 'du trycker + Spara i pärmen'}</small></label>
   <div class="btns" style="margin-top:10px">${SC.stream ? `${SC.ring === 'found' ? `<button class="btn grn" data-act="scannext" style="flex:2">↻ Skanna nästa</button>` : !auto ? `<button class="btn pri" data-act="snap" style="flex:2">📸 Skanna nu</button>` : ''}<button class="btn" data-act="camoff">Stäng kamera</button>` : `<button class="btn pri" data-act="camon" style="flex:2">📷 Starta kameran</button>`}
    <label class="btn">🖼️ Fota / välj bild<input type="file" accept="image/*" id="scanfile" hidden></label></div>
   <div id="scanstat" class="muted" style="margin-top:8px">${esc(SC.status)}</div>
  </div>
  <form id="scanform" class="qs" style="margin-bottom:6px"><input id="scanq" class="inp" type="search" autocomplete="off" placeholder="Eller skriv: OP05-119, SV2a 201, 199/165, Charizard" value="${esc(SC.typed)}"><button class="btn pri" type="submit">Sök</button></form>
  <div class="muted" style="margin-bottom:12px">Tips i butik i Japan: skriv koden som står längst ner på kortet – snabbast och säkrast.</div>
  <div id="scanres"></div>`;
}
function rerenderScan() { if (S.tab !== 'scan') return; const v = $('#scanvid'); $('#app').innerHTML = vScan(); renderScanResults(); const nv = $('#scanvid'); if (SC.stream && nv) { nv.srcObject = SC.stream; nv.play().catch(() => { }); } }
function stopCamera() {
  SC.loopId = (SC.loopId || 0) + 1; clearTimeout(SC.loopT);
  if (SC.stream) { SC.stream.getTracks().forEach(t => t.stop()); SC.stream = null; }
}
async function startCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { toast('Kameran stöds inte här – fota/välj en bild'); return; }
  try {
    SC.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
    SC.preview = null; SC.ring = 'idle'; rerenderScan();
    startLoop();
  } catch (e) { SC.stream = null; toast('Fick inte använda kameran – fota/välj en bild i stället'); }
}
// Automatisk skanning: en OCR-omgång i taget, paus 1,5 s mellan omgångarna, stannar när kortet hittats
function startLoop() {
  const id = SC.loopId = (SC.loopId || 0) + 1; clearTimeout(SC.loopT);
  if (S.autoScan === false || !SC.stream) { setRing('idle', 'Auto-skanning är av – tryck Skanna nu'); return; }
  setRing(SC.worker ? 'scan' : 'load');
  const tick = async () => {
    if (id !== SC.loopId || !SC.stream || S.autoScan === false || S.tab !== 'scan') return;
    if (SC.busy) { SC.loopT = setTimeout(tick, 400); return; }
    const v = $('#scanvid');
    if (!v || !v.videoWidth) { SC.loopT = setTimeout(tick, 500); return; }
    const found = await snapCamera(true).catch(() => false);
    if (id !== SC.loopId) return;
    if (found) { setRing('found', SC.saved ? 'Sparat i pärmen!' : 'Kort hittat!'); rerenderScan(); try { navigator.vibrate && navigator.vibrate(60); } catch (e) { } return; }
    setRing('scan'); SC.loopT = setTimeout(tick, 1500);
  };
  SC.loopT = setTimeout(tick, 700);
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
async function ocrCanvas(src, lite) {
  const w = await getWorker(); const W = src.width, H = src.height; const out = [];
  const rec = async (c, psm) => { await w.setParameters({ tessedit_pageseg_mode: psm || '6' }); const r = await w.recognize(c); out.push(r.data.text); };
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
async function scanImage(src, photo, auto) {
  if (SC.busy) return false; SC.busy = true; if (!auto) SC.photo = photo || null;
  try {
    if (!auto) { scanStatus('Startar läsaren…'); setRing('read'); }
    const o = await ocrCanvas(src, auto);
    if (!auto) { SC.text = o.text + (o.jtext ? '\n' + o.jtext : ''); SC.jtext = o.jtext; scanStatus('Söker efter kortet…'); }
    const found = await runMatch(o.text, false, o.jtext, auto ? { auto: 1, photo, full: o.text + (o.jtext ? '\n' + o.jtext : '') } : null);
    if (!auto) { setRing(found || (SC.res && SC.res.list.length) ? 'found' : 'none', SC.saved ? 'Sparat i pärmen!' : found ? 'Kort hittat!' : SC.res && SC.res.list.length ? 'Möjliga kort nedan' : RINGTXT.none); rerenderScan(); }
    return found;
  } catch (e) { console.warn(e); scanStatus('Kunde inte läsa bilden. Prova igen eller skriv koden nedan.'); if (!auto) setRing('none'); return false; }
  finally { SC.busy = false; }
}
async function snapCamera(auto) {
  const v = $('#scanvid'); if (!v || !v.videoWidth) { if (!auto) toast('Kameran är inte redo'); return false; }
  const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight; c.getContext('2d').drawImage(v, 0, 0);
  // beskär till kortformat i mitten
  const fw = Math.min(c.width * 0.9, c.height * 0.9 * 63 / 88), fh = fw * 88 / 63;
  const cc = document.createElement('canvas'); cc.width = Math.round(fw); cc.height = Math.round(fh);
  cc.getContext('2d').drawImage(c, (c.width - fw) / 2, (c.height - fh) / 2, fw, fh, 0, 0, fw, fh);
  const full = cc.toDataURL('image/jpeg', 0.8);
  const t = document.createElement('canvas'); const ts = 160 / Math.max(cc.width, cc.height); t.width = cc.width * ts; t.height = cc.height * ts; t.getContext('2d').drawImage(cc, 0, 0, t.width, t.height);
  return scanImage(cc, { full, thumb: t.toDataURL('image/jpeg', 0.7) }, auto);
}
async function scanFile(file) {
  stopCamera();
  const ph = await compressPhoto(file, 1600, 0.85);
  SC.preview = ph.full; SC.ring = 'read'; SC.ringTxt = 'Skannar bilden…'; rerenderScan();
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
  // snedstrecket läses ofta fel ("2017,165" = 201/165) – godta bara om det inte redan finns ett riktigt nummer
  if (!r.nums.length) for (const mm of T.matchAll(/(?:^|[^\d])(\d{1,3})\s?[7Il1\\,.]{1,2}\s?(\d{2,3})(?!\d)/g)) { const n = parseInt(mm[1], 10), t = parseInt(mm[2], 10); if (n > 0 && t >= 10 && !r.nums.some(x => x.n === n && x.t === t)) r.nums.push({ n, t }); }
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
async function runMatch(text, typed, jtext, auto) {
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
  const strong = list.length && best >= 55;
  if (auto) { // automatisk skanning: byt bara resultat när kortet säkert hittats
    if (!strong) return false;
    SC.photo = auto.photo || null; SC.text = auto.full; SC.jtext = jtext || '';
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
  const found = [P.op.join(', '), P.jpsets.join(', '), P.nums.map(x => x.n + (x.t ? '/' + x.t : '')).join(', '), P.grade ? P.grade.gco + ' ' + P.grade.gv : ''].filter(Boolean).join(' · ');
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
  const t = e.target.closest('[data-sadd],[data-scanlang],[data-scphoto],[data-act="camon"],[data-act="camoff"],[data-act="snap"],[data-act="scancustom"],[data-act="scanundo"],[data-act="scannext"]'); if (!t) return;
  e.stopImmediatePropagation();
  try {
    const d = t.dataset;
    if (d.scanlang) { S.scanLang = d.scanlang; LS.set('scanLang', d.scanlang); document.querySelectorAll('[data-scanlang]').forEach(b => b.classList.toggle('on', b.dataset.scanlang === d.scanlang)); if (SC.res) await runMatch(SC.text, SC.res.typed, SC.jt); return; }
    if (d.sadd) { await scanAdd(d.sadd, d.sset, d.scard); return; }
    if (d.act === 'camon') { await startCamera(); return; }
    if (d.act === 'camoff') { stopCamera(); $('#app').innerHTML = vScan(); renderScanResults(); return; }
    if (d.act === 'snap') { t.disabled = true; setRing('read'); const f = await snapCamera(); if (!f && SC.ring === 'read') setRing('none'); t.disabled = false; return; }
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
  if (e.target.id === 'scanfile' && e.target.files[0]) { e.stopImmediatePropagation(); const f = e.target.files[0]; e.target.value = ''; try { await scanFile(f); } catch (err) { scanStatus('Kunde inte läsa bilden.'); } }
}, true);
