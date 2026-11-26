/* Lejon Kort – samlarkort & Masterset. All data sparas lokalt på telefonen (IndexedDB). */
'use strict';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const CATS = [
  { id: 'pokemon', name: 'Pokémon', em: '⚡', short: 'Pokémon' },
  { id: 'onepiece', name: 'One Piece', em: '🏴‍☠️', short: 'One Piece' },
  { id: 'fotboll', name: 'Fotboll', em: '⚽', short: 'Fotboll' },
  { id: 'basket', name: 'Basket', em: '🏀', short: 'Basket' },
  { id: 'hockey', name: 'Hockey', em: '🏒', short: 'Hockey' }
];
const CAT = Object.fromEntries(CATS.map(c => [c.id, c]));
const VLABEL = { normal: 'Normal', reverse: 'Reverse Holo', holo: 'Holo', first: '1:a upplagan', base: 'Bas' };
const GCOS = ['PSA', 'BGS', 'CGC', 'TAG', 'Annat'];
const GVALS = ['10', '9.5', '9', '8.5', '8', '7.5', '7', '6.5', '6', '5', '4', '3', '2', '1', 'Auth'];
const gLabel = it => it && it.graded ? `${it.gco || 'Annat'}${it.gv ? ' ' + it.gv : ''}` : 'Ogradat';
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const TCGDEX = 'https://api.tcgdex.net/v2/en';
const TCGDEX_JA = 'https://api.tcgdex.net/v2/ja';
const tcgdexBase = lang => lang === 'ja' ? TCGDEX_JA : TCGDEX;
const CURS = ['SEK', 'EUR', 'USD', 'JPY'];
const CURFLAG = { SEK: '🇸🇪', EUR: '🇪🇺', USD: '🇺🇸', JPY: '🇯🇵' };
const JPCHIP = '<span class="chip jp">🇯🇵 JP</span>';

/* ---------- IndexedDB ---------- */
const DB = {
  db: null,
  open() {
    return new Promise(res => {
      if (!('indexedDB' in window)) return res(null);
      let req;
      try { req = indexedDB.open('lejon-kort', 1); } catch (e) { return res(null); }
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('items')) d.createObjectStore('items', { keyPath: 'k' });
        if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
        if (!d.objectStoreNames.contains('photos')) d.createObjectStore('photos');
      };
      req.onsuccess = () => { this.db = req.result; res(this.db); };
      req.onerror = () => res(null);
    });
  },
  tx(store, mode, fn) {
    return new Promise((res, rej) => {
      const t = this.db.transaction(store, mode); const s = t.objectStore(store); let out;
      const r = fn(s); if (r && 'onsuccess' in r) r.onsuccess = () => { out = r.result; };
      t.oncomplete = () => res(out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
    });
  },
  all(store) { return this.db ? this.tx(store, 'readonly', s => s.getAll()) : Promise.resolve(LS.get('fb_' + store) || []); },
  keys(store) { return this.db ? this.tx(store, 'readonly', s => s.getAllKeys()) : Promise.resolve([]); },
  get(store, k) { return this.db ? this.tx(store, 'readonly', s => s.get(k)) : Promise.resolve(LS.get('fb_' + store + '_' + k)); },
  put(store, v, k) {
    if (this.db) return this.tx(store, 'readwrite', s => k === undefined ? s.put(v) : s.put(v, k));
    if (store === 'items') { const a = (LS.get('fb_items') || []).filter(x => x.k !== v.k); a.push(v); LS.set('fb_items', a); }
    else LS.set('fb_' + store + '_' + k, v);
    return Promise.resolve();
  },
  del(store, k) {
    if (this.db) return this.tx(store, 'readwrite', s => s.delete(k));
    if (store === 'items') LS.set('fb_items', (LS.get('fb_items') || []).filter(x => x.k !== k)); else localStorage.removeItem('lk_fb_' + store + '_' + k);
    return Promise.resolve();
  },
  clear(store) { if (this.db) return this.tx(store, 'readwrite', s => s.clear()); if (store === 'items') LS.set('fb_items', []); return Promise.resolve(); }
};
const LS = {
  get(k) { try { return JSON.parse(localStorage.getItem('lk_' + k)); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem('lk_' + k, JSON.stringify(v)); } catch (e) { } }
};

/* ---------- state ---------- */
const S = {
  idx: null, setMeta: {}, sets: {}, items: new Map(), owned: new Map(), favs: new Set(), setcfg: {}, customSets: [], pxl: {},
  cur: LS.get('cur') || 'SEK', fx: null,
  tab: 'oversikt', cat: LS.get('cat') || 'pokemon', setId: null, filter: 'Alla', q: '', sub: -1, showN: 120,
  colQ: '', colCat: 'alla', colGrade: 'alla', colLang: 'alla', colSort: 'value', liveSets: null, liveSetsJa: null, showAllPk: false, sheet: null,
  pklang: LS.get('pklang') || 'en', oplang: LS.get('oplang') || 'en', scanLang: LS.get('scanLang') || 'auto'
};
const kvGet = (k, d) => DB.get('kv', k).then(v => v ?? d).catch(() => d);
const kvSet = (k, v) => DB.put('kv', v, k).catch(() => { });

/* ---------- money ---------- */
function rate(c) { const r = S.fx && S.fx.rates; return r && r[c] ? r[c] : ({ USD: 1, SEK: 10.5, EUR: 0.92, JPY: 155 }[c]); }
function conv(v, from, to = S.cur) { if (v == null || isNaN(v)) return null; return v / rate(from) * rate(to); }
function money(v, c = S.cur) {
  if (v == null || isNaN(v)) return '–';
  const d = c === 'JPY' ? 0 : c === 'SEK' ? (Math.abs(v) >= 10 || v === 0 ? 0 : 2) : 2;
  if (c === 'JPY') return '¥' + Math.round(v).toLocaleString('sv-SE');
  try { return new Intl.NumberFormat('sv-SE', { style: 'currency', currency: c, minimumFractionDigits: d, maximumFractionDigits: d }).format(v); }
  catch (e) { return v.toFixed(d) + ' ' + c; }
}
const fmtDate = d => { if (!d) return ''; const x = new Date(d); return isNaN(x) ? String(d) : x.toLocaleDateString('sv-SE'); };

/* ---------- data loading ---------- */
async function loadIndex() {
  const r = await fetch('data/index.json', { cache: 'no-cache' });
  S.idx = await r.json();
  S.setMeta = Object.fromEntries(S.idx.sets.map(m => [m.id, m]));
}
function metaOf(id) {
  if (S.setMeta[id]) return S.setMeta[id];
  const cs = S.customSets.find(x => x.id === id); if (cs) return cs;
  if (id && id.startsWith('pkjl-')) { const l = (S.liveSetsJa || []).find(x => 'pkjl-' + x.id === id); return { id, cat: 'pokemon', lang: 'ja', name: (l ? id.slice(5) + ' ' + l.name : id.slice(5)), live: true, api: 'tcgdex', apiId: id.slice(5) }; }
  if (id && id.startsWith('pkl-')) { const l = (S.liveSets || []).find(x => 'pkl-' + x.id === id); return { id, cat: 'pokemon', name: l ? l.name : id.slice(4), live: true, api: 'tcgdex', apiId: id.slice(4), logo: l && l.logo }; }
  return null;
}
async function loadSet(id) {
  if (S.sets[id]) return S.sets[id];
  let d;
  const cs = S.customSets.find(x => x.id === id);
  if (cs) d = cs;
  else if (id.startsWith('pkjl-')) d = await loadLivePk(id.slice(5), 'ja');
  else if (id.startsWith('pkl-')) d = await loadLivePk(id.slice(4));
  else { const r = await fetch('data/sets/' + id + '.json'); if (!r.ok) throw new Error('Kunde inte ladda set'); d = await r.json(); }
  d.byId = new Map(d.cards.map(c => [c.id, c]));
  S.sets[id] = d; return d;
}
async function loadLivePk(apiId, lang = 'en') {
  const ck = (lang === 'ja' ? 'livej-' : 'live-') + apiId;
  const cached = await kvGet(ck, null);
  if (cached && cached.cards) return cached;
  const r = await fetch(`${tcgdexBase(lang)}/sets/${encodeURIComponent(apiId)}`); if (!r.ok) throw new Error('TCGdex svarade inte');
  const s = await r.json();
  const d = {
    id: (lang === 'ja' ? 'pkjl-' : 'pkl-') + apiId, cat: 'pokemon', lang, api: 'tcgdex', apiId, live: true, name: lang === 'ja' ? apiId + ' ' + s.name : s.name, series: s.serie && s.serie.name, release: s.releaseDate, logo: s.logo, official: s.cardCount && s.cardCount.official,
    total: (s.cards || []).length, source: { name: 'TCGdex (live)', url: 'https://tcgdex.dev' }, priceSource: 'Cardmarket (EUR) + TCGplayer (USD) via TCGdex', fetched: new Date().toISOString().slice(0, 10),
    cards: (s.cards || []).map(c => ({ id: c.id, n: c.localId, name: c.name, img: c.image, v: ['normal'], unk: 1 }))
  };
  kvSet(ck, d); return d;
}
async function loadFx() {
  S.fx = (await kvGet('fx', null)) || (S.idx && S.idx.fx);
  const age = S.fx && S.fx.fetchedAt ? Date.now() - S.fx.fetchedAt : Infinity;
  if (age < 6 * 3600e3 && S.fx.rates && S.fx.rates.JPY) return;
  try {
    const r = await fetch('https://open.er-api.com/v6/latest/USD'); const j = await r.json();
    if (j && j.rates && j.rates.SEK) {
      S.fx = { base: 'USD', rates: { USD: 1, SEK: j.rates.SEK, EUR: j.rates.EUR, JPY: j.rates.JPY }, updated: j.time_last_update_utc, source: 'exchangerate-api.com (open.er-api.com)', fetchedAt: Date.now(), live: true };
      kvSet('fx', S.fx);
    }
  } catch (e) { /* offline – använd sparad kurs */ }
}

/* ---------- prices (endast riktiga källor) ---------- */
function livePrice(card) { const l = S.pxl[card.id]; return l ? l.p : null; }
// Returnerar {v, c, src, date} eller null – aldrig ett påhittat pris
function marketPrice(card, variant, meta) {
  if (!card) return null;
  const p = livePrice(card) || card.p; if (!p) return null;
  if (meta && meta.cat === 'onepiece') {
    if (meta.jp) return null; // engelskt OPTCG-pris gäller inte japanska kort
    if (p.usd_m) return { v: p.usd_m, c: 'USD', src: 'OPTCG API marknadspris', date: p.d };
    if (p.usd_l) return { v: p.usd_l, c: 'USD', src: 'OPTCG API lägsta pris', date: p.d };
    return null;
  }
  const tpK = { normal: ['tp_normal', 'tp_unlimited'], reverse: ['tp_reverse-holofoil'], holo: ['tp_holofoil', 'tp_unlimited-holofoil'], first: ['tp_1st-edition-holofoil', 'tp_1st-edition'] }[variant] || ['tp_normal', 'tp_holofoil'];
  const cmSrc = meta && meta.lang === 'ja' ? 'Cardmarket trend (JP-utgåva)' : 'Cardmarket trend';
  if (variant === 'reverse' && p.cm_th) return { v: p.cm_th, c: 'EUR', src: cmSrc, date: p.cmd };
  if ((variant === 'normal' || variant === 'holo' || (meta && meta.lang === 'ja')) && p.cm_t) return { v: p.cm_t, c: 'EUR', src: cmSrc, date: p.cmd };
  for (const k of tpK) if (p[k]) return { v: p[k], c: 'USD', src: 'TCGplayer marknadspris', date: p.tpd };
  return null;
}
function itemValue(it) {
  if (it.my && it.my.v > 0) return { v: conv(it.my.v, it.my.c) * (it.qty || 1), own: true };
  if (it.graded) return null; // graderade priser hämtas aldrig automatiskt – bara ditt sparade pris
  const set = S.sets[it.setId]; const card = set && set.byId.get(it.cardId);
  const mp = card ? marketPrice(card, it.variant, it.lang === 'ja' && set.cat === 'onepiece' ? { cat: 'onepiece', jp: 1 } : set) : null;
  if (!mp) return null;
  return { v: conv(mp.v, mp.c) * (it.qty || 1), own: false, mp };
}
/* ---------- collection ---------- */
async function loadItems() {
  const arr = await DB.all('items').catch(() => []);
  S.items = new Map();
  for (const x of arr) {
    const oldK = x.k; const it = migrateItem(x); if (it && !it.lang) it.lang = String(it.setId || '').startsWith('pkj') ? 'ja' : 'en';
    S.items.set(it.k, it);
    if (oldK !== it.k || !x.v2m) { it.v2m = 1; if (oldK !== it.k) await DB.del('items', oldK).catch(() => { }); await DB.put('items', it).catch(() => { }); }
  }
  rebuildOwned();
  S.favs = new Set(await kvGet('favs', []));
  S.setcfg = await kvGet('setcfg', {});
  S.customSets = await kvGet('customSets', []);
  S.pxl = await kvGet('pxl', {});
  S.cphoto = await kvGet('cphoto', {});
}
// v1 → v2: graderade kort blir egna exemplar (Ogradat och Graderat kan finnas samtidigt)
function migrateItem(it) {
  if (!it || it.v2m) return it;
  if (it.graded === undefined) {
    const g = String(it.grade || 'Raw');
    if (g !== 'Raw' && g !== 'Ogradat') {
      const m = g.match(/^(PSA|BGS|CGC|TAG)\s*(.*)$/i);
      it.graded = 1; it.gco = m ? m[1].toUpperCase() : 'Annat'; it.gv = m ? m[2].trim() : '';
      if (!it.custom && it.setId !== 'custom') it.k = `${it.cardId}|${it.variant}|g${uid()}`;
    } else it.graded = 0;
  }
  it.grade = gLabel(it);
  return it;
}
function rebuildOwned() {
  S.owned = new Map(); S.gown = new Map();
  for (const it of S.items.values()) {
    if (!(it.qty > 0)) continue;
    if (it.cat === 'onepiece' && !it.custom && (it.lang || 'en') !== S.oplang) continue;
    if (it.graded) { if (!S.gown.has(it.cardId)) S.gown.set(it.cardId, []); S.gown.get(it.cardId).push(it); }
    else { if (!S.owned.has(it.cardId)) S.owned.set(it.cardId, new Map()); S.owned.get(it.cardId).set(it.variant, it); }
  }
}
const hasV = (id, v) => { const o = S.owned.get(id); if (o && o.has(v)) return true; const g = S.gown.get(id); return !!(g && g.some(x => x.variant === v)); };
const hasAny = id => !!((S.owned.get(id) || new Map()).size || (S.gown.get(id) || []).length);
function newGraded(card, set, variant, gco, gv, lang = curLang(set)) {
  return { k: `${card.id}|${variant}|g${uid()}`, cardId: card.id, setId: set.id, cat: set.cat, lang, variant, qty: 1, graded: 1, gco, gv, grade: gco + (gv ? ' ' + gv : ''), added: Date.now(), snap: snapOf(card, set), v2m: 1 };
}
const ikey = (cardId, variant, jpOp) => cardId + '|' + variant + (jpOp ? '|ja' : '');
// Språk: japanska Pokémon-set är egna set (pkj-…); One Piece delar kortkoder → språket sitter på exemplaret
function curLang(set) { if (!set) return 'en'; if (set.cat === 'pokemon') return set.lang === 'ja' ? 'ja' : 'en'; if (set.cat === 'onepiece') return S.oplang; return 'en'; }
const isJpOp = set => set && set.cat === 'onepiece' && S.oplang === 'ja';
const pmeta = set => isJpOp(set) ? Object.assign({}, set, { jp: 1 }) : set;
function snapOf(card, set) { return { code: set.cat === 'onepiece' ? (card.base || card.n) : (set.lang === 'ja' ? set.apiId : null), off: set.official || null, name: card.name, n: card.n, img: card.img || null, imgf: card.imgf || null, setName: set.name, team: card.team || null, r: card.r || null, sub: set.subsets && card.sub != null ? set.subsets[card.sub].name : null }; }
async function setQty(card, set, variant, qty, lang = curLang(set)) {
  const k = ikey(card.id, variant, set.cat === 'onepiece' && lang === 'ja'); let it = S.items.get(k);
  if (qty <= 0) { if (it) { if (it.photo) await DB.del('photos', it.photo).catch(() => { }); S.items.delete(k); await DB.del('items', k); } }
  else {
    if (!it) it = { k, cardId: card.id, setId: set.id, cat: set.cat, lang, variant, qty, graded: 0, grade: 'Ogradat', added: Date.now(), snap: snapOf(card, set), v2m: 1 };
    it.qty = qty; S.items.set(k, it); await DB.put('items', it);
  }
  rebuildOwned();
}
async function saveItem(it) { S.items.set(it.k, it); await DB.put('items', it); rebuildOwned(); }
async function toggleFav(id) { if (S.favs.has(id)) S.favs.delete(id); else S.favs.add(id); await kvSet('favs', [...S.favs]); }

/* ---------- Masterset-logik ---------- */
function cfgOf(setId) { return S.setcfg[setId] || { mode: 'master', par: [] }; }
function cardVariants(card, set, mode) {
  if (mode !== 'master') return null;
  if (set.cat === 'pokemon') return card.v && card.v.length ? card.v : ['normal'];
  if (set.subsets) {
    const sub = set.subsets[card.sub] || { parallels: [] }; const par = cfgOf(set.id).par || [];
    return ['base', ...par.filter(p => (sub.parallels || []).includes(p))];
  }
  return null;
}
function inMode(card, set, mode) {
  if (mode === 'master') return true;
  if (set.cat === 'onepiece') return !card.alt;
  if (set.subsets) return !!(set.subsets[card.sub] || {}).base;
  return true;
}
function progress(set, mode) {
  let have = 0, tot = 0;
  for (const c of set.cards) {
    if (!inMode(c, set, mode)) continue;
    const vs = cardVariants(c, set, mode);
    if (!vs) { tot++; if (hasAny(c.id)) have++; }
    else for (const v of vs) { tot++; if (hasV(c.id, v)) have++; }
  }
  return { have, tot, pct: tot ? Math.floor(have / tot * 1000) / 10 : 0 };
}
function cardComplete(c, set, mode) {
  const vs = cardVariants(c, set, mode);
  if (!vs) return hasAny(c.id);
  return vs.every(v => hasV(c.id, v));
}
const VORDER = ['normal', 'holo', 'reverse', 'first'];
const defaultVariant = (card, set) => set.cat === 'pokemon' ? (VORDER.find(v => (card.v || []).includes(v)) || (card.v && card.v[0]) || 'normal') : (set.subsets ? 'base' : 'normal');

/* ---------- UI-hjälp ---------- */
let toastT;
function toast(msg, undo) {
  const t = $('#toast'); msg = String(msg); if (msg.length > 42) msg = msg.slice(0, 40) + '…'; t.innerHTML = esc(msg) + (undo ? ' <button id="undo">Ångra</button>' : '');
  t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), undo ? 4500 : 2200);
  if (undo) $('#undo').onclick = () => { t.classList.remove('show'); undo(); };
}
function imgErr(img) { const d = document.createElement('div'); d.className = 'phd ' + (img.dataset.cat || ''); d.innerHTML = '<b>🃏</b>Ingen bild'; img.replaceWith(d); }
function imgTag(src, cat) { return `<img loading="lazy" decoding="async" src="${esc(src)}" data-cat="${esc(cat)}" alt="" onerror="imgErr(this)">`; }
const LIMJP = (code, n) => `https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpc/${code}/${code}_${String(n).replace(/^0+(?=\d)/, '')}_R_JP_SM.png`;
function cardImgSrc(card, set, hi) {
  if (card.imgf) return hi ? card.imgf.replace('_SM.', '_LG.') : card.imgf; // reservbild (Limitless TCG / pokemontcg.io)
  if (!card.img && set && set.lang === 'ja' && set.live && set.apiId && card.n) return hi ? LIMJP(set.apiId, card.n).replace('_SM.', '_LG.') : LIMJP(set.apiId, card.n);
  if (!card.img) return null;
  if (set.cat === 'pokemon') return card.img + (hi ? '/high.webp' : '/low.webp');
  return card.img;
}
const SPORTEM = { fotboll: '⚽', basket: '🏀', hockey: '🏒', pokemon: '⚡', onepiece: '🏴‍☠️' };
// Accentfärg per lag (bara en stabil färg för att skilja lag åt – inte lagets officiella färger)
function teamHue(t) { let h = 0; for (const ch of String(t || '')) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; }
function sportBadge(card, set, mini) {
  const cat = set ? set.cat : card.cat; const sub = set && set.subsets && set.subsets[card.sub];
  const yr = set ? (String(set.name).match(/\b(19|20)\d{2}([-/]\d{2})?\b/) || [''])[0] : '';
  const brand = set ? String(set.name).replace(yr, '').replace(/\s*(Basketball|Hockey|Soccer|Football)\b/i, '').replace(/\s{2,}/g, ' ').trim() : '';
  const hue = teamHue(card.team || card.name);
  if (mini) return `<div class="sbadge mini ${esc(cat)}" style="--th:${hue}"><i>${SPORTEM[cat] || '🃏'}</i><b>#${esc(card.n || '')}</b></div>`;
  return `<div class="sbadge ${esc(cat)}" style="--th:${hue}"><div class="sbt"><span>${SPORTEM[cat] || '🃏'} ${esc(yr)}</span><span>#${esc(card.n || '')}</span></div>
   <div class="sbm"><div class="sbn">${esc(card.name || '')}</div>${card.team ? `<div class="sbteam">${esc(card.team)}</div>` : ''}${card.rc ? '<span class="pill rc">RC</span>' : ''}${sub && !sub.base ? `<div class="sbsub">${esc(sub.name)}</div>` : ''}</div>
   <div class="sbf">${esc(brand)}</div></div>`;
}
const isSport = cat => cat === 'fotboll' || cat === 'basket' || cat === 'hockey';
function cardPhotoThumb(id) { return S.cphoto && S.cphoto[id] || null; }
function imgSearchQ(card, set) { const sub = set.subsets && set.subsets[card.sub]; return [set.name, card.name, '#' + card.n, sub && !sub.base ? sub.name : ''].filter(Boolean).join(' '); }
function placeholder(card, cat) { return `<div class="phd ${cat}"><b>#${esc(card.n || '')}</b>${esc((card.name || '').slice(0, 40))}</div>`; }
const pctTxt = p => String(p).replace('.', ',');
function progBar(label, p, cls = '') { return `<div class="prog"><div class="t"><b>${label}</b><span>${p.have} / ${p.tot} kort · ${pctTxt(p.pct)} %</span></div><div class="bar ${cls}"><i style="width:${Math.min(100, p.pct)}%"></i></div></div>`; }
function setThumb(m) {
  if (m.logo) return `<img class="lg" loading="lazy" src="${esc(m.logo)}.png" alt="" onerror="this.style.visibility='hidden'">`;
  const short = m.apiId || (m.name || '').split(' ').slice(0, 2).join(' ');
  return `<div class="ph">${esc(CAT[m.cat] ? CAT[m.cat].em : '')} ${esc(String(short).slice(0, 12))}</div>`;
}
function updHeader() {
  const n = [...S.items.values()].reduce((a, b) => a + (b.qty || 0), 0);
  $('#upd').textContent = `${n} kort i samlingen`;
  $('#curtop').innerHTML = CURS.map(c => `<button data-cur="${c}" class="${S.cur === c ? 'on' : ''}">${c}</button>`).join('');
}
function langSeg(cat) {
  const k = cat === 'pokemon' ? 'pklang' : 'oplang'; const cur = S[k];
  return `<div class="seg lseg"><button data-${k}="en" class="${cur === 'en' ? 'on' : ''}">Engelska (EN)</button><button data-${k}="ja" class="${cur === 'ja' ? 'on' : ''}">🇯🇵 Japanska (JP)</button></div>`;
}
function catsBar(sel, all) {
  const list = (all ? [{ id: 'alla', em: '✦', short: 'Alla' }] : []).concat(CATS);
  return `<div class="cats" style="${all ? 'grid-template-columns:repeat(6,1fr)' : ''}">${list.map(c => `<button data-cat="${c.id}" class="${c.id} ${sel === c.id ? 'on' : ''}"><i>${c.em}</i>${c.short}</button>`).join('')}</div>`;
}

/* ---------- vyer ---------- */
let renderSeq = 0;
async function render() {
  const seq = ++renderSeq;
  document.querySelectorAll('#tabbar button').forEach(b => b.classList.toggle('on', b.dataset.tab === S.tab));
  updHeader();
  if (S.tab !== 'scan') stopCamera();
  if (S.tab === 'scan' && document.getElementById('scanview')) { renderScanResults(); return; }
  const v = { oversikt: vOverview, set: vSet, scan: vScan, samling: vCollection, backup: vBackup }[S.tab];
  const html = await v();
  if (seq !== renderSeq) return;
  $('#app').innerHTML = html;
  if (S.tab === 'scan') renderScanResults();
}
function totals() {
  const t = { v: 0, n: 0, uniq: 0, noPrice: 0, byCat: {}, raw: { n: 0, v: 0, noP: 0 }, gr: { n: 0, v: 0, noP: 0 } };
  for (const c of CATS) t.byCat[c.id] = { v: 0, n: 0 };
  for (const it of S.items.values()) {
    const val = itemValue(it); const q = it.qty || 0; const g = it.graded ? t.gr : t.raw;
    t.n += q; t.uniq++; g.n += q;
    const bc = t.byCat[it.cat] || (t.byCat[it.cat] = { v: 0, n: 0 }); bc.n += q;
    if (val) { t.v += val.v; bc.v += val.v; g.v += val.v; } else { t.noPrice++; g.noP++; }
  }
  return t;
}
function activeSets() {
  const ids = new Set([...S.items.values()].map(i => i.setId).filter(id => id && id !== 'custom'));
  return [...ids].map(id => S.sets[id]).filter(Boolean);
}
function vOverview() {
  const t = totals(); const act = activeSets().map(s => ({ s, p: progress(s, cfgOf(s.id).mode) })).sort((a, b) => b.p.pct - a.p.pct);
  const top = [...S.items.values()].map(it => ({ it, val: itemValue(it) })).filter(x => x.val).sort((a, b) => b.val.v - a.val.v).slice(0, 5);
  const recent = [...S.items.values()].sort((a, b) => b.added - a.added).slice(0, 5);
  let h = `<button class="scanbig" data-tab="scan"><span>📷</span><div><b>Skanna kort</b><small>Fota kortet – appen hittar det och visar priset</small></div><i>›</i></button>
  <div class="card hero">
    <div class="muted">Samlingens värde</div>
    <div class="big">${money(t.v)}</div>
    ${splitBoxes(t)}
    <div class="stat"><div><span class="muted">Kort</span><b>${t.n}</b></div><div><span class="muted">Olika</span><b>${t.uniq}</b></div><div><span class="muted">Utan pris</span><b>${t.noPrice}</b></div></div>
    ${t.noPrice ? `<div class="muted" style="margin-top:8px">${t.noPrice} av dina kort saknar pris (sportkort och graderade kort). Tryck på kortet → <b>Kolla pris</b> och spara det du hittar.</div>` : ''}
  </div>
  <div class="tiles">${CATS.map((c, i) => `<button class="tile ${c.id} ${i === 4 ? 'wide' : ''}" data-gocat="${c.id}"><span class="em">${c.em}</span><b>${c.name}</b><div class="muted">${t.byCat[c.id].n} kort</div><div class="v">${money(t.byCat[c.id].v)}</div></button>`).join('')}</div>`;
  h += `<div class="sec">Masterset-framsteg</div><div class="card">`;
  if (!act.length) h += `<div class="empty"><div class="e">🃏</div>Inga set påbörjade än.<br>Gå till <b>Set &amp; Masterset</b>, välj ett set och bocka av dina kort.</div><button class="btn pri full" data-tabgo="set">Välj ett set</button>`;
  else h += act.map(({ s, p }) => `<div data-open="${esc(s.id)}" style="cursor:pointer">${progBar(`${CAT[s.cat] ? CAT[s.cat].em : ''} ${s.lang === 'ja' || isJpOp(s) ? '🇯🇵 ' : ''}${esc(s.name)} <span class="muted">· ${cfgOf(s.id).mode === 'master' ? 'Masterset' : 'Grundset'}</span>`, p, cfgOf(s.id).mode === 'master' ? 'm' : '')}</div>`).join('');
  h += `</div>`;
  if (top.length) h += `<div class="sec">Dyraste korten</div><div class="card list">${top.map(x => itemLi(x.it, x.val)).join('')}</div>`;
  if (recent.length) h += `<div class="sec">Senast tillagda</div><div class="card list">${recent.map(it => itemLi(it, itemValue(it))).join('')}</div>`;
  h += `<button class="fab" data-act="addcustom">+ Lägg till eget kort</button>`;
  return h;
}
function splitBoxes(t) {
  return `<div class="split"><div class="sb raw"><span>Ogradat</span><b>${money(t.raw.v)}</b><small>${t.raw.n} kort${t.raw.noP ? ' · ' + t.raw.noP + ' utan pris' : ''}</small></div>
   <div class="sb gr"><span>🏅 Graderat</span><b>${money(t.gr.v)}</b><small>${t.gr.n} kort${t.gr.noP ? ' · ' + t.gr.noP + ' utan pris' : ''}</small></div></div>`;
}
function gBadge(id) {
  const g = S.gown.get(id); if (!g || !g.length) return '';
  const labs = [...new Set(g.map(gLabel))]; const v = g.reduce((a, x) => a + (x.my ? conv(x.my.v, x.my.c) * (x.qty || 1) : 0), 0);
  return `<span class="gb">🏅 ${esc(labs.slice(0, 2).join(', '))}${labs.length > 2 ? '…' : ''}${v ? ' · ' + money(v) : ''}</span>`;
}
function gradeChip(it) { if (!it.graded) return '<span class="chip">Ogradat</span>'; return `<span class="chip ${it.gco === 'PSA' ? 'y' : 'b'}">🏅 ${esc(gLabel(it))}</span>`; }
function itemThumb(it) {
  const s = it.snap || {};
  const set = S.sets[it.setId]; const card = set && set.byId && set.byId.get(it.cardId);
  const src = it.photoThumb || (card ? cardImgSrc(card, set) : null) || cardPhotoThumb(it.cardId) || s.imgf || (s.img ? (it.cat === 'pokemon' ? s.img + '/low.webp' : s.img) : null);
  return `<div class="th">${src ? imgTag(src, it.cat) : sportBadge(card || { n: s.n, name: s.name, team: s.team, cat: it.cat }, set || { cat: it.cat, name: s.setName || '' }, true)}</div>`;
}
function itemLi(it, val) {
  const s = it.snap || {};
  const vlab = VLABEL[it.variant] || it.variant;
  return `<div class="li" data-item="${esc(it.k)}">${itemThumb(it)}<div class="mid"><b>${esc(s.name)}</b><div class="muted">${esc(s.setName || '')}${s.n ? ' · #' + esc(s.n) : ''}</div>
   <div class="chips" style="margin-top:3px">${it.lang === 'ja' ? JPCHIP : ''}${gradeChip(it)}<span class="chip">${esc(vlab)}</span>${it.qty > 1 ? `<span class="chip b">×${it.qty}</span>` : ''}</div></div>
   <div class="rt"><b>${val ? money(val.v) : '–'}</b><span class="muted">${val ? (val.own ? 'ditt pris' : 'marknad') : (it.graded ? 'spara pris' : 'inget pris')}</span></div></div>`;
}
/* ----- Set-fliken ----- */
function setsOfCat(cat, anyLang) { return S.idx.sets.filter(m => m.cat === cat && (anyLang || cat !== 'pokemon' || (m.lang === 'ja' ? 'ja' : 'en') === S.pklang)).concat(S.customSets.filter(c => c.cat === cat)); }
async function vSet() {
  if (S.setId) return vSetDetail();
  const cat = S.cat; const list = setsOfCat(cat);
  const q = S.q.trim().toLowerCase();
  let h = `<h2>Set &amp; Masterset</h2><p class="lead">Välj kategori och set. Bocka av korten du har – appen räknar ut hur nära du är ett komplett <b>Masterset</b>.</p>${catsBar(cat)}`;
  if (cat === 'pokemon' || cat === 'onepiece') h += langSeg(cat);
  if (cat === 'pokemon' && S.pklang === 'ja') h += `<div class="note jpn">🇯🇵 <b>Japanska Pokémon-set</b> med japanska kortnummer och bilder. Priser: Cardmarket (japansk utgåva) via TCGdex. I Japan: tryck på ett kort → <b>Kolla pris</b> för SNKRDUNK, Yuyu-tei och eBay.</div>`;
  if (cat === 'onepiece' && S.oplang === 'ja') h += `<div class="note jpn">🇯🇵 <b>Japanska One Piece-kort</b> har samma kortkoder (t.ex. OP05-119) och räknas som en egen samling och eget Masterset. Engelska priser används inte för japanska kort – tryck på kortet → <b>Kolla pris</b> (SNKRDUNK, Yuyu-tei, PriceCharting, eBay) och spara priset.</div>`;
  h += `<input class="search" id="setq" type="search" placeholder="${cat === 'pokemon' && S.pklang === 'ja' ? 'Sök set eller kod, t.ex. SV2a…' : 'Sök set…'}" value="${esc(S.q)}" autocomplete="off">`;
  const filtered = list.filter(m => !q || (m.name + ' ' + (m.apiId || '') + ' ' + (m.series || '')).toLowerCase().includes(q));
  h += `<div class="card">${filtered.map(m => {
    const s = S.sets[m.id]; const p = s ? progress(s, cfgOf(m.id).mode) : null;
    const tot = m.total || (m.cards || []).length;
    const cnt = m.official && tot && m.official !== tot ? `${m.official} bas · ${tot} totalt` : `${tot} kort`;
    return `<div class="setrow" data-open="${esc(m.id)}">${setThumb(m)}<div class="info"><b>${m.lang === 'ja' ? '🇯🇵 ' : ''}${esc(m.name)}</b><div class="muted">${esc([m.series, m.release ? String(m.release).slice(0, 4) : '', cnt].filter(Boolean).join(' · '))}</div>
     ${p && p.have ? `<div class="bar m" style="margin-top:4px"><i style="width:${p.pct}%"></i></div>` : ''}</div>${p && p.have ? `<span class="chip g">${pctTxt(p.pct)}%</span>` : '<span class="muted">›</span>'}</div>`;
  }).join('') || '<div class="empty">Inga set matchar.</div>'}</div>`;
  if (cat === 'pokemon') {
    const jp = S.pklang === 'ja'; const live = jp ? S.liveSetsJa : S.liveSets; const pre = jp ? 'pkjl-' : 'pkl-';
    h += `<div class="sec">Alla andra ${jp ? 'japanska ' : ''}Pokémon-set</div><div class="card">`;
    if (!S.showAllPk) h += `<p class="muted" style="margin-top:0">Ovan finns populära set med priser färdigladdade. Vill du ha ett äldre set? Hämta hela listan live från TCGdex.</p><button class="btn full" data-act="allpk">Visa alla ${jp ? 'japanska ' : ''}Pokémon-set (live)</button>`;
    else if (!live) h += `<div class="loading">Hämtar set från TCGdex…</div>`;
    else {
      const have = new Set(S.idx.sets.filter(m => m.cat === 'pokemon' && (m.lang === 'ja') === jp).map(m => m.apiId));
      const ls = live.filter(x => !have.has(x.id) && (!q || (x.id + ' ' + x.name).toLowerCase().includes(q))).reverse();
      h += ls.map(x => `<div class="setrow" data-open="${pre}${esc(x.id)}">${setThumb({ logo: x.logo, cat: 'pokemon', apiId: x.id, name: x.name })}<div class="info"><b>${jp ? esc(x.id) + ' ' : ''}${esc(x.name)}</b><div class="muted">${esc(x.id)} · ${x.cardCount ? x.cardCount.total : '?'} kort · live</div></div><span class="muted">›</span></div>`).join('') || '<div class="empty">Inga fler set.</div>';
    }
    h += `</div>`;
  }
  if (cat === 'fotboll' || cat === 'basket' || cat === 'hockey') h += `<div class="note">Sportkort har ingen gratis pris-API. Checklistorna kommer från riktiga publicerade listor (källan visas i varje set). Priser tar du fram med <b>Kolla livepris</b> (eBay sålda, 130point, PriceCharting, Tradera) och sparar som <b>eget pris</b>.</div>`;
  h += `<button class="btn full" data-act="newset">+ Skapa eget set (${esc(CAT[cat].name)})</button>`;
  return h;
}
async function vSetDetail() {
  let set;
  try { set = await loadSet(S.setId); } catch (e) { return `<button class="back" data-act="backsets">‹ Alla set</button><div class="warn">Kunde inte ladda setet. Kontrollera internet och försök igen.</div>`; }
  const cf = cfgOf(set.id); const mode = cf.mode;
  const pB = progress(set, 'basic'), pM = progress(set, 'master');
  const q = S.q.trim().toLowerCase();
  let cards = set.cards;
  if (S.sub >= 0 && set.subsets) cards = cards.filter(c => c.sub === S.sub);
  else cards = cards.filter(c => inMode(c, set, mode));
  if (q) cards = cards.filter(c => (c.name + ' ' + c.n + ' ' + (c.base || '') + ' ' + (c.team || '')).toLowerCase().includes(q));
  const f = S.filter;
  if (f === 'Äger') cards = cards.filter(c => hasAny(c.id));
  if (f === 'Saknas') cards = cards.filter(c => !cardComplete(c, set, mode));
  if (f === 'Favoriter') cards = cards.filter(c => S.favs.has(c.id));
  const src = set.source ? `<a href="${esc(set.source.url)}" target="_blank" rel="noopener">${esc(set.source.name)}</a>` : 'ditt eget set';
  const priceInfo = isJpOp(set) ? '🇯🇵 Japanska kort: inga automatiska priser – Kolla pris på kortet (SNKRDUNK, Yuyu-tei, PriceCharting, eBay)' : set.priceSource ? `Priser: ${esc(set.lang === 'ja' ? 'Cardmarket (EUR, japansk utgåva) via TCGdex' : set.priceSource)}${set.priceDate ? ' · ' + fmtDate(set.priceDate) : ''}` : (set.subsets ? 'Inga automatiska priser – använd Kolla livepris på kortet' : '');
  const mLabel = set.cat === 'pokemon' ? 'Masterset (alla varianter)' : set.cat === 'onepiece' ? 'Masterset (inkl. parallel/alt-art)' : set.subsets ? `Masterset (alla delar${(cf.par || []).length ? ' + ' + cf.par.length + ' paralleller' : ''})` : 'Masterset';
  let h = `<button class="back" data-act="backsets">‹ Alla ${esc(CAT[set.cat].name)}-set</button>
  ${set.cat === 'onepiece' ? langSeg('onepiece') : ''}
  <div class="card"><div class="shead">${set.logo ? `<img src="${esc(set.logo)}.png" alt="" onerror="this.remove()">` : ''}<div style="min-width:0"><h3>${set.lang === 'ja' || isJpOp(set) ? JPCHIP + ' ' : ''}${esc(set.name)}</h3><div class="muted">${esc([set.series, set.release ? String(set.release).slice(0, 10) : ''].filter(Boolean).join(' · '))}</div></div></div>
   ${progBar(set.subsets ? 'Grundset (bas)' : set.cat === 'onepiece' ? 'Grundset (utan alt-art)' : 'Grundset (ett av varje kort)', pB)}
   ${progBar(mLabel, pM, 'm')}
   <div class="mtog"><button data-mode="basic" class="${mode === 'basic' ? 'on' : ''}">Grundset</button><button data-mode="master" class="${mode === 'master' ? 'on' : ''}">Masterset</button>${set.subsets ? `<button data-act="pars">Paralleller (${(cf.par || []).length})</button>` : ''}</div>
   <div class="muted src" style="margin-top:8px">Checklista: ${src}${set.fetched ? ' · hämtad ' + fmtDate(set.fetched) : ''}${priceInfo ? '<br>' + priceInfo : ''}${set.cards.some(c => c.imgf) ? '<br>Bilder: TCGdex + reservbilder från Limitless TCG / pokemontcg.io' : ''}</div>
   ${set.live && set.cards.some(c => c.unk) ? `<button class="btn sm full" style="margin-top:8px" data-act="livefill">Hämta varianter &amp; priser för hela setet</button>` : ''}
   ${set.custom ? `<div class="btns" style="margin-top:8px"><button class="btn sm" data-act="addtoset">+ Lägg till kort i setet</button><button class="btn sm red" data-act="delset">Ta bort set</button></div>` : ''}
  </div>`;
  h += `<input class="search" id="cardq" type="search" placeholder="Sök kort, nummer${set.subsets ? ', lag' : ''}…" value="${esc(S.q)}" autocomplete="off">`;
  h += `<div class="fbar">${['Alla', 'Äger', 'Saknas', 'Favoriter'].map(x => `<button data-filter="${x}" class="${S.filter === x ? 'on' : ''}">${x}</button>`).join('')}</div>`;
  if (set.subsets && set.subsets.length > 1) h += `<div class="fbar"><button data-sub="-1" class="${S.sub < 0 ? 'on' : ''}">${mode === 'master' ? 'Alla delar' : 'Bas'}</button>${set.subsets.map((s, i) => `<button data-sub="${i}" class="${S.sub === i ? 'on' : ''}">${esc(s.name)}<span class="cnt">${set.cards.filter(c => c.sub === i).length}</span></button>`).join('')}</div>`;
  const shown = cards.slice(0, S.showN);
  if (!shown.length) h += `<div class="empty"><div class="e">🔍</div>Inga kort här${f !== 'Alla' ? ' med filtret “' + esc(f) + '”' : ''}.</div>`;
  else if (set.cat === 'pokemon' || set.cat === 'onepiece') h += `<div class="grid">${shown.map(c => cardTile(c, set, mode)).join('')}</div>`;
  else h += `<div class="card" style="padding:4px 12px">${shown.map(c => sportRow(c, set, mode)).join('')}</div>`;
  if (cards.length > S.showN) h += `<button class="btn full more" data-act="more">Visa fler (${cards.length - S.showN} kvar)</button>`;
  return h;
}
function cardTile(c, set, mode) {
  const o = S.owned.get(c.id); const own = hasAny(c.id); const dv = defaultVariant(c, set);
  const qty = o ? [...o.values()].reduce((a, b) => a + b.qty, 0) : 0;
  const src = cardImgSrc(c, set);
  const vs = mode === 'master' && set.cat === 'pokemon' ? (c.v || []) : [];
  const mp = marketPrice(c, dv, pmeta(set));
  return `<div class="ct ${own ? '' : 'miss'}" data-card="${esc(c.id)}"><div class="im">${src ? imgTag(src, set.cat) : placeholder(c, set.cat)}</div>
   <button class="chk ${o && o.has(dv) ? 'on' : ''}" data-quick="${esc(c.id)}" aria-label="Bocka av ${esc(c.name)}">${o && o.has(dv) ? '✓' : ''}</button>
   ${qty > 1 ? `<span class="qty">×${qty}</span>` : ''}${S.favs.has(c.id) ? '<span class="fav">⭐</span>' : ''}
   <div class="nm">${esc(c.name)}</div><div class="no"><span>#${esc(c.n)}${c.alt ? ' · alt' : ''}</span><span>${mp ? money(conv(mp.v, mp.c)) : ''}</span></div>${gBadge(c.id)}
   ${vs.length > 1 ? `<div class="vd">${vs.map(v => `<i class="${hasV(c.id, v) ? 'on' : ''}" title="${VLABEL[v] || v}"></i>`).join('')}</div>` : ''}</div>`;
}
function sportRow(c, set, mode) {
  const cp = cardPhotoThumb(c.id);
  const o = S.owned.get(c.id); const dv = defaultVariant(c, set); const has = o && o.has(dv);
  const sub = set.subsets && set.subsets[c.sub];
  const extra = o ? [...o.keys()].filter(v => v !== dv) : [];
  const vs = cardVariants(c, set, mode);
  const val = o ? [...o.values()].map(itemValue).filter(Boolean).reduce((a, b) => a + b.v, 0) : 0;
  return `<div class="srow"><div class="sth" data-card="${esc(c.id)}">${cp ? `<img src="${esc(cp)}" alt="">` : sportBadge(c, set, true)}</div><div class="mid" data-card="${esc(c.id)}"><b>${esc(c.name)} ${c.rc ? '<span class="pill rc">RC</span>' : ''} ${S.favs.has(c.id) ? '⭐' : ''}</b>
   <div class="muted">${esc(c.team || '')}${sub && !sub.base ? ' · ' + esc(sub.name) : ''}${extra.length ? ' · <span style="color:var(--grn)">+' + extra.length + ' parallell</span>' : ''}${val ? ' · Ogradat ' + money(val) : ''}</div>${gBadge(c.id)}
   ${vs && vs.length > 1 ? `<div class="vd">${vs.map(v => `<i class="${hasV(c.id, v) ? 'on' : ''}"></i>`).join('')}</div>` : ''}</div>
   <button class="chk ${has ? 'on' : ''}" data-quick="${esc(c.id)}" aria-label="Bocka av ${esc(c.name)}">${has ? '✓' : ''}</button></div>`;
}

/* ----- Min samling ----- */
function vCollection() {
  let items = [...S.items.values()];
  const q = S.colQ.trim().toLowerCase();
  if (S.colCat !== 'alla') items = items.filter(i => i.cat === S.colCat);
  if (S.colLang !== 'alla') items = items.filter(i => (i.lang || 'en') === S.colLang);
  if (S.colGrade === 'raw') items = items.filter(i => !i.graded); else if (S.colGrade === 'graded') items = items.filter(i => i.graded);
  if (q) items = items.filter(i => { const s = i.snap || {}; return [s.name, s.setName, s.n, s.team, i.notes, i.cert, gLabel(i), s.code, i.lang === 'ja' ? 'jp japansk' : '', VLABEL[i.variant] || i.variant].join(' ').toLowerCase().includes(q); });
  const withV = items.map(it => ({ it, val: itemValue(it) }));
  const sorters = { value: (a, b) => (b.val ? b.val.v : -1) - (a.val ? a.val.v : -1), new: (a, b) => b.it.added - a.it.added, name: (a, b) => String((a.it.snap || {}).name).localeCompare(String((b.it.snap || {}).name), 'sv') };
  withV.sort(sorters[S.colSort]);
  const sum = withV.reduce((a, x) => a + (x.val ? x.val.v : 0), 0); const n = items.reduce((a, b) => a + (b.qty || 0), 0);
  let h = `<h2>Min samling</h2><p class="lead">Alla dina kort från alla kategorier. Tryck på ett kort för att ändra antal, gradering, pris eller foto.</p>${catsBar(S.colCat, true)}
  <input class="search" id="colq" type="search" placeholder="Sök namn, set, nummer, lag…" value="${esc(S.colQ)}" autocomplete="off">
  <div class="btns" style="margin-bottom:10px"><button class="btn" data-tab="scan">📷 Skanna kort</button><button class="btn" data-act="addcustom">+ Eget kort</button></div>
  ${splitBoxes(totals())}
  <div class="fbar" style="margin-top:10px">${[['alla', 'Alla'], ['raw', 'Ogradat'], ['graded', '🏅 Graderat']].map(([g, l]) => `<button data-grade="${g}" class="${S.colGrade === g ? 'on' : ''}">${l}</button>`).join('')}<span class="fsep"></span>${[['alla', 'Alla språk'], ['en', 'EN'], ['ja', '🇯🇵 JP']].map(([g, l]) => `<button data-collang="${g}" class="${S.colLang === g ? 'on' : ''}">${l}</button>`).join('')}</div>
  <div class="row" style="margin-bottom:8px"><span class="muted">${n} kort · ${money(sum)}</span>
   <select class="inp" id="colsort" style="width:auto;padding:7px 28px 7px 10px;font-size:15px"><option value="value" ${S.colSort === 'value' ? 'selected' : ''}>Högst värde</option><option value="new" ${S.colSort === 'new' ? 'selected' : ''}>Nyast</option><option value="name" ${S.colSort === 'name' ? 'selected' : ''}>Namn A–Ö</option></select></div>`;
  if (!withV.length) h += `<div class="card empty"><div class="e">🗂️</div>${S.items.size ? 'Inga kort matchar filtret.' : 'Din samling är tom än så länge.<br>Bocka av kort under <b>Set &amp; Masterset</b> eller lägg till ett eget kort.'}</div>`;
  else h += `<div class="card list">${withV.slice(0, 500).map(x => itemLi(x.it, x.val)).join('')}</div>`;
  h += `<button class="fab" data-act="addcustom">+ Lägg till eget kort</button>`;
  return h;
}

/* ----- Pris & Backup ----- */
async function vBackup() {
  const t = totals(); const photos = (await DB.keys('photos').catch(() => [])).length;
  let est = '';
  try { if (navigator.storage && navigator.storage.estimate) { const e = await navigator.storage.estimate(); est = `${(e.usage / 1048576).toFixed(1).replace('.', ',')} MB använt`; } } catch (e) { }
  let persisted = false;
  try { persisted = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : false; } catch (e) { }
  const lastBk = LS.get('lastBackup');
  const fx = S.fx; const cnt = c => S.idx.sets.filter(s => s.cat === c).length;
  return `<h2>Pris &amp; Backup</h2><p class="lead">Valuta, växelkurser, var priserna kommer ifrån – och backup så att du aldrig tappar din samling.</p>
  <div class="sec">Valuta</div><div class="card"><div class="seg" style="margin:0">${CURS.map(c => `<button data-cur="${c}" class="${S.cur === c ? 'on' : ''}">${CURFLAG[c]} ${c}</button>`).join('')}</div>
   <div class="kv" style="margin-top:10px"><span>1 USD</span><span>${fx ? fx.rates.SEK.toFixed(2).replace('.', ',') + ' kr' : '–'}</span></div>
   <div class="kv"><span>1 EUR</span><span>${fx ? (fx.rates.SEK / fx.rates.EUR).toFixed(2).replace('.', ',') + ' kr' : '–'}</span></div>
   <div class="kv"><span>🇯🇵 1 000 ¥</span><span>${fx && fx.rates.JPY ? (1000 * fx.rates.SEK / fx.rates.JPY).toFixed(2).replace('.', ',') + ' kr' : '–'}</span></div>
   <div class="kv"><span>🇯🇵 100 kr</span><span>${fx && fx.rates.JPY ? Math.round(100 * fx.rates.JPY / fx.rates.SEK).toLocaleString('sv-SE') + ' ¥' : '–'}</span></div>
   <div class="muted">Växelkurs: ${esc(fx ? fx.source : 'ingen')}${fx && fx.updated ? ' · ' + fmtDate(fx.updated) : ''}${fx && fx.live ? ' (live)' : ' (sparad)'}</div></div>
  <div class="sec">Backup</div><div class="card">
   <div class="kv"><span>Kort i samlingen</span><span>${t.n} (${t.uniq} olika)</span></div>
   <div class="kv"><span>Foton</span><span>${photos}</span></div>
   <div class="kv"><span>Egna set</span><span>${S.customSets.length}</span></div>
   <div class="kv"><span>Lagring</span><span>${est || '–'}${persisted ? ' · skyddad ✓' : ''}</span></div>
   <div class="kv"><span>Senaste backup</span><span>${lastBk ? fmtDate(lastBk) : '<span style="color:var(--org)">aldrig</span>'}</span></div>
   <div class="btns" style="margin-top:10px"><button class="btn pri" data-act="export">⬇︎ Spara backup</button><label class="btn">⬆︎ Läs in backup<input type="file" id="importf" accept="application/json,.json" hidden></label></div>
   <p class="muted" style="margin-bottom:0">Allt sparas bara på den här telefonen. Spara en backup-fil ibland (t.ex. i Filer eller iCloud Drive) – då kan du alltid läsa tillbaka den, även på en ny telefon.</p></div>
  <div class="sec">Var kommer priserna ifrån?</div><div class="card">
   <div class="kv"><span>⚡ Pokémon</span><span>Cardmarket (EUR) &amp; TCGplayer (USD) via <a href="https://tcgdex.dev" target="_blank" rel="noopener">TCGdex</a></span></div>
   <div class="kv"><span>🇯🇵 Pokémon JP</span><span>Cardmarket (EUR, japansk utgåva) via TCGdex</span></div>
   <div class="kv"><span>🏴‍☠️ One Piece</span><span>Marknadspris (USD) via <a href="https://optcgapi.com" target="_blank" rel="noopener">OPTCG API</a> – engelska kort</span></div>
   <div class="kv"><span>🇯🇵 One Piece JP</span><span>Ingen gratis pris-API → Kolla pris (SNKRDUNK, Yuyu-tei, PriceCharting, eBay) + eget pris</span></div>
   <div class="kv"><span>⚽ 🏀 🏒 Sport</span><span>Ingen gratis pris-API finns → Kolla livepris + eget pris</span></div>
   <p class="muted" style="margin-bottom:0">Appen hittar aldrig på priser. Saknas ett pris finns ingen riktig källa – då söker du sålda priser med ett tryck och sparar ditt eget. Marknadspriserna gäller ograderade kort; för PSA/BGS-kort, spara ditt eget pris.</p>
   <button class="btn full" style="margin-top:10px" data-act="refreshprices">↻ Uppdatera priser för mina kort nu</button></div>
  <div class="sec">Datakällor för set</div><div class="card small">
   <div class="kv"><span>Pokémon</span><span><a href="https://tcgdex.dev" target="_blank" rel="noopener">TCGdex</a> · ${S.idx.sets.filter(s => s.cat === 'pokemon' && s.lang !== 'ja').length} engelska + ${S.idx.sets.filter(s => s.lang === 'ja').length} 🇯🇵 japanska set färdigladdade + alla andra live</span></div>
   <div class="kv"><span>One Piece</span><span><a href="https://optcgapi.com" target="_blank" rel="noopener">OPTCG API</a> · ${cnt('onepiece')} boosters &amp; startdäck</span></div>
   <div class="kv"><span>Fotboll</span><span><a href="https://www.soccr.cloud" target="_blank" rel="noopener">soccr.cloud</a> · ${cnt('fotboll')} set</span></div>
   <div class="kv"><span>Basket</span><span><a href="https://www.checklistinsider.com" target="_blank" rel="noopener">Checklist Insider</a> · ${cnt('basket')} set</span></div>
   <div class="kv"><span>Hockey</span><span><a href="https://www.checklistinsider.com" target="_blank" rel="noopener">Checklist Insider</a> · ${cnt('hockey')} set</span></div>
   <div class="kv"><span>Setdata uppdaterad</span><span>${esc(S.idx.generated)}</span></div></div>
  <div class="sec">Övrigt</div><div class="card"><button class="btn red full" data-act="wipe">Radera hela samlingen…</button></div>
  <p class="muted" style="text-align:center">Lejon Kort · Pokémon, One Piece, Topps, Panini och Upper Deck är varumärken som tillhör sina ägare.</p>`;
}

/* ---------- sheets ---------- */
function openSheet(html) {
  const sh = $('#sheet'); sh.innerHTML = `<div class="grab"></div><button class="shx" data-act="close" aria-label="Stäng">✕</button>` + html;
  sh.classList.add('show'); $('#sheetbg').classList.add('show'); document.body.classList.add('lock');
  hydratePhotos(sh);
}
function closeSheet() { $('#sheet').classList.remove('show'); $('#sheetbg').classList.remove('show'); document.body.classList.remove('lock'); S.sheet = null; S.pendingPhoto = null; }
async function hydratePhotos(root) {
  for (const img of root.querySelectorAll('img[data-ph]')) { const d = await DB.get('photos', img.dataset.ph).catch(() => null); if (d) img.src = d; }
}
function searchQuery(card, set, variant, grade) {
  const parts = [];
  if (set.cat === 'pokemon') parts.push(card.name, card.n + (set.official ? '/' + String(set.official).padStart(3, '0') : ''), set.name);
  else if (set.cat === 'onepiece') parts.push(card.base || card.n, (card.name || '').replace(/\s*\(\d+\)/, ''));
  else { parts.push(set.name, card.name, '#' + card.n); const sub = set.subsets && set.subsets[card.sub]; if (sub && !sub.base) parts.push(sub.name); }
  if (variant && !['normal', 'base'].includes(variant)) parts.push(VLABEL[variant] || variant);
  if (grade && grade !== 'Ogradat' && !/^Annat/.test(grade)) parts.push(grade);
  return parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}
// Japanska söklänkar: SNKRDUNK & Yuyu-tei (Japan), PriceCharting & eBay sålda för japanska kort
function jpQueries(card, set, grade) {
  const gq = grade && grade !== 'Ogradat' && !/^Annat/.test(grade) ? ' ' + grade : '';
  if (set.cat === 'onepiece') { const code = card.base || String(card.n).replace(/_.*/, ''); const alt = card.alt ? ' parallel' : '';
    return { en: `${code} japanese${alt}${gq}`, snk: `${code}${gq.replace(' ', ' ').replace('PSA ', 'PSA')}`, yuyu: code, cat: 'onepiece' }; }
  const num = card.n + (set.official ? '/' + String(set.official).padStart(3, '0') : '');
  return { en: `pokemon japanese ${set.apiId || ''} ${num}${gq}`.replace(/\s+/g, ' '), snk: `${card.name} ${num}${gq.replace('PSA ', 'PSA')}`, yuyu: card.name, cat: 'pokemon' };
}
function jpLinks(j) {
  const E = encodeURIComponent;
  const L = [
    [`https://snkrdunk.com/search?keywords=${E(j.snk)}`, 'SNKRDUNK', 'Japans största – sålda & PSA'],
    [`https://yuyu-tei.jp/sell/${j.cat === 'pokemon' ? 'poc' : 'opc'}/s/search?search_word=${E(j.yuyu)}`, 'Yuyu-tei', 'Butikspris i Japan (ograderat)'],
    [`https://www.pricecharting.com/search-products?q=${E(j.en)}&type=prices`, 'PriceCharting JP', 'Sålda japanska kort'],
    [`https://www.ebay.com/sch/i.html?_nkw=${E(j.en)}&LH_Sold=1&LH_Complete=1`, 'eBay sålda JP', 'Riktiga försäljningar']
  ];
  if (j.cat === 'pokemon') L.push([`https://www.cardmarket.com/en/Pokemon/Products/Search?searchString=${E(j.en.replace('pokemon japanese ', ''))}`, 'Cardmarket', 'Europeiska priser']);
  L.push(['https://130point.com/sales/', '130point', 'Söktexten kopieras – klistra in', j.en]);
  return `<div class="links">${L.map(([u, t, sub, copy]) => `<a href="${u}" target="_blank" rel="noopener" ${copy ? `data-copy="${esc(copy)}"` : ''}>${t}<span>${sub}</span></a>`).join('')}</div>`;
}
function priceLinks(q, cat) {
  const e = encodeURIComponent(q);
  const L = [
    [`https://www.ebay.com/sch/i.html?_nkw=${e}&LH_Sold=1&LH_Complete=1`, 'eBay sålda', 'Riktiga försäljningar'],
    ['https://130point.com/sales/', '130point', 'Söktexten kopieras – klistra in', true],
    [`https://www.pricecharting.com/search-products?q=${e}&type=prices`, 'PriceCharting', 'Sålda priser & historik'],
    [`https://www.tradera.com/search?q=${e}`, 'Tradera', 'Svenska annonser']
  ];
  if (cat === 'pokemon') L.push([`https://www.cardmarket.com/en/Pokemon/Products/Search?searchString=${e}`, 'Cardmarket', 'Europeiska priser'], [`https://www.tcgplayer.com/search/pokemon/product?q=${e}`, 'TCGplayer', 'USA-priser']);
  if (cat === 'onepiece') L.push([`https://www.cardmarket.com/en/OnePiece/Products/Search?searchString=${e}`, 'Cardmarket', 'Europeiska priser'], [`https://www.tcgplayer.com/search/one-piece-card-game/product?q=${e}`, 'TCGplayer', 'USA-priser']);
  return `<div class="links">${L.map(([u, t, s, copy]) => `<a href="${u}" target="_blank" rel="noopener" ${copy ? `data-copy="${esc(q)}"` : ''}>${t}<span>${s}</span></a>`).join('')}</div>`;
}
async function openCard(cardId, setId, opts = {}) {
  const set = await loadSet(setId); if (!set.byId.get(cardId)) return;
  S.pendingPhoto = opts.photo || null;
  S.sheet = Object.assign({ cardId, setId, tab: (S.gown.get(cardId) || []).length && !S.owned.has(cardId) ? 'graded' : 'raw', gform: null, pq: 'Ogradat' }, opts);
  if (opts.gpre) { S.sheet.tab = 'graded'; S.sheet.gform = 'new'; S.sheet.pq = opts.gpre.gco + (opts.gpre.gv ? ' ' + opts.gpre.gv : ''); }
  renderCardSheet();
}
function sheetVariants(card, set) {
  const o = S.owned.get(card.id) || new Map(); const cf = cfgOf(set.id); let vs;
  if (set.cat === 'pokemon') vs = card.v && card.v.length ? card.v.slice() : ['normal'];
  else if (set.subsets) { const tracked = (cf.par || []).filter(p => ((set.subsets[card.sub] || {}).parallels || []).includes(p)); vs = ['base', ...tracked]; }
  else vs = ['normal'];
  for (const v of o.keys()) if (!vs.includes(v)) vs.push(v);
  return vs;
}
function renderCardSheet(keepScroll) {
  const sh0 = S.sheet; const set = S.sets[sh0.setId]; const card = set.byId.get(sh0.cardId); const cardId = card.id;
  const o = S.owned.get(cardId) || new Map(); const gl = S.gown.get(cardId) || [];
  const vs = sheetVariants(card, set);
  const src = cardImgSrc(card, set, true); const sub = set.subsets && set.subsets[card.sub];
  const p = livePrice(card) || card.p || {};
  const rawN = [...o.values()].reduce((a, b) => a + b.qty, 0);
  const cph = !src && cardPhotoThumb(card.id); let h;
  if (src) h = `<div class="bigimg">${imgTag(src, set.cat)}</div>`;
  else {
    const iq = encodeURIComponent(imgSearchQ(card, set));
    h = `<div class="bigimg ${cph ? '' : 'badge'}">${cph ? `<img data-ph="cp-${esc(card.id)}" src="${esc(cph)}" alt="">` : sportBadge(card, set)}</div>
    <div class="imgbtns"><label class="btn sm pri">📷 ${cph ? 'Byt bild' : 'Fota / lägg till bild'}<input type="file" accept="image/*" capture="environment" hidden id="cardphoto"></label>${cph ? `<button class="btn sm red" data-act="delcardphoto" aria-label="Ta bort bild">✕</button>` : ''}</div>
    <div class="imglinks">🔍 Se bild: <a href="https://www.google.com/search?tbm=isch&q=${iq}" target="_blank" rel="noopener">Google Bilder</a> · <a href="https://www.ebay.com/sch/i.html?_nkw=${iq}" target="_blank" rel="noopener">eBay</a></div>`;
  }
  h += `
  <div class="row"><div style="min-width:0"><h3 style="font-size:19px">${esc(card.name)} ${card.rc ? '<span class="pill rc">RC</span>' : ''}</h3>
   <div class="muted">${esc(set.name)} · #${esc(card.n)}${card.r ? ' · ' + esc(card.r) : ''}${card.team ? ' · ' + esc(card.team) : ''}${sub && !sub.base ? ' · ' + esc(sub.name) : ''}</div></div>
   <button class="btn sm" data-act="fav" style="flex-shrink:0">${S.favs.has(cardId) ? '⭐ Favorit' : '☆ Favorit'}</button></div>
  ${set.cat === 'onepiece' ? `<div style="margin-top:10px">${langSeg('onepiece')}</div>` : set.lang === 'ja' ? `<div class="chips" style="margin-top:8px">${JPCHIP}<span class="chip">${esc(set.apiId || '')} · ${esc(card.n)}${set.official ? '/' + String(set.official).padStart(3, '0') : ''}</span></div>` : ''}
  <div class="seg stabs" style="margin-top:12px"><button data-stab="raw" class="${sh0.tab === 'raw' ? 'on' : ''}">Ogradat${rawN ? ' (' + rawN + ')' : ''}</button><button data-stab="graded" class="${sh0.tab === 'graded' ? 'on' : ''}">🏅 Graderat${gl.length ? ' (' + gl.length + ')' : ''}</button></div>`;
  if (sh0.tab === 'raw') {
    if (set.cat === 'pokemon') {
      const boxes = [];
      if (p.cm_t) boxes.push([set.lang === 'ja' ? 'Cardmarket trend (JP)' : 'Cardmarket trend', conv(p.cm_t, 'EUR'), `${p.cm_t} € · ${fmtDate(p.cmd)}`]);
      if (set.lang === 'ja' && p.cm_a30) boxes.push(['Cardmarket snitt 30 d (JP)', conv(p.cm_a30, 'EUR'), `${p.cm_a30} € · ${fmtDate(p.cmd)}`]);
      if (p.cm_th && (card.v || []).includes('reverse')) boxes.push(['Cardmarket reverse holo', conv(p.cm_th, 'EUR'), `${p.cm_th} € · ${fmtDate(p.cmd)}`]);
      for (const [k, lab] of [['tp_normal', 'TCGplayer normal'], ['tp_unlimited', 'TCGplayer unlimited'], ['tp_holofoil', 'TCGplayer holo'], ['tp_unlimited-holofoil', 'TCGplayer unlimited holo'], ['tp_reverse-holofoil', 'TCGplayer reverse'], ['tp_1st-edition-holofoil', 'TCGplayer 1:a uppl. holo'], ['tp_1st-edition', 'TCGplayer 1:a upplagan']]) if (p[k]) boxes.push([lab, conv(p[k], 'USD'), `$${p[k]} · ${fmtDate(p.tpd)}`]);
      h += boxes.length ? `<div class="prices">${boxes.map(b => `<div class="pbox"><div class="l">${b[0]}</div><div class="a">${money(b[1])}</div><div class="s">${b[2]}</div></div>`).join('')}</div><div class="muted">Källa: TCGdex (Cardmarket${set.lang === 'ja' ? ', japansk utgåva' : '/TCGplayer'}). Gäller ogradade kort.</div>` : `<div class="note" style="margin-top:10px">Inget marknadspris finns hos källan för det här kortet. Använd Kolla pris nedan.</div>`;
    } else if (isJpOp(set)) {
      h += `<div class="note jpn" style="margin-top:10px">🇯🇵 Japanskt exemplar. Det finns ingen gratis pris-API för japanska One Piece-kort, och engelska priser visas inte här. Tryck <b>Kolla pris</b> nedan (SNKRDUNK, Yuyu-tei, PriceCharting, eBay) och spara priset – gärna i yen.</div>`;
    } else if (set.cat === 'onepiece') {
      h += (p.usd_m || p.usd_l) ? `<div class="prices">${p.usd_m ? `<div class="pbox"><div class="l">Marknadspris</div><div class="a">${money(conv(p.usd_m, 'USD'))}</div><div class="s">$${p.usd_m} · ${fmtDate(p.d)}</div></div>` : ''}${p.usd_l ? `<div class="pbox"><div class="l">Lägsta i lager</div><div class="a">${money(conv(p.usd_l, 'USD'))}</div><div class="s">$${p.usd_l} · ${fmtDate(p.d)}</div></div>` : ''}</div><div class="muted">Källa: OPTCG API (engelska kort, ogradade).</div>` : `<div class="note" style="margin-top:10px">Inget marknadspris finns hos källan för det här kortet. Använd Kolla pris nedan.</div>`;
    } else h += `<div class="note" style="margin-top:10px">Sportkort har ingen gratis pris-API. Använd <b>Kolla pris</b> nedan och spara det sålda priset – då räknas det in i samlingens värde direkt.</div>`;
    if (set.cat === 'pokemon' || (set.cat === 'onepiece' && !isJpOp(set))) h += `<button class="btn sm full" style="margin-top:8px" data-act="livecard">↻ Hämta senaste pris live</button>`;
    h += `<div class="sec">${set.cat === 'pokemon' ? 'Varianter – bocka av det du har' : set.subsets ? 'Bas &amp; paralleller – bocka av det du har' : 'Mitt ogradade exemplar'}</div>`;
    h += vs.map(v => variantRow(card, set, v, o.get(v))).join('');
    if (set.subsets && sub && sub.parallels && sub.parallels.length) {
      const rest = sub.parallels.filter(x => !vs.includes(x));
      if (rest.length) h += `<label class="fl w" style="margin-bottom:8px">Har du en annan parallell?<select class="inp" id="addpar"><option value="">+ Välj parallell…</option>${rest.map(x => `<option>${esc(x)}</option>`).join('')}</select></label>`;
    }
  } else {
    h += `<div class="note" style="margin-top:10px">${set.lang === 'ja' || isJpOp(set) ? '🇯🇵 Sparas som japanskt exemplar. ' : ''}Graderade kort (PSA, BGS, CGC, TAG) sparas som egna exemplar – de skriver aldrig över ditt ogradade kort. Graderade priser hämtas inte automatiskt: kolla sålda priser nedan och spara ditt pris.</div>`;
    h += gl.map(it => it.k === sh0.gform ? gradedForm(card, set, vs, it) : gradedRow(it)).join('');
    if (sh0.gform === 'new') h += gradedForm(card, set, vs, null, sh0.gpre);
    else if (!sh0.gform) h += `<button class="btn pri full" data-act="gnew">+ Lägg till graderat kort</button>`;
  }
  h += priceHelper(card, set);
  const sh = $('#sheet'); const st = sh.scrollTop;
  openSheet(h); sh.scrollTop = keepScroll ? st : 0;
  if (S.pendingPhoto && $('#gprev')) { $('#gprev').src = S.pendingPhoto.full; $('#gprev').style.display = 'block'; }
}
function gradedRow(it) {
  const vlab = VLABEL[it.variant] || it.variant;
  return `<div class="vrow on grow"><div class="vtop"><span class="gbig ${it.gco === 'PSA' ? 'psa' : ''}">${esc(it.gco || 'Annat')}<b>${esc(it.gv || '–')}</b></span>
   <div class="lb"><b>${esc(gLabel(it))} · ${esc(vlab)}</b><span class="muted">${it.cert ? 'Cert ' + esc(it.cert) + ' · ' : ''}${it.my ? 'Värde ' + money(conv(it.my.v, it.my.c)) : 'Inget pris sparat'}${it.buy ? ' · köpt ' + money(conv(it.buy.v, it.buy.c)) : ''}</span></div>
   <button class="btn sm" data-gedit="${esc(it.k)}">Ändra</button></div>${it.photo ? `<img class="photo" data-ph="${esc(it.photo)}" alt="">` : ''}</div>`;
}
const toCurStr = x => x ? String(+conv(x.v, x.c).toFixed(2)).replace('.', ',') : '';
function gradedForm(card, set, vs, it, pre) {
  pre = pre || {}; const gco = it ? it.gco : (pre.gco || 'PSA'); const gv = it ? it.gv : (pre.gv || '10');
  const variant = it ? it.variant : defaultVariant(card, set);
  return `<form id="gform" class="form gform" data-k="${it ? esc(it.k) : ''}">
   <div class="fl w"><b style="color:var(--txt);font-size:15px">${it ? 'Ändra graderat kort' : 'Nytt graderat kort'}</b></div>
   <div class="fl w">Företag<div class="seg rseg" style="margin:0">${GCOS.map(c => `<label><input type="radio" name="gco" value="${c}" ${c === gco ? 'checked' : ''}><span>${c}</span></label>`).join('')}</div></div>
   <label>Betyg<select class="inp" name="gv">${GVALS.map(g => `<option ${g === gv ? 'selected' : ''}>${g}</option>`).join('')}</select></label>
   <label>Variant<select class="inp" name="variant">${vs.map(v => `<option value="${esc(v)}" ${variant === v ? 'selected' : ''}>${esc(VLABEL[v] || v)}</option>`).join('')}</select></label>
   <label class="w">Cert-nummer (valfritt)<input class="inp" name="cert" value="${esc(it && it.cert || '')}" placeholder="T.ex. 87654321"></label>
   <label>Köppris (${S.cur})<input class="inp" name="buy" inputmode="decimal" placeholder="0" value="${esc(toCurStr(it && it.buy))}"></label>
   <label>Graderat värde (${S.cur})<input class="inp" name="my" inputmode="decimal" placeholder="Sålt pris" value="${esc(toCurStr(it && it.my))}"></label>
   <label class="w">Anteckning<input class="inp" name="notes" value="${esc(it && it.notes || '')}" placeholder="T.ex. köpt på Tradera"></label>
   <div class="fl w"><label class="btn sm">📷 ${it && it.photo ? 'Byt foto' : 'Foto (valfritt)'}<input type="file" accept="image/*" hidden id="gphoto"></label><img class="photo" id="gprev" ${it && it.photo ? `data-ph="${esc(it.photo)}"` : 'style="display:none"'} alt=""></div>
   <div class="fl w"><div class="btns"><button class="btn" type="button" data-act="gcancel">Avbryt</button><button class="btn pri" type="submit">${it ? 'Spara' : 'Lägg till graderat'}</button></div>
   ${it ? `<button class="btn red full" type="button" data-act="gdel" data-k="${esc(it.k)}" style="margin-top:8px">Ta bort graderat kort</button>` : ''}</div></form>`;
}
function priceHelper(card, set) {
  const gl = S.gown.get(card.id) || [];
  const opts = ['Ogradat', 'PSA 10', 'PSA 9', 'BGS 9.5', 'CGC 10']; for (const it of gl) { const l = gLabel(it); if (!opts.includes(l) && !/^Annat/.test(l)) opts.push(l); }
  const pq = S.sheet.pq || 'Ogradat';
  const jp = set.lang === 'ja' || isJpOp(set);
  const q = jp ? jpQueries(card, set, pq) : searchQuery(card, set, defaultVariant(card, set), pq);
  const target = pq === 'Ogradat' ? (S.owned.get(card.id) ? 'ditt ogradade kort' : 'ett nytt ogradat kort i samlingen') : (gl.some(x => gLabel(x) === pq) ? `ditt ${pq}-kort` : `ett nytt ${pq}-kort i samlingen`);
  return `<div class="sec">💰 Kolla pris</div>
  <div class="fbar">${opts.map(o => `<button data-pq="${esc(o)}" class="${pq === o ? 'on' : ''}">${esc(o)}</button>`).join('')}</div>
  ${jp ? `<div class="muted">${JPCHIP} Söker japanska: “${esc(q.snk)}”</div>${jpLinks(q)}` : `<div class="muted">Söker sålda: “${esc(q)}”</div>${priceLinks(q, set.cat)}`}
  <div class="qs"><input id="qsv" class="inp" inputmode="decimal" placeholder="Pris du hittade (${S.cur})"><button class="btn pri" data-act="qsave">Spara</button></div>
  ${jp && S.cur !== 'JPY' ? `<button class="btn sm" data-cur="JPY" style="margin-top:6px">¥ Skriv priset i yen</button>` : ''}
  <div class="muted">Sparas som värde på ${esc(target)}.</div>`;
}
function variantRow(card, set, v, it) {
  const on = !!it; const mp = marketPrice(card, v, pmeta(set)); const lab = VLABEL[v] || v;
  let h = `<div class="vrow ${on ? 'on' : ''}"><div class="vtop"><button class="chk ${on ? 'on' : ''}" data-vt="${esc(v)}" aria-label="Har ${esc(lab)}">${on ? '✓' : ''}</button>
   <div class="lb"><b>${esc(lab)}</b><span class="muted">${on && it.my ? 'Ditt pris ' + money(conv(it.my.v, it.my.c)) : mp ? money(conv(mp.v, mp.c)) + ' · ' + esc(mp.src) : (isJpOp(set) ? '🇯🇵 spara eget pris' : set.cat === 'pokemon' || set.cat === 'onepiece' ? 'inget marknadspris' : 'spara eget pris')}</span></div>
   ${on ? `<div class="step"><button data-vq="${esc(v)}" data-d="-1" aria-label="Minska">−</button><span>${it.qty}</span><button data-vq="${esc(v)}" data-d="1" aria-label="Öka">+</button></div>` : ''}</div>`;
  if (on) {
    const c = it.my ? it.my.c : S.cur;
    h += `<div class="form" data-form="${esc(it.k)}">
     <label>Köppris (${esc(it.buy ? it.buy.c : S.cur)})<input class="inp" data-f="buy" inputmode="decimal" placeholder="0" value="${it.buy ? esc(String(it.buy.v).replace('.', ',')) : ''}"></label>
     <label>Eget pris (${esc(c)})<input class="inp" data-f="my" inputmode="decimal" placeholder="${mp ? money(conv(mp.v, mp.c, c), c) : 'Sålt pris'}" value="${it.my ? esc(String(it.my.v).replace('.', ',')) : ''}"></label>
     <label class="w">Anteckning<input class="inp" data-f="notes" placeholder="T.ex. köpt på Tradera" value="${esc(it.notes || '')}"></label>
     <div class="fl w"><div class="btns"><label class="btn sm">📷 ${it.photo ? 'Byt foto' : 'Lägg till foto'}<input type="file" accept="image/*" hidden data-photo="${esc(it.k)}"></label>${it.photo ? `<button class="btn sm red" data-delphoto="${esc(it.k)}">Ta bort foto</button>` : ''}</div>
     ${it.photo ? `<img class="photo" data-ph="${esc(it.photo)}" alt="">` : ''}</div></div>`;
  }
  return h + '</div>';
}
function parseNum(s) { if (s == null) return null; const v = parseFloat(String(s).replace(/\s/g, '').replace(',', '.')); return isNaN(v) ? null : v; }
async function compressPhoto(file, max = 1100, q = 0.8) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const draw = (m, qq) => { const sc = Math.min(1, m / Math.max(img.width, img.height)); const cv = document.createElement('canvas'); cv.width = Math.round(img.width * sc); cv.height = Math.round(img.height * sc); cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height); return cv.toDataURL('image/jpeg', qq); };
    return { full: draw(max, q), thumb: draw(160, 0.7) };
  } finally { URL.revokeObjectURL(url); }
}

/* ----- eget kort ----- */
function customForm(it, pre) {
  pre = pre || {};
  const s = it ? it.snap || {} : { name: pre.name, n: pre.n, setName: pre.setName };
  const cat = it ? it.cat : (pre.cat || (S.tab === 'samling' && S.colCat !== 'alla' ? S.colCat : S.cat));
  const gco = it ? (it.graded ? it.gco : 'Ogradat') : (pre.gco || 'Ogradat'); const gv = it ? it.gv : (pre.gv || '10');
  const lang = it ? (it.lang || 'en') : (pre.lang || (cat === 'pokemon' ? S.pklang : cat === 'onepiece' ? S.oplang : 'en'));
  return `<h3 style="font-size:19px">${it ? 'Ändra eget kort' : 'Lägg till eget kort'}</h3><p class="muted">${pre.fromScan ? 'Ifyllt från skanningen – kolla och rätta det som blev fel.' : 'Fyll i det du vet – bara namn behövs. Fungerar för alla kategorier.'}</p>
  <form id="cform" class="form">
   <label class="w">Kategori<select class="inp" name="cat">${CATS.map(c => `<option value="${c.id}" ${c.id === cat ? 'selected' : ''}>${c.em} ${c.name}</option>`).join('')}</select></label>
   <label class="w">Set / serie<input class="inp" name="setName" list="setlist" placeholder="T.ex. 2025-26 Topps Chrome" value="${esc(s.setName && s.setName !== 'Eget kort' ? s.setName : '')}"><datalist id="setlist">${setsOfCat(cat).map(m => `<option value="${esc(m.name)}">`).join('')}</datalist></label>
   <label class="w">Kortnamn / spelare *<input class="inp" name="name" required placeholder="T.ex. Charizard ex eller Lamine Yamal" value="${esc(s.name || '')}"></label>
 <div class="fl w">Språk<div class="seg rseg" style="margin:0"><label><input type="radio" name="lang" value="en" ${lang !== 'ja' ? 'checked' : ''}><span>Engelska (EN)</span></label><label><input type="radio" name="lang" value="ja" ${lang === 'ja' ? 'checked' : ''}><span>🇯🇵 Japanska (JP)</span></label></div></div>
   <label>Nummer<input class="inp" name="n" placeholder="T.ex. 199 eller OP05-119" value="${esc(s.n || '')}"></label>
   <label>Variant / parallell<input class="inp" name="variant" list="varlist" placeholder="Normal" value="${esc(it ? (VLABEL[it.variant] || it.variant) : '')}"><datalist id="varlist">${['Normal', 'Reverse Holo', 'Holo', 'Refractor', 'Silver Prizm', 'Parallel', 'Alt Art', 'Manga', 'Gold /50', 'Young Guns', 'Rookie'].map(v => `<option value="${v}">`).join('')}</datalist></label>
   <label>Gradering<select class="inp" name="gco"><option value="Ogradat" ${gco === 'Ogradat' ? 'selected' : ''}>Ogradat</option>${GCOS.map(g => `<option ${gco === g ? 'selected' : ''}>${g}</option>`).join('')}</select></label>
   <label>Betyg (om graderat)<select class="inp" name="gv">${GVALS.map(g => `<option ${g === gv ? 'selected' : ''}>${g}</option>`).join('')}</select></label>
   <label class="w">Cert-nummer (om graderat)<input class="inp" name="cert" value="${esc(it && it.cert || '')}" placeholder="Valfritt"></label>
   <label>Antal<input class="inp" name="qty" type="number" min="1" inputmode="numeric" value="${it ? it.qty : 1}"></label>
   <label>Köppris (${S.cur})<input class="inp" name="buy" inputmode="decimal" placeholder="0" value="${esc(toCurStr(it && it.buy))}"></label>
   <label class="w">Värde per kort (${S.cur})<input class="inp" name="my" inputmode="decimal" placeholder="Ditt pris, t.ex. sålt pris från eBay" value="${esc(toCurStr(it && it.my))}"></label>
   <label class="w">Anteckning<textarea class="inp" name="notes" placeholder="T.ex. var jag köpte det…">${esc(it ? it.notes || '' : '')}</textarea></label>
   <div class="fl w">Foto (valfritt)<label class="btn">📷 Ta foto / välj bild<input type="file" accept="image/*" name="photo" hidden id="cphoto"></label><img class="photo" id="cprev" ${it && it.photo ? `data-ph="${esc(it.photo)}"` : 'style="display:none"'} alt=""></div>
   <div class="fl w"><button class="btn pri full" type="submit">${it ? 'Spara ändringar' : 'Lägg till i samlingen'}</button>${it ? `<button class="btn red full" type="button" data-act="delcustom" data-k="${esc(it.k)}" style="margin-top:8px">Ta bort kortet</button>` : ''}</div>
  </form>`;
}
function openCustom(it, pre) {
  S.sheet = { custom: it ? it.k : 'new' }; S.pendingPhoto = (pre && pre.photo) || null;
  let h = customForm(it, pre);
  if (it) { const s = it.snap || {}; const sq = [s.setName !== 'Eget kort' ? s.setName : '', s.name, s.n ? '#' + s.n : '', it.variant && it.variant !== 'normal' ? (VLABEL[it.variant] || it.variant) : '', it.graded && it.gco !== 'Annat' ? gLabel(it) : ''].filter(Boolean).join(' ');
    if (it.lang === 'ja' && (it.cat === 'pokemon' || it.cat === 'onepiece')) { const s2 = it.snap || {}; const g = it.graded && it.gco !== 'Annat' ? gLabel(it) : '';
      const j = it.cat === 'onepiece' ? { en: `${s2.n || s2.name} japanese ${g}`.trim(), snk: `${s2.n || s2.name} ${g}`.trim(), yuyu: s2.n || s2.name, cat: 'onepiece' } : { en: `pokemon japanese ${s2.name} ${s2.n || ''} ${g}`.replace(/\s+/g, ' ').trim(), snk: `${s2.name} ${s2.n || ''} ${g}`.trim(), yuyu: s2.name, cat: 'pokemon' };
      h += `<div class="sec">💰 Kolla pris</div><div class="muted">${JPCHIP} Söker japanska: “${esc(j.snk)}”</div>${jpLinks(j)}`;
    } else h += `<div class="sec">💰 Kolla pris</div><div class="muted">Söker sålda: “${esc(sq)}”</div>${priceLinks(sq, it.cat)}`; }
  openSheet(h); $('#sheet').scrollTop = 0;
  if (S.pendingPhoto) { const pv = $('#cprev'); pv.src = S.pendingPhoto.full; pv.style.display = 'block'; }
}
async function submitCustom(form) {
  const fd = new FormData(form); const name = String(fd.get('name') || '').trim(); if (!name) { toast('Skriv kortets namn'); return; }
  const prevK = S.sheet && S.sheet.custom !== 'new' ? S.sheet.custom : null; const prev = prevK ? S.items.get(prevK) : null;
  const k = prev ? prev.k : 'cu-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const vraw = String(fd.get('variant') || '').trim() || 'Normal';
  const vkey = Object.keys(VLABEL).find(x => VLABEL[x].toLowerCase() === vraw.toLowerCase()) || vraw;
  const buy = parseNum(fd.get('buy')), my = parseNum(fd.get('my'));
  const it = Object.assign(prev || { k, cardId: k, setId: 'custom', added: Date.now() }, {
    cat: fd.get('cat'), lang: fd.get('lang') === 'ja' ? 'ja' : 'en', variant: vkey, graded: fd.get('gco') && fd.get('gco') !== 'Ogradat' ? 1 : 0, gco: fd.get('gco') !== 'Ogradat' ? fd.get('gco') : undefined, gv: fd.get('gco') !== 'Ogradat' ? fd.get('gv') : undefined, cert: String(fd.get('cert') || '').trim(), v2m: 1,
    qty: Math.max(1, parseInt(fd.get('qty'), 10) || 1), notes: String(fd.get('notes') || ''),
    buy: buy != null ? { v: buy, c: S.cur } : null, my: my != null && my > 0 ? { v: my, c: S.cur } : null, custom: 1,
    snap: { name, n: String(fd.get('n') || '').trim(), setName: String(fd.get('setName') || '').trim() || 'Eget kort', img: null }
  });
  it.grade = gLabel(it);
  if (S.pendingPhoto) { const pid = 'p-' + k; await DB.put('photos', S.pendingPhoto.full, pid); it.photo = pid; it.photoThumb = S.pendingPhoto.thumb; }
  await saveItem(it); closeSheet(); toast(prev ? 'Sparat ✓' : 'Kortet är tillagt ✓'); render();
}

/* ----- eget set ----- */
function newSetForm() {
  return `<h3 style="font-size:19px">Skapa eget set</h3><p class="muted">För set som inte finns i appen. Klistra in checklistan – en rad per kort, t.ex. <b>12 Lamine Yamal</b>.</p>
  <form id="sform" class="form">
   <label class="w">Kategori<select class="inp" name="cat">${CATS.map(c => `<option value="${c.id}" ${c.id === S.cat ? 'selected' : ''}>${c.em} ${c.name}</option>`).join('')}</select></label>
   <label class="w">Setnamn *<input class="inp" name="name" required placeholder="T.ex. 2025 Topps Allsvenskan"></label>
   <label>År<input class="inp" name="year" inputmode="numeric" placeholder="2025"></label>
   <label>Antal kort (om ingen lista)<input class="inp" name="count" inputmode="numeric" placeholder="T.ex. 200"></label>
   <label class="w">Checklista (valfri)<textarea class="inp" name="list" style="min-height:140px" placeholder="1 Spelare Ett&#10;2 Spelare Två&#10;…"></textarea></label>
   <div class="fl w"><button class="btn pri full" type="submit">Skapa set</button></div></form>`;
}
const LINE_RE = /^#?\s*([A-Za-z]{0,6}-?\d+[A-Za-z]?)[\s.:)\-–]+(.+)$/;
async function saveCustomSets() { await kvSet('customSets', S.customSets.map(x => { const { byId, ...r } = x; return r; })); }
async function submitSet(form) {
  const fd = new FormData(form); const name = String(fd.get('name') || '').trim(); if (!name) return;
  const id = 'cs-' + Date.now().toString(36);
  let cards = String(fd.get('list') || '').split('\n').map(l => l.trim()).filter(Boolean).map((l, i) => { const m = l.match(LINE_RE); return { id: id + '-' + i, n: m ? m[1] : String(i + 1), name: m ? m[2].trim() : l }; });
  if (!cards.length) { const n = Math.min(2000, parseInt(fd.get('count'), 10) || 0); cards = Array.from({ length: n }, (_, i) => ({ id: id + '-' + i, n: String(i + 1), name: 'Kort ' + (i + 1) })); }
  const s = { id, cat: fd.get('cat'), name, release: String(fd.get('year') || ''), total: cards.length, official: cards.length, custom: 1, cards, source: null };
  S.customSets.push(s); await saveCustomSets();
  delete S.sets[id]; S.cat = s.cat; S.setId = id; S.q = ''; S.filter = 'Alla'; S.sub = -1; closeSheet(); toast('Setet är skapat ✓'); render();
}

/* ----- livepriser ----- */
async function fetchPkCard(id, lang) {
  const r = await fetch(`${tcgdexBase(lang)}/cards/${encodeURIComponent(id)}`); if (!r.ok) throw new Error('fel');
  const c = await r.json(); const p = {}; const cm = (c.pricing || {}).cardmarket || {}; const tp = (c.pricing || {}).tcgplayer || {};
  const r2 = x => typeof x === 'number' && x > 0 ? Math.round(x * 100) / 100 : null;
  [['trend', 't'], ['trend-holo', 'th'], ['avg30', 'a30'], ['avg30-holo', 'a30h'], ['low', 'l']].forEach(([k, kk]) => { if (r2(cm[k])) p['cm_' + kk] = r2(cm[k]); });
  if (cm.updated) p.cmd = cm.updated.slice(0, 10);
  for (const [k, v] of Object.entries(tp)) if (v && typeof v === 'object') { const m = r2(v.marketPrice) || r2(v.midPrice); if (m) p['tp_' + k] = m; }
  if (tp.updated) p.tpd = tp.updated.slice(0, 10);
  const vmap = { normal: 'normal', reverse: 'reverse', holo: 'holo', firstEdition: 'first' };
  let v = Object.entries(c.variants || {}).filter(([k, on]) => on && vmap[k]).map(([k]) => vmap[k]);
  const tpv = { tp_normal: 'normal', tp_holofoil: 'holo', 'tp_reverse-holofoil': 'reverse', tp_unlimited: 'normal', 'tp_unlimited-holofoil': 'holo', 'tp_1st-edition': 'first', 'tp_1st-edition-holofoil': 'first' };
  if (!v.length || (v.length === 1 && v[0] === 'normal')) { const inf = [...new Set(Object.keys(p).filter(k => tpv[k]).map(k => tpv[k]))]; if (inf.length) v = inf; }
  v.sort((a, b) => VORDER.indexOf(a) - VORDER.indexOf(b));
  return { p: Object.keys(p).length ? p : null, v: v.length ? v : null, r: c.rarity };
}
async function fetchOpCard(card) {
  const base = card.base || card.n; const isST = /^ST/.test(base);
  const r = await fetch(`https://optcgapi.com/api/${isST ? 'decks' : 'sets'}/card/${encodeURIComponent(base)}/`); if (!r.ok) throw new Error('fel');
  const arr = [].concat(await r.json());
  const x = arr.find(y => (y.card_image_id || y.card_set_id) === card.n) || arr[0];
  if (!x) return null; const p = {};
  if (x.market_price > 0) p.usd_m = x.market_price; if (x.inventory_price > 0) p.usd_l = x.inventory_price; if (x.date_scraped) p.d = x.date_scraped;
  return { p: Object.keys(p).length ? p : null };
}
async function saveLiveSet(set) { const { byId, ...r } = set; await kvSet('live-' + set.apiId, r); }
async function liveCardPrice(card, set) {
  const res = set.cat === 'pokemon' ? await fetchPkCard(card.id, set.lang) : await fetchOpCard(card);
  if (res && res.p) { S.pxl[card.id] = { p: res.p, ts: Date.now() }; }
  if (res && res.v && set.cat === 'pokemon') { card.v = res.v; delete card.unk; if (res.r) card.r = res.r; }
  return res;
}
async function pool(list, n, fn, onStep) {
  let i = 0, done = 0;
  await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => { while (i < list.length) { const x = list[i++]; try { await fn(x); } catch (e) { } done++; if (onStep) onStep(done, list.length); } }));
}

/* ---------- export / import ---------- */
async function doExport() {
  const photoKeys = await DB.keys('photos').catch(() => []);
  const photos = {}; for (const k of photoKeys) photos[k] = await DB.get('photos', k);
  const data = { app: 'lejon-kort', version: 2, exported: new Date().toISOString(), items: [...S.items.values()], favs: [...S.favs], setcfg: S.setcfg, customSets: S.customSets.map(x => { const { byId, ...r } = x; return r; }), settings: { cur: S.cur, pklang: S.pklang, oplang: S.oplang }, cphoto: S.cphoto, photos };
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const fname = `lejon-kort-backup-${new Date().toISOString().slice(0, 10)}.json`;
  try {
    const file = new File([blob], fname, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] }) && /iPhone|iPad|Android/i.test(navigator.userAgent)) { await navigator.share({ files: [file], title: 'Lejon Kort backup' }); LS.set('lastBackup', Date.now()); toast('Backup sparad ✓'); render(); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = fname; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  LS.set('lastBackup', Date.now()); toast('Backup sparad ✓'); render();
}
async function doImport(file) {
  let data; try { data = JSON.parse(await file.text()); } catch (e) { toast('Filen kunde inte läsas'); return; }
  if (!data || data.app !== 'lejon-kort' || !Array.isArray(data.items)) { toast('Det där är ingen Lejon Kort-backup'); return; }
  const replace = confirm(`Backup från ${fmtDate(data.exported)} med ${data.items.length} kort-poster.\n\nOK = Ersätt allt med backupen\nAvbryt = Slå ihop med det du redan har`);
  if (replace) { await DB.clear('items'); await DB.clear('photos'); S.items.clear(); }
  for (const raw of data.items) if (raw && raw.k) { const it = migrateItem(raw); it.v2m = 1; if (!it.lang) it.lang = String(it.setId || '').startsWith('pkj') ? 'ja' : 'en'; S.items.set(it.k, it); await DB.put('items', it); }
  for (const [k, v] of Object.entries(data.photos || {})) await DB.put('photos', v, k);
  S.favs = new Set([...(replace ? [] : S.favs), ...(data.favs || [])]); await kvSet('favs', [...S.favs]);
  S.setcfg = Object.assign(replace ? {} : S.setcfg, data.setcfg || {}); await kvSet('setcfg', S.setcfg);
  S.cphoto = Object.assign(replace ? {} : S.cphoto, data.cphoto || {}); await kvSet('cphoto', S.cphoto);
  const ids = new Set(S.customSets.map(x => x.id));
  S.customSets = (replace ? [] : S.customSets).concat((data.customSets || []).filter(x => replace || !ids.has(x.id)));
  for (const k of Object.keys(S.sets)) if (k.startsWith('cs-')) delete S.sets[k];
  await saveCustomSets(); rebuildOwned(); await ensureOwnedSets(); toast('Backup inläst ✓'); render();
}
async function ensureOwnedSets() {
  const ids = new Set([...S.items.values()].map(i => i.setId).filter(id => id && id !== 'custom'));
  await Promise.all([...ids].map(id => loadSet(id).catch(() => null)));
}

/* ---------- händelser ---------- */
function setOpLang(l) { if (S.oplang === l) return; S.oplang = l; LS.set('oplang', l); rebuildOwned(); }
async function gradedSubmit(form) {
  const { set, card } = curSheetCard(); const fd = new FormData(form); const k = form.dataset.k;
  const gco = String(fd.get('gco') || 'PSA'), gv = String(fd.get('gv') || ''), variant = String(fd.get('variant') || defaultVariant(card, set));
  let it = k ? S.items.get(k) : null;
  if (!it) it = newGraded(card, set, variant, gco, gv);
  const buy = parseNum(fd.get('buy')), my = parseNum(fd.get('my'));
  Object.assign(it, { gco, gv, variant, cert: String(fd.get('cert') || '').trim(), notes: String(fd.get('notes') || ''), buy: buy != null && buy > 0 ? { v: buy, c: S.cur } : null, my: my != null && my > 0 ? { v: my, c: S.cur } : null });
  it.grade = gLabel(it);
  if (S.pendingPhoto) { const pid = 'p-' + it.k.replace(/[^\w-]/g, '_'); await DB.put('photos', S.pendingPhoto.full, pid); it.photo = pid; it.photoThumb = S.pendingPhoto.thumb; S.pendingPhoto = null; }
  await saveItem(it); S.sheet.gform = null; S.sheet.gpre = null; S.sheet.pq = gLabel(it);
  toast(k ? 'Sparat ✓' : '🏅 ' + gLabel(it) + ' tillagt ✓'); renderCardSheet(true); render();
}
const curSheetCard = () => { const { cardId, setId } = S.sheet; const set = S.sets[setId]; return { set, card: set.byId.get(cardId) }; };
const ACTIONS = {
  close() { closeSheet(); },
  async delcardphoto() { if (!confirm('Ta bort bilden på kortet?')) return; const id = S.sheet.cardId; await DB.del('photos', 'cp-' + id).catch(() => { }); delete S.cphoto[id]; await kvSet('cphoto', S.cphoto); renderCardSheet(true); render(); },
  gnew() { S.sheet.gform = 'new'; S.sheet.gpre = null; renderCardSheet(true); },
  gcancel() { S.sheet.gform = null; S.sheet.gpre = null; S.pendingPhoto = null; renderCardSheet(true); },
  async gdel(t) {
    if (!confirm('Ta bort det graderade kortet ur samlingen?')) return; const it = S.items.get(t.dataset.k); if (!it) return;
    if (it.photo) await DB.del('photos', it.photo).catch(() => { }); S.items.delete(it.k); await DB.del('items', it.k); rebuildOwned();
    S.sheet.gform = null; toast('Borttaget'); renderCardSheet(true); render();
  },
  async qsave() {
    const v = parseNum(($('#qsv') || {}).value); if (!(v > 0)) { toast('Skriv priset först'); return; }
    const { set, card } = curSheetCard(); const pq = S.sheet.pq || 'Ogradat'; let it;
    if (pq === 'Ogradat') {
      const o = S.owned.get(card.id); const dv = defaultVariant(card, set);
      it = o && (o.get(dv) || [...o.values()][0]);
      if (!it) { await setQty(card, set, dv, 1); it = S.owned.get(card.id).get(dv); }
    } else {
      it = (S.gown.get(card.id) || []).find(x => gLabel(x) === pq);
      if (!it) { const m = pq.match(/^(\S+)\s*(.*)$/); it = newGraded(card, set, defaultVariant(card, set), m[1], m[2]); }
    }
    it.my = { v, c: S.cur }; await saveItem(it); toast(`Sparat: ${money(v)} ✓`); renderCardSheet(true); render();
  },
  backsets() { S.setId = null; S.q = ''; window.scrollTo(0, 0); render(); },
  more() { S.showN += 200; render(); },
  addcustom() { openCustom(null); },
  newset() { S.sheet = { newset: 1 }; openSheet(newSetForm()); $('#sheet').scrollTop = 0; },
  async fav() { await toggleFav(S.sheet.cardId); renderCardSheet(true); render(); },
  export() { doExport(); },
  async wipe() {
    if (!confirm('Vill du radera HELA samlingen på den här telefonen? Spara gärna en backup först.')) return;
    if (!confirm('Är du helt säker? Det går inte att ångra.')) return;
    await DB.clear('items'); await DB.clear('photos'); S.items.clear(); rebuildOwned(); S.cphoto = {}; await kvSet('cphoto', {}); S.favs.clear(); await kvSet('favs', []); toast('Samlingen är raderad'); render();
  },
  async allpk() {
    S.showAllPk = true; render(); const jp = S.pklang === 'ja';
    try { const r = await fetch(`${tcgdexBase(S.pklang)}/sets`); const j = await r.json(); if (jp) S.liveSetsJa = j; else S.liveSets = j; } catch (err) { if (jp) S.liveSetsJa = []; else S.liveSets = []; toast('Kunde inte nå TCGdex just nu'); }
    render();
  },
  async livecard(t) {
    const { set, card } = curSheetCard(); t.disabled = true; t.textContent = 'Hämtar…';
    try { const r = await liveCardPrice(card, set); await kvSet('pxl', S.pxl); if (set.live) await saveLiveSet(set); toast(r && r.p ? 'Senaste pris hämtat ✓' : 'Källan har inget pris för kortet'); } catch (err) { toast('Kunde inte hämta pris just nu'); }
    if (S.sheet) renderCardSheet(true); render();
  },
  async livefill(t) {
    const set = S.sets[S.setId]; const todo = set.cards.filter(c => c.unk); t.disabled = true;
    await pool(todo, 6, c => liveCardPrice(c, set), (n, tot) => { t.textContent = `Hämtar ${n} / ${tot}…`; });
    await kvSet('pxl', S.pxl); await saveLiveSet(set); toast('Varianter och priser hämtade ✓'); render();
  },
  async refreshprices(t) {
    await ensureOwnedSets(); const list = []; const seen = new Set();
    for (const it of S.items.values()) { const set = S.sets[it.setId]; if (!set || !(set.cat === 'pokemon' || set.cat === 'onepiece') || (set.cat === 'onepiece' && it.lang === 'ja')) continue; const c = set.byId.get(it.cardId); if (c && !seen.has(c.id)) { seen.add(c.id); list.push([c, set]); } }
    if (!list.length) { toast('Inga Pokémon- eller One Piece-kort att uppdatera'); return; }
    t.disabled = true; await pool(list, 5, ([c, s]) => liveCardPrice(c, s), (n, tot) => { t.textContent = `Uppdaterar ${n} / ${tot}…`; });
    await kvSet('pxl', S.pxl); toast('Priserna är uppdaterade ✓'); render();
  },
  pars() {
    const set = S.sets[S.setId]; const all = [...new Set(set.subsets.flatMap(s => s.parallels || []))]; const cur = new Set(cfgOf(set.id).par || []);
    S.sheet = { pars: 1 };
    openSheet(`<h3 style="font-size:19px">Masterset-paralleller</h3><p class="muted">Välj vilka paralleller som ska räknas i ditt Masterset. Bas räknas alltid. Tips: börja med de vanliga (t.ex. Refractor eller Silver).</p>
     <div class="card" style="padding:4px 12px">${all.map(p => `<label class="srow" style="cursor:pointer"><span class="mid"><b style="font-weight:600">${esc(p)}</b></span><input type="checkbox" data-par="${esc(p)}" ${cur.has(p) ? 'checked' : ''} style="width:24px;height:24px;accent-color:#3ccf8e"></label>`).join('') || '<div class="empty">Inga paralleller listade för det här setet.</div>'}</div>
     <button class="btn pri full" data-act="savepars">Spara</button>`);
    $('#sheet').scrollTop = 0;
  },
  async savepars() {
    const par = [...document.querySelectorAll('#sheet input[data-par]')].filter(x => x.checked).map(x => x.dataset.par);
    S.setcfg[S.setId] = Object.assign({}, cfgOf(S.setId), { par, mode: 'master' }); await kvSet('setcfg', S.setcfg); closeSheet(); toast('Masterset uppdaterat ✓'); render();
  },
  async delset() {
    if (!confirm('Ta bort det här egna setet? Korten du bockat av ligger kvar i Min samling.')) return;
    S.customSets = S.customSets.filter(x => x.id !== S.setId); delete S.sets[S.setId]; await saveCustomSets(); S.setId = null; render();
  },
  async addtoset() {
    const n = prompt('Kortnummer och namn, t.ex. "12 Lamine Yamal"'); if (!n || !n.trim()) return;
    const set = S.customSets.find(x => x.id === S.setId); const m = n.trim().match(LINE_RE);
    set.cards.push({ id: set.id + '-' + Date.now().toString(36), n: m ? m[1] : String(set.cards.length + 1), name: m ? m[2] : n.trim() });
    set.total = set.official = set.cards.length; set.byId = new Map(set.cards.map(c => [c.id, c])); await saveCustomSets(); render();
  },
  async delcustom(t) {
    if (!confirm('Ta bort kortet ur samlingen?')) return; const it = S.items.get(t.dataset.k);
    if (it && it.photo) await DB.del('photos', it.photo); S.items.delete(t.dataset.k); await DB.del('items', t.dataset.k); rebuildOwned(); closeSheet(); toast('Borttaget'); render();
  }
};
document.addEventListener('click', async e => {
  const t = e.target.closest('button,a[data-copy],[data-open],[data-card],[data-item],[data-gocat],[data-tabgo]'); if (!t) return;
  const d = t.dataset;
  try {
    if (d.tab) { if (d.tab === S.tab && S.tab === 'set') S.setId = null; S.tab = d.tab; S.q = ''; window.scrollTo(0, 0); render(); return; }
    if (d.tabgo) { S.tab = d.tabgo; render(); return; }
    if (d.cur) { S.cur = d.cur; LS.set('cur', S.cur); render(); if (S.sheet && S.sheet.cardId) renderCardSheet(true); return; }
    if (d.copy) { try { await navigator.clipboard.writeText(d.copy); toast('Söktext kopierad – klistra in på 130point'); } catch (err) { } return; }
    if (d.gocat) { S.tab = 'set'; S.cat = d.gocat; LS.set('cat', S.cat); S.setId = null; S.q = ''; window.scrollTo(0, 0); render(); return; }
    if (d.cat) { if (S.tab === 'samling') S.colCat = d.cat; else { S.cat = d.cat; LS.set('cat', S.cat); S.setId = null; S.q = ''; S.showAllPk = false; } render(); return; }
    if (d.open) { S.tab = 'set'; S.setId = d.open; const m = metaOf(d.open); if (m) S.cat = m.cat; S.q = ''; S.filter = 'Alla'; S.sub = -1; S.showN = 120; window.scrollTo(0, 0); render(); return; }
    if (d.filter) { S.filter = d.filter; S.showN = 120; render(); return; }
    if (d.sub !== undefined) { S.sub = parseInt(d.sub, 10); S.showN = 120; render(); return; }
    if (d.grade) { S.colGrade = d.grade; render(); return; }
    if (d.collang) { S.colLang = d.collang; render(); return; }
    if (d.pklang) { S.pklang = d.pklang; LS.set('pklang', d.pklang); S.showAllPk = false; S.q = ''; render(); return; }
    if (d.oplang) { setOpLang(d.oplang); render(); if (S.sheet && S.sheet.cardId) { S.sheet.gform = null; renderCardSheet(true); } toast(d.oplang === 'ja' ? '🇯🇵 Japanska One Piece-kort' : 'Engelska One Piece-kort'); return; }
    if (d.stab) { S.sheet.tab = d.stab; S.sheet.gform = null; if (d.stab === 'raw') S.sheet.pq = 'Ogradat'; else { const g = (S.gown.get(S.sheet.cardId) || [])[0]; if (g) S.sheet.pq = gLabel(g); else if (S.sheet.pq === 'Ogradat') S.sheet.pq = 'PSA 10'; } renderCardSheet(true); return; }
    if (d.pq) { S.sheet.pq = d.pq; renderCardSheet(true); return; }
    if (d.gedit) { S.sheet.gform = d.gedit; const it = S.items.get(d.gedit); if (it) S.sheet.pq = gLabel(it); renderCardSheet(true); return; }
    if (d.mode) { S.setcfg[S.setId] = Object.assign({}, cfgOf(S.setId), { mode: d.mode }); await kvSet('setcfg', S.setcfg); S.sub = -1; render(); return; }
    if (d.quick) {
      e.stopPropagation(); const set = S.sets[S.setId]; const card = set.byId.get(d.quick); const v = defaultVariant(card, set);
      const o = S.owned.get(card.id); const had = o && o.get(v);
      if (had) { const prev = { ...had }; await setQty(card, set, v, 0); toast('Borttaget: ' + card.name, async () => { await saveItem(prev); render(); }); }
      else { await setQty(card, set, v, 1); toast('✓ ' + card.name + (set.cat === 'pokemon' && v !== 'normal' ? ' (' + VLABEL[v] + ')' : '')); }
      render(); return;
    }
    if (d.card) { await openCard(d.card, S.setId); return; }
    if (d.item) {
      const it = S.items.get(d.item); if (!it) return;
      if (it.custom || it.setId === 'custom') { openCustom(it); return; }
      if (it.cat === 'onepiece') setOpLang(it.lang || 'en');
      try { await openCard(it.cardId, it.setId, it.graded ? { tab: 'graded', pq: gLabel(it) } : {}); } catch (err) { openCustom(it); }
      return;
    }
    if (d.vt) {
      const { set, card } = curSheetCard(); const o = S.owned.get(card.id); const has = o && o.get(d.vt);
      if (has) { if ((has.photo || has.my || has.notes) && !confirm('Ta bort ' + (VLABEL[d.vt] || d.vt) + ' ur samlingen? Pris, anteckning och foto försvinner.')) return; await setQty(card, set, d.vt, 0); }
      else await setQty(card, set, d.vt, 1);
      renderCardSheet(true); render(); return;
    }
    if (d.vq) {
      const { set, card } = curSheetCard(); const it = S.owned.get(card.id).get(d.vq);
      const nq = it.qty + parseInt(d.d, 10); if (nq <= 0 && !confirm('Ta bort kortet ur samlingen?')) return;
      await setQty(card, set, d.vq, nq); renderCardSheet(true); render(); return;
    }
    if (d.delphoto) { const it = S.items.get(d.delphoto); if (it && it.photo) { await DB.del('photos', it.photo); delete it.photo; delete it.photoThumb; await saveItem(it); renderCardSheet(true); render(); } return; }
    if (d.act && ACTIONS[d.act]) await ACTIONS[d.act](t);
  } catch (err) { console.warn(err); toast('Något gick fel – försök igen'); }
});
$('#sheetbg').addEventListener('click', closeSheet);
document.addEventListener('input', e => {
  const id = e.target.id;
  if (id === 'setq' || id === 'cardq' || id === 'colq') {
    if (id === 'colq') S.colQ = e.target.value; else S.q = e.target.value;
    clearTimeout(S.qT);
    S.qT = setTimeout(async () => { const pos = e.target.selectionStart; await render(); const el = document.getElementById(id); if (el) { el.focus({ preventScroll: true }); try { el.setSelectionRange(pos, pos); } catch (er) { } } }, 300);
  }
});
document.addEventListener('change', async e => {
  const el = e.target;
  try {
    if (el.id === 'colsort') { S.colSort = el.value; render(); return; }
    if (el.id === 'importf' && el.files[0]) { await doImport(el.files[0]); el.value = ''; return; }
    if (el.id === 'addpar' && el.value) { const { set, card } = curSheetCard(); await setQty(card, set, el.value, 1); renderCardSheet(true); render(); return; }
    if (el.id === 'cardphoto' && el.files[0]) {
      const id = S.sheet.cardId; const ph = await compressPhoto(el.files[0]); await DB.put('photos', ph.full, 'cp-' + id); S.cphoto[id] = ph.thumb; await kvSet('cphoto', S.cphoto);
      toast('Bild sparad ✓ – syns i hela appen'); renderCardSheet(true); render(); return;
    }
    if (el.id === 'gphoto' && el.files[0]) { S.pendingPhoto = await compressPhoto(el.files[0]); const p = $('#gprev'); p.removeAttribute('data-ph'); p.src = S.pendingPhoto.full; p.style.display = 'block'; return; }
    if (el.id === 'cphoto' && el.files[0]) { S.pendingPhoto = await compressPhoto(el.files[0]); const p = $('#cprev'); p.src = S.pendingPhoto.full; p.style.display = 'block'; return; }
    if (el.name === 'cat' && el.closest('#cform')) { const dl = $('#setlist'); if (dl) dl.innerHTML = setsOfCat(el.value).map(m => `<option value="${esc(m.name)}">`).join(''); return; }
    if (el.dataset.photo && el.files[0]) {
      const it = S.items.get(el.dataset.photo); if (!it) return;
      const ph = await compressPhoto(el.files[0]); const pid = 'p-' + it.k; await DB.put('photos', ph.full, pid); it.photo = pid; it.photoThumb = ph.thumb; await saveItem(it);
      toast('Foto sparat ✓'); renderCardSheet(true); render(); return;
    }
    const form = el.closest('[data-form]');
    if (form && el.dataset.f) {
      const it = S.items.get(form.dataset.form); if (!it) return; const f = el.dataset.f;
      if (f === 'grade') it.grade = el.value;
      else if (f === 'notes') it.notes = el.value;
      else { const v = parseNum(el.value); it[f] = v != null && v > 0 ? { v, c: (it[f] && it[f].c) || S.cur } : null; }
      await saveItem(it); toast('Sparat ✓'); render(); if (f === 'grade' || f === 'my') renderCardSheet(true);
    }
  } catch (err) { console.warn(err); toast('Något gick fel – försök igen'); }
});
document.addEventListener('submit', e => {
  if (e.target.id === 'cform') { e.preventDefault(); submitCustom(e.target); }
  if (e.target.id === 'sform') { e.preventDefault(); submitSet(e.target); }
  if (e.target.id === 'gform') { e.preventDefault(); gradedSubmit(e.target).catch(err => { console.warn(err); toast('Något gick fel – försök igen'); }); }
  if (e.target.id === 'scanform') { e.preventDefault(); if (typeof scanTyped === 'function') scanTyped(); }
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && S.sheet) closeSheet(); });

/* ---------- start ---------- */
(async function start() {
  await DB.open();
  try { await loadIndex(); } catch (e) { $('#app').innerHTML = '<div class="warn">Kunde inte ladda appen. Kontrollera internet och ladda om sidan.</div>'; return; }
  await loadItems(); await loadFx();
  await ensureOwnedSets().catch(() => { });
  render();
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => { }); } catch (e) { }
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => { });
})();
