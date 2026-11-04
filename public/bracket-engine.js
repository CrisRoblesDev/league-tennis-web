// ========================================
// BRACKET ENGINE - Editor interactivo tipo bracketengine.net
// ========================================

const BracketEngine = {
  el: null,
  tournament: null,
  players: [],
  mode: "knockout",
  zoom: 1,
  dragging: null,

  init(containerId, tournament) {
    this.el = document.getElementById(containerId);
    if (!this.el || !tournament) return;
    this.tournament = tournament;
    this.players = (tournament.entries || []).map(e => e);
    this.render();
  },

  render() {
    if (!this.el) return;
    const tournament = this.tournament;
    const mode = tournament.formatType === "league" ? "league" : "knockout";
    this.el.innerHTML = `
      <div class="bracket-engine__toolbar">
        <div class="bracket-engine__left">
          <span class="bracket-engine__title">${escapeHtml(tournament.title || "Main Draw")}</span>
          <span class="bracket-engine__subtitle">${escapeHtml(tournament.month)} · ${escapeHtml(CATEGORY_LABELS[tournament.category || "singles"] || "Singles")}</span>
        </div>
        <div class="bracket-engine__right">
          <button class="btn btn-sm btn-secondary" onclick="BracketEngine.setBracketSize()">Tamaño del cuadro</button>
          <button class="btn btn-sm btn-secondary" onclick="BracketEngine.zoomIn()">+ Zoom</button>
          <button class="btn btn-sm btn-secondary" onclick="BracketEngine.zoomOut()">− Zoom</button>
          <button class="btn btn-sm btn-dark" onclick="BracketEngine.export()">Exportar imagen</button>
        </div>
      </div>
      <div class="bracket-engine__stage-wrap">
        <div class="bracket-engine__stage" id="bracketStage" style="zoom:${this.zoom}">
          ${mode === "knockout" ? this.renderKnockout() : this.renderLeague()}
        </div>
      </div>
    `;
    if (mode === "knockout") {
      this.attachDragEvents();
    }
  },

  // ========= FASE FINAL (KNOCKOUT) =========
  renderKnockout() {
    const matches = this.tournament.matches || [];
    const rounds = [];
    matches.forEach(match => {
      const round = match.round || "Ronda 1";
      let bucket = rounds.find(r => r.name === round);
      if (!bucket) {
        bucket = { name: round, matches: [] };
        rounds.push(bucket);
      }
      bucket.matches.push(match);
    });
    if (!rounds.length) {
      return `
        <div class="bracket-engine__empty">
          <p>Aún no hay partidos en el cuadro. Genera el cuadro o arrastrando jugadores a las sedes.</p>
        </div>
      `;
    }
    return rounds.map((round, ri) => `
      <div class="bracket-engine__round">
        <div class="bracket-engine__round-title">${escapeHtml(round.name)}</div>
        <div class="bracket-engine__round-body">
          ${round.matches.map((match, mi) => this.renderMatch(match, mi, ri)).join("")}
        </div>
      </div>
    `).join("");
  },

  renderMatch(match, mi, ri) {
    const winnerA = match.status === "completed" && match.winnerId && match.winnerId === match.playerAId;
    const winnerB = match.status === "completed" && match.winnerId && match.winnerId === match.playerBId;
    return `
      <div class="bracket-engine__match" data-match-id="${escapeHtml(match.id)}">
        <div class="be-row" draggable="true" data-slot="playerA" data-match-id="${escapeHtml(match.id)}">
          <span class="be-seed">${mi + 1}</span>
          <span class="be-name ${winnerA ? "is-winner" : ""}">${escapeHtml(this.playerName(match.playerAId))}</span>
          ${winnerA ? '<span class="be-check">✓</span>' : ''}
        </div>
        <div class="be-row" draggable="true" data-slot="playerB" data-match-id="${escapeHtml(match.id)}">
          <span class="be-seed">${mi + 1}</span>
          <span class="be-name ${winnerB ? "is-winner" : ""}">${escapeHtml(this.playerName(match.playerBId))}</span>
          ${winnerB ? '<span class="be-check">✓</span>' : ''}
        </div>
        ${match.score ? `<div class="be-score">${escapeHtml(match.score)}</div>` : `<div class="be-score">${match.date ? escapeHtml(match.date) : "Por jugar"}</div>`}
      </div>
    `;
  },

  playerName(playerId) {
    const entry = this.players.find(p => p.playerId === playerId);
    return entry?.name || (playerId ? `J-${playerId.slice(-4)}` : "Por definir");
  },

  // ========= FASSE DE GRUPOS (LEAGUE) =========
  renderLeague() {
    const groups = this.tournament.groups || [];
    if (!groups.length) return '<div class="bracket-engine__empty"><p>No hay grupos definidos.</p></div>';
    return groups.map(group => `
      <div class="be-group">
        <div class="be-group__name">${escapeHtml(group.name)}</div>
        <div class="be-group__members">
          ${group.entryPlayerIds.map(pid => `<span class="be-player-chip">${escapeHtml(this.playerName(pid))}</span>`).join("")}
        </div>
      </div>
    `).join("");
  },

  // ========= DRAG && SWAP =========
  attachDragEvents() {
    const rows = this.el.querySelectorAll(".be-row[draggable]");
    rows.forEach(row => {
      row.addEventListener("dragstart", event => {
        this.dragging = { matchId: row.dataset.matchId, slot: row.dataset.slot };
        row.classList.add("is-dragging");
      });
      row.addEventListener("dragend", () => row.classList.remove("is-dragging"));
      row.addEventListener("dragover", event => event.preventDefault());
      row.addEventListener("drop", event => {
        event.preventDefault();
        const target = { matchId: row.dataset.matchId, slot: row.dataset.slot };
        if (this.dragging && (this.dragging.matchId !== target.matchId || this.dragging.slot !== target.slot)) {
          this.swapSeed(this.dragging, target);
        }
        this.dragging = null;
      });
    });
  },

  swapSeed(from, to) {
    const matches = this.tournament.matches || [];
    const fromMatch = matches.find(m => m.id === from.matchId);
    const toMatch = matches.find(m => m.id === to.matchId);
    if (!fromMatch || !toMatch) return;
    const fromId = fromMatch[from.slot === "playerA" ? "playerAId" : "playerBId"];
    const toId = toMatch[to.slot === "playerA" ? "playerAId" : "playerBId"];
    fromMatch[from.slot === "playerA" ? "playerAId" : "playerBId"] = toId;
    toMatch[to.slot === "playerA" ? "playerAId" : "playerBId"] = fromId;
    this.persistSeed();
    this.render();
  },

  async persistSeed() {
    try {
      // Guarda el nuevo cuadro a partir del orden actual de la primera ronda
      const matches = this.tournament.matches || [];
      const r1 = matches.filter(match => match.round === "Ronda 1" || match.round === "First Round");
      if (!r1.length) return;
      const seedOrder = r1.flatMap(match => [match.playerAId, match.playerBId]).filter(Boolean);
      await api(`/api/admin/tournaments/${encodeURIComponent(this.tournament.id)}`, {
        method: "PUT",
        body: JSON.stringify({ saveSeed: seedOrder })
      });
      showToast("Cuadro actualizado.");
    } catch (error) {
      showToast(`No se pudo guardar: ${error.message}`);
    }
  },

  // ========= TAMAÑO DEL CUADRO =========
  setBracketSize() {
    const size = Number(prompt("Tamaño del cuadro (4, 8, 16, 32, 64):", this.tournament.bracketSize || 8));
    if (!Number.isInteger(size) || size < 4 || size > 64 || (size & (size - 1)) !== 0) {
      showToast("Tamaño válido: 4, 8, 16, 32 o 64.");
      return;
    }
    this.tournament.bracketSize = size;
    try {
      api(`/api/admin/tournaments/${encodeURIComponent(this.tournament.id)}`, {
        method: "PUT",
        body: JSON.stringify({ bracketSize: size })
      }).then(() => {
        showToast(`Cuadro ajustado a ${size} equipos.`);
        const entries = (this.tournament.entries || []).map(e => e.playerId);
        if (entries.length) {
          this.persistSeed(entries);
        }
      });
    } catch (error) {
      showToast(`No se pudo ajustar: ${error.message}`);
    }
  },

  // ========= ZOOM && EXPORT =========
  zoomIn() {
    this.zoom = Math.min(1.8, this.zoom + 0.1);
    this.render();
  },
  zoomOut() {
    this.zoom = Math.max(0.5, this.zoom - 0.1);
    this.render();
  },

  export() {
    const stage = document.getElementById("bracketStage");
    if (!stage) return;
    // Creamos un canvas transparente y dibujamos el cuadro estilo US Open
    const canvas = document.createElement("canvas");
    canvas.width = 1200;
    canvas.height = 800;
    document.body.appendChild(canvas);
    canvas.style.display = "none";
    drawUsOpenBracket(canvas, this.tournament, false);
    canvas.toBlob(blob => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${this.tournament.title || "main-draw"}.png`;
      a.click();
      URL.revokeObjectURL(url);
      canvas.remove();
      showToast("Main Draw exportado como PNG.");
    });
  }
};

window.BracketEngine = BracketEngine;