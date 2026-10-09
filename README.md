# Fetih 1453 ⚔️

Een 3D-belegeringsgame voor **iOS, Android en de browser**, rond het beleg van Constantinopel in 1453.
Zes historische machten vechten met wapens uit die tijd om elkaars forten: van bogen en kruisbogen tot
haakbussen, Grieks vuur, stormrammen, belegeringstorens en de bombarde van Urban.

## De zes machten

| Rijk | Leider | Speelstijl | Bijzondere troepen |
| --- | --- | --- | --- |
| Ottomaanse Rijk | Sultan **Mehmed II** | grote legers, zware artillerie | azaps, janitsaren (börk), tüfekçi, sipahi's, bombarde van Urban |
| Byzantijnse Rijk | Keizer **Constantijn XI** | verdediger, dubbele Theodosiaanse muur met gracht | skoutatoi, toxotai, Grieks vuur, kataphrakten |
| Republiek Genua | **Giovanni Giustiniani Longo** | elite-kruisboogschutters met pavese | balestrieri, lancieri, armigeri |
| Republiek Venetië | Bailo **Girolamo Minotto** | gemengd, schutters en mariniers | balestrieri, schioppettieri, marinai, cavalieri |
| Servisch Despotaat | Despoot **Đurađ Branković** | veel goedkope troepen, mijnwerkers | pešaci, strelci, kopijruiters, rudari (mineurs) |
| Koninkrijk Hongarije | **János Hunyadi** | pieken, vroege vuurwapens, zware ridders | piekeniers, kruisboogschutters, puskások, huszárok, ridders |

Historische noot: Branković en Hunyadi waren in 1453 zelf niet bij het beleg. De Servische hulptroepen
vochten aan Ottomaanse zijde; Hongarije was de grote christelijke tegenstander op de Balkan.

## Het spel

- **Opzet:** kies 2–6 rijken, *historische allianties* (christenen tegen Ottomanen en hun Servische vazal)
  of *ieder voor zich*. Kies daarna moeilijkheid (makkelijk/normaal/moeilijk), lengte
  (kort ±15, normaal ±20–25, lang ±30+ minuten) en legergrootte (klein 25, normaal 60, groot 120 per team).
  Een kleinere alliantie krijgt automatisch meer troepen, zodat 1 tegen 2 nog een eerlijk gevecht is.
- **Rol:** vóór elk potje kies je wat je wordt: elke soldaat uit de selectie van je rijk, of de **leider** zelf.
  Na het sneuvelen kun je een andere rol kiezen.
- **Fases:** 1 *Opmars & belegering* → 2 *Bres* (de eerste muur, toren of poort valt) → 3 *Strijd om de donjon*.
  Na 75% van de tijd begint de *finale* en is een donjon makkelijker in te nemen.
- **Winnen:** neem de **donjon** van elke vijand in (meer aanvallers dan verdedigers in de binnenplaats;
  een levende leider telt als vier verdedigers). Loopt de tijd af, dan wint de kant met de meeste punten.
- **Forten:** muren, torens en poorten hebben levenspunten. Zwaarden doen er bijna niets tegen. Je hebt
  stormrammen, bombardes, blijdes, mineurs of een belegeringstoren nodig.
- **Golven:** elk rijk rekruteert om de ±24 s nieuwe troepen uit zijn mankracht. Veroverde dorpen
  (vlaggen op het veld) geven extra inkomen. Een fort met een bres krijgt eerst extra rekruten en raakt daarna uitgeput.
- **Leiders** hebben meer levenspunten, een aura, een **strijdkreet** en een levensbalk boven het hoofd.
  Sneuvelt een leider, dan zakt het moreel van zijn leger fors; na 2,5 minuut keert hij terug.
- **AI:** squads in formatie, schutters houden afstand, ruiters chargeren en draaien weg, gezette speren
  breken charges, verdedigers bemannen muren en poorten, en de commandant kiest wanneer hij aanvalt, verovert of verdedigt.

### Wapens en tegenwapens

| Wapen | Sterk tegen | Zwak tegen |
| --- | --- | --- |
| Speer · piek · hellebaard | ruiters (gezet breekt dat een charge) | boog- en kruisboogschutters |
| Lans (te paard) | schutters, licht voetvolk | speren en pieken van voren |
| Turkse composietboog | licht gepantserden; snel en ver | zwaar pantser, schilden |
| Kruisboog | pantser (traag herladen) | snelle ruiters |
| Haakbus / handkanon | alles (veel schade, rook) | zeer traag herladen |
| Knots · strijdbijl · houweel | zwaar pantser (houweel ook muren) | speren (bereik) |
| Kılıç · spathion · zwaarden | licht voetvolk, snel | plaatharnas |
| Werpspies | schilden en ruiters op korte afstand | weinig munitie |
| Grieks vuur | groepen, rammen, torens, poorten | afstand |
| Bombarde · blijde · ram · toren | muren en poorten | ruiters en voetvolk die ze aanvallen |

## Besturing

| Desktop | Mobiel |
| --- | --- |
| WASD lopen, Shift rennen | linkerkant slepen (ver duwen = rennen) |
| Muis richten (klik eerst in het spel) | rechterkant slepen |
| Linkermuisknop aanvallen / schieten | **AANVAL** ingedrukt houden |
| Q, muiswiel, 1 / 2: wapen wisselen | ⇄ |
| E: ladder op/af de muur (in je eigen fort) | ⇅ |
| R: strijdkreet (als leider) | 📯 |
| Esc / P: pauze | ❚❚ |

## Starten

### Snelle demo (Windows/Mac/Linux)

Dubbelklik op `demo/fetih-1453.html`. Het hele spel zit in dat ene bestand en start in
Chrome, Edge of Firefox, ook zonder internet. Opnieuw maken na wijzigingen: `npm run build:demo`.

### Ontwikkelen

Vereist Node.js 20+.

```bash
npm install
npm run dev          # speel in de browser (ook op je telefoon via het netwerkadres)
npm test             # automatische tests (Vitest)
npm run simulate -- --teams ottoman,byzantine --troops normal --length normal --seed 1
node scripts/sweep.mjs --set pairs --seeds 2   # alle 15 tweetallen, parallel, zonder scherm
node scripts/sweep.mjs --set multi --seeds 2   # 3–6 teams, allianties en ieder voor zich
```

### Android

Vereist Android Studio (met JDK 21).

```bash
npm run android      # bouwt, synchroniseert en opent Android Studio → ▶ Run
```

Zonder Android Studio: elke push bouwt via GitHub Actions automatisch een APK
(**Actions → Build apps → artifact `fetih-1453-android-apk`**). Die kun je direct op een
Android-telefoon installeren (sta "installeren uit onbekende bronnen" toe).

### iOS

Vereist een Mac met Xcode.

```bash
npm run ios          # bouwt, synchroniseert en opent Xcode
```

Kies in Xcode bij *Signing & Capabilities* je eigen team (Apple ID) en druk op ▶.
Na elke codewijziging: `npm run cap:sync`.

## Techniek

- **Three.js** voor de 3D-wereld. Alle soldaten, paarden, forten en vlaggen worden in code opgebouwd (geen externe 3D-bestanden).
- **Simulatie los van rendering:** `src/sim` is pure JavaScript zonder scherm en volledig deterministisch (seed).
  Daardoor kunnen tests en balanssimulaties honderden complete veldslagen in Node draaien.
- **GPU-crowd-renderer:** één instanced draw call per soldaattype en LOD-niveau. De skeletten (18 botten
  voor mensen, 12 voor paarden) staan in een datatextuur, zodat honderden soldaten soepel bewegen.
- **Navigatie:** flow fields per doel en alliantie (in tijdsplakken berekend), obstakelraster met DDA-raycasts.
- **Capacitor 8** verpakt dezelfde code als native app voor iOS (`ios/`) en Android (`android/`).
- Geluid en muziek (mehter of Byzantijns koraal) worden live gesynthetiseerd met de Web Audio API.

```
src/
  sim/        data.js (wapens, eenheden, leiders, facties) · map.js (forten, kaart) · match.js (spelregels,
              gevecht, economie, fases) · ai.js (commandant, squads, eenheden, belegeringstuig) · nav.js · geom.js
  render/     view.js (scène, camera, effecten-koppeling) · crowd.js (instanced skinning) · rig.js (skeletten,
              animaties, IK) · models.js (modellen per eenheid) · world.js (terrein, forten) · fx.js · textures.js
  ui/hud.js   HUD, minimap, leiderbalken, aankondigingen
  main.js     menu's, opzet, rolkeuze, pauze, instellingen, uitslag
  controls.js touch + toetsenbord/muis
  audio.js    geluid en muziek
tests/        Vitest-tests
scripts/      simulate.mjs, sweep.mjs, build-demo.mjs
```
