/* NetguY Market 2.0 – adatréteg. Kulcs nélküli, CORS-t támogató nyilvános API-k. */
(function (root) {
  'use strict';
  const DAY = 864e5;
  const OZ = 31.1034768;     // gramm / troy uncia
  const KEEP = 372;          // ennyi napot tartunk meg

  const good = v => typeof v === 'number' && Number.isFinite(v) && v > 0;
  const isISO = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
  const isoOf = t => new Date(t).toISOString().slice(0, 10);
  const back = (day, n) => isoOf(Date.parse(day + 'T12:00:00Z') - n * DAY);
  const todayRO = () => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Bucharest', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());

  async function getJSON(url, timeout = 15000) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeout);
    try {
      const res = await fetch(url, { cache: 'no-store', signal: ctl.signal, headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const json = await res.json();
      if (json && json.Response === 'Error') throw new Error(json.Message || 'API-hiba');
      return json;
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('időtúllépés');
      if (e instanceof TypeError) throw new Error('hálózati hiba');
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  /* Dátum szerint rendezett, duplikátummentes, érvényes pontok. Későbbi sor felülírja a korábbit. */
  function clean(rows, today) {
    const from = back(today, KEEP);
    const map = new Map();
    for (const r of rows) {
      if (r && isISO(r.d) && r.d >= from && r.d <= today && good(r.v)) map.set(r.d, r.v);
    }
    return [...map].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([d, v]) => ({ d, v }));
  }

  async function firstOk(tasks) {
    const errs = [];
    for (const task of tasks) {
      try { return await task(); } catch (e) { errs.push(e.message); }
    }
    throw new Error(errs.join('; '));
  }

  /* Legutóbbi USD/RON jegyzés az adott napon vagy legfeljebb 6 nappal előtte (hétvége, ünnep). */
  function fxAt(usd, date) {
    if (!usd || !usd.length) return null;
    const min = back(date, 6);
    let lo = 0, hi = usd.length - 1, idx = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (usd[mid].d <= date) { idx = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return idx >= 0 && usd[idx].d >= min ? usd[idx].v : null;
  }

  /* ---------- BNR devizák ---------- */
  async function loadFX(today) {
    const url = `https://api.frankfurter.dev/v2/providers/bnr/rates?from=${back(today, KEEP)}&to=${today}&base=RON&quotes=EUR,HUF,USD,GBP`;
    const data = await getJSON(url);
    if (!Array.isArray(data)) throw new Error('váratlan BNR-válasz');
    const out = {};
    for (const sym of ['EUR', 'HUF', 'USD', 'GBP']) {
      const rows = data
        .filter(r => r.base === 'RON' && r.quote === sym && good(r.rate))
        .map(r => ({ d: r.date, v: Number((1 / r.rate).toPrecision(6)) }));
      const series = clean(rows, today);
      if (series.length) out[sym] = { series, cur: 'RON', source: 'BNR (Frankfurter)', live: false };
    }
    if (!Object.keys(out).length) throw new Error('nem érkezett BNR-adat');
    return out;
  }

  /* ---------- Arany (RON / gramm) ---------- */
  function goldHistoryUSD() {
    return firstOk([
      async () => {
        const j = await getJSON('https://xaus.com/api/v1/history');
        const rows = (j && j.points || []).map(p => ({ d: String(p.d || p.date || '').slice(0, 10), v: Number(p.c ?? p.close) }));
        if (rows.length < 2) throw new Error('XAUS: üres előzmény');
        return { rows, source: 'XAUS' };
      },
      async () => {
        const j = await getJSON('https://standardbullion.com/api/v1/market/history?metal=XAU&range=1y');
        const rows = (j && j.points || []).map(p => ({ d: String(p.t || '').slice(0, 10), v: Number(p.price) }));
        if (rows.length < 2) throw new Error('Standard Bullion: üres előzmény');
        return { rows, source: 'Standard Bullion' };
      }
    ]);
  }

  async function loadGold(today, usd) {
    const [hist, spot] = await Promise.allSettled([
      goldHistoryUSD(),
      getJSON('https://xaus.com/api/v1/spot?currency=RON&unit=gram')
    ]);
    const rows = [];
    const sources = [];
    if (hist.status === 'fulfilled') {
      sources.push(hist.value.source);
      for (const r of hist.value.rows) {
        const fx = fxAt(usd, r.d);
        if (good(fx) && good(r.v)) rows.push({ d: r.d, v: r.v * fx / OZ });
      }
    }
    let live = false;
    if (spot.status === 'fulfilled') {
      const x = spot.value && spot.value.xau;
      const price = Number(x && x.price);
      const d = String(spot.value && spot.value.updated_at || '').slice(0, 10);
      if (x && x.currency === 'RON' && x.unit === 'gram' && good(price) && isISO(d)) {
        rows.push({ d, v: price });
        live = true;
        if (!sources.includes('XAUS')) sources.push('XAUS spot');
      }
    }
    const series = clean(rows, today);
    if (!series.length) {
      throw new Error(hist.status === 'rejected' ? hist.reason.message : 'nincs aranyár');
    }
    return { series, cur: 'RON', source: sources.join(' + ') + ' · USD→RON (BNR)', live };
  }

  /* ---------- Kripto (USD) ---------- */
  function cryptoHistory(sym, today) {
    return firstOk([
      async () => {
        // Coinbase: legfeljebb 300 gyertya / kérés → két részlet.
        const end = Date.parse(today + 'T00:00:00Z') + DAY;
        const start = end - KEEP * DAY;
        const mid = start + Math.round(KEEP / 2) * DAY;
        const base = `https://api.exchange.coinbase.com/products/${sym}-USD/candles?granularity=86400`;
        const parts = await Promise.all([[start, mid], [mid, end]].map(([a, b]) =>
          getJSON(`${base}&start=${new Date(a).toISOString()}&end=${new Date(b).toISOString()}`)));
        const rows = parts.flat()
          .filter(c => Array.isArray(c) && c.length >= 5)
          .map(c => ({ d: isoOf(Number(c[0]) * 1000), v: Number(c[4]) }));
        if (rows.length < 2) throw new Error('Coinbase: üres');
        return { rows, source: 'Coinbase' };
      },
      async () => {
        const j = await getJSON(`https://min-api.cryptocompare.com/data/v2/histoday?fsym=${sym}&tsym=USD&limit=${KEEP}&extraParams=NetguYMarket`);
        const c = j && j.Data && j.Data.Data;
        if (!Array.isArray(c) || c.length < 2) throw new Error('CryptoCompare: üres');
        return { rows: c.map(k => ({ d: isoOf(k.time * 1000), v: Number(k.close) })), source: 'CryptoCompare' };
      }
    ]);
  }

  function cryptoSpot(sym) {
    return firstOk([
      async () => {
        const j = await getJSON(`https://api.exchange.coinbase.com/products/${sym}-USD/ticker`, 8000);
        const p = Number(j && j.price);
        if (!good(p)) throw new Error('Coinbase: nincs ár');
        return p;
      },
      async () => {
        const j = await getJSON(`https://min-api.cryptocompare.com/data/price?fsym=${sym}&tsyms=USD&extraParams=NetguYMarket`, 8000);
        const p = Number(j && j.USD);
        if (!good(p)) throw new Error('CryptoCompare: nincs ár');
        return p;
      }
    ]);
  }

  async function loadCrypto(sym, today) {
    const [hist, spot] = await Promise.all([cryptoHistory(sym, today), cryptoSpot(sym).catch(() => null)]);
    const rows = hist.rows.slice();
    let live = false;
    if (good(spot)) { rows.push({ d: today, v: spot }); live = true; }
    const series = clean(rows, today);
    if (!series.length) throw new Error('nincs használható adat');
    return { series, cur: 'USD', source: hist.source + ' · USD', live };
  }

  /*
   * Minden forrás párhuzamosan indul; ami megérkezik, azonnal jelentjük (onPart),
   * így a felület fokozatosan töltődik fel. Csoportok: fx, XAU, BTC, ETH.
   */
  function loadAll(onPart, opts = {}) {
    const today = todayRO();
    const fxP = loadFX(today);
    const jobs = {
      fx: fxP,
      XAU: fxP.catch(() => null).then(fx => {
        const usd = fx && fx.USD ? fx.USD.series : opts.usdFallback;
        if (!usd || !usd.length) throw new Error('USD/RON adat nélkül nem számolható');
        return loadGold(today, usd).then(g => ({ XAU: g }));
      }),
      BTC: loadCrypto('BTC', today).then(r => ({ BTC: r })),
      ETH: loadCrypto('ETH', today).then(r => ({ ETH: r }))
    };
    return Promise.all(Object.entries(jobs).map(([key, p]) =>
      p.then(v => onPart(key, v, null), e => onPart(key, null, e))));
  }

  root.MarketData = { loadAll, fxAt, back, todayRO, isoOf };
})(typeof window !== 'undefined' ? window : globalThis);
