# Bronnen en licenties

## 3D-assets

| Asset | Gebruikt voor | Bron | Licentie |
| --- | --- | --- | --- |
| MakeHuman-basismesh **hm08** (`base.obj`) | het menselijk lichaam van alle soldaten (gezicht, handen, lichaamsbouw) | [makehumancommunity/makehuman](https://github.com/makehumancommunity/makehuman), map `makehuman/data/3dobjs` | **CC0 1.0** (sinds 2020, zie `assets-src/makehuman/LICENSE-CC0.md`) |
| MakeHuman-skelet `default.mhskel` en gewichten `default_weights.mhw` | herposeren naar de rustpose van het spel, en de skinning van het lichaam | idem, `makehuman/data/rigs` | **CC0 1.0** |
| MakeHuman-targets `caucasian-male-young`, `universal-male-young-maxmuscle-averageweight` | volwassen, gespierde mannelijke lichaamsbouw | idem, `makehuman/data/targets/macrodetails` | **CC0 1.0** |

De bronbestanden staan in `assets-src/makehuman/`. `scripts/build-human.mjs` zet ze om naar het compacte spelformaat in `src/render/assets/human-data.js` en `human-rig.js`:
- naar de rustpose brengen;
- handen tot een vuist krullen;
- 163 botten samenvoegen tot 20;
- drie detailniveaus maken;
- ambient occlusion bakken.

## Zelf gemaakt (geen externe bestanden)

- **Paarden.** Een signed distance field van vloeiend samengevoegde vormen, omgezet met surface nets en geskind op het paardenskelet (`scripts/build-horse.mjs`).
- **Kleding, harnassen, gezichten en haar.** Geschilderd in de UV-ruimte van het lichaam op basis van 3D-positie (`src/render/human.js`).
- **Helmen, schilden, wapens en belegeringstuig.** Opgebouwd uit geometrische vormen (`src/render/models.js`).
- **Overige assets.** Alle texturen, vlaggen, wapens, het geluid en de muziek worden in code gegenereerd.

## Gereedschap (npm)

- **three.js:** MIT.
- **meshoptimizer:** MIT, alleen gebruikt bij het bouwen.
- **Vite, Vitest:** MIT.
- **Capacitor:** MIT.

## Niet gebruikt

Mixamo, Quaternius, Kenney en Poly Haven waren vanuit de bouwomgeving niet bereikbaar. Er is niets van gebruikt.
