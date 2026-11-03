// Motor de puntuación y clasificación de tenis (tipo CourtManager)
// Reglas: mejor de 3 sets, set a 6 con diferencia 2, tie-break a 7 si 6-6.

const STATUS_PENDING = "scheduled";
const STATUS_COMPLETED = "completed";
const STATUS_CANCELLED = "cancelled";

function isInteger(n) {
  return typeof n === "number" && Number.isInteger(n);
}

function gamesWonInSet(setScore) {
  return [setScore[0], setScore[1]];
}

function setWinner(setScore) {
  if (setScore[0] === setScore[1]) return null;
  return setScore[0] > setScore[1] ? 0 : 1;
}

function isValidSet(homeGames, awayGames, tiebreak, isFinalSet, superTiebreak) {
  if (!isInteger(homeGames) || !isInteger(awayGames) || homeGames < 0 || awayGames < 0) return false;
  const max = Math.max(homeGames, awayGames);
  const min = Math.min(homeGames, awayGames);
  const diff = max - min;

  // Tie-break normal: 7-6 con diferencia 1 en el juego decisivo (se decidió por TB)
  if (tiebreak) {
    return max === 7 && min === 6 && diff === 1;
  }

  // Super tie-break (tercer set, opcional): 10-X con diferencia 2
  if (superTiebreak && isFinalSet) {
    return max === 10 && min <= 8 && diff >= 2;
  }

  // Set normal: 6-0..6-4, 7-5
  if (max === 6 && min <= 4 && diff >= 2) return true;
  if (max === 7 && min === 5 && diff === 2) return true;
  return false;
}

function validateTennisMatch(sets, superTiebreak) {
  // sets: array de [homeGames, awayGames, tiebreak?]
  if (!Array.isArray(sets) || sets.length < 1 || sets.length > 3) return null;

  let setsWon = [0, 0];
  const parsed = [];

  for (let i = 0; i < sets.length; i++) {
    const s = sets[i];
    if (!Array.isArray(s) || s.length < 2) return null;
    const home = Number(s[0]);
    const away = Number(s[1]);
    const tiebreak = s.length >= 3 ? Boolean(s[2]) : false;

    const isFinalSet = i === sets.length - 1;
    const tbForSet = tiebreak && !superTiebreak;
    if (!isValidSet(home, away, tbForSet, isFinalSet, superTiebreak)) return null;

    const winner = setWinner([home, away]);
    if (winner === null) return null;
    setsWon[winner] += 1;
    parsed.push({ home, away, tiebreak: tbForSet });
  }

  // Partido al mejor de 3: debe haber un jugador con 2 sets para estar completado
  if (setsWon[0] < 2 && setsWon[1] < 2) return null;

  const winnerId = setsWon[0] >= 2 ? 0 : 1;
  return { sets: parsed, winnerId, setsWon };
}

function tennisScoreString(sets) {
  if (!sets || !sets.length) return "";
  return sets.map(s => {
    const home = (typeof s.home === "number") ? s.home : s[0];
    const away = (typeof s.away === "number") ? s.away : s[1];
    const tb = (typeof s.tiebreak === "boolean") ? s.tiebreak : (s.length >= 3 ? Boolean(s[2]) : false);
    const tbMark = tb ? "*" : "";
    return `${home}-${away}${tbMark}`;
  }).join(", ");
}

function computeStandings(players, matches) {
  // players: array de { id, name, level }
  // matches: array de { playerAId, playerBId, winnerId, status, sets: [[h,a,tb],...] }
  const byId = new Map(players.map(p => [p.id, { id: p.id, name: p.name, level: p.level, played: 0, won: 0, lost: 0, setsWon: 0, setsLost: 0, gamesWon: 0, gamesLost: 0, points: 0 }]));

  for (const m of matches) {
    if (m.status !== STATUS_COMPLETED || !m.winnerId) continue;
    const a = byId.get(m.playerAId);
    const b = byId.get(m.playerBId);
    if (!a || !b) continue;

    a.played += 1;
    b.played += 1;

    const sets = m.sets || [];
    let aSets = 0, bSets = 0, aGames = 0, bGames = 0;
    for (const s of sets) {
      const home = (typeof s.home === "number") ? s.home : s[0];
      const away = (typeof s.away === "number") ? s.away : s[1];
      aGames += home;
      bGames += away;
      if (home > away) aSets += 1;
      else if (away > home) bSets += 1;
    }

    a.setsWon += aSets;
    a.setsLost += bSets;
    a.gamesWon += aGames;
    a.gamesLost += bGames;
    b.setsWon += bSets;
    b.setsLost += aSets;
    b.gamesWon += bGames;
    b.gamesLost += aGames;

    const winner = m.winnerId === m.playerAId ? a : b;
    const loser = winner === a ? b : a;
    winner.won += 1;
    winner.points += 100; // puntos por victoria (consistente con ranking)
    loser.lost += 1;
  }

  const list = Array.from(byId.values());
  list.sort((x, y) => {
    if (y.points !== x.points) return y.points - x.points;
    const xSetsDiff = x.setsWon - x.setsLost;
    const ySetsDiff = y.setsWon - y.setsLost;
    if (ySetsDiff !== xSetsDiff) return ySetsDiff - xSetsDiff;
    const xGamesDiff = x.gamesWon - x.gamesLost;
    const yGamesDiff = y.gamesWon - y.gamesLost;
    if (yGamesDiff !== xGamesDiff) return yGamesDiff - xGamesDiff;
    return x.name.localeCompare(y.name);
  });

  return list.map((p, index) => ({ ...p, position: index + 1, setsDiff: p.setsWon - p.setsLost, gamesDiff: p.gamesWon - p.gamesLost }));
}

function tennisPointLabel(points) {
  const labels = ["0", "15", "30", "40"];
  return labels[points] || "40";
}

export { validateTennisMatch, tennisScoreString, computeStandings, tennisPointLabel, STATUS_PENDING, STATUS_COMPLETED, STATUS_CANCELLED };