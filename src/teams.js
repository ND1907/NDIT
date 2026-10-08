// Teamdefinities: Ottomaanse janitsaren met lontroer vs Byzantijnse soldaten met kruisboog.
export const TEAMS = {
  ottoman: {
    id: 'ottoman',
    name: 'Ottomaanse Rijk',
    short: 'Osmanlı',
    color: '#d0202e',
    uiColor: '#e8423f',
    weapon: 'musket',
    weaponName: 'Tüfek (lontroer)',
    damage: 34,
    fireDelay: 0.5,
    magazine: 8,
    reloadTime: 1.9,
    projectileSpeed: 260,
    names: ['Murat', 'Hasan', 'Mehmet', 'Osman', 'Selim', 'Ahmet', 'Yusuf', 'Ali', 'Kemal', 'Orhan', 'Bayezid', 'Ulubatlı'],
  },
  byzantine: {
    id: 'byzantine',
    name: 'Byzantijnse Rijk',
    short: 'Bizans',
    color: '#6b1f8f',
    uiColor: '#a45ad0',
    weapon: 'crossbow',
    weaponName: 'Kruisboog',
    damage: 42,
    fireDelay: 0.65,
    magazine: 6,
    reloadTime: 1.6,
    projectileSpeed: 110,
    names: ['Konstantinos', 'Ioannes', 'Theodoros', 'Loukas', 'Demetrios', 'Nikephoros', 'Andronikos', 'Manuel', 'Giustiniani', 'Michael', 'Basileios', 'Alexios'],
  },
};

export const enemyOf = (team) => (team === 'ottoman' ? 'byzantine' : 'ottoman');

export const DIFFICULTY = {
  easy:   { label: 'Makkelijk', spread: 0.06, reaction: 0.9, turnRate: 2.5, damageToPlayer: 0.55 },
  normal: { label: 'Normaal',   spread: 0.036, reaction: 0.55, turnRate: 4.0, damageToPlayer: 0.85 },
  hard:   { label: 'Moeilijk',  spread: 0.022, reaction: 0.3, turnRate: 6.0, damageToPlayer: 1.1 },
};
