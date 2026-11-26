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
