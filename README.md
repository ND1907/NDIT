# Fetih 1453 ⚔️

Een 3D-teamshooter voor **iOS en Android**: het **Ottomaanse Rijk** tegen het **Byzantijnse Rijk**
tijdens de belegering van Constantinopel.

- **Ottomanen** – janitsaren met rode kaftan en witte börk-muts, gewapend met een lontroer (snel vuur, 8 schoten).
- **Byzantijnen** – soldaten met lamellair harnas, spitse helm, schild op de rug en een kruisboog (meer schade, 6 schoten).

Je speelt 6 tegen 6 (jij + 5 AI-bondgenoten tegen 6 AI-vijanden). Het eerste team met **30 kills** wint.
De slag gaat over een slagveld tussen het Ottomaanse legerkamp (tenten, bronzen kanonnen) en de
Theodosiaanse muren met drie bressen.

## Besturing

| Mobiel | Desktop |
| --- | --- |
| Linkerkant slepen: lopen (ver duwen = sprinten) | WASD lopen, Shift sprinten |
| Rechterkant slepen: richten | Muis richten |
| **VUUR** ingedrukt houden (en slepen om te richten) | Linkermuisknop schieten |
| ⟳ herladen, ▲ springen (op kratten!) | R herladen, Spatie springen, Esc pauze |

Kopschoten doen dubbele schade. Gezondheid herstelt na 7 seconden zonder schade.

## Techniek

- **Three.js** voor de 3D-wereld; alle soldaten, gebouwen en vlaggen worden in code opgebouwd (geen externe 3D-bestanden).
- **Capacitor 8** verpakt dezelfde code als native app voor iOS (`ios/`) en Android (`android/`).
- **Vite** als bundler. Geluid wordt live gesynthetiseerd met de Web Audio API.

```
src/
  main.js      menu's, opstarten, native instellingen (landschap, statusbalk)
  game.js      game-loop, AI, schieten, physics, camera, effecten
  soldier.js   3D-modellen van janitsaar en Byzantijnse soldaat + animaties
  world.js     slagveld, muren van Constantinopel, kamp, dekking
  controls.js  joystick/touch + toetsenbord/muis
  hud.js       score, levensbalk, minimap, kill-feed
  audio.js     geluidseffecten
  teams.js     wapens, teams en moeilijkheidsgraden
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
