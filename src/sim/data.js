// Alle spelgegevens: schadetypes, pantser, wapens, eenheden, facties, leiders en instellingen.
// Dit bestand bevat geen rendering- of DOM-code, zodat het ook in Node-tests draait.

// ---------------------------------------------------------------------------
// Schade en pantser (steen-papier-schaar)
// ---------------------------------------------------------------------------
// Vermenigvuldiger: schade × ARMOR[pantser][schadetype]
export const ARMOR = {
  none:   { slash: 1.0,  pierce: 1.0,  blunt: 1.0,  arrow: 1.0,  bolt: 1.0,  bullet: 1.0, fire: 1.0, siege: 1.0 },
  light:  { slash: 0.85, pierce: 0.9,  blunt: 0.95, arrow: 0.8,  bolt: 0.95, bullet: 1.0, fire: 1.0, siege: 1.0 },
  medium: { slash: 0.6,  pierce: 0.75, blunt: 0.85, arrow: 0.5,  bolt: 0.8,  bullet: 0.9, fire: 0.9, siege: 1.0 },
  heavy:  { slash: 0.38, pierce: 0.55, blunt: 0.75, arrow: 0.25, bolt: 0.65, bullet: 0.8, fire: 0.8, siege: 1.0 },
};

// Schade tegen belegeringstuig: de bemanning is kwetsbaar, het hout brandt
export const SIEGE_VULN = { slash: 0.35, pierce: 0.3, blunt: 0.45, arrow: 0.12, bolt: 0.22, bullet: 0.35, fire: 2.5, siege: 1.0 };

// Schade tegen bouwwerken (muren/torens van steen, poorten en belegeringstuig van hout)
export const STRUCT = {
  stone: { slash: 0.0, pierce: 0.0, blunt: 0.03, arrow: 0, bolt: 0, bullet: 0.02, fire: 0.0, siege: 1.0 },
  wood:  { slash: 0.04, pierce: 0.02, blunt: 0.08, arrow: 0.0, bolt: 0.01, bullet: 0.05, fire: 1.0, siege: 1.0 },
};

// ---------------------------------------------------------------------------
// Wapens
// kind: melee | ranged | thrown | spray | siege
// ---------------------------------------------------------------------------
export const WEAPONS = {
  // --- zwaarden en slagwapens ---
  kilij:     { name: 'Kılıç', kind: 'melee', dmg: 'slash', damage: 30, cooldown: 0.8, windup: 0.22, reach: 2.2, anim: 'slash', model: 'kilij' },
  spathion:  { name: 'Spathion', kind: 'melee', dmg: 'slash', damage: 31, cooldown: 0.85, windup: 0.25, reach: 2.25, anim: 'slash', model: 'sword' },
  sword:     { name: 'Zwaard', kind: 'melee', dmg: 'slash', damage: 30, cooldown: 0.85, windup: 0.24, reach: 2.2, anim: 'slash', model: 'sword' },
  longsword: { name: 'Langzwaard', kind: 'melee', dmg: 'slash', damage: 36, cooldown: 1.0, windup: 0.3, reach: 2.5, anim: 'slash', model: 'longsword', twoHanded: true },
  sabre:     { name: 'Sabel', kind: 'melee', dmg: 'slash', damage: 29, cooldown: 0.75, windup: 0.2, reach: 2.2, anim: 'slash', model: 'kilij' },
  mace:      { name: 'Knots', kind: 'melee', dmg: 'blunt', damage: 32, cooldown: 1.0, windup: 0.3, reach: 2.0, anim: 'smash', model: 'mace' },
  axe:       { name: 'Strijdbijl', kind: 'melee', dmg: 'blunt', damage: 36, cooldown: 1.1, windup: 0.32, reach: 2.2, anim: 'smash', model: 'axe' },
  pick:      { name: 'Mijnhouweel', kind: 'melee', dmg: 'blunt', damage: 22, cooldown: 1.1, windup: 0.3, reach: 2.0, anim: 'smash', model: 'pick', structMult: 14 },
  // --- stokwapens (sterk tegen ruiters) ---
  spear:     { name: 'Speer', kind: 'melee', dmg: 'pierce', damage: 26, cooldown: 0.9, windup: 0.2, reach: 3.0, anim: 'thrust', model: 'spear', antiCav: 2.4 },
  pike:      { name: 'Piek', kind: 'melee', dmg: 'pierce', damage: 26, cooldown: 1.1, windup: 0.25, reach: 4.3, anim: 'thrust', model: 'pike', antiCav: 3.0, twoHanded: true },
  halberd:   { name: 'Hellebaard', kind: 'melee', dmg: 'pierce', damage: 36, cooldown: 1.2, windup: 0.33, reach: 3.2, anim: 'chop', model: 'halberd', antiCav: 2.2, twoHanded: true },
  lance:     { name: 'Lans', kind: 'melee', dmg: 'pierce', damage: 30, cooldown: 1.3, windup: 0.12, reach: 3.6, anim: 'couch', model: 'lance', charge: 3.0 },
  // --- afstandswapens ---
  turkbow:   { name: 'Turkse composietboog', kind: 'ranged', proj: 'arrow', dmg: 'arrow', damage: 26, cooldown: 1.05, range: 85, speed: 72, spread: 0.018, ammo: 30, anim: 'bow', model: 'turkbow' },
  bow:       { name: 'Boog', kind: 'ranged', proj: 'arrow', dmg: 'arrow', damage: 25, cooldown: 1.2, range: 72, speed: 64, spread: 0.022, ammo: 28, anim: 'bow', model: 'bow' },
  crossbow:  { name: 'Kruisboog', kind: 'ranged', proj: 'bolt', dmg: 'bolt', damage: 46, cooldown: 3.4, range: 88, speed: 85, spread: 0.012, ammo: 22, anim: 'crossbow', model: 'crossbow' },
  arquebus:  { name: 'Haakbus', kind: 'ranged', proj: 'bullet', dmg: 'bullet', damage: 72, cooldown: 7.5, range: 65, speed: 210, spread: 0.04, ammo: 16, anim: 'gun', model: 'arquebus', smoke: true },
  javelin:   { name: 'Werpspiezen', kind: 'thrown', proj: 'javelin', dmg: 'pierce', damage: 42, cooldown: 2.2, range: 32, speed: 30, spread: 0.03, ammo: 4, anim: 'throw', model: 'javelin' },
  greekfire: { name: 'Grieks vuur', kind: 'spray', dmg: 'fire', damage: 9, cooldown: 4.5, range: 11, cone: 0.42, duration: 1.2, burn: 4, ammo: 12, anim: 'siphon', model: 'siphon' },
  // --- belegeringsgeschut (bemand door de eenheid zelf) ---
  bombard:   { name: 'Bombarde', kind: 'siege', proj: 'cannonball', dmg: 'siege', damage: 1100, unitDamage: 140, splash: 3.2, cooldown: 26, range: 230, speed: 115, spread: 0.012, anim: 'none', model: 'none' },
  trebuchet: { name: 'Blijde', kind: 'siege', proj: 'stone', dmg: 'siege', damage: 650, unitDamage: 110, splash: 3.6, cooldown: 15, range: 165, speed: 48, lob: true, spread: 0.02, anim: 'none', model: 'none' },
  ram:       { name: 'Stormram', kind: 'melee', dmg: 'siege', damage: 340, cooldown: 3.2, windup: 0.8, reach: 4.5, anim: 'none', model: 'none', structOnly: true },
};

// ---------------------------------------------------------------------------
// Eenheden
// role bepaalt het AI-gedrag; model verwijst naar de 3D-uitrusting (render/models.js)
// ---------------------------------------------------------------------------
const U = (o) => ({ hp: 100, armor: 'light', speed: 4.4, shield: null, mounted: false, cost: 10, ...o });

export const UNITS = {
  // ===== Ottomaanse Rijk =====
  ott_janissary: U({ faction: 'ottoman', name: 'Janitsaar', role: 'archer', weapons: ['turkbow', 'kilij'], model: 'janissary', cost: 11 }),
  ott_tufekci:   U({ faction: 'ottoman', name: 'Janitsaar-tüfekçi', role: 'gunner', weapons: ['arquebus', 'kilij'], model: 'janissary_gun', cost: 14, weaponName: 'Tüfek (haakbus)' }),
  ott_azap:      U({ faction: 'ottoman', name: 'Azap', role: 'spear', weapons: ['spear', 'javelin'], armor: 'none', shield: 'round', model: 'azap', cost: 6, hp: 90 }),
  ott_sipahi:    U({ faction: 'ottoman', name: 'Sipahi', role: 'cavalry', weapons: ['lance', 'kilij'], armor: 'medium', shield: 'round', mounted: true, hp: 150, speed: 11, model: 'sipahi', cost: 24 }),
  ott_solak:     U({ faction: 'ottoman', name: 'Solak (lijfwacht)', role: 'guard', weapons: ['turkbow', 'kilij'], armor: 'medium', hp: 130, model: 'solak', cost: 0 }),
  ott_bombard:   U({ faction: 'ottoman', name: 'Bombarde van Urban', role: 'siege', weapons: ['bombard'], armor: 'heavy', hp: 900, speed: 1.3, model: 'bombard', cost: 70, structure: 'wood' }),
  ott_ram:       U({ faction: 'ottoman', name: 'Stormram', role: 'ram', weapons: ['ram'], armor: 'heavy', hp: 1500, speed: 1.8, model: 'ram', cost: 45, structure: 'wood' }),
  ott_tower:     U({ faction: 'ottoman', name: 'Belegeringstoren', role: 'tower', weapons: [], armor: 'heavy', hp: 1600, speed: 1.2, model: 'tower', cost: 60, structure: 'wood' }),
  ott_leader:    U({ faction: 'ottoman', name: 'Sultan Mehmed II', role: 'leader', weapons: ['kilij', 'mace'], armor: 'medium', shield: null, mounted: true, hp: 950, speed: 9, model: 'mehmed', cost: 0 }),

  // ===== Byzantijnse Rijk =====
  byz_skoutatos: U({ faction: 'byzantine', name: 'Skoutatos', role: 'spear', weapons: ['spear', 'spathion'], armor: 'medium', shield: 'round', model: 'skoutatos', cost: 11, hp: 110 }),
  byz_toxotes:   U({ faction: 'byzantine', name: 'Toxotes', role: 'archer', weapons: ['bow', 'spathion'], model: 'toxotes', cost: 10 }),
  byz_siphon:    U({ faction: 'byzantine', name: 'Siphōnarios (Grieks vuur)', role: 'fire', weapons: ['greekfire', 'spathion'], model: 'siphonarios', cost: 15 }),
  byz_kataphrakt:U({ faction: 'byzantine', name: 'Kataphrakt', role: 'cavalry', weapons: ['lance', 'mace'], armor: 'heavy', mounted: true, hp: 170, speed: 10, model: 'kataphrakt', cost: 28 }),
  byz_guard:     U({ faction: 'byzantine', name: 'Keizerlijke garde', role: 'guard', weapons: ['spathion'], armor: 'heavy', shield: 'round', hp: 140, model: 'byzguard', cost: 0 }),
  byz_trebuchet: U({ faction: 'byzantine', name: 'Blijde', role: 'siege', weapons: ['trebuchet'], armor: 'heavy', hp: 800, speed: 1.2, model: 'trebuchet', cost: 50, structure: 'wood' }),
  byz_ram:       U({ faction: 'byzantine', name: 'Stormram', role: 'ram', weapons: ['ram'], armor: 'heavy', hp: 1500, speed: 1.8, model: 'ram', cost: 45, structure: 'wood' }),
  byz_leader:    U({ faction: 'byzantine', name: 'Keizer Constantijn XI', role: 'leader', weapons: ['spathion'], armor: 'heavy', shield: 'round', hp: 900, speed: 4.6, model: 'constantine', cost: 0 }),

  // ===== Republiek Genua =====
  gen_balestriere: U({ faction: 'genoa', name: 'Genuese kruisboogschutter', role: 'crossbow', weapons: ['crossbow', 'sword'], armor: 'medium', shield: 'pavise', model: 'gen_crossbow', cost: 14, hp: 105 }),
  gen_lanciere:    U({ faction: 'genoa', name: 'Genuese speerman', role: 'spear', weapons: ['spear', 'sword'], armor: 'medium', shield: 'kite', model: 'gen_spear', cost: 11 }),
  gen_armigero:    U({ faction: 'genoa', name: 'Genuese man-at-arms', role: 'heavy', weapons: ['longsword'], armor: 'heavy', model: 'gen_maa', cost: 17, hp: 125, speed: 4.1 }),
  gen_guard:       U({ faction: 'genoa', name: 'Lijfwacht van Giustiniani', role: 'guard', weapons: ['longsword'], armor: 'heavy', hp: 140, model: 'gen_maa', cost: 0 }),
  gen_trebuchet:   U({ faction: 'genoa', name: 'Blijde', role: 'siege', weapons: ['trebuchet'], armor: 'heavy', hp: 800, speed: 1.2, model: 'trebuchet', cost: 50, structure: 'wood' }),
  gen_ram:         U({ faction: 'genoa', name: 'Stormram', role: 'ram', weapons: ['ram'], armor: 'heavy', hp: 1500, speed: 1.8, model: 'ram', cost: 45, structure: 'wood' }),
  gen_leader:      U({ faction: 'genoa', name: 'Giovanni Giustiniani Longo', role: 'leader', weapons: ['longsword'], armor: 'heavy', hp: 880, speed: 4.5, model: 'giustiniani', cost: 0 }),

  // ===== Republiek Venetië =====
  ven_balestriere: U({ faction: 'venice', name: 'Venetiaanse kruisboogschutter', role: 'crossbow', weapons: ['crossbow', 'sword'], armor: 'medium', shield: 'pavise', model: 'ven_crossbow', cost: 14, hp: 105 }),
  ven_schioppo:    U({ faction: 'venice', name: 'Schioppettiere', role: 'gunner', weapons: ['arquebus', 'sword'], armor: 'light', model: 'ven_gun', cost: 14, weaponName: 'Schioppo (handkanon)' }),
  ven_marinaio:    U({ faction: 'venice', name: 'Venetiaanse marinier', role: 'spear', weapons: ['halberd'], armor: 'medium', model: 'ven_halberd', cost: 12, hp: 110 }),
  ven_cavaliere:   U({ faction: 'venice', name: 'Condottiere-ruiter', role: 'cavalry', weapons: ['lance', 'sword'], armor: 'heavy', mounted: true, hp: 165, speed: 10, model: 'ven_cav', cost: 27 }),
  ven_guard:       U({ faction: 'venice', name: 'Garde van San Marco', role: 'guard', weapons: ['halberd'], armor: 'heavy', hp: 140, model: 'ven_halberd', cost: 0 }),
  ven_trebuchet:   U({ faction: 'venice', name: 'Blijde', role: 'siege', weapons: ['trebuchet'], armor: 'heavy', hp: 800, speed: 1.2, model: 'trebuchet', cost: 50, structure: 'wood' }),
  ven_ram:         U({ faction: 'venice', name: 'Stormram', role: 'ram', weapons: ['ram'], armor: 'heavy', hp: 1500, speed: 1.8, model: 'ram', cost: 45, structure: 'wood' }),
  ven_leader:      U({ faction: 'venice', name: 'Girolamo Minotto', role: 'leader', weapons: ['longsword'], armor: 'heavy', hp: 850, speed: 4.5, model: 'minotto', cost: 0 }),

  // ===== Servisch Despotaat =====
  srb_lancer:    U({ faction: 'serbia', name: 'Servische lansruiter', role: 'cavalry', weapons: ['lance', 'mace'], armor: 'medium', shield: 'kite', mounted: true, hp: 150, speed: 10.5, model: 'srb_cav', cost: 24 }),
  srb_pesak:     U({ faction: 'serbia', name: 'Servisch voetvolk', role: 'spear', weapons: ['spear', 'axe'], armor: 'light', shield: 'kite', model: 'srb_spear', cost: 9, hp: 105 }),
  srb_strelac:   U({ faction: 'serbia', name: 'Servische boogschutter', role: 'archer', weapons: ['bow', 'axe'], model: 'srb_archer', cost: 10 }),
  srb_miner:     U({ faction: 'serbia', name: 'Mijnwerker van Novo Brdo', role: 'sapper', weapons: ['pick'], armor: 'none', model: 'srb_miner', cost: 12, hp: 95 }),
  srb_guard:     U({ faction: 'serbia', name: 'Garde van de despoot', role: 'guard', weapons: ['mace'], armor: 'heavy', shield: 'kite', hp: 140, model: 'srb_guard', cost: 0 }),
  srb_trebuchet: U({ faction: 'serbia', name: 'Blijde', role: 'siege', weapons: ['trebuchet'], armor: 'heavy', hp: 800, speed: 1.2, model: 'trebuchet', cost: 50, structure: 'wood' }),
  srb_ram:       U({ faction: 'serbia', name: 'Stormram', role: 'ram', weapons: ['ram'], armor: 'heavy', hp: 1500, speed: 1.8, model: 'ram', cost: 45, structure: 'wood' }),
  srb_leader:    U({ faction: 'serbia', name: 'Despoot Đurađ Branković', role: 'leader', weapons: ['mace', 'sword'], armor: 'heavy', shield: 'kite', mounted: true, hp: 900, speed: 9, model: 'brankovic', cost: 0 }),

  // ===== Koninkrijk Hongarije =====
  hun_knight:    U({ faction: 'hungary', name: 'Hongaarse ridder', role: 'cavalry', weapons: ['lance', 'longsword'], armor: 'heavy', mounted: true, hp: 175, speed: 9.5, model: 'hun_knight', cost: 26 }),
  hun_light:     U({ faction: 'hungary', name: 'Lichte ruiter', role: 'cavalry', weapons: ['lance', 'sabre'], armor: 'light', shield: 'tarcsa', mounted: true, hp: 130, speed: 12, model: 'hun_light', cost: 18 }),
  hun_pike:      U({ faction: 'hungary', name: 'Hongaarse piekenier', role: 'spear', weapons: ['pike', 'sword'], armor: 'medium', model: 'hun_pike', cost: 11, hp: 110 }),
  hun_crossbow:  U({ faction: 'hungary', name: 'Hongaarse kruisboogschutter', role: 'crossbow', weapons: ['crossbow', 'axe'], armor: 'medium', shield: 'pavise', model: 'hun_xbow', cost: 13, hp: 105 }),
  hun_puskas:    U({ faction: 'hungary', name: 'Puskás (haakbusschutter)', role: 'gunner', weapons: ['arquebus', 'axe'], armor: 'light', shield: 'pavise', model: 'hun_gun', cost: 14, weaponName: 'Puska (haakbus)' }),
  hun_guard:     U({ faction: 'hungary', name: 'Lijfwacht van Hunyadi', role: 'guard', weapons: ['mace'], armor: 'heavy', shield: 'tarcsa', hp: 140, model: 'hun_guard', cost: 0 }),
  hun_bombard:   U({ faction: 'hungary', name: 'Bombarde', role: 'siege', weapons: ['bombard'], armor: 'heavy', hp: 900, speed: 1.3, model: 'bombard', cost: 70, structure: 'wood' }),
  hun_ram:       U({ faction: 'hungary', name: 'Stormram', role: 'ram', weapons: ['ram'], armor: 'heavy', hp: 1500, speed: 1.8, model: 'ram', cost: 45, structure: 'wood' }),
  hun_leader:    U({ faction: 'hungary', name: 'János Hunyadi', role: 'leader', weapons: ['mace', 'longsword'], armor: 'heavy', mounted: true, hp: 950, speed: 9, model: 'hunyadi', cost: 0 }),
};
for (const [id, u] of Object.entries(UNITS)) u.id = id;

// ---------------------------------------------------------------------------
// Leiders: aura (passief) en strijdkreet (actief)
// ---------------------------------------------------------------------------
export const LEADERS = {
  ottoman: {
    unit: 'ott_leader', guard: 'ott_solak', title: 'Sultan', bio: 'Mehmed II (1432–1481) leidde in 1453 op 21-jarige leeftijd het beleg.',
    aura: { radius: 20, dmg: 0.15, def: 0.0, speed: 0.05, label: '+15% schade' },
    cry: { name: 'İleri! (Voorwaarts!)', radius: 28, duration: 12, cooldown: 60, dmg: 0.25, def: 0.1, speed: 0.25, heal: 0, morale: 12 },
  },
  byzantine: {
    unit: 'byz_leader', guard: 'byz_guard', title: 'Keizer', bio: 'Constantijn XI Palaiologos (1405–1453), de laatste Byzantijnse keizer, sneuvelde bij de val van de stad.',
    aura: { radius: 20, dmg: 0.0, def: 0.2, speed: 0.0, label: '−20% schade ontvangen' },
    cry: { name: 'Voor de Stad!', radius: 28, duration: 12, cooldown: 60, dmg: 0.1, def: 0.25, speed: 0.1, heal: 0.3, morale: 15 },
  },
  genoa: {
    unit: 'gen_leader', guard: 'gen_guard', title: 'Condottiere', bio: 'Giovanni Giustiniani Longo leidde 700 Genuezen bij de verdediging van de landmuren.',
    aura: { radius: 20, dmg: 0.1, def: 0.1, speed: 0.0, reload: 0.25, label: 'Sneller herladen, +10% schade/verdediging' },
    cry: { name: 'Per San Giorgio!', radius: 28, duration: 12, cooldown: 60, dmg: 0.2, def: 0.2, speed: 0.1, heal: 0.15, morale: 12 },
  },
  venice: {
    unit: 'ven_leader', guard: 'ven_guard', title: 'Bailo', bio: 'Girolamo Minotto was de Venetiaanse bailo in Constantinopel en leidde de Venetianen tijdens het beleg.',
    aura: { radius: 20, dmg: 0.1, def: 0.05, speed: 0.0, accuracy: 0.35, label: 'Nauwkeuriger schieten, +10% schade' },
    cry: { name: 'San Marco!', radius: 28, duration: 12, cooldown: 60, dmg: 0.2, def: 0.15, speed: 0.15, heal: 0.1, morale: 12 },
  },
  serbia: {
    unit: 'srb_leader', guard: 'srb_guard', title: 'Despoot', bio: 'Đurađ Branković (1377–1456), despoot van Servië en Ottomaans vazal, stuurde troepen naar het beleg (hij was er zelf niet bij).',
    aura: { radius: 20, dmg: 0.1, def: 0.1, speed: 0.08, label: '+10% schade/verdediging, sneller' },
    cry: { name: 'Za Despota!', radius: 28, duration: 12, cooldown: 60, dmg: 0.2, def: 0.2, speed: 0.2, heal: 0.1, morale: 12 },
  },
  hungary: {
    unit: 'hun_leader', guard: 'hun_guard', title: 'Kapitein-generaal', bio: 'János Hunyadi (±1406–1456), regent en veldheer van Hongarije, vocht in deze jaren tegen de Ottomanen (Varna 1444, Belgrado 1456). Hongarije vocht niet mee bij Constantinopel.',
    aura: { radius: 20, dmg: 0.2, def: 0.0, speed: 0.05, label: '+20% schade' },
    cry: { name: 'Szent László!', radius: 28, duration: 12, cooldown: 60, dmg: 0.3, def: 0.1, speed: 0.2, heal: 0, morale: 12 },
  },
};

// ---------------------------------------------------------------------------
// Facties
// side: historische kant in 1453 (voor de modus "historische allianties")
// ---------------------------------------------------------------------------
export const FACTIONS = {
  ottoman: {
    id: 'ottoman', name: 'Ottomaanse Rijk', short: 'Ottomanen', color: '#b3141f', color2: '#e8d9b0', ui: '#e24a3f', side: 'ottoman',
    fortStyle: 'ottoman', incomeMult: 1.1,
    style: 'Grootste leger, Turkse bogen, sipahi-ruiters en de enorme bombardes van Urban.',
    roster: ['ott_janissary', 'ott_tufekci', 'ott_azap', 'ott_sipahi'],
    mix: { ott_azap: 0.35, ott_janissary: 0.32, ott_tufekci: 0.13, ott_sipahi: 0.2 },
    siege: ['ott_bombard', 'ott_ram', 'ott_tower'],
  },
  byzantine: {
    id: 'byzantine', name: 'Byzantijnse Rijk', short: 'Byzantijnen', color: '#5b1a7a', color2: '#d4a72c', ui: '#a35ad6', side: 'christian',
    fortStyle: 'byzantine', incomeMult: 0.9,
    style: 'Verdedigers: dubbele Theodosiaanse muren met gracht, Grieks vuur en zware kataphrakten.',
    roster: ['byz_skoutatos', 'byz_toxotes', 'byz_siphon', 'byz_kataphrakt'],
    mix: { byz_skoutatos: 0.42, byz_toxotes: 0.33, byz_siphon: 0.1, byz_kataphrakt: 0.15 },
    siege: ['byz_trebuchet', 'byz_ram'],
  },
  genoa: {
    id: 'genoa', name: 'Republiek Genua', short: 'Genuezen', color: '#c8102e', color2: '#f2f0ea', ui: '#ff6b6b', side: 'christian',
    fortStyle: 'genoa', incomeMult: 0.8,
    style: 'Beroemde kruisboogschutters achter pavese-schilden en zwaar gepantserde men-at-arms.',
    roster: ['gen_balestriere', 'gen_lanciere', 'gen_armigero'],
    mix: { gen_balestriere: 0.42, gen_lanciere: 0.33, gen_armigero: 0.25 },
    siege: ['gen_trebuchet', 'gen_ram'],
  },
  venice: {
    id: 'venice', name: 'Republiek Venetië', short: 'Venetianen', color: '#8e1b1b', color2: '#e3b23c', ui: '#f0a63a', side: 'christian',
    fortStyle: 'venice', incomeMult: 0.9,
    style: 'Kruisbogen en vroege handkanonnen, mariniers met hellebaarden en condottieri-ruiters.',
    roster: ['ven_balestriere', 'ven_schioppo', 'ven_marinaio', 'ven_cavaliere'],
    mix: { ven_balestriere: 0.3, ven_schioppo: 0.15, ven_marinaio: 0.38, ven_cavaliere: 0.17 },
    siege: ['ven_trebuchet', 'ven_ram'],
  },
  serbia: {
    id: 'serbia', name: 'Servisch Despotaat', short: 'Serviërs', color: '#9b1c1c', color2: '#f4f1ea', ui: '#ff8f70', side: 'ottoman',
    fortStyle: 'serbia', incomeMult: 1.3,
    style: 'Sterke lansruiters en de mijnwerkers van Novo Brdo die muren ondergraven.',
    roster: ['srb_lancer', 'srb_pesak', 'srb_strelac', 'srb_miner'],
    mix: { srb_pesak: 0.38, srb_strelac: 0.27, srb_lancer: 0.25, srb_miner: 0.1 },
    siege: ['srb_trebuchet', 'srb_ram'],
  },
  hungary: {
    id: 'hungary', name: 'Koninkrijk Hongarije', short: 'Hongaren', color: '#1d5a32', color2: '#c8102e', ui: '#5fcf7f', side: 'christian',
    fortStyle: 'hungary', incomeMult: 1.32,
    style: 'Zware ridders, lichte ruiters, piekeniers, kruisboog- en haakbusschutters (naar Hussitisch voorbeeld).',
    roster: ['hun_knight', 'hun_light', 'hun_pike', 'hun_crossbow', 'hun_puskas'],
    mix: { hun_pike: 0.3, hun_crossbow: 0.2, hun_puskas: 0.16, hun_light: 0.18, hun_knight: 0.16 },
    siege: ['hun_bombard', 'hun_ram'],
  },
};
export const FACTION_IDS = ['ottoman', 'byzantine', 'genoa', 'venice', 'serbia', 'hungary'];

// ---------------------------------------------------------------------------
// Instellingen
// ---------------------------------------------------------------------------
export const TROOP_SIZES = {
  small:  { label: 'Klein (±25 per team)', perTeam: 25 },
  normal: { label: 'Normaal (±60 per team)', perTeam: 60 },
  large:  { label: 'Groot (±120 per team)', perTeam: 120 },
};

// Potjeslengte: schaalt muur-/poortsterkte, inname-tijd, inkomen en tijdslimiet.
export const MATCH_LENGTHS = {
  short:  { label: 'Kort (±10 min)', structHp: 0.6, capture: 0.7, income: 1.25, timeLimit: 15 * 60 },
  normal: { label: 'Normaal (±20 min)', structHp: 1.0, capture: 1.0, income: 1.0, timeLimit: 30 * 60 },
  long:   { label: 'Lang (±30 min)', structHp: 1.5, capture: 1.35, income: 0.85, timeLimit: 45 * 60 },
};

export const DIFFICULTIES = {
  easy:   { label: 'Makkelijk', spread: 2.0, reaction: 0.9, toPlayer: 0.55, tactics: 0.3, enemyIncome: 0.85 },
  normal: { label: 'Normaal', spread: 1.0, reaction: 0.5, toPlayer: 0.85, tactics: 0.7, enemyIncome: 1.0 },
  hard:   { label: 'Moeilijk', spread: 0.6, reaction: 0.3, toPlayer: 1.05, tactics: 1.0, enemyIncome: 1.15 },
};

export const MODES = {
  historical: { label: 'Historische allianties', desc: 'Ottomanen + Serviërs tegen Byzantijnen, Genuezen, Venetianen en Hongaren.' },
  ffa: { label: 'Ieder voor zich', desc: 'Elk rijk vecht voor zichzelf.' },
};

export const DEFAULT_SETTINGS = {
  teams: ['ottoman', 'byzantine'],
  mode: 'historical',
  playerTeam: 'ottoman',
  playerUnit: 'ott_janissary',
  difficulty: 'normal',
  length: 'normal',
  troops: 'normal',
};
