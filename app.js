/* NetguY Market 2.0 – felület. */
(() => {
  'use strict';
  const { loadAll, fxAt, back } = window.MarketData;

  /* ---------- Eszközök ---------- */
  const GROUPS = [
    { id: 'fx', title: 'Devizák', sub: 'BNR hivatalos árfolyam · RON', syms: ['EUR', 'USD', 'GBP', 'HUF'] },
    { id: 'XAU', title: 'Nemesfém', sub: 'Spot ár · RON', syms: ['XAU'] },
    { id: 'crypto', title: 'Kripto', sub: 'Piaci ár', syms: ['BTC', 'ETH'] }
  ];
  const META = {
    EUR: { name: 'Euró', badge: '€', unit: 1, unitLabel: '1 EUR', dig: 4, group: 'fx', kind: 'fx' },
    USD: { name: 'Amerikai dollár', badge: '$', unit: 1, unitLabel: '1 USD', dig: 4, group: 'fx', kind: 'fx' },
    GBP: { name: 'Angol font', badge: '£', unit: 1, unitLabel: '1 GBP', dig: 4, group: 'fx', kind: 'fx' },
    HUF: { name: 'Magyar forint', badge: 'Ft', unit: 100, unitLabel: '100 HUF', dig: 4, group: 'fx', kind: 'fx' },
    XAU: { name: 'Arany', badge: 'Au', unit: 1, unitLabel: '1 gramm · 24K', dig: 2, group: 'XAU', kind: 'gold' },
    BTC: { name: 'Bitcoin', badge: '₿', unit: 1, unitLabel: '1 BTC', dig: 2, group: 'BTC', kind: 'crypto' },
    ETH: { name: 'Ethereum', badge: 'Ξ', unit: 1, unitLabel: '1 ETH', dig: 2, group: 'ETH', kind: 'crypto' }
  };
  const NOTES = {
    fx: 'Hivatalos BNR referencia-árfolyam. Hétvégén és ünnepnapon nincs új jegyzés.',
    gold: 'Nemzetközi spot ár USD/unciában, a napi BNR USD/RON árfolyammal grammra és lejre átszámítva.',
    crypto: 'Napi záróár (UTC); a mai érték az aktuális piaci ár.'
  };
  const RANGES = [[7, '7N'], [30, '1H'], [90, '3H'], [180, '6H'], [365, '1É']];
  const STORE = 'netguy-market-v2';
  const PREFS = 'netguy-market-prefs';
  const STALE_MS = 10 * 60e3;

  /* ---------- Állapot ---------- */
  const prefs = Object.assign({ range: 30, cryptoCur: 'USD', from: 'EUR', to: 'RON', amount: '100' }, readJSON(PREFS));
  const state = {
    assets: {},
    groups: { fx: idle(), XAU: idle(), BTC: idle(), ETH: idle() },
    loading: false,
    lastRefresh: 0,
    route: undefined,
    homeScroll: 0,
    tableLimit: 20,
    errOpen: false
  };
  function idle() { return { status: 'idle', error: null }; }

  const $ = id => document.getElementById(id);
  function readJSON(key) { try { return JSON.parse(localStorage.getItem(key)) || {}; } catch (e) { return {}; } }
  function writeJSON(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* tele vagy tiltva */ } }
  const savePrefs = () => writeJSON(PREFS, prefs);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------- Formázás ---------- */
  const nfCache = new Map();
  const nf = (min, max = min) => {
    const k = min + ':' + max;
    if (!nfCache.has(k)) nfCache.set(k, new Intl.NumberFormat('hu-HU', { minimumFractionDigits: min, maximumFractionDigits: max }));
    return nfCache.get(k);
  };
  const fmt = (v, d) => Number.isFinite(v) ? nf(d).format(v) : '–';
  const signed = (v, d) => !Number.isFinite(v) ? '–' : (v > 0 ? '+' : v < 0 ? '−' : '±') + nf(d).format(Math.abs(v));
  const pct = v => !Number.isFinite(v) ? '–' : (v >= 0.005 ? '+' : v <= -0.005 ? '−' : '±') + nf(2).format(Math.abs(v)) + '%';
  const dir = v => !Number.isFinite(v) || Math.abs(v) < 1e-12 ? 'flat' : v > 0 ? 'up' : 'down';
  function smart(v) {
    if (!Number.isFinite(v)) return '–';
    const a = Math.abs(v);
    if (a >= 100) return nf(2).format(v);
    if (a >= 1) return nf(2, 4).format(v);
    if (a === 0) return '0';
    const d = Math.min(10, Math.max(4, 3 - Math.floor(Math.log10(a)) + 2));
    return nf(0, d).format(v);
  }
  const dateObj = iso => new Date(iso + 'T12:00:00Z');
  const fDate = (iso, o) => dateObj(iso).toLocaleDateString('hu-HU', Object.assign({ timeZone: 'UTC' }, o));
  const longDate = iso => fDate(iso, { year: 'numeric', month: 'long', day: 'numeric' });
  const shortDate = iso => fDate(iso, { month: 'short', day: 'numeric' });
  const dayName = iso => fDate(iso, { weekday: 'long' });
  const timeOf = t => new Date(t).toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Bucharest' });

  /* ---------- Adatnézetek ---------- */
  function view(sym) {
    const a = state.assets[sym];
    if (!a || !a.series || !a.series.length) return null;
    const m = META[sym];
    let s = a.series, cur = a.cur;
    if (m.unit !== 1) s = s.map(p => ({ d: p.d, v: p.v * m.unit }));
    if (m.kind === 'crypto' && prefs.cryptoCur === 'RON' && state.assets.USD) {
      const usd = state.assets.USD.series;
      s = s.map(p => { const fx = fxAt(usd, p.d); return fx ? { d: p.d, v: p.v * fx } : null; }).filter(Boolean);
      cur = 'RON';
      if (!s.length) return null;
    }
    const last = s[s.length - 1], prev = s[s.length - 2] || null;
    const delta = prev ? last.v - prev.v : NaN;
    return { s, cur, last, prev, delta, deltaPct: prev ? delta / prev.v * 100 : NaN, asset: a };
  }
  function sliceRange(s, days) {
    if (!s.length) return s;
    const from = back(s[s.length - 1].d, days);
    let i = s.findIndex(p => p.d >= from);
    if (i > 0) i -= 1; // a tartomány elejénél egy ponttal korábbról indulunk, hogy a változás pontos legyen
    return s.slice(Math.max(0, i));
  }
  function changeOver(s, days) {
    const r = sliceRange(s, days);
    if (r.length < 2) return NaN;
    return (r[r.length - 1].v - r[0].v) / r[0].v * 100;
  }
  /* 1 egység RON-ban, az átváltóhoz. */
  function ronPer(code) {
    if (code === 'RON') return 1;
    const a = state.assets[code];
    if (!a || !a.series.length) return NaN;
    const v = a.series[a.series.length - 1].v;
    if (a.cur === 'RON') return v;
    const usd = state.assets.USD;
    return usd && usd.series.length ? v * usd.series[usd.series.length - 1].v : NaN;
  }

  /* ---------- Gyorsítótár ---------- */
  function loadCache() {
    const c = readJSON(STORE);
    if (c && c.assets) {
      for (const [k, a] of Object.entries(c.assets)) if (a && Array.isArray(a.series) && a.series.length) state.assets[k] = a;
      state.lastRefresh = 0; // a mentett adatot mindig frissítjük indításkor
      state.cachedAt = c.savedAt || 0;
    }
  }
  const saveCache = () => writeJSON(STORE, { savedAt: Date.now(), assets: state.assets });

  /* ---------- Frissítés ---------- */
  async function refresh() {
    if (state.loading) return;
    state.loading = true;
    for (const g of Object.values(state.groups)) { g.status = 'loading'; g.error = null; }
    renderStatus();
    document.body.classList.add('is-loading');
    const usdFallback = state.assets.USD && state.assets.USD.series;
    await loadAll((key, val, err) => {
      const g = state.groups[key];
      if (val) {
        const now = Date.now();
        for (const [sym, a] of Object.entries(val)) state.assets[sym] = Object.assign({}, a, { fetchedAt: now });
        g.status = 'ok';
        saveCache();
      } else {
        g.status = 'error';
        g.error = (err && err.message) || 'ismeretlen hiba';
      }
      render(key);
    }, { usdFallback });
    state.loading = false;
    state.lastRefresh = Date.now();
    document.body.classList.remove('is-loading');
    renderStatus();
  }

  /* ---------- Fejléc állapot ---------- */
  const GROUP_NAMES = { fx: 'BNR-devizák', XAU: 'Arany', BTC: 'Bitcoin', ETH: 'Ethereum' };
  function renderStatus() {
    const btn = $('status'), txt = $('statusText');
    const errs = Object.entries(state.groups).filter(([, g]) => g.status === 'error');
    let cls, text;
    if (state.loading) { cls = 'loading'; text = 'Frissítés…'; }
    else if (!navigator.onLine) { cls = 'warn'; text = 'Offline · mentett adat'; }
    else if (errs.length) { cls = 'warn'; text = `${errs.length} forrás nem elérhető`; }
    else if (state.lastRefresh) { cls = 'ok'; text = 'Frissítve ' + timeOf(state.lastRefresh); }
    else { cls = 'loading'; text = 'Betöltés…'; }
    btn.className = 'status ' + cls;
    txt.textContent = text;
    btn.setAttribute('aria-expanded', String(state.errOpen && errs.length > 0));
    $('refreshBtn').classList.toggle('spin', state.loading);
    const panel = $('errPanel');
    if (state.errOpen && errs.length) {
      panel.hidden = false;
      panel.innerHTML = '<ul>' + errs.map(([k, g]) =>
        `<li><b>${GROUP_NAMES[k]}:</b> ${esc(g.error)}${hasAny(k) ? ' – a legutóbb mentett adatot mutatjuk.' : ''}</li>`).join('') +
        '</ul><button class="btn" type="button" data-act="retry">Újrapróbálás</button>';
    } else panel.hidden = true;
  }
  const symsOfGroup = k => k === 'fx' ? ['EUR', 'USD', 'GBP', 'HUF'] : [k];
  const hasAny = k => symsOfGroup(k).some(s => state.assets[s]);

  /* ---------- Sparkline ---------- */
  function spark(s, cls) {
    if (!s || s.length < 2) return '<span class="spark"></span>';
    const W = 96, H = 32;
    let lo = Infinity, hi = -Infinity;
    for (const p of s) { if (p.v < lo) lo = p.v; if (p.v > hi) hi = p.v; }
    if (hi === lo) { hi += 1; lo -= 1; }
    const pts = s.map((p, i) => `${(i / (s.length - 1) * W).toFixed(1)},${(2 + (hi - p.v) / (hi - lo) * (H - 4)).toFixed(1)}`);
    return `<svg class="spark ${cls}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">` +
      `<polyline points="${pts.join(' ')}" fill="none" vector-effect="non-scaling-stroke"/></svg>`;
  }

  /* ---------- Kezdőlap ---------- */
  function groupState(sym) { return state.groups[META[sym].group]; }

  function rowHtml(sym) {
    const m = META[sym], v = view(sym), g = groupState(sym);
    const badge = `<span class="badge b-${sym.toLowerCase()}" aria-hidden="true">${m.badge}</span>`;
    if (!v) {
      if (g.status === 'error') {
        return `<li><div class="row row-err">${badge}<span class="row-name"><b>${m.name}</b><small>${esc(g.error)}</small></span>` +
          `<button class="btn btn-sm" type="button" data-act="retry">Újra</button></div></li>`;
      }
      return `<li><div class="row row-skel" aria-hidden="true">${badge}<span class="row-name"><b>${m.name}</b><small>${m.unitLabel}</small></span>` +
        `<span class="spark"></span><span class="skel w1"></span><span class="skel w2"></span></div></li>`;
    }
    const s30 = sliceRange(v.s, 30), ch30 = changeOver(v.s, 30);
    const dg = m.kind === 'crypto' ? 2 : m.dig;
    const stale = g.status === 'error' ? ' <span class="tag">mentett</span>' : '';
    const liveTag = v.asset.live && v.last.d === MarketData.todayRO() ? '<span class="live" title="Aktuális ár"></span>' : '';
    const unit = m.kind === 'crypto' ? `${m.unitLabel}` : m.unitLabel;
    return `<li><a class="row" href="#${sym}" aria-label="${m.name}: ${fmt(v.last.v, dg)} ${v.cur}, ${pct(v.deltaPct)}">` +
      badge +
      `<span class="row-name"><b>${m.name}</b><small>${unit} · ${shortDate(v.last.d)}${stale}</small></span>` +
      spark(s30, dir(ch30)) +
      `<span class="row-val"><b class="num">${liveTag}${fmt(v.last.v, dg)}</b><small>${v.cur}</small></span>` +
      `<span class="chip ${dir(v.delta)}" title="Változás az előző jegyzéshez képest">${pct(v.deltaPct)}</span>` +
      `</a></li>`;
  }

  function renderHome() {
    $('today').textContent = new Date().toLocaleDateString('hu-HU', {
      timeZone: 'Europe/Bucharest', year: 'numeric', month: 'long', day: 'numeric', weekday: 'long'
    });
    $('lists').innerHTML = GROUPS.map(gr => {
      const sub = gr.id === 'crypto'
        ? `<span class="seg seg-mini" role="group" aria-label="Kripto pénznem">${['USD', 'RON'].map(c =>
          `<button type="button" data-cur="${c}" aria-pressed="${prefs.cryptoCur === c}">${c}</button>`).join('')}</span>`
        : `<span class="group-sub">${gr.sub}</span>`;
      return `<section class="group"><div class="group-head"><h2>${gr.title}</h2>${sub}</div>` +
        `<ul class="rows">${gr.syms.map(rowHtml).join('')}</ul></section>`;
    }).join('');
    renderConverter();
  }

  /* ---------- Átváltó ---------- */
  const CONV = [['RON', 'Román lej'], ['EUR', 'Euró'], ['USD', 'Amerikai dollár'], ['GBP', 'Angol font'], ['HUF', 'Magyar forint'],
    ['XAU', 'Arany (gramm)'], ['BTC', 'Bitcoin'], ['ETH', 'Ethereum']];
  function initConverter() {
    const opts = CONV.map(([c, n]) => `<option value="${c}">${c} – ${n}</option>`).join('');
    $('cFrom').innerHTML = opts; $('cTo').innerHTML = opts;
    $('cFrom').value = prefs.from; $('cTo').value = prefs.to; $('cAmt').value = prefs.amount;
    $('cAmt').addEventListener('input', () => { prefs.amount = $('cAmt').value; savePrefs(); renderConverter(); });
    $('cFrom').addEventListener('change', () => { prefs.from = $('cFrom').value; savePrefs(); renderConverter(); });
    $('cTo').addEventListener('change', () => { prefs.to = $('cTo').value; savePrefs(); renderConverter(); });
    $('cSwap').addEventListener('click', () => {
      [prefs.from, prefs.to] = [prefs.to, prefs.from];
      $('cFrom').value = prefs.from; $('cTo').value = prefs.to; savePrefs(); renderConverter();
    });
  }
  function parseAmount(s) {
    const t = String(s).replace(/[\s ]/g, '').replace(',', '.');
    return t === '' ? NaN : Number(t);
  }
  function renderConverter() {
    const amt = parseAmount($('cAmt').value);
    const a = ronPer(prefs.from), b = ronPer(prefs.to);
    const out = $('cOut'), rate = $('cRate');
    $('cAmt').classList.toggle('invalid', $('cAmt').value.trim() !== '' && !Number.isFinite(amt));
    if (!Number.isFinite(a) || !Number.isFinite(b)) {
      out.textContent = '–'; rate.textContent = 'Az árfolyam még töltődik vagy nem elérhető.'; return;
    }
    const r = a / b;
    out.innerHTML = Number.isFinite(amt) ? `${smart(amt * r)} <small>${prefs.to}</small>` : '–';
    rate.textContent = `1 ${prefs.from} = ${smart(r)} ${prefs.to}` + (prefs.from !== prefs.to ? ` · 1 ${prefs.to} = ${smart(1 / r)} ${prefs.from}` : '');
  }

  /* ---------- Részletek ---------- */
  function renderDetail(sym) {
    const host = $('detail');
    const m = META[sym], v = view(sym), g = groupState(sym);
    const badge = `<span class="badge badge-lg b-${sym.toLowerCase()}" aria-hidden="true">${m.badge}</span>`;
    const curToggle = m.kind === 'crypto'
      ? `<span class="seg" role="group" aria-label="Pénznem">${['USD', 'RON'].map(c =>
        `<button type="button" data-cur="${c}" aria-pressed="${prefs.cryptoCur === c}">${c}</button>`).join('')}</span>` : '';
    const head = `<a class="back" href="#">← Árfolyamok</a>` +
      `<header class="d-head">${badge}<div class="d-title"><h1>${m.name}</h1><p>${sym}/${v ? v.cur : (m.kind === 'crypto' ? prefs.cryptoCur : 'RON')} · ${m.unitLabel}</p></div>${curToggle}</header>`;

    if (!v) {
      host.innerHTML = head + (g.status === 'error'
        ? `<div class="card empty-card"><p>Ez az árfolyam most nem érhető el.</p><p class="muted">${esc(g.error)}</p><button class="btn" data-act="retry" type="button">Újrapróbálás</button></div>`
        : `<div class="card empty-card"><div class="loader" aria-label="Betöltés"></div></div>`);
      return;
    }
    const dg = m.kind === 'crypto' ? 2 : m.dig;
    const range = prefs.range;
    const r = sliceRange(v.s, range);
    const first = r[0], last = r[r.length - 1];
    let lo = r[0], hi = r[0], sum = 0;
    for (const p of r) { if (p.v < lo.v) lo = p; if (p.v > hi.v) hi = p; sum += p.v; }
    const rChange = last.v - first.v, rPct = rChange / first.v * 100;
    const today = MarketData.todayRO();
    const asOf = v.asset.live && v.last.d === today ? 'Aktuális ár · ' + timeOf(v.asset.fetchedAt || Date.now()) : 'Jegyzés: ' + longDate(v.last.d) + ', ' + dayName(v.last.d);
    const quick = RANGES.map(([d, l]) => {
      const c = changeOver(v.s, d);
      return `<li><span>${l}</span><b class="${dir(c)}">${pct(c)}</b></li>`;
    }).join('');

    host.innerHTML = head +
      `<div class="d-top">
        <div class="d-price">
          <div class="d-num"><span class="num">${fmt(v.last.v, dg)}</span><span class="cur">${v.cur}</span></div>
          <p class="d-change"><span class="chip ${dir(v.delta)}">${signed(v.delta, dg)} · ${pct(v.deltaPct)}</span>
            <span class="muted">${v.prev ? 'előző: ' + shortDate(v.prev.d) : ''}</span></p>
          <p class="muted d-asof">${asOf}${g.status === 'error' ? ' · <span class="tag">mentett adat</span>' : ''}</p>
        </div>
        <ul class="quick" aria-label="Változás időszakonként">${quick}</ul>
      </div>
      <div class="card chart-card">
        <div class="chart-head">
          <div class="seg" role="group" aria-label="Időszak">${RANGES.map(([d, l]) =>
            `<button type="button" data-range="${d}" aria-pressed="${d === range}">${l}</button>`).join('')}</div>
          <span class="chart-sum ${dir(rChange)}">${signed(rChange, dg)} (${pct(rPct)})</span>
        </div>
        <div class="chart" id="chart" role="img" aria-label="${m.name} árfolyama az elmúlt ${range} napban"></div>
        <dl class="stats">
          <div><dt>Nyitó</dt><dd class="num">${fmt(first.v, dg)}</dd><dd class="muted">${shortDate(first.d)}</dd></div>
          <div><dt>Minimum</dt><dd class="num">${fmt(lo.v, dg)}</dd><dd class="muted">${shortDate(lo.d)}</dd></div>
          <div><dt>Maximum</dt><dd class="num">${fmt(hi.v, dg)}</dd><dd class="muted">${shortDate(hi.d)}</dd></div>
          <div><dt>Átlag</dt><dd class="num">${fmt(sum / r.length, dg)}</dd><dd class="muted">${r.length} adatpont</dd></div>
        </dl>
      </div>
      <section class="card hist">
        <div class="hist-head"><h2>Napi adatok</h2><button class="btn btn-sm" type="button" data-act="csv">CSV letöltés</button></div>
        <div id="histTable"></div>
      </section>
      <p class="note">${NOTES[m.kind]}<br>Forrás: ${esc(v.asset.source || '')}</p>`;

    drawChart($('chart'), r, dg, v.cur);
    renderTable(v, r, dg);
  }

  function renderTable(v, r, dg) {
    const idx = new Map(v.s.map((p, i) => [p.d, i]));
    const rows = r.slice().reverse();
    const shown = rows.slice(0, state.tableLimit);
    const body = shown.map(p => {
      const i = idx.get(p.d), prev = i > 0 ? v.s[i - 1] : null;
      const d = prev ? p.v - prev.v : NaN, dp = prev ? d / prev.v * 100 : NaN;
      return `<tr><td>${fDate(p.d, { year: 'numeric', month: 'short', day: 'numeric' })}<small>${dayName(p.d)}</small></td><td class="num">${fmt(p.v, dg)}</td>` +
        `<td class="num ${dir(d)}">${signed(d, dg)}<small>${pct(dp)}</small></td></tr>`;
    }).join('');
    const more = rows.length > shown.length
      ? `<button class="btn btn-ghost more" type="button" data-act="more">Továbbiak (${rows.length - shown.length})</button>` : '';
    $('histTable').innerHTML = `<table><thead><tr><th>Dátum</th><th>Árfolyam (${v.cur})</th><th>Változás</th></tr></thead><tbody>${body}</tbody></table>${more}`;
  }

  function downloadCSV(sym) {
    const v = view(sym); if (!v) return;
    const r = sliceRange(v.s, prefs.range);
    const dg = META[sym].kind === 'crypto' ? 2 : META[sym].dig;
    const lines = ['Dátum;Árfolyam (' + v.cur + ')'].concat(r.map(p => `${p.d};${p.v.toFixed(dg + 2).replace('.', ',')}`));
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `netguy-${sym.toLowerCase()}-${v.cur.toLowerCase()}-${prefs.range}nap.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  /* ---------- Grafikon ---------- */
  let chartObserver = null;
  function drawChart(host, pts, dg, cur) {
    if (chartObserver) chartObserver.disconnect();
    const paint = () => paintChart(host, pts, dg, cur);
    paint();
    let w = host.clientWidth;
    chartObserver = new ResizeObserver(() => { if (host.isConnected && host.clientWidth !== w) { w = host.clientWidth; paint(); } });
    chartObserver.observe(host);
  }
  function paintChart(host, pts, dg, cur) {
    if (pts.length < 2) { host.innerHTML = '<p class="muted chart-empty">Ehhez az időszakhoz nincs elég adat.</p>'; return; }
    const W = Math.max(280, host.clientWidth), H = host.clientHeight || 280;
    const P = { l: 2, r: 62, t: 14, b: 26 };
    const xs = pts.map(p => dateObj(p.d).getTime());
    const x0 = xs[0], x1 = xs[xs.length - 1];
    let lo = Infinity, hi = -Infinity;
    for (const p of pts) { if (p.v < lo) lo = p.v; if (p.v > hi) hi = p.v; }
    if (hi === lo) { lo -= Math.abs(lo) * 0.01 || 1; hi += Math.abs(hi) * 0.01 || 1; }
    const pad = (hi - lo) * 0.1; lo -= pad; hi += pad;
    const iw = W - P.l - P.r, ih = H - P.t - P.b;
    const X = t => P.l + (t - x0) / (x1 - x0) * iw;
    const Y = v => P.t + (hi - v) / (hi - lo) * ih;
    const line = pts.map((p, i) => (i ? 'L' : 'M') + X(xs[i]).toFixed(1) + ' ' + Y(p.v).toFixed(1)).join('');
    const area = line + `L${X(x1).toFixed(1)} ${P.t + ih}L${X(x0).toFixed(1)} ${P.t + ih}Z`;
    const trend = dir(pts[pts.length - 1].v - pts[0].v);
    const tdg = (hi - lo) < 0.05 ? Math.max(dg, 4) : (hi - lo) > 500 ? 0 : dg;
    let grid = '';
    for (let k = 0; k <= 4; k++) {
      const v = lo + (hi - lo) * (k + 0.5) / 5, y = Y(v).toFixed(1);
      grid += `<line x1="${P.l}" x2="${P.l + iw}" y1="${y}" y2="${y}" class="grid"/>` +
        `<text x="${W - 4}" y="${y}" class="axis" text-anchor="end" dominant-baseline="middle">${fmt(v, tdg)}</text>`;
    }
    const nx = W < 420 ? 3 : 5;
    let xl = '';
    for (let k = 0; k < nx; k++) {
      const i = Math.round(k / (nx - 1) * (pts.length - 1));
      const anchor = k === 0 ? 'start' : k === nx - 1 ? 'end' : 'middle';
      xl += `<text x="${X(xs[i]).toFixed(1)}" y="${H - 6}" class="axis" text-anchor="${anchor}">${shortDate(pts[i].d)}</text>`;
    }
    const lastX = X(x1), lastY = Y(pts[pts.length - 1].v);
    host.innerHTML =
      `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" class="t-${trend}" aria-hidden="true">
        <defs><linearGradient id="cg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" class="g0"/><stop offset="1" class="g1"/></linearGradient></defs>
        ${grid}${xl}
        <path d="${area}" fill="url(#cg)"/>
        <path d="${line}" class="line" fill="none"/>
        <circle cx="${lastX.toFixed(1)}" cy="${lastY.toFixed(1)}" r="3.5" class="end"/>
        <g class="cross" visibility="hidden"><line class="cx" y1="${P.t}" y2="${P.t + ih}"/><circle class="cdot" r="5"/></g>
      </svg><div class="tip" hidden></div>`;
    const svg = host.querySelector('svg'), cross = svg.querySelector('.cross'), cx = svg.querySelector('.cx'),
      cdot = svg.querySelector('.cdot'), tip = host.querySelector('.tip');
    const show = clientX => {
      const rect = svg.getBoundingClientRect();
      const mx = (clientX - rect.left) * (W / rect.width);
      const t = x0 + (mx - P.l) / iw * (x1 - x0);
      let lo2 = 0, hi2 = xs.length - 1;
      while (hi2 - lo2 > 1) { const mid = (lo2 + hi2) >> 1; if (xs[mid] < t) lo2 = mid; else hi2 = mid; }
      const i = Math.abs(xs[lo2] - t) <= Math.abs(xs[hi2] - t) ? lo2 : hi2;
      const px = X(xs[i]), py = Y(pts[i].v);
      cross.setAttribute('visibility', 'visible');
      cx.setAttribute('x1', px); cx.setAttribute('x2', px);
      cdot.setAttribute('cx', px); cdot.setAttribute('cy', py);
      const ch = (pts[i].v - pts[0].v) / pts[0].v * 100;
      tip.hidden = false;
      tip.innerHTML = `<span>${longDate(pts[i].d)}</span><b class="num">${fmt(pts[i].v, dg)} ${cur}</b><em class="${dir(ch)}">${pct(ch)} az időszak elejéhez</em>`;
      const scale = rect.width / W;
      const tw = tip.offsetWidth;
      let left = px * scale + 12;
      if (left + tw > rect.width - 4) left = px * scale - tw - 12;
      tip.style.left = Math.max(4, left) + 'px';
      tip.style.top = Math.max(4, Math.min(py * scale - 30, rect.height - tip.offsetHeight - 30)) + 'px';
    };
    const hide = () => { cross.setAttribute('visibility', 'hidden'); tip.hidden = true; };
    host.onpointermove = e => show(e.clientX);
    host.onpointerdown = e => show(e.clientX);
    host.onpointerleave = hide;
  }

  /* ---------- Útvonal és renderelés ---------- */
  function currentSym() {
    const h = decodeURIComponent(location.hash.slice(1)).toUpperCase();
    return META[h] ? h : null;
  }
  function route() {
    const sym = currentSym();
    const was = state.route;
    if (was === null && sym) state.homeScroll = window.scrollY;
    if (sym !== was) state.tableLimit = 20;
    state.route = sym;
    $('home').hidden = !!sym;
    $('detail').hidden = !sym;
    document.title = sym ? `${META[sym].name} – NetguY Market` : 'NetguY Market – Árfolyamok';
    render();
    if (sym && sym !== was) window.scrollTo(0, 0);
    else if (!sym && was) requestAnimationFrame(() => window.scrollTo(0, state.homeScroll));
  }
  function render(changedGroup) {
    renderStatus();
    const sym = state.route;
    if (!sym) { renderHome(); return; }
    // részletnézetben csak akkor rajzolunk újra, ha az aktuális eszközt érinti a frissítés
    const g = META[sym].group;
    if (!changedGroup || changedGroup === g || (changedGroup === 'fx' && META[sym].kind !== 'fx' && prefs.cryptoCur === 'RON') ||
      (changedGroup === 'fx' && sym === 'XAU')) {
      renderDetail(sym);
    }
  }

  /* ---------- Téma ---------- */
  function applyThemeColor() {
    const bg = getComputedStyle(document.body).backgroundColor;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta && bg) meta.setAttribute('content', bg);
  }
  function toggleTheme() {
    const root = document.documentElement;
    const isDark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = isDark ? 'light' : 'dark';
    try { localStorage.setItem('ngm-theme', root.dataset.theme); } catch (e) {}
    applyThemeColor();
    if (state.route) renderDetail(state.route);
  }

  /* ---------- Események ---------- */
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-act],[data-range],[data-cur]');
    if (!t) return;
    if (t.dataset.range) { prefs.range = Number(t.dataset.range); state.tableLimit = 20; savePrefs(); renderDetail(state.route); }
    else if (t.dataset.cur) { prefs.cryptoCur = t.dataset.cur; savePrefs(); render(); }
    else if (t.dataset.act === 'retry') { state.errOpen = false; refresh(); }
    else if (t.dataset.act === 'more') { state.tableLimit += 30; const v = view(state.route); const dg = META[state.route].kind === 'crypto' ? 2 : META[state.route].dig; renderTable(v, sliceRange(v.s, prefs.range), dg); }
    else if (t.dataset.act === 'csv') downloadCSV(state.route);
  });
  $('refreshBtn').addEventListener('click', () => refresh());
  $('themeBtn').addEventListener('click', toggleTheme);
  $('status').addEventListener('click', () => { state.errOpen = !state.errOpen; renderStatus(); });
  window.addEventListener('hashchange', route);
  document.addEventListener('keydown', e => {
    if (e.target.closest('input,select,textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'Escape' && state.route) location.hash = '';
    else if (e.key === 'r' || e.key === 'R') refresh();
  });
  const maybeRefresh = () => { if (!document.hidden && navigator.onLine && Date.now() - state.lastRefresh > STALE_MS) refresh(); };
  document.addEventListener('visibilitychange', maybeRefresh);
  window.addEventListener('online', () => { renderStatus(); refresh(); });
  window.addEventListener('offline', renderStatus);
  setInterval(maybeRefresh, 60e3);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { applyThemeColor(); if (state.route) renderDetail(state.route); });

  /* ---------- Indítás ---------- */
  loadCache();
  initConverter();
  route();
  applyThemeColor();
  refresh();
})();
