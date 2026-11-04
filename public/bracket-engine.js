// Bracket Engine: grupos + eliminatorias en un único canvas lógico.
// No depende de frameworks; los cambios se persisten en Pages Functions.
const BracketEngine = {
  el: null,
  tournament: null,
  zoom: 1,
  draggedSlot: null,
  observer: null,

  init(containerId, tournament) {
    this.el = document.getElementById(containerId);
    this.tournament = tournament;
    this.zoom = 1;
    if (!this.el || !tournament) return;
    this.render();
  },

  async reload() {
    if (!this.tournament?.id) return;
    try {
      const data = await api(`/api/admin/tournaments/${encodeURIComponent(this.tournament.id)}`);
      this.tournament = data.tournament;
      this.render();
    } catch (error) {
      showToast(`No se pudo actualizar el Main Draw: ${error.message}`);
    }
  },

  render() {
    if (!this.el || !this.tournament) return;
    if (this.observer) this.observer.disconnect();
    const t = this.tournament;
    const groups = t.groups || [];
    const playoffs = (t.matches || []).filter(match => match.stageId === "playoff");
    const plainKnockout = !groups.length;
    const rounds = this.getRounds(plainKnockout ? (t.matches || []) : playoffs);
    const qualifiedCount = t.qualifiersPerGroup || 2;

    this.el.innerHTML = `
      <div class="bracket-engine__toolbar">
        <div class="bracket-engine__left">
          <span class="bracket-engine__title">${escapeHtml(t.title || "Main Draw")}</span>
          <span class="bracket-engine__subtitle">${escapeHtml(t.month || "")} · ${escapeHtml(CATEGORY_LABELS[t.category || "singles"] || "Singles")}</span>
        </div>
        <div class="bracket-engine__right">
          ${groups.length ? `<label class="be-qualifier-control">Clasifican por grupo
            <select id="beQualifiersPerGroup">${[1,2,3,4].map(n => `<option value="${n}" ${n === qualifiedCount ? "selected" : ""}>${n}</option>`).join("")}</select>
          </label><button class="btn btn-sm btn-primary" data-be-action="advance">${playoffs.length ? "Actualizar eliminatorias" : "Generar eliminatorias"}</button>` : ""}
          ${plainKnockout ? '<button class="btn btn-sm btn-secondary" data-be-action="size">Tamaño del cuadro</button>' : ""}
          <button class="btn btn-sm btn-secondary" data-be-action="zoom-in" aria-label="Acercar">+</button>
          <button class="btn btn-sm btn-secondary" data-be-action="zoom-out" aria-label="Alejar">−</button>
          <button class="btn btn-sm btn-dark" data-be-action="export">Exportar SVG</button>
        </div>
      </div>
      <div class="bracket-engine__help">Haz clic en un participante para cambiarlo, en el marcador para editarlo o arrastra dos casillas para intercambiar el sembrado.</div>
      <div class="bracket-engine__stage-wrap" id="beStageWrap">
      <div class="bracket-engine__stage" id="bracketStage" style="--be-zoom:${this.zoom}">
          <svg class="be-connectors" aria-hidden="true"></svg>
          ${groups.length ? this.renderGroupStages(groups, playoffs) : ""}
          ${rounds.map(round => `
            <section class="bracket-engine__round" data-round="${escapeHtml(round.name)}">
              <h3 class="bracket-engine__round-title">${escapeHtml(round.name)}</h3>
              <div class="bracket-engine__round-body">
                ${round.matches.map((match, index) => this.renderMatch(
                  match,
                  index,
                  plainKnockout || (match.stageId === "playoff" && round === rounds[0])
                )).join("")}
              </div>
            </section>`).join("")}
          ${!groups.length && !rounds.length ? '<div class="bracket-engine__empty">Genera el cuadro para comenzar a editar participantes y resultados.</div>' : ""}
        </div>
      </div>`;

    this.attachEvents();
    this.drawConnectors();
    if (typeof ResizeObserver === "function") {
      this.observer = new ResizeObserver(() => this.drawConnectors());
      this.observer.observe(this.el.querySelector("#bracketStage"));
    } else {
      requestAnimationFrame(() => this.drawConnectors());
    }
  },

  getRounds(matches) {
    const map = new Map();
    matches.forEach(match => {
      const name = match.round || "Ronda";
      if (!map.has(name)) map.set(name, []);
      map.get(name).push(match);
    });
    return [...map.entries()].map(([name, roundMatches]) => ({ name, matches: roundMatches }));
  },

  playerName(id) {
    if (!id) return "Por definir";
    const entry = (this.tournament.entries || []).find(player => player.playerId === id);
    return entry?.name || `Jugador ${String(id).slice(-4)}`;
  },

  renderGroupStages(groups, playoffs) {
    const stored = this.tournament.groupStandings || [];
    const isQualified = new Set(this.tournament.qualifiedPlayerIds || []);
    return groups.map(group => {
      const result = stored.find(item => item.name === group.name);
      const standings = result?.standings || this.calculateGroupTable(group);
      const qualifiedIds = new Set(result?.qualifiedPlayerIds || []);
      return `<section class="be-group-stage" data-group-stage="${escapeHtml(group.name)}">
        <h3 class="bracket-engine__round-title">${escapeHtml(group.name)}</h3>
        <div class="be-group-card">
          <table class="be-group-table"><thead><tr><th>#</th><th>Jugador</th><th>PJ</th><th>G</th><th>Sets</th><th>Pts</th></tr></thead>
            <tbody>${standings.map(row => {
              const qualified = qualifiedIds.has(row.id) || isQualified.has(row.id);
              return `<tr data-group-player="${escapeHtml(row.id)}" class="${qualified ? "is-qualified" : ""}">
                <td>${row.position}</td><td>${escapeHtml(row.name)}${qualified ? '<span class="be-qualified-badge">Clasificado</span>' : ""}</td>
                <td>${row.played}</td><td>${row.won}</td><td>${row.setsWon}-${row.setsLost}</td><td>${row.points}</td>
              </tr>`;
            }).join("")}</tbody>
          </table>
          <div class="be-group-fixtures">${(this.tournament.matches || []).filter(match =>
            (match.stageId === "groups" || !match.stageId) && String(match.round || "").startsWith(`${group.name} ·`)
          ).map(match => `<div class="be-fixture"><span>${escapeHtml(this.playerName(match.playerAId))}</span><b>${escapeHtml(match.score || "vs")}</b><span>${escapeHtml(this.playerName(match.playerBId))}</span><small>${escapeHtml(match.date || match.round || "")}</small></div>`).join("")}</div>
        </div>
      </section>`;
    }).join("") + (playoffs.length ? '<div class="be-stage-divider"><span>Fase final</span></div>' : '<div class="be-stage-pending">Finaliza todos los partidos de grupo para habilitar la fase final.</div>');
  },

  calculateGroupTable(group) {
    const rows = new Map((group.entryPlayerIds || []).map(id => [id, {
      id, name: this.playerName(id), played: 0, won: 0, lost: 0, setsWon: 0, setsLost: 0, points: 0
    }]));
    (this.tournament.matches || []).filter(match =>
      (match.stageId === "groups" || !match.stageId) && String(match.round || "").startsWith(`${group.name} ·`) && match.status === "completed"
    ).forEach(match => {
      const a = rows.get(match.playerAId), b = rows.get(match.playerBId);
      if (!a || !b) return;
      a.played++; b.played++;
      const sets = match.sets || [];
      sets.forEach(set => {
        const home = typeof set.home === "number" ? set.home : set[0];
        const away = typeof set.away === "number" ? set.away : set[1];
        if (home > away) { a.setsWon++; b.setsLost++; }
        else { b.setsWon++; a.setsLost++; }
      });
      const winner = match.winnerId === a.id ? a : b;
      const loser = winner === a ? b : a;
      winner.won++; winner.points += 100; loser.lost++;
    });
    return [...rows.values()].sort((a,b) => b.points-a.points || (b.setsWon-b.setsLost)-(a.setsWon-a.setsLost) || a.name.localeCompare(b.name))
      .map((row,index) => ({...row,position:index+1}));
  },

  renderMatch(match, index, draggable) {
    const slot = (side, playerId) => {
      const winner = match.status === "completed" && match.winnerId === playerId && playerId;
      return `<div role="group" tabindex="0" class="be-row ${winner ? "is-winner" : ""}" data-slot="${side}" data-match-id="${escapeHtml(match.id)}" data-player-id="${escapeHtml(playerId || "")}" ${draggable ? 'draggable="true"' : ""}>
        <span class="be-seed">${index + 1}</span><button type="button" class="be-name-button">${escapeHtml(this.playerName(playerId))}</button>${winner ? '<span class="be-check">✓</span>' : '<span class="be-edit-hint">Editar</span>'}
      </div>`;
    };
    const matchId = escapeHtml(match.id);
    const setsText = match.score && match.score !== "BYE" ? match.score : "";
    return `<article class="bracket-engine__match" data-stage-id="${escapeHtml(match.stageId || "knockout")}" data-match-id="${matchId}" ${match.nextMatchId ? `data-next-match-id="${escapeHtml(match.nextMatchId)}" data-next-slot="${escapeHtml(match.nextSlot || "A")}"` : ""}>
      ${slot("A", match.playerAId)}${slot("B", match.playerBId)}
      <div class="be-inline-score" data-score-for="${matchId}">
        <button type="button" class="be-score-button" data-edit-score="${matchId}">${escapeHtml(setsText || match.date || (match.score === "BYE" ? "BYE" : "Editar marcador / fecha"))}</button>
      </div>
    </article>`;
  },

  attachEvents() {
    this.el.querySelectorAll("[data-edit-score]").forEach(button => button.addEventListener("click", () => this.openInlineScore(button.dataset.editScore)));
    this.el.querySelectorAll(".be-row").forEach(row => {
      row.addEventListener("click", event => {
        if (event.target.closest("select,button[data-save-slot]")) return;
        this.openInlineSlot(row.dataset.matchId, row.dataset.slot);
      });
      if (row.draggable) {
        row.addEventListener("dragstart", () => {
          this.draggedSlot = { matchId: row.dataset.matchId, slot: row.dataset.slot };
          row.classList.add("is-dragging");
        });
        row.addEventListener("dragend", () => row.classList.remove("is-dragging"));
        row.addEventListener("dragover", event => event.preventDefault());
        row.addEventListener("drop", event => {
          event.preventDefault();
          if (this.draggedSlot) this.swapSlots(this.draggedSlot, { matchId: row.dataset.matchId, slot: row.dataset.slot });
          this.draggedSlot = null;
        });
      }
    });
    this.el.querySelectorAll("[data-be-action]").forEach(button => button.addEventListener("click", () => {
      const action = button.dataset.beAction;
      if (action === "advance") this.advanceGroups();
      if (action === "size") this.setBracketSize();
      if (action === "zoom-in") { this.zoom = Math.min(1.8, this.zoom + .1); this.render(); }
      if (action === "zoom-out") { this.zoom = Math.max(.5, this.zoom - .1); this.render(); }
      if (action === "export") this.exportSvg();
    }));
  },

  async openInlineSlot(matchId, side) {
    const row = this.el.querySelector(`.be-row[data-match-id="${CSS.escape(matchId)}"][data-slot="${side}"]`);
    if (!row) return;
    const match = (this.tournament.matches || []).find(item => item.id === matchId);
    if (!match) return;
    const field = side === "A" ? "playerAId" : "playerBId";
    const options = (this.tournament.entries || []).map(entry => `<option value="${escapeHtml(entry.playerId)}" ${entry.playerId === match[field] ? "selected" : ""}>${escapeHtml(entry.name)}</option>`).join("");
    row.innerHTML = `<span class="be-seed">•</span><select class="be-inline-select"><option value="">Por definir / BYE</option>${options}</select><button type="button" class="btn btn-sm btn-primary" data-save-slot>Guardar</button>`;
    row.querySelector("[data-save-slot]").addEventListener("click", event => {
      event.stopPropagation();
      this.saveSlot(matchId, side, row.querySelector("select").value || null);
    });
    row.querySelector("select").focus();
  },

  async saveSlot(matchId, side, playerId) {
    try {
      await api(`/api/admin/tournaments/${encodeURIComponent(this.tournament.id)}`, {
        method: "PUT", body: JSON.stringify({ bracketSlotUpdate: { matchId, slot: side, playerId } })
      });
      await this.reload();
      showToast("Participante actualizado.");
    } catch (error) { showToast(`No se pudo actualizar la casilla: ${error.message}`); }
  },

  async swapSlots(from, to) {
    if (from.matchId === to.matchId && from.slot === to.slot) return;
    try {
      await api(`/api/admin/tournaments/${encodeURIComponent(this.tournament.id)}`, {
        method: "PUT", body: JSON.stringify({ bracketSlotSwap: { from, to } })
      });
      await this.reload();
      showToast("Sembrado actualizado.");
    } catch (error) { showToast(`No se pudo intercambiar el sembrado: ${error.message}`); }
  },

  openInlineScore(matchId) {
    const match = (this.tournament.matches || []).find(item => item.id === matchId);
    const host = this.el.querySelector(`[data-score-for="${CSS.escape(matchId)}"]`);
    if (!match || !host) return;
    host.innerHTML = `<div class="be-inline-editor">
      <label>Marcador<input name="score" placeholder="6-4, 4-6, 7-6*" value="${escapeHtml(match.score === "BYE" ? "" : (match.score || ""))}"></label>
      <label>Fecha<input name="date" type="date" value="${escapeHtml(match.date || "")}"></label>
      <label>Cancha<input name="court" maxlength="120" value="${escapeHtml(match.court || "")}"></label>
      <div class="be-inline-buttons"><button class="btn btn-sm btn-primary" data-save-result>Guardar resultado</button><button class="btn btn-sm btn-secondary" data-save-schedule>Guardar fecha</button></div>
    </div>`;
    host.querySelector("[data-save-result]").addEventListener("click", () => this.saveInlineResult(matchId, host));
    host.querySelector("[data-save-schedule]").addEventListener("click", () => this.saveInlineSchedule(matchId, host));
    host.querySelector('input[name="score"]').focus();
  },

  parseScore(value) {
    const sets = String(value || "").split(",").map(raw => {
      const match = raw.trim().match(/^(\d{1,2})-(\d{1,2})(\*)?$/);
      return match ? [Number(match[1]), Number(match[2]), Boolean(match[3])] : null;
    });
    return sets.length >= 1 && sets.length <= 3 && sets.every(Boolean) ? sets : null;
  },

  async saveInlineResult(matchId, host) {
    const sets = this.parseScore(host.querySelector('input[name="score"]').value);
    if (!sets) { showToast("Formato inválido. Ejemplo: 6-4, 4-6, 7-6*"); return; }
    const date = host.querySelector('input[name="date"]').value;
    const court = host.querySelector('input[name="court"]').value;
    try {
      await api(`/api/admin/tournaments/${encodeURIComponent(this.tournament.id)}`, {
        method: "PUT",
        body: JSON.stringify({ matchResult: { matchId, sets, status: "completed", date, court } })
      });
      await this.reload();
      showToast("Resultado guardado y ganador avanzado.");
    } catch (error) { showToast(`No se pudo guardar el resultado: ${error.message}`); }
  },

  async saveInlineSchedule(matchId, host) {
    try {
      await api(`/api/admin/tournaments/${encodeURIComponent(this.tournament.id)}`, {
        method: "PUT",
        body: JSON.stringify({ matchScheduleUpdate: {
          matchId,
          date: host.querySelector('input[name="date"]').value,
          court: host.querySelector('input[name="court"]').value
        } })
      });
      await this.reload();
      showToast("Fecha y cancha guardadas.");
    } catch (error) { showToast(`No se pudo guardar la programación: ${error.message}`); }
  },

  async advanceGroups() {
    const qualifiersPerGroup = Number(this.el.querySelector("#beQualifiersPerGroup")?.value || 2);
    try {
      await api(`/api/admin/tournaments/${encodeURIComponent(this.tournament.id)}`, {
        method: "PUT", body: JSON.stringify({ advanceGroups: { qualifiersPerGroup } })
      });
      await this.reload();
      showToast("Clasificados avanzados a la fase final.");
    } catch (error) { showToast(`No se pudieron generar las eliminatorias: ${error.message}`); }
  },

  async setBracketSize() {
    const size = Number(prompt("Tamaño del cuadro (4, 8, 16, 32 o 64):", this.tournament.bracketSize || 8));
    if (![4,8,16,32,64].includes(size)) { showToast("Elige 4, 8, 16, 32 o 64."); return; }
    try {
      await api(`/api/admin/tournaments/${encodeURIComponent(this.tournament.id)}`, {
        method: "PUT", body: JSON.stringify({ bracketSize: size })
      });
      await this.reload();
      showToast(`Tamaño de cuadro guardado: ${size}.`);
    } catch (error) { showToast(`No se pudo guardar el tamaño: ${error.message}`); }
  },

  drawConnectors() {
    if (!this.el) return;
    const stage = this.el.querySelector("#bracketStage");
    const svg = stage?.querySelector(".be-connectors");
    if (!stage || !svg) return;
    const rect = stage.getBoundingClientRect();
    const width = Math.max(stage.scrollWidth, rect.width);
    const height = Math.max(stage.scrollHeight, rect.height);
    svg.setAttribute("width", width);
    svg.setAttribute("height", height);
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.innerHTML = "";
    const stageRect = stage.getBoundingClientRect();
    const scaleX = stage.offsetWidth ? stageRect.width / stage.offsetWidth : 1;
    const scaleY = stage.offsetHeight ? stageRect.height / stage.offsetHeight : 1;
    const toPoint = element => {
      const r = element.getBoundingClientRect();
      return {
        left: (r.left - stageRect.left) / (scaleX || 1) + stage.scrollLeft,
        right: (r.right - stageRect.left) / (scaleX || 1) + stage.scrollLeft,
        y: (r.top - stageRect.top + r.height / 2) / (scaleY || 1) + stage.scrollTop
      };
    };
    (this.tournament.matches || []).filter(match => match.stageId !== "groups" && match.nextMatchId).forEach(match => {
      const from = stage.querySelector(`.bracket-engine__match[data-match-id="${CSS.escape(match.id)}"]`);
      const to = stage.querySelector(`.bracket-engine__match[data-match-id="${CSS.escape(match.nextMatchId)}"] .be-row[data-slot="${match.nextSlot === "B" ? "B" : "A"}"]`);
      if (!from || !to) return;
      const a = toPoint(from), b = toPoint(to);
      const xMid = a.right + Math.max(18, (b.left - a.right) / 2);
      this.appendConnector(svg, `M ${a.right} ${a.y} H ${xMid} V ${b.y} H ${b.left}`);
    });
    const playoffSlots = stage.querySelectorAll('.bracket-engine__match[data-stage-id="playoff"] .be-row[data-player-id]');
    const qualifiers = new Set(this.tournament.qualifiedPlayerIds || []);
    stage.querySelectorAll("[data-group-player]").forEach(row => {
      const playerId = row.dataset.groupPlayer;
      if (!qualifiers.has(playerId)) return;
      const target = [...playoffSlots].find(slot => slot.dataset.playerId === playerId);
      if (!target) return;
      const a = toPoint(row), b = toPoint(target);
      const xMid = a.right + Math.max(18, (b.left - a.right) / 2);
      this.appendConnector(svg, `M ${a.right} ${a.y} H ${xMid} V ${b.y} H ${b.left}`, true);
    });
  },

  appendConnector(svg, pathData, isQualification = false) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", pathData);
    path.setAttribute("class", isQualification ? "be-connector is-qualification" : "be-connector");
    svg.appendChild(path);
  },

  exportSvg() {
    const stage = this.el?.querySelector("#bracketStage");
    if (!stage) return;
    const clone = stage.cloneNode(true);
    const connector = clone.querySelector(".be-connectors");
    if (connector) connector.style.position = "absolute";
    clone.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
    const markup = `<svg xmlns="http://www.w3.org/2000/svg" width="${stage.scrollWidth}" height="${stage.scrollHeight}"><foreignObject width="100%" height="100%">${new XMLSerializer().serializeToString(clone)}</foreignObject></svg>`;
    const blob = new Blob([markup], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${(this.tournament.title || "main-draw").replace(/[^a-z0-9-_]+/gi, "-")}.svg`;
    link.click();
    URL.revokeObjectURL(url);
  }
};

window.BracketEngine = BracketEngine;
