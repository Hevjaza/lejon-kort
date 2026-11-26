# Lejon Kort

iPhone-vänlig webbapp (PWA) för att samla **Pokémon, One Piece, fotbolls-, basket- och hockeykort** – med set, Masterset-varianter, egen samling, foton, priser och backup. Allt sparas lokalt i telefonen (IndexedDB).

**Öppna:** https://hevjaza.github.io/lejon-kort/ → Safari → Dela → *Lägg till på hemskärmen*.

## Datakällor (inga påhittade priser)
| Kategori | Checklistor | Priser |
|---|---|---|
| Pokémon | [TCGdex](https://tcgdex.dev) (populära set färdigladdade, alla andra live) | Cardmarket (EUR) + TCGplayer (USD) via TCGdex |
| One Piece | [OPTCG API](https://optcgapi.com) (boosters, extra boosters, premium boosters, startdäck) | Marknadspris (USD) via OPTCG API |
| Fotboll | [soccr.cloud](https://www.soccr.cloud) checklistor | Ingen gratis API → *Kolla livepris* (eBay sålda, 130point, PriceCharting, Tradera) + eget pris |
| Basket, Hockey | [Checklist Insider](https://www.checklistinsider.com) checklistor | Som ovan |

Växelkurser: exchangerate-api.com (open.er-api.com).

## Uppdatera setdata
```
cd tools
python3 build_pokemon.py      # TCGdex – set + priser
python3 build_onepiece.py     # OPTCG API – set + priser
python3 build_sports.py       # från nedladdade checklistor i tools/sources/ (ingår inte i repot)
python3 build_index.py        # data/index.json + växelkurs
```

## v2 (2026-11-26)
- 📷 **Kortskanning** (kamera eller bild, OCR på telefonen med Tesseract.js) – läser kortnummer (199/165), setkod (SV2a, S12a), One Piece-koder (OP05-119) och PSA/BGS/CGC-etiketter. Sökruta för att skriva koden direkt.
- 🏅 **Ogradat och Graderat** som separata exemplar (PSA/BGS/CGC/TAG, betyg, cert, köppris, värde, foto).
- 💰 Tydligare priser och **Kolla pris** med graderingsval i varje kort.
- 🇯🇵 **Japanska kort**: 36 japanska Pokémon-set (TCGdex `/v2/ja`, Cardmarket-pris för japansk utgåva) + alla andra live; One Piece EN/JP-växel med egen JP-samling och JP-prislänkar (SNKRDUNK, Yuyu-tei, PriceCharting, eBay sålda).
- ¥ **JPY** i valutaväljaren (live-kurs från open.er-api.com).
