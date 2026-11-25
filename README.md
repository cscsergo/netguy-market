# NetguY Market

Napi deviza-, arany- és kriptoárfolyamok RON-ban és USD-ben, grafikonnal és átváltóval.

- Devizák: BNR hivatalos árfolyam (Frankfurter API)
- Arany: BNR hivatalos aranyár lej/grammban (cursbnr.ro API, utolsó 10 nap); tartalék: XAUS / Standard Bullion, BNR USD/RON átszámítással
- Kripto (BTC, ETH, CRO): élő ár a CoinGecko-tól; napi előzmény a Coinbase-től, tartalékként CoinGecko és CryptoCompare

Statikus oldal, nincs build lépés: a mappa tartalma közvetlenül telepíthető Netlify-ra
(Build command: üres, Publish directory: `.`).
