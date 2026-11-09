/* Score Editor compartido — "Registrar resultado" idéntico en toda la app.
 *
 * Flujo canónico: torneo → partido (jugadores automáticos) → resultado.
 * El resultado se carga set por set con los juegos de AMBOS jugadores:
 * el usuario indica cuántos sets se jugaron (2 o 3; el tercero solo si van
 * 1-1) y el ganador se detecta solo por sets ganados. La vista de los sets
 * es neutral (Jugador A / Jugador B); al enviar a /api/results se orienta
 * el marcador a la perspectiva del ganador, porque el servidor valida que
 * la primera columna gane el partido (winnerIndex === 0).
 *
 * Validación espejo del servidor (functions/_helpers.js validateMatchScore):
 *  - 2 o 3 sets; cada set distinto (sin empates);
 *  - set completo: 6-x (x<=4), 7-5 o 7-6;
 *  - tercer set solo si los dos primeros se repartieron 1-1;
 *  - super tie-break (10+ con diferencia >= 2) solo como tercer set;
 *  - gana quien gana 2 sets, sin sets extra tras el 2-0.
 */
(() => {
  const esc = value => String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[character]));

  function isCompleteSet(first, second) {
    return (first === 6 && second <= 4) ||
      (second === 6 && first <= 4) ||
      (first === 7 && (second === 5 || second === 6)) ||
      (second === 7 && (first === 5 || first === 6));
  }

  function isMatchTieBreak(first, second) {
    return Math.max(first, second) >= 10 && Math.abs(first - second) >= 2;
  }

  function setWinner(first, second) {
    if (first === second) return null;
    return first > second ? 0 : 1;
  }

  // Valida sets en perspectiva A-B: [[a,b],[a,b],...]. Devuelve
  // { ok, error, winnerIndex (0=A / 1=B / null), setsWon: [a,b], sets }.
  function validateSets(input) {
    const sets = Array.isArray(input) ? input : [];
    const parsed = [];
    for (const set of sets) {
      const rawA = Array.isArray(set) ? set[0] : "";
      const rawB = Array.isArray(set) ? set[1] : "";
      if (rawA === "" || rawB === "" || rawA === null || rawB === null || rawA === undefined || rawB === undefined) {
        return { ok: false, error: "Completa los juegos de cada set con números válidos.", setsWon: [0, 0], winnerIndex: null, sets: null };
      }
      const a = Number(rawA);
      const b = Number(rawB);
      if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0 || a > 30 || b > 30) {
        return { ok: false, error: "Completa los juegos de cada set con números válidos.", setsWon: [0, 0], winnerIndex: null, sets: null };
      }
      parsed.push([a, b]);
    }
    if (parsed.length < 2 || parsed.length > 3) {
      return { ok: false, error: "El partido es al mejor de 3 sets: indica 2 o 3 sets.", setsWon: [0, 0], winnerIndex: null, sets: null };
    }
    const setWinners = [];
    for (let index = 0; index < parsed.length; index++) {
      const [first, second] = parsed[index];
      if (first === second) {
        return { ok: false, error: `El set ${index + 1} no puede terminar empatado.`, setsWon: [0, 0], winnerIndex: null, sets: null };
      }
      const firstTwoEachWon = index === 2 && setWinners[0] !== setWinners[1];
      if (index === 2 && !firstTwoEachWon) {
        return { ok: false, error: "El tercer set solo se juega si los dos primeros quedaron 1-1.", setsWon: [0, 0], winnerIndex: null, sets: null };
      }
      const tb = isMatchTieBreak(first, second);
      if (!isCompleteSet(first, second) && !(index === 2 && tb)) {
        return { ok: false, error: `El set ${index + 1} no es un set completo válido (6-4, 7-5, 7-6 o súper tie-break 10+ en el tercer set).`, setsWon: [0, 0], winnerIndex: null, sets: null };
      }
      setWinners.push(setWinner(first, second));
      const wins = [setWinners.filter(w => w === 0).length, setWinners.filter(w => w === 1).length];
      if (Math.max(...wins) === 2 && index !== parsed.length - 1) {
        return { ok: false, error: "El partido ya se definió en 2 sets: quita el tercer set.", setsWon: wins, winnerIndex: null, sets: null };
      }
    }
    const setsWon = [setWinners.filter(w => w === 0).length, setWinners.filter(w => w === 1).length];
    if (Math.max(...setsWon) !== 2) {
      return { ok: false, error: "Falta un set: el ganador debe ganar 2 sets.", setsWon, winnerIndex: null, sets: null };
    }
    return { ok: true, error: "", winnerIndex: setsWon[0] === 2 ? 0 : 1, setsWon, sets: parsed };
  }

  // Construye el string que espera /api/results: primera columna = ganador.
  function buildScoreString(sets, winnerIndex) {
    const check = validateSets(sets);
    if (!check.ok || winnerIndex === null || winnerIndex === undefined) return "";
    return check.sets.map(([a, b]) => (winnerIndex === 0 ? `${a}-${b}` : `${b}-${a}`)).join(", ");
  }

  // Parsea "6-4, 4-6, 10-7*" (la * de tie-break se ignora).
  function parseScoreString(value) {
    if (typeof value !== "string" || !value.trim()) return [];
    return value.split(",").map(part => {
      const match = part.trim().match(/^(\d{1,2})\s*-\s*(\d{1,2})\*?$/);
      return match ? [Number(match[1]), Number(match[2])] : null;
    }).filter(Boolean);
  }

  // Resuelve los 2 jugadores de un partido en ambos modelos de datos:
  //  - mensual (/api/tournament): playerAId/playerBId son playerId.
  //  - referencia (/api/tournaments): a/b son userId → se mapea a playerId.
  // parts: Map id→player (por playerId) y Map userId→player.
  function resolvePlayers(match, maps) {
    const byId = (maps && maps.byId) || new Map();
    const byUserId = (maps && maps.byUserId) || new Map();
    const fromUserId = id => (id && byUserId.get(id)) || null;
    const fromPlayerId = id => (id && byId.get(id)) || null;
    const playerA = fromPlayerId(match?.playerAId) || fromUserId(match?.a) || fromUserId(match?.playerAId) || null;
    const playerB = fromPlayerId(match?.playerBId) || fromUserId(match?.b) || fromUserId(match?.playerBId) || null;
    const nameA = playerA?.name || match?.playerAName || "Jugador A";
    const nameB = playerB?.name || match?.playerBName || "Jugador B";
    return {
      playerAId: playerA?.id || (match?.playerAId && byId.has(match.playerAId) ? match.playerAId : (match?.playerAId || null)),
      playerBId: playerB?.id || (match?.playerBId && byId.has(match.playerBId) ? match.playerBId : (match?.playerBId || null)),
      playerAName: nameA,
      playerBName: nameB
    };
  }

  // Crea el editor dentro de container. initialSets en perspectiva A-B.
  function createEditor(container, options = {}) {
    if (!container) return null;
    const opts = {
      playerAName: options.playerAName || "Jugador A",
      playerBName: options.playerBName || "Jugador B",
      initialSets: Array.isArray(options.initialSets) ? options.initialSets : [],
      onChange: typeof options.onChange === "function" ? options.onChange : null
    };
    let names = { a: opts.playerAName, b: opts.playerBName };
    let state = opts.initialSets.map(set => ({ a: set[0] ?? "", b: set[1] ?? "" }));
    while (state.length < 2) state.push({ a: "", b: "" });
    if (state.length > 3) state = state.slice(0, 3);
    let setCount = 3;
    if (state.length === 2) setCount = 2;
    while (state.length < 3) state.push({ a: "", b: "" });

    container.innerHTML = `
      <div class="score-editor">
        <div class="score-editor-head">
          <div class="score-editor-names">
            <span class="se-name" data-role="nameA"></span><span class="se-vs">vs</span><span class="se-name" data-role="nameB"></span>
          </div>
          <div class="score-editor-count" role="radiogroup" aria-label="Cantidad de sets">
            <button type="button" data-setcount="2" role="radio" aria-checked="true">2 sets</button>
            <button type="button" data-setcount="3" role="radio" aria-checked="false">3 sets</button>
          </div>
        </div>
        <p class="score-editor-hint">¿Cuántos sets se jugaron? Completa los juegos de cada set; el ganador se detecta solo.</p>
        <div class="score-editor-rows" data-role="rows"></div>
        <div class="score-editor-preview" data-role="preview">Ingresa los juegos de cada set…</div>
        <p class="score-editor-error" data-role="error" role="alert"></p>
      </div>`;

    const nameAEl = container.querySelector('[data-role="nameA"]');
    const nameBEl = container.querySelector('[data-role="nameB"]');
    const rowsEl = container.querySelector('[data-role="rows"]');
    const previewEl = container.querySelector('[data-role="preview"]');
    const errorEl = container.querySelector('[data-role="error"]');
    const countBtns = [...container.querySelectorAll("[data-setcount]")];

    function readState() {
      return state.slice(0, setCount).map(row => [row.a === "" ? "" : Number(row.a), row.b === "" ? "" : Number(row.b)]);
    }

    function isEmpty() {
      return state.every(row => row.a === "" && row.b === "");
    }

    function render() {
      nameAEl.textContent = names.a;
      nameBEl.textContent = names.b;
      countBtns.forEach(btn => {
        const active = Number(btn.dataset.setcount) === setCount;
        btn.classList.toggle("is-active", active);
        btn.setAttribute("aria-checked", active ? "true" : "false");
      });
      const sets = readState();
      const check = validateSets(sets);
      rowsEl.innerHTML = state.slice(0, setCount).map((row, index) => {
        const [a, b] = sets[index];
        const aDone = Number.isInteger(a) && Number.isInteger(b) && a !== b;
        const winner = aDone ? (a > b ? "A" : "B") : "";
        const isTieBreak = aDone && Math.max(a, b) === 7;
        const isSuperTb = aDone && Math.max(a, b) >= 10;
        return `<div class="se-set">
          <span class="se-set-label">Set ${index + 1}</span>
          <input type="number" class="se-games ${winner === "A" ? "is-setwinner" : ""}" data-set="${index}" data-side="a" min="0" max="30" step="1" inputmode="numeric" value="${esc(row.a)}" aria-label="Juegos ${esc(names.a)} set ${index + 1}">
          <span class="se-dash">—</span>
          <input type="number" class="se-games ${winner === "B" ? "is-setwinner" : ""}" data-set="${index}" data-side="b" min="0" max="30" step="1" inputmode="numeric" value="${esc(row.b)}" aria-label="Juegos ${esc(names.b)} set ${index + 1}">
          <span class="se-winner" aria-hidden="true">${winner ? `✓ ${esc(winner === "A" ? names.a : names.b)}` : ""}${isTieBreak ? " · TB" : ""}${isSuperTb ? " · Súper TB" : ""}</span>
        </div>`;
      }).join("");
      rowsEl.querySelectorAll("input").forEach(input => {
        input.addEventListener("input", () => {
          const index = Number(input.dataset.set);
          const side = input.dataset.side;
          state[index][side] = input.value;
          render();
        });
      });
      if (isEmpty()) {
        previewEl.textContent = "Ingresa los juegos de cada set…";
        errorEl.textContent = "";
      } else if (check.ok) {
        const winnerName = check.winnerIndex === 0 ? names.a : names.b;
        previewEl.innerHTML = `Marcador: <b>${esc(check.sets.map(([a, b]) => `${a}-${b}`).join(", "))}</b> · Gana <b>${esc(winnerName)}</b>`;
        errorEl.textContent = "";
      } else {
        previewEl.textContent = "Revisa el marcador para continuar…";
        errorEl.textContent = check.error;
      }
      if (opts.onChange) opts.onChange(api);
    }

    countBtns.forEach(btn => btn.addEventListener("click", () => {
      setCount = Number(btn.dataset.setcount);
      render();
    }));

    const api = {
      setNames(a, b) { names = { a, b }; render(); },
      setSets(setsOrString) {
        const sets = typeof setsOrString === "string" ? parseScoreString(setsOrString) : (setsOrString || []);
        state = [{ a: "", b: "" }, { a: "", b: "" }, { a: "", b: "" }];
        sets.forEach((set, index) => {
          if (index < 3) state[index] = { a: set[0] ?? "", b: set[1] ?? "" };
        });
        setCount = sets.length >= 3 ? 3 : 2;
        render();
      },
      getSets() {
        const check = validateSets(readState());
        return check.ok ? check.sets : null;
      },
      getState() { return readState(); },
      isEmpty,
      validate() { return validateSets(readState()); },
      score() {
        const check = validateSets(readState());
        if (!check.ok) return "";
        return buildScoreString(check.sets, check.winnerIndex);
      },
      winnerIndex() {
        const check = validateSets(readState());
        return check.ok ? check.winnerIndex : null;
      },
      matchPayload() {
        const check = validateSets(readState());
        if (!check.ok) return { ok: false, error: check.error };
        const sets = check.sets.map(([a, b]) => [a, b, Math.max(a, b) === 7 && Math.min(a, b) === 6]);
        const last = check.sets[check.sets.length - 1];
        const lastMax = Math.max(last[0], last[1]);
        const lastMin = Math.min(last[0], last[1]);
        // validateTennisMatch (tennis-scoring.js) solo acepta súper tie-break
        // exacto 10-x en el set final; 11-9 solo vale en /api/results.
        if (lastMax >= 10 && !(lastMax === 10 && lastMin <= 8)) {
          return { ok: false, error: "En el cuadro, el súper tie-break es 10-x con diferencia de 2 (ej. 10-8). Usa esa forma." };
        }
        const superTiebreak = lastMax >= 10;
        return { ok: true, sets, superTiebreak, score: check.sets.map(([a, b]) => `${a}-${b}`).join(", "), setsWon: check.setsWon, winnerIndex: check.winnerIndex };
      }
    };

    render();
    return api;
  }

  window.TennisScore = { isCompleteSet, isMatchTieBreak, validateSets, buildScoreString, parseScoreString, resolvePlayers, createEditor };
})();
