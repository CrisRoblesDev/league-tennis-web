// Script temporal: crea cuentas temporales, perfiles y el cuadro del torneo de noviembre.
import { readFileSync, writeFileSync } from "node:fs";

const repo = "C:/Users/crisr/OneDrive/Desktop/LeagueTennis/league-tennis-web";
const read = (file) => JSON.parse(readFileSync(`${repo}/data/${file}`, "utf8"));
const write = (file, data) => writeFileSync(`${repo}/data/${file}`, JSON.stringify(data, null, 2) + "\n");

const users = read("users.json");
const players = read("players.json");
const tournaments = read("tournaments.json");

const existingHezi = players.find(p => p.name === "Hezi Saaty");
if (!existingHezi) throw new Error("Hezi Saaty no encontrado en players.json");

const roster = [
  // Grupo Damas · Nivel 3.5
  { name: "Diana Sanchez", gender: "mujeres", level: "3.5", group: "damas" },
  { name: "Simone Matamalla", gender: "mujeres", level: "3.5", group: "damas" },
  { name: "Kelly Rullier", gender: "mujeres", level: "3.5", group: "damas" },
  { name: "Anastacia Filippova", gender: "mujeres", level: "3.5", group: "damas" },
  { name: "Alison Friedman", gender: "mujeres", level: "3.5", group: "damas" },
  { name: "Laurie Milgrim", gender: "mujeres", level: "3.5", group: "damas" },
  // Grupo A
  { name: "Andrii Melnyk", gender: "hombres", level: "4.0", group: "A" },
  { name: "Juan Carlos Perez", gender: "hombres", level: "4.0", group: "A" },
  { name: "Diego Grove", gender: "hombres", level: "4.0", group: "A" },
  { name: "Artemii Aukhmik", gender: "hombres", level: "4.0", group: "A" },
  // Grupo B
  { name: "Diego Weiswein", gender: "hombres", level: "4.0", group: "B" },
  { name: "Joao Fujiwara", gender: "hombres", level: "4.0", group: "B" },
  { name: "Ivan Rossman", gender: "hombres", level: "4.0", group: "B" },
  { name: "Alternate Grupo B", gender: "hombres", level: "4.0", group: "B" },
  // Grupo C
  { name: "Philips Burleigh", gender: "hombres", level: "4.0", group: "C" },
  { name: "Ricardo Rolim", gender: "hombres", level: "4.0", group: "C" },
  { name: "Ignacio Garcia", gender: "hombres", level: "4.0", group: "C" },
  { name: "Alternate Grupo C", gender: "hombres", level: "4.0", group: "C" },
  // Grupo D (Hezi Saaty ya tiene cuenta)
  { name: "Aidan Vela", gender: "hombres", level: "4.0", group: "D" },
  { name: "Roberto Estrugo", gender: "hombres", level: "4.0", group: "D" },
  { name: "Hezi Saaty", gender: "hombres", level: "4.0", group: "D" },
  { name: "Diogo Vianna", gender: "hombres", level: "4.0", group: "D" }
];

const slug = (name) => name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9]+/g, ".").replace(/^\.|\.$/g, "");

const idByPlayerName = new Map(players.map(p => [p.name, p.id]));
const created = [];

for (const person of roster) {
  let playerId = idByPlayerName.get(person.name);
  let userId;
  if (playerId) {
    userId = players.find(p => p.id === playerId).userId;
  } else {
    userId = `user-${crypto.randomUUID()}`;
    playerId = `player-${crypto.randomUUID()}`;
    const email = `${slug(person.name)}@temp.aventuratennisleague.com`;
    if (users.some(u => u.email === email)) throw new Error(`Email duplicado: ${email}`);
    users.push({
      id: userId,
      name: person.name,
      email,
      // Contraseña temporal; el administrador puede reestablecerla desde el panel.
      password: "pbkdf2$100000$temp$placeholder",
      phone: null,
      level: person.level,
      zone: "Aventura / Sunny Isles",
      role: "user",
      created: new Date().toISOString(),
      membershipActive: false,
      temporary: true
    });
    players.push({
      id: playerId,
      userId,
      name: person.name,
      level: person.level,
      zone: "Aventura / Sunny Isles",
      category: "singles",
      gender: person.gender,
      matches: 0,
      points: 0,
      created: new Date().toISOString()
    });
    created.push(person.name);
  }
  idByPlayerName.set(person.name, playerId);
  person.playerId = playerId;
  person.userId = userId;
}

// Cuadro Round Robin por grupos según las imágenes oficiales.
function roundRobin(ids, roundLabel) {
  const list = [...ids];
  if (list.length % 2 === 1) list.push(null);
  const rounds = list.length - 1;
  const matches = [];
  let rotation = [...list];
  for (let roundIndex = 0; roundIndex < rounds; roundIndex++) {
    for (let index = 0; index < list.length / 2; index++) {
      const a = rotation[index];
      const b = rotation[rotation.length - 1 - index];
      if (a === null || b === null) continue;
      matches.push({
        id: `match-${slug(roundLabel)}-${roundIndex + 1}-${index + 1}`,
        round: roundLabel,
        playerAId: roundIndex % 2 === 0 ? a : b,
        playerBId: roundIndex % 2 === 0 ? b : a,
        date: "",
        court: "",
        status: "scheduled",
        score: "",
        winnerId: null
      });
    }
    const fixed = rotation[0];
    const rest = rotation.slice(1);
    rest.unshift(rest.pop());
    rotation = [fixed, ...rest];
  }
  return matches;
}

const idsOf = (group) => roster.filter(p => p.group === group).map(p => p.playerId);
const matches = [
  ...roundRobin(idsOf("damas"), "Grupo Damas"),
  ...roundRobin(idsOf("A"), "Grupo A"),
  ...roundRobin(idsOf("B"), "Grupo B"),
  ...roundRobin(idsOf("C"), "Grupo C"),
  ...roundRobin(idsOf("D"), "Grupo D")
];

const tournament = tournaments.find(t => t.id === "monthly-2026-11");
if (!tournament) throw new Error("Torneo monthly-2026-11 no encontrado");
const existingEntryIds = new Set((tournament.entries || []).map(e => e.playerId));
for (const person of roster) {
  if (!existingEntryIds.has(person.playerId)) {
    tournament.entries.push({ playerId: person.playerId, userId: person.userId, created: new Date().toISOString() });
  }
}
tournament.formatType = "league";
tournament.format = "Round Robin por grupos · Best of 3";
tournament.matches = matches;
tournament.updated = new Date().toISOString();

write("users.json", users);
write("players.json", players);
write("tournaments.json", tournaments);

console.log(`Cuentas creadas: ${created.length}`);
console.log(created.join(", "));
console.log(`Entradas del torneo: ${tournament.entries.length}`);
console.log(`Partidos generados: ${matches.length}`);
