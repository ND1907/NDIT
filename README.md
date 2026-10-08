# Fetih 1453 ⚔️

Een 3D-actiegame voor **iOS en Android**: het **Ottomaanse Rijk** tegen het **Byzantijnse Rijk**
tijdens de belegering van Constantinopel. Alleen wapens uit die tijd: boog en pijlen, zwaarden, schilden en paarden.

- **Ottomanen** – janitsaren (rode kaftan, witte börk-muts) met de Turkse reflexboog en de gebogen **kılıç**-sabel;
  **sipahi**-ruiters te paard.
- **Byzantijnen** – soldaten in lamellair harnas met spitse helm, boog en het rechte **spathion**-zwaard met rond
  schild (vangt zwaardslagen van voren deels op); **kataphrakten** te paard.

Elk team heeft een eigen **fort** met muren, ronde torens, een hoofdpoort en twee zijpoorten, een donjon,
een stal met paarden en een blijde (trebuchet). Daartussen ligt het slagveld.
Je speelt 8 tegen 8 (jij + 7 AI-strijders: boogschutters, voetvolk en ruiters). Het eerste team met **30 kills** wint.

- Pijlen vliegen echt, in een boog door de zwaartekracht, en blijven steken in muren, bomen en paarden.
- Je pijlkoker (24 pijlen) vult zich weer aan binnen je eigen fort.
- Ruiters slaan harder in galop en vertrappen vijanden.

## Besturing

| Mobiel | Desktop |
| --- | --- |
| Linkerkant slepen: lopen (ver duwen = sprinten) | WASD lopen, Shift sprinten |
| Rechterkant slepen: richten | Muis richten |
| **AANVAL** ingedrukt houden (en slepen om te richten) | Linkermuisknop: schieten / slaan |
| ⇄ boog ↔ zwaard | Q of muiswiel (1 = zwaard, 2 = boog) |
| 🐎 op/af het paard (verschijnt bij een vrij paard) | E op/af het paard |
| ▲ springen (op kratten!) | Spatie springen, Esc pauze |

Kopschoten met de boog doen dubbele schade. Gezondheid herstelt na 7 seconden zonder schade.

## Techniek

- **Three.js** voor de 3D-wereld; alle soldaten, gebouwen en vlaggen worden in code opgebouwd (geen externe 3D-bestanden).
- **Capacitor 8** verpakt dezelfde code als native app voor iOS (`ios/`) en Android (`android/`).
- **Vite** als bundler. Geluid wordt live gesynthetiseerd met de Web Audio API.

```
src/
  main.js      menu's, opstarten, native instellingen (landschap, statusbalk)
  game.js      game-loop, AI (boogschutters, voetvolk, ruiters), pijlen, zwaardgevecht, rijden, camera
  soldier.js   3D-modellen van janitsaar en Byzantijnse soldaat, boog/zwaard/schild + animaties
  horse.js     paarden met zadel en schabrak in teamkleuren, galop-animatie
  world.js     slagveld, de twee forten, poorten, stal, dekking
  controls.js  joystick/touch + toetsenbord/muis
  hud.js       score, levensbalk, minimap, kill-feed
  audio.js     geluidseffecten
  teams.js     wapens, rollen, teams en moeilijkheidsgraden
```

## Snelle demo (Windows/Mac/Linux)

Open `demo/fetih-1453.html` met een dubbelklik: het hele spel zit in dat ene bestand en start in
Chrome, Edge of Firefox, ook zonder internet. Opnieuw maken na wijzigingen: `npm run build:demo`.

## Starten

Vereist Node.js 20+.

```bash
npm install
npm run dev          # speel in de browser (ook op je telefoon via het netwerkadres)
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

Kies in Xcode bij *Signing & Capabilities* je eigen team (Apple ID) en druk op ▶ om op je
iPhone/iPad te installeren. Voor de App Store heb je een Apple Developer-account nodig.

Na elke codewijziging: `npm run cap:sync`.
