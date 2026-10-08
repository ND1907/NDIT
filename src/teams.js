// Teamdefinities: alleen wapens uit 1453 — boog en pijlen, zwaard, en paarden.
export const TEAMS = {
  ottoman: {
    id: 'ottoman',
    name: 'Ottomaanse Rijk',
    short: 'Osmanlı',
    color: '#d0202e',
    uiColor: '#e8423f',
    bow: { name: 'Türk yayı', damage: 38, delay: 0.8, speed: 70 },
    sword: { name: 'Kılıç', damage: 42, delay: 0.6, range: 2.3 },
    cavalryName: 'Sipahi',
    names: ['Murat', 'Hasan', 'Mehmet', 'Osman', 'Selim', 'Ahmet', 'Yusuf', 'Ali', 'Kemal', 'Orhan', 'Bayezid', 'Ulubatlı', 'Zağanos', 'Karaca'],
  },
  byzantine: {
    id: 'byzantine',
    name: 'Byzantijnse Rijk',
    short: 'Bizans',
    color: '#6b1f8f',
    uiColor: '#a45ad0',
    bow: { name: 'Toxon (boog)', damage: 40, delay: 0.85, speed: 68 },
    sword: { name: 'Spathion', damage: 48, delay: 0.72, range: 2.4 },
    cavalryName: 'Kataphrakt',
    names: ['Konstantinos', 'Ioannes', 'Theodoros', 'Loukas', 'Demetrios', 'Nikephoros', 'Andronikos', 'Manuel', 'Giustiniani', 'Michael', 'Basileios', 'Alexios', 'Georgios', 'Leon'],
  },
};

export const ARROWS_MAX = 24;

// Rolverdeling per team. Plek 0 is de speler (als die meedoet).
export const ROLES = ['archer', 'infantry', 'cavalry', 'archer', 'infantry', 'archer', 'cavalry', 'infantry'];

export const enemyOf = (team) => (team === 'ottoman' ? 'byzantine' : 'ottoman');

export const DIFFICULTY = {
  easy:   { label: 'Makkelijk', spread: 0.05, reaction: 0.9, turnRate: 2.5, damageToPlayer: 0.55 },
  normal: { label: 'Normaal',   spread: 0.03, reaction: 0.55, turnRate: 4.0, damageToPlayer: 0.85 },
  hard:   { label: 'Moeilijk',  spread: 0.018, reaction: 0.3, turnRate: 6.0, damageToPlayer: 1.1 },
};
