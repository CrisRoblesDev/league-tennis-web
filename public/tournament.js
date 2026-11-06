/* Tournament center — ported from the reference “Punto de Partido” experience. */
(() => {
  const FORMATS = {
    robin: { label: "Round robin", stages: ["Todos contra todos"], groups: ["Grupo único"] },
    knockout: { label: "Eliminación directa", stages: ["Octavos de final", "Cuartos de final", "Semifinal", "Final"], groups: [] },
    groups: { label: "Grupos + eliminatoria", stages: ["Fase de grupos", "Semifinal", "Final"], groups: ["Grupo A", "Grupo B"] },
    double: { label: "Doble eliminación", stages: ["Cuadro principal", "Cuadro de repesca", "Gran final"], groups: [] },
    league: { label: "Liga", stages: ["Jornada 1", "Jornada 2", "Jornada 3"], groups: ["Liga única"] }
  };
  const STATUSES = ["abierto", "en proceso", "cerrado"];
  const esc = value => String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[character]));

  let serial = 0;
  function uid() {
    serial += 1;
    return `x${Date.now().toString(36)}${serial.toString(36)}`;
  }

  const makeStages = mode => (FORMATS[mode] || FORMATS.knockout).stages.map((name, index) => ({
    id: uid(),
    name,
    kind: (mode === "groups" || mode === "robin" || mode === "league") && index === 0 ? "groups" : "bracket"
  }));
  const makeGroups = mode => (FORMATS[mode] || FORMATS.knockout).groups.map(name => ({ id: uid(), name }));
  const today = () => new Date().toISOString().slice(0, 10);

  async function request(payload) {
    const response = await fetch("/api/tournaments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Error del servidor (${response.status})`);
    return data;
  }

  function mount(rootOrSelector, options = {}) {
    const root = typeof rootOrSelector === "string" ? document.querySelector(rootOrSelector) : rootOrSelector;
    if (!root) return null;

    root.innerHTML = `
      <div class="tournament-app">
        <div class="ta-notice" role="status" aria-live="polite" hidden></div>
        <div class="ta-app"></div>
        <div class="ta-modal-root"></div>
      </div>
    `;
    const shell = root.querySelector(".tournament-app");
    const app = root.querySelector(".ta-app");
    const modalRoot = root.querySelector(".ta-modal-root");
    const notice = root.querySelector(".ta-notice");
    const $id = id => root.querySelector(`#${id}`);

    let tournaments = [];
    let users = [];
    let currentUserId = options.currentUserId || null;
    let isAdmin = Boolean(options.isAdmin);
    const view = options.mode === "admin" ? "admin" : "public";
    const showRankings = options.showRankings === true;
    let page = "home";
    let tab = "summary";
    let activeId = null;
    let selectedUser = currentUserId;
    let wizard = null;
    let drag = null;
    let modalReturn = null;
    let drawZoom = 0.75;
    let saveChain = Promise.resolve();
    // New: track which participant belongs to which group (participantId -> groupId)
    let groupAssignments = new Map();

    const tNow = () => tournaments.find(tournament => tournament.id === activeId);
    const name = id => users.find(user => user.id === id)?.name || "Por asignar";
    const stageName = (tournament, id) => tournament.stages.find(stage => stage.id === id)?.name || "Etapa";
    const date = value => value
      ? new Date(`${value}T12:00:00`).toLocaleDateString("es-CL", { day: "numeric", month: "short", year: "numeric" })
      : "Sin fecha";
    const adminView = () => view === "admin" && isAdmin;
    const btn = (text, action, id = "", style = "secondary") =>
      `<button type="button" class="button ${style} small" data-action="${action}" data-id="${esc(id)}">${esc(text)}</button>`;
    const pill = status => `<span class="pill ${status === "abierto" ? "open" : status === "en proceso" ? "progress" : "closed"}">${esc(status)}</span>`;
    const member = id => users.some(user => user.id === id);
    const winner = match => match && match.sa !== null && match.sb !== null && match.sa !== match.sb
      ? (match.sa > match.sb ? match.a : match.b)
      : null;

    function notify(text) {
      notice.textContent = text;
      notice.hidden = false;
      clearTimeout(notify.timer);
      notify.timer = setTimeout(() => { notice.hidden = true; }, 5000);
    }

    function render() {
      if (page === "wizard" && adminView()) renderWizard();
      else if (page === "detail" && tNow()) renderDetail();
      else {
        page = "home";
        renderHome();
      }
    }

    function scoreTable(tournament) {
      const ids = tournament
        ? tournament.participants
        : users.filter(user => user.role === "miembro").map(user => user.id);
      const matches = tournament ? tournament.matches : tournaments.flatMap(item => item.matches);
      const rows = ids.map(id => ({
        id,
        played: matches.filter(match => (match.a === id || match.b === id) && winner(match)).length,
        wins: matches.filter(match => winner(match) === id).length
      })).sort((left, right) => right.wins - left.wins || right.played - left.played || name(left.id).localeCompare(name(right.id)));
      return `<div class="overflow-x-auto mt-4"><table class="table"><thead><tr><th>#</th><th>Jugador</th><th>Jugados</th><th>Victorias</th><th>Puntos</th></tr></thead><tbody>${
        rows.map((row, index) => `<tr><td>${index + 1}</td><td class="font-bold">${esc(name(row.id))}</td><td>${row.played}</td><td>${row.wins}</td><td>${row.wins * 3}</td></tr>`).join("") ||
        '<tr><td colspan="5">Sin participantes.</td></tr>'
      }</tbody></table></div>`;
    }

    function renderHome() {
      const admin = adminView();
      const ranking = showRankings ? `<section class="mt-9" aria-label="Rankings"><p class="eyebrow text-[#598044] mb-2">TEMPORADA 2026</p><h2 class="display text-3xl font-bold mb-5">Rankings</h2><div class="grid lg:grid-cols-2 gap-5"><div class="card p-5"><h3 class="font-bold">Ranking general 2026</h3><p class="muted text-sm">3 puntos por victoria registrada.</p>${scoreTable(null)}</div><div class="card p-5"><h3 class="font-bold">Ranking por torneo</h3><label class="label mt-3" for="ranking-tournament">Torneo</label><select id="ranking-tournament" class="field">${tournaments.map(tournament => `<option value="${esc(tournament.id)}">${esc(tournament.name)}</option>`).join("")}</select><div id="ranking-body">${tournaments.length ? scoreTable(tournaments[0]) : '<p class="muted mt-4">Sin torneos.</p>'}</div></div></div></section>` : "";
      app.innerHTML = `<div class="fade"><div class="flex flex-wrap justify-between items-end gap-4 mb-6"><div><p class="eyebrow text-[#598044] mb-2">${admin ? "CENTRO DE CONTROL" : "EN LA CANCHA"}</p><h2 class="display text-3xl md:text-4xl font-bold">${admin ? "Panel de torneos" : "Explora los torneos"}</h2><p class="muted mt-2">${admin ? "Organiza jugadores, partidos y cuadros." : "Consulta los cuadros e inscríbete para jugar."}</p></div>${
        admin
          ? `<div class="flex flex-wrap items-center gap-2"><span class="pill">${tournaments.length} torneos</span>${btn("+ Crear torneo", "wizard-start", "", "light")}</div>`
          : ""
      }</div><div class="grid md:grid-cols-2 gap-5">${
        tournaments.map((tournament, index) => `<article class="card overflow-hidden"><div class="h-2 ${index % 2 ? "bg-[#a3c979]" : "bg-[#d9f274]"}"></div><div class="p-6"><div class="flex justify-between gap-2 mb-5"><span class="eyebrow text-[#69845b]">TORNEO ${String(index + 1).padStart(2, "0")} · 2026</span>${pill(tournament.status)}</div><h3 class="display text-2xl font-bold mb-2">${esc(tournament.name)}</h3><p class="muted text-sm">${esc(tournament.description)}</p><div class="grid grid-cols-2 gap-3 my-5 py-4 border-y border-[#dce5d8] text-sm"><div><span class="muted block text-xs">Formato</span><strong>${esc((FORMATS[tournament.mode] || FORMATS.knockout).label)}</strong></div><div><span class="muted block text-xs">Inicio</span><strong>${date(tournament.date)}</strong></div><div><span class="muted block text-xs">Jugadores</span><strong>${tournament.participants.length} / ${tournament.capacity}</strong></div><div><span class="muted block text-xs">Sede</span><strong>${esc(tournament.venue || "Por definir")}</strong></div></div><div class="flex flex-wrap gap-2">${btn(admin ? "Gestionar" : "Ver torneo", "open", tournament.id, "")}${btn("Main Draw", "open-draw", tournament.id)}</div></div></article>`).join("")
      }</div>${ranking}</div>`;
    }

    function renderDetail() {
      const tournament = tNow();
      const admin = adminView();
      app.innerHTML = `<div class="fade"><button type="button" class="text-sm font-bold text-[#30634b] mb-5" data-action="back">← Todos los torneos</button><div class="card p-5 md:p-7 mb-5"><div class="flex justify-between flex-wrap gap-4"><div><p class="eyebrow text-[#668957] mb-2">${admin ? "ADMINISTRACIÓN" : "VISTA PÚBLICA"} · ${esc(tournament.category)}</p><h2 class="display text-3xl md:text-4xl font-bold">${esc(tournament.name)}</h2><p class="muted mt-2">${esc(tournament.description)}</p></div>${pill(tournament.status)}</div></div>${admin ? "" : `<p class="muted text-xs mb-5">Solo los miembros pueden inscribirse y jugar.</p>`}<nav class="tabs mb-5" aria-label="Secciones del torneo">${
        [["summary", "Resumen"], ["players", admin ? "Participantes e inscripciones" : "Participantes"], ["matches", "Partidos"], ["draw", "Main Draw"]].map(([key, label]) =>
          `<button type="button" class="tab ${tab === key ? "active" : ""}" data-action="tab" data-id="${key}" aria-current="${tab === key ? "page" : "false"}">${label}</button>`
        ).join("")
      }</nav><section id="detail-content" aria-label="Contenido del torneo"></section></div>`;
      renderDetailContent();
    }

    function renderDetailContent() {
      const tournament = tNow();
      const admin = adminView();
      const el = $id("detail-content");
      if (!el) return;

      if (tab === "summary") {
        el.innerHTML = `<div class="grid md:grid-cols-[1.3fr_1fr] gap-5"><div class="card p-6"><h3 class="display text-2xl font-bold mb-5">Ficha del torneo</h3><div class="grid grid-cols-2 gap-5 text-sm">${
          [
            ["Formato", (FORMATS[tournament.mode] || FORMATS.knockout).label],
            ["Categoría", tournament.category],
            ["Inicio", date(tournament.date)],
            ["Fin", date(tournament.end)],
            ["Sede", tournament.venue || "Por definir"],
            ["Cupos", `${tournament.participants.length} / ${tournament.capacity}`],
            ["Etapas", tournament.stages.map(stage => stage.name).join(" · ")],
            ["Grupos", tournament.groups.map(group => group.name).join(" · ") || "Sin grupos"]
          ].map(([label, value]) => `<div><span class="muted block text-xs mb-1">${label}</span><strong>${esc(value)}</strong></div>`).join("")
        }</div></div><div class="card p-6"><h3 class="font-bold mb-3">Estado y accesos</h3>${
          admin
            ? `<label class="label" for="t-status">Estado del torneo</label><select id="t-status" class="field mb-4">${STATUSES.map(status => `<option ${status === tournament.status ? "selected" : ""}>${status}</option>`).join("")}</select>${btn("Editar ficha y fechas", "edit-tournament")}`
            : '<p class="muted text-sm mb-4">Sigue los participantes, partidos y resultados actualizados.</p>'
        }<div class="flex flex-wrap gap-2 mt-4">${btn("Participantes", "tab", "players")}${btn("Partidos", "tab", "matches")}${btn("Main Draw", "tab", "draw")}</div></div></div>`;
      }

      if (tab === "players") {
        const publicActions = !currentUserId
          ? '<p class="muted">Inicia sesión para inscribirte.</p>'
          : selectedUser !== currentUserId
            ? '<p class="muted">Estás viendo otra cuenta. Solo puedes gestionar tu propia inscripción.</p>'
            : tournament.participants.includes(selectedUser)
              ? btn("Retirar mi inscripción", "withdraw", selectedUser, "danger")
              : tournament.requests.includes(selectedUser)
                ? btn("Cancelar solicitud", "cancel-request", selectedUser, "danger")
                : tournament.status !== "abierto"
                  ? '<p class="muted">Las inscripciones no están abiertas.</p>'
                  : tournament.participants.length >= tournament.capacity
                    ? '<p class="muted">No quedan cupos.</p>'
                    : btn("Solicitar inscripción", "enroll", selectedUser, "");
        el.innerHTML = `<div class="grid md:grid-cols-[1.2fr_1fr] gap-5"><div class="card p-6"><div class="flex justify-between gap-2"><h3 class="display text-2xl font-bold">Participantes</h3><span class="pill">${tournament.participants.length} / ${tournament.capacity}</span></div><p class="muted text-xs mt-2">${admin ? "Arrastra para cambiar el orden de siembra; también puedes usar las flechas." : "Jugadores inscritos en este torneo."}</p><div class="mt-4 space-y-2">${
          tournament.participants.map((id, index) => `<div class="flex justify-between items-center gap-2 rounded-xl border border-[#dce5d8] p-3 text-sm ${admin ? "draggable" : ""}" ${admin ? `draggable="true" data-drag="player" data-id="${esc(id)}" data-drop="player"` : ""}><span><strong class="text-[#679043] mr-3">${String(index + 1).padStart(2, "0")}</strong>${esc(name(id))}</span>${
            admin
              ? `<span class="flex flex-wrap gap-1">${btn("↑", "move-player-up", id)}${btn("↓", "move-player-down", id)}${btn("Editar", "edit-player", id)}${btn("Retirar", "remove", id, "danger")}</span>`
              : selectedUser === id ? '<span class="pill open">Inscrito</span>' : ""
          }</div>`).join("") || '<p class="muted text-sm">Aún no hay participantes.</p>'
        }</div></div><div class="card p-6"><h3 class="font-bold mb-3">${admin ? "Gestionar inscripciones" : "Tu inscripción"}</h3>${
          admin
            ? `<p class="muted text-sm mb-4">Solo los miembros pueden jugar.</p><label for="add-player" class="label">Añadir miembro</label><div class="flex gap-2 mb-5"><select id="add-player" class="field">${users.filter(user => member(user.id) && !tournament.participants.includes(user.id)).map(user => `<option value="${esc(user.id)}">${esc(user.name)}</option>`).join("")}</select>${btn("Añadir", "add-player", "", "")}</div><h4 class="font-bold mb-2">Solicitudes pendientes (${tournament.requests.length})</h4><div class="space-y-2">${
              tournament.requests.map(id => `<div class="fixture"><strong>${esc(name(id))}</strong><div class="flex gap-2 mt-2">${btn("Aprobar", "approve", id, "")}${btn("Rechazar", "reject", id, "danger")}</div></div>`).join("") || '<p class="muted text-sm">No hay solicitudes pendientes.</p>'
            }</div>`
            : `<p class="muted text-sm mb-4">Usuario: <strong>${esc(name(selectedUser))}</strong></p>${publicActions}`
        }</div></div>`;
      }

      if (tab === "matches") {
        const groupStageIds = tournament.stages.filter(s => s.kind === "groups").map(s => s.id);
        el.innerHTML = `<div class="grid ${admin ? "lg:grid-cols-[1fr_1.4fr]" : ""} gap-5">${
          admin
            ? `<form id="match-form" class="card p-6"><h3 class="display text-2xl font-bold mb-4">Asignar partido</h3><div class="space-y-3"><div><label class="label" for="match-stage">Etapa</label><select id="match-stage" class="field">${tournament.stages.map(stage => `<option value="${esc(stage.id)}">${esc(stage.name)} (${stage.kind})</option>`).join("")}</select></div><div><label class="label" for="match-group">Grupo (requerido para fase de grupos)</label><select id="match-group" class="field"><option value="">Sin grupo</option>${tournament.groups.map(group => `<option value="${esc(group.id)}">${esc(group.name)}</option>`).join("")}</select></div><div class="grid grid-cols-2 gap-2"><div><label class="label" for="match-a">Jugador A</label><select id="match-a" class="field"><option value="">Elegir</option>${tournament.participants.map(id => `<option value="${esc(id)}">${esc(name(id))}</option>`).join("")}</select></div><div><label class="label" for="match-b">Jugador B</label><select id="match-b" class="field"><option value="">Elegir</option>${tournament.participants.map(id => `<option value="${esc(id)}">${esc(name(id))}</option>`).join("")}</select></div></div><div><label class="label" for="match-date">Fecha y hora</label><input id="match-date" type="datetime-local" class="field"></div><p class="muted text-xs" id="match-form-hint"></p><button type="submit" class="button w-full">Agregar partido</button></div></form>`
            : ""
        }<div class="card p-6"><div class="flex justify-between flex-wrap gap-2"><h3 class="display text-2xl font-bold">Calendario y resultados</h3><span class="pill">${tournament.matches.length} partidos</span></div><div class="space-y-3 mt-5">${
          tournament.matches.map(match => `<div class="fixture"><div class="flex justify-between gap-2"><span class="eyebrow text-[#69845b]">${esc(stageName(tournament, match.stageId))}${match.groupId ? ` · ${esc(tournament.groups.find(group => group.id === match.groupId)?.name || "")}` : ""}</span><span class="muted text-xs">${match.date ? new Date(match.date).toLocaleString("es-CL", { dateStyle: "medium", timeStyle: "short" }) : "Por programar"}</span></div><p class="font-bold mt-2">${esc(name(match.a))} <span class="muted">vs.</span> ${esc(name(match.b))}</p><p class="muted text-sm mt-1">${winner(match) ? `${match.sa} – ${match.sb} · Ganador: ${esc(name(winner(match)))}` : "Resultado pendiente"}</p>${admin ? `<div class="flex gap-2 mt-3">${btn("Editar / resultado", "edit-match", match.id)}${btn("Eliminar", "delete-match", match.id, "danger")}</div>` : ""}</div>`).join("") || '<p class="muted text-sm">Todavía no hay partidos asignados.</p>'
        }</div></div></div>`;
        // Dynamic player filtering by group when stage changes
        const stageSel = $id("match-stage");
        const groupSel = $id("match-group");
        const playerA = $id("match-a");
        const playerB = $id("match-b");
        const hint = $id("match-form-hint");
        function updatePlayerOptions() {
          const stageId = stageSel?.value;
          const groupId = groupSel?.value;
          const stage = tournament.stages.find(s => s.id === stageId);
          const isGroupStage = stage && stage.kind === "groups";
          const players = groupId
            ? tournament.participants.filter(pId => tournament.groupAssignments?.[pId] === groupId)
            : isGroupStage
              ? [] // Require group selection for group stages
              : tournament.participants;
          const options = players.map(id => `<option value="${esc(id)}">${esc(name(id))}</option>`).join("");
          if (playerA) playerA.innerHTML = `<option value="">Elegir${groupId ? "" : isGroupStage ? " (selecciona grupo)" : ""}</option>${options}`;
          if (playerB) playerB.innerHTML = `<option value="">Elegir${groupId ? "" : isGroupStage ? " (selecciona grupo)" : ""}</option>${options}`;
          if (hint) {
            if (isGroupStage && !groupId) hint.textContent = "Selecciona un grupo para ver sus jugadores";
            else if (isGroupStage && groupId && players.length < 2) hint.textContent = "Este grupo necesita al menos 2 jugadores asignados";
            else hint.textContent = "";
          }
        }
        if (stageSel) stageSel.addEventListener("change", () => {
          const stage = tournament.stages.find(s => s.id === stageSel.value);
          if (stage && stage.kind === "groups" && tournament.groups.length) {
            groupSel.style.display = "";
            groupSel.required = true;
          } else {
            groupSel.style.display = "none";
            groupSel.required = false;
            groupSel.value = "";
          }
          updatePlayerOptions();
        });
        if (groupSel) groupSel.addEventListener("change", updatePlayerOptions);
        // Initial
        updatePlayerOptions();
      }

      if (tab === "draw") {
        el.innerHTML = `<div class="card p-5 md:p-6"><div class="flex flex-wrap justify-between gap-3 items-start"><div><p class="eyebrow text-[#668957] mb-2">CUADRO PRINCIPAL</p><h3 class="display text-2xl font-bold">${esc((FORMATS[tournament.mode] || FORMATS.knockout).label)}</h3><p class="muted text-sm mt-1">${admin ? "Gestión por arrastre: arrastra jugadores entre grupos, partidos entre etapas/grupos y reordena con el ratón. Haz clic en un partido para editarlo." : "Los ganadores avanzan conforme se registran los resultados."}</p></div>${
          admin
            ? `<div class="flex flex-wrap gap-2">${btn("+ Participante", "add-participant-draw", "", "")}${btn("+ Partido", "add-match-top", "", "")}${btn("+ Grupo", "add-group")}${btn("+ Etapa", "add-stage", "", "")}${btn("Editar torneo", "edit-tournament")}</div>`
            : `<span class="pill">${tournament.participants.length} jugadores</span>`
        }</div><div class="flex flex-wrap items-center gap-2 mb-3 mt-2"><span class="muted text-xs font-bold">Zoom</span>${btn("−", "zoom-out", "", "secondary")}${btn("+", "zoom-in", "", "secondary")}${btn("Ajustar", "zoom-reset", "", "secondary")}<span class="muted text-xs" id="zoom-label">${Math.round(drawZoom * 100)}%</span></div>${admin ? `<div class="mb-3 p-2 rounded-lg bg-[#f7fbf2] border border-[#dce5d8] text-xs text-[#4b6b3a]">Arrastra jugadores y partidos. Suelta sobre un grupo/etapa para moverlos.</div>` : ""}${drawMarkup(tournament, admin)}</div>`;
      }
      if (tab === "draw") setTimeout(() => {
        drawConnections(); applyDrawZoom();
        const scroll = root.querySelector(".bracket-scroll");
        if (scroll && !scroll.dataset.zoomBound) {
          scroll.dataset.zoomBound = "1";
          scroll.addEventListener("wheel", (e) => {
            e.preventDefault();
            const delta = e.deltaY < 0 ? 0.1 : -0.1;
            drawZoom = Math.min(2, Math.max(0.4, Math.round((drawZoom + delta) * 100) / 100));
            applyDrawZoom();
            drawConnections();
          }, { passive: false });
        }
      }, 50);
    }

    function bracketStages(tournament) {
      return tournament.stages.filter(stage => stage.kind === "bracket");
    }

    function rounds(tournament) {
      const stages = bracketStages(tournament);
      if (!stages.length) return [];
      const size = Math.min(16, Math.max(2, 2 ** Math.ceil(Math.log2(Math.max(tournament.participants.length, 2)))));
      return stages.map((stage, index) => ({
        stage,
        count: Math.max(1, Math.ceil(size / 2 ** (index + 1)))
      }));
    }

    function bracketMatch(tournament, stageId, slot) {
      return tournament.matches.find(match => match.stageId === stageId && match.slot === slot);
    }
    function nextCardNo(tournament) {
      const nums = (tournament.matches || []).map(m => Number(m.cardNo)).filter(n => Number.isInteger(n) && n > 0);
      return nums.length ? Math.max(...nums) + 1 : 1;
    }

    function entrants(tournament, roundIndex, slot) {
      const allRounds = rounds(tournament);
      if (roundIndex === 0) return [tournament.participants[slot * 2] || null, tournament.participants[slot * 2 + 1] || null];
      const previous = allRounds[roundIndex - 1];
      return [0, 1].map(offset => {
        const source = slot * 2 + offset;
        if (source >= previous.count) return null;
        return winner(bracketMatch(tournament, previous.stage.id, source)) || null;
      });
    }

    function groupPlayers(tournament, index) {
      const group = tournament.groups[index];
      if (!group) return [];
      // Use explicit group assignments if available, fall back to modulo for backwards compatibility
      const assigned = tournament.participants.filter(pId => {
        const assignedGroupId = tournament.groupAssignments?.[pId];
        return assignedGroupId === group.id;
      });
      // If no explicit assignments exist, fall back to modulo distribution
      if (assigned.length === 0 && tournament.groupAssignments && Object.keys(tournament.groupAssignments).length === 0) {
        return tournament.participants.filter((_, playerIndex) => playerIndex % tournament.groups.length === index);
      }
      return assigned;
    }

    function groupMatches(tournament, groupId) {
      return tournament.matches.filter(match => match.groupId === groupId);
    }

    function getGroupForPlayer(tournament, playerId) {
      if (tournament.groupAssignments && tournament.groupAssignments[playerId]) {
        return tournament.groupAssignments[playerId];
      }
      // Fallback: calculate from modulo
      const index = tournament.participants.indexOf(playerId);
      if (index >= 0 && tournament.groups.length > 0) {
        return tournament.groups[index % tournament.groups.length]?.id;
      }
      return null;
    }

    function setGroupForPlayer(tournament, playerId, groupId) {
      if (!tournament.groupAssignments) tournament.groupAssignments = {};
      if (groupId) {
        tournament.groupAssignments[playerId] = groupId;
      } else {
        delete tournament.groupAssignments[playerId];
      }
    }

    function drawMarkup(tournament, admin) {
      const allRounds = rounds(tournament);
      const groupStage = tournament.stages.find(stage => stage.kind === "groups");
      const groups = groupStage
        ? `<div class="round" ${admin ? `draggable="true" data-drag="stage" data-id="${esc(groupStage.id)}" data-drop="stage"` : ""}><div class="round-title">${
            admin
              ? `<button type="button" data-action="edit-stage" data-id="${esc(groupStage.id)}" class="text-left hover:underline">${esc(groupStage.name)} ✎</button> ${btn("↑", "move-stage-up", groupStage.id)} ${btn("↓", "move-stage-down", groupStage.id)} ${btn("✕", "delete-stage", groupStage.id, "danger").replace("<button", "<button draggable=\"false\"")}`
              : esc(groupStage.name)
          }</div><div class="round-body">${
            tournament.groups.map((group, index) => {
              const players = groupPlayers(tournament, index);
              const matches = groupMatches(tournament, group.id);
              const win = winner; // reference for use in map
              return `<div class="group-card ${admin ? "draggable" : ""}" ${admin ? `draggable="true" data-drag="group" data-drop="group" data-id="${esc(group.id)}"` : ""}><div class="flex justify-between gap-1 items-center mb-2"><strong class="text-sm">${
                admin
                  ? `<button data-action="edit-group" data-id="${esc(group.id)}" class="hover:underline" type="button">${esc(group.name)} ✎</button>`
                  : esc(group.name)
              }</strong>${admin ? `<span>${btn("↑", "move-group-up", group.id)}${btn("↓", "move-group-down", group.id)}${btn("✕", "delete-group", group.id, "danger").replace("<button", "<button draggable=\"false\"")}</span>` : ""}</div><div class="group-players">${players.map(id => `<div class="slot border-t border-[#dce5d8] ${admin ? "draggable" : ""}" ${admin ? `draggable="true" data-drag="player" data-drop="player" data-id="${esc(id)}"` : ""}>${admin ? `<button type="button" data-action="edit-player" data-id="${esc(id)}" class="text-left hover:underline">${esc(name(id))}</button>` : esc(name(id))}${admin ? ` <button type="button" class="button light small" style="margin-left:6px;" data-action="remove-from-group" data-player-id="${esc(id)}" data-group-id="${esc(group.id)}" draggable="false">Quitar del grupo</button>` : ""}</div>`).join("") || '<p class="muted text-xs">Sin jugadores</p>'}</div>${admin ? `<div class="group-drop-zone" data-drop="group" data-id="${esc(group.id)}" style="margin-top:8px;padding:8px;border:2px dashed #c9dd9d;border-radius:6px;text-align:center;color:#598044;font-size:11px;">Soltar jugador aquí para mover a ${esc(group.name)}</div>` : ""}<div class="group-matches mt-2">${matches.length > 0 ? matches.map(match => {
                const mWin = winner(match);
                return `<div class="match-node group-match ${mWin ? "win" : ""}" data-card-no="${esc(match.cardNo || "")}" data-match-id="${esc(match.id)}" ${admin ? `data-action="draw-match" draggable="true" data-drag="match" data-drop="match" data-id="${esc(match.id)}" role="button" tabindex="0" aria-label="Editar partido de ${esc(group.name)}"` : ""}>
                  <div class="flex justify-between gap-2 text-[10px] muted mb-1">
                    <span>${esc(group.name)}${admin ? ` · #${esc(match.cardNo || match.id)}` : ""}</span>
                    <span>${match.date ? new Date(match.date).toLocaleDateString("es-CL") : "Por programar"}</span>
                  </div>
                  ${[match.a, match.b].map((id, i) => `<div class="slot ${mWin === id && id ? "winner" : ""}" ${admin ? `draggable="true" data-drag="player" data-drop="player" data-id="${esc(id)}"` : ""}>${id ? esc(name(id)) : "— Por definir"}</div>`).join("")}
                  ${admin ? '<span class="muted text-[10px]">Clic para editar · arrastra para mover</span>' : ""}
                  ${admin ? `<button type="button" class="button light small" style="margin-top:6px;" data-action="unir-linea" data-match-id="${esc(match.id)}" draggable="false" title="unir linea">Unir linea</button>` : ""}${admin ? `<button type="button" class="button light small" style="margin-top:6px;margin-left:4px;" data-action="desunir-linea" data-match-id="${esc(match.id)}" draggable="false" title="desunir linea">Desunir linea</button>` : ""}
                </div>`;
              }).join("") : ''}</div>${admin && matches.length > 0 ? `<div class="match-drop-zone" data-drop="group" data-id="${esc(group.id)}" style="margin-top:8px;padding:8px;border:2px dashed #c9dd9d;border-radius:6px;text-align:center;color:#598044;font-size:11px;">Soltar partido aquí para mover a ${esc(group.name)}</div>` : ""}</div>`;
            }).join("") || '<p class="muted text-sm">Añade un grupo.</p>'
          }</div></div>`
        : "";

      // Bracket stages: only show REAL matches, not empty slots. Add "+" buttons for empty slots.
      const columns = allRounds.map((round, roundIndex) => {
        const stageId = round.stage.id;
        const realMatches = tournament.matches.filter(m => m.stageId === stageId && m.slot !== null);
        const maxSlot = realMatches.length > 0 ? Math.max(...realMatches.map(m => m.slot)) : -1;
        const slotsToShow = Math.max(round.count, maxSlot + 1);

        return `<div class="round" ${admin ? `draggable="true" data-drag="stage" data-drop="stage" data-id="${esc(stageId)}"` : ""}><div class="round-title">${
          admin
            ? `<button type="button" data-action="edit-stage" data-id="${esc(stageId)}" class="text-left hover:underline">${esc(round.stage.name)} ✎</button> ${btn("↑", "move-stage-up", stageId)} ${btn("↓", "move-stage-down", stageId)} ${btn("✕", "delete-stage", stageId, "danger").replace("<button", "<button draggable=\"false\"")}`
            : esc(round.stage.name)
        }</div><div class="round-body">${
          Array.from({ length: slotsToShow }, (_, slot) => {
            const match = bracketMatch(tournament, stageId, slot);
            const win = winner(match);
            const last = roundIndex === allRounds.length - 1;
            if (match) {
              const [a, b] = [match.a, match.b];
              return `<div class="match-node ${last ? "last" : ""} ${win ? "win" : ""}" data-slot="${slot}" data-card-no="${esc(match.cardNo || "")}" data-match-id="${esc(match.id)}" ${admin ? `data-action="draw-match" draggable="true" data-drag="match" data-drop="match" data-id="${esc(match.id)}" role="button" tabindex="0" aria-label="Editar partido ${slot + 1} de ${esc(round.stage.name)}"` : ""}><div class="flex justify-between gap-2 text-[10px] muted mb-1"><span>PARTIDO ${slot + 1}${admin ? ` · #${esc(match.cardNo || match.id)}` : ""}</span><span>${match.date ? new Date(match.date).toLocaleDateString("es-CL") : "Por programar"}</span></div>${
                [a, b].map(id => `<div class="slot ${win === id && id ? "winner" : ""}" ${admin && roundIndex === 0 && id ? `draggable="true" data-drag="player" data-drop="player" data-id="${esc(id)}"` : ""}>${id ? esc(name(id)) : "— Por definir"}</div>`).join("")
              }${admin ? '<span class="muted text-[10px]">Clic para editar · arrastra para mover</span>' : ""}${admin ? `<button type="button" class="button light small" style="margin-top:6px;" data-action="unir-linea" data-match-id="${esc(match.id)}" draggable="false" title="unir linea">Unir linea</button>` : ""}${admin ? `<button type="button" class="button light small" style="margin-top:6px;margin-left:4px;" data-action="desunir-linea" data-match-id="${esc(match.id)}" draggable="false" title="desunir linea">Desunir linea</button>` : ""}</div>`;
            }
            // Empty slot (sin botón de creación; el admin usa el botón superior "+ Partido")
            return `<div class="match-node empty-slot ${last ? "last" : ""}" data-slot="${slot}" style="border-style:dashed;border-color:#c9dd9d;background:#f8fdf3;min-height:86px;"></div>`;
          }).join("")
        }</div></div>`;
      }).join("");

      return `<div class="bracket-scroll mt-6" aria-label="Main Draw desplazable"><div class="bracket" style="position:relative;">${groups}${columns || '<p class="muted">Añade una etapa de eliminación para mostrar el cuadro.</p>'}<svg class="draw-connectors" aria-hidden="true" style="position:absolute;top:0;left:0;pointer-events:none;z-index:2;"></svg></div></div>${admin ? '<p class="muted text-xs mt-2">Las flechas permiten reordenar sin arrastrar. Para mover un jugador entre grupos, arrástralo sobre la zona "Soltar jugador aquí" del grupo de destino. Para mover un partido entre grupos, arrástralo sobre la zona "Soltar partido aquí" del grupo de destino. Haz clic en "+ Crear partido" para añadir partidos al cuadro. Las líneas conectan cada partido con el de la siguiente etapa.</p>' : ""}`;
    }

    function applyDrawZoom() {
      const bracket = root.querySelector(".bracket");
      if (!bracket) return;
      bracket.style.zoom = String(drawZoom);
      const label = root.querySelector("#zoom-label");
      if (label) label.textContent = `${Math.round(drawZoom * 100)}%`;
    }
    function drawConnections() {
      const tournament = tNow();
      if (!tournament) return;
      const bracket = root.querySelector(".bracket");
      const svg = root.querySelector(".draw-connectors");
      if (!bracket || !svg) return;
      const stageRect = bracket.getBoundingClientRect();
      const scrollW = Math.max(bracket.scrollWidth, stageRect.width);
      const scrollH = Math.max(bracket.scrollHeight, stageRect.height);
      svg.setAttribute("width", scrollW);
      svg.setAttribute("height", scrollH);
      svg.setAttribute("viewBox", `0 0 ${scrollW} ${scrollH}`);
      svg.innerHTML = "";
      // Las líneas automáticas entre etapas se eliminaron: el admin controla las conexiones manualmente.

      // Manual connections between cards
      const manualConnections = Array.isArray(tournament.connections) ? tournament.connections : [];
      manualConnections.forEach(conn => {
        const fromNode = bracket.querySelector('[data-match-id="' + conn.from + '"]');
        const toNode = bracket.querySelector('[data-match-id="' + conn.to + '"]');
        if (!fromNode || !toNode) return;
        const a = fromNode.getBoundingClientRect();
        const b = toNode.getBoundingClientRect();
        const x1 = (a.right - stageRect.left) + bracket.scrollLeft;
        const y1 = (a.top - stageRect.top + a.height / 2) + bracket.scrollTop;
        const x2 = (b.left - stageRect.left) + bracket.scrollLeft;
        const y2 = (b.top - stageRect.top + b.height / 2) + bracket.scrollTop;
        const mid = (x1 + x2) / 2;
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", `M ${x1} ${y1} H ${mid} V ${y2} H ${x2}`);
        path.setAttribute("class", "draw-connector");
        path.setAttribute("fill", "none");
        path.setAttribute("stroke", "#e07b39");
        path.setAttribute("stroke-width", "2");
        path.setAttribute("stroke-dasharray", "6 4");
        svg.appendChild(path);
      });
    }

    function reconcile(tournament) {
      // Manual management: only clean up matches whose stage/group no longer exists.
      tournament.matches = tournament.matches.filter(match =>
        tournament.stages.some(stage => stage.id === match.stageId) &&
        (!match.groupId || tournament.groups.some(group => group.id === match.groupId))
      );
      if (Array.isArray(tournament.connections)) {
        const ids = new Set(tournament.matches.map(match => match.id));
        tournament.connections = tournament.connections.filter(connection =>
          ids.has(connection.from) && ids.has(connection.to) && connection.from !== connection.to
        );
      }
    }

    function reorder(list, from, to) {
      const first = list.findIndex(item => (typeof item === "string" ? item : item.id) === from);
      const second = list.findIndex(item => (typeof item === "string" ? item : item.id) === to);
      if (first < 0 || second < 0 || first === second) return false;
      list.splice(second, 0, list.splice(first, 1)[0]);
      return true;
    }

    function stepMove(list, id, direction) {
      const index = list.findIndex(item => (typeof item === "string" ? item : item.id) === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= list.length) return false;
      [list[index], list[target]] = [list[target], list[index]];
      return true;
    }

    function queueSave(tournament) {
      if (!isAdmin || !tournament) return Promise.resolve();
      const payload = JSON.parse(JSON.stringify(tournament));
      saveChain = saveChain.then(async () => {
        const data = await request({ action: "save", tournament: payload });
        if (data.tournament) {
          const index = tournaments.findIndex(item => item.id === payload.id);
          if (index >= 0) tournaments[index] = data.tournament;
          else tournaments.unshift(data.tournament);
        }
      }).catch(error => {
        notify(`No se pudo guardar: ${error.message}`);
      });
      return saveChain;
    }

    function refresh(message) {
      const tournament = tNow();
      if (tournament) reconcile(tournament);
      render();
      if (message) notify(message);
      queueSave(tournament);
    }

    function modal(title, body, onSubmit, confirmLabel = "Guardar cambios") {
      modalReturn = document.activeElement;
      modalRoot.innerHTML = `<div class="modal-backdrop"><div class="modal-box" role="dialog" aria-modal="true" aria-labelledby="modal-title"><h2 id="modal-title" class="display text-2xl font-bold mb-4">${esc(title)}</h2><form id="modal-form">${body}<div class="flex flex-wrap justify-end gap-2 mt-6"><button type="button" class="button secondary" id="modal-cancel">Cancelar</button><button type="submit" class="button">${esc(confirmLabel)}</button></div></form></div></div>`;
      $id("modal-cancel").onclick = closeModal;
      $id("modal-form").onsubmit = event => {
        event.preventDefault();
        if (onSubmit(new FormData(event.currentTarget)) !== false) closeModal();
      };
      modalRoot.querySelector("input,select,button")?.focus();
    }

    function closeModal() {
      modalRoot.innerHTML = "";
      modalReturn?.focus();
      modalReturn = null;
    }

    function confirmAction(title, message, run) {
      modal(title, `<p class="muted text-sm">${esc(message)}</p>`, () => { run(); }, "Confirmar");
    }

    const field = (label, key, value = "", type = "text", extra = "") =>
      `<div><label class="label" for="modal-${key}">${esc(label)}</label><input class="field" id="modal-${key}" name="${key}" type="${type}" value="${esc(value)}" ${extra}></div>`;

    function editTournament() {
      const tournament = tNow();
      modal("Editar ficha y fechas", `<div class="grid sm:grid-cols-2 gap-3">${field("Nombre", "name", tournament.name, "text", 'required maxlength="80"')}${field("Cupos", "capacity", tournament.capacity, "number", 'required min="2" max="128"')}${field("Inicio", "date", tournament.date, "date", "required")}${field("Término", "end", tournament.end, "date")}${field("Sede", "venue", tournament.venue)}${field("Categoría", "category", tournament.category)}</div><div class="mt-3"><label class="label" for="modal-description">Descripción</label><textarea id="modal-description" name="description" class="field">${esc(tournament.description)}</textarea></div>`, form => {
        if (form.get("end") && form.get("end") < form.get("date")) {
          notify("La fecha de término debe ser posterior al inicio.");
          return false;
        }
        if (+form.get("capacity") < tournament.participants.length) {
          notify("Los cupos no pueden ser menores al número de inscritos.");
          return false;
        }
        for (const key of ["name", "date", "end", "venue", "category", "description"]) {
          tournament[key] = String(form.get(key)).trim();
        }
        tournament.capacity = +form.get("capacity");
        refresh("Ficha actualizada.");
      });
    }

    function editStructure(kind, id) {
      const tournament = tNow();
      const item = (kind === "stage" ? tournament.stages : tournament.groups).find(entry => entry.id === id);
      if (!item) return;
      modal(kind === "stage" ? "Editar etapa" : "Editar grupo", `${field("Nombre", "name", item.name, "text", 'required maxlength="60"')}${kind === "stage" ? `<div class="mt-3"><label class="label" for="modal-kind">Tipo de etapa</label><select class="field" id="modal-kind" name="kind"><option value="bracket" ${item.kind === "bracket" ? "selected" : ""}>Cuadro eliminatorio</option><option value="groups" ${item.kind === "groups" ? "selected" : ""}>Fase de grupos / liga</option></select></div>` : ""}<div class="mt-4">${btn(`Eliminar ${kind === "stage" ? "etapa" : "grupo"}`, "delete-structure", `${kind}:${id}`, "danger")}</div>`, form => {
        const changed = kind === "stage" && item.kind !== form.get("kind");
        item.name = String(form.get("name")).trim();
        if (kind === "stage") item.kind = form.get("kind");
        if (changed) tournament.matches = tournament.matches.filter(match => match.stageId !== id);
        refresh("Estructura actualizada.");
      });
    }

    function editPlayer(id) {
      const tournament = tNow();
      const index = tournament.participants.indexOf(id);
      modal("Editar participante", `<p class="font-bold mb-3">${esc(name(id))}</p><div><label class="label" for="modal-position">Posición de siembra</label><input class="field" id="modal-position" name="position" type="number" min="1" max="${tournament.participants.length}" value="${index + 1}" required></div><p class="muted text-xs mt-2">La posición determina su ubicación inicial en el cuadro y en los grupos.</p>`, form => {
        const position = +form.get("position") - 1;
        tournament.participants.splice(index, 1);
        tournament.participants.splice(position, 0, id);
        refresh("Participante reubicado.");
      });
    }

    function editMatch(id, stageId = null, slot = null, preGroupId = null) {
      const tournament = tNow();
      const match = tournament.matches.find(item => item.id === id);
      const stage = tournament.stages.find(item => item.id === (match?.stageId || stageId));
      const isBracket = stage?.kind === "bracket";
      const roundIndex = rounds(tournament).findIndex(item => item.stage.id === stage?.id);
      // Manual assignment: never pre-fill players automatically.
      const a = match?.a || "";
      const b = match?.b || "";
      const existingGroupId = match?.groupId || preGroupId;

      // Stage selector for moving matches between stages
      const stageSelect = `<div><label class="label" for="modal-stage">Etapa</label><select class="field" id="modal-stage" name="stage"><option value="">Seleccionar etapa</option>${tournament.stages.map(s => `<option value="${esc(s.id)}" ${(match?.stageId || stage?.id) === s.id ? "selected" : ""}>${esc(s.name)} (${s.kind})</option>`).join("")}</select></div>`;

      // Helper to get players for a group (or all if bracket)
      const getPlayersForGroup = (groupId) => {
        if (!groupId) return tournament.participants;
        return tournament.participants.filter(pId => tournament.groupAssignments?.[pId] === groupId);
      };

      // Initial players based on existing group or match
      const initialPlayers = getPlayersForGroup(existingGroupId);

      const select = (key, value, label) => `<div><label class="label" for="modal-${key}">${label}</label><select class="field" id="modal-${key}" name="${key}" ${isBracket && !match ? "disabled" : ""}><option value="">Por asignar</option>${initialPlayers.map(playerId => `<option value="${esc(playerId)}" ${playerId === value ? "selected" : ""}>${esc(name(playerId))}</option>`).join("")}</select></div>`;

      // Group container - show for group stages
      const showGroupSelector = stage && stage.kind === "groups" && tournament.groups.length;
      const groupContainerHtml = showGroupSelector ? `<div><label class="label" for="modal-group">Grupo <span class="text-red-500">*</span></label><select id="modal-group" name="group" class="field" required><option value="">Seleccionar grupo</option>${tournament.groups.map(group => `<option value="${esc(group.id)}" ${existingGroupId === group.id ? "selected" : ""}>${esc(group.name)}</option>`).join("")}</select></div>` : "";

      modal(match ? "Editar partido" : "Asignar partido", `<p class="muted text-sm mb-4">${esc(stage?.name || "Etapa")} ${slot !== null ? `· partido ${slot + 1}` : ""}</p><div class="space-y-3"><div class="grid grid-cols-2 gap-3">${stageSelect}<div id="modal-group-container">${groupContainerHtml}</div></div><div class="grid grid-cols-2 gap-3">${select("a", a, "Jugador A")}${select("b", b, "Jugador B")}</div><div class="grid grid-cols-2 gap-3">${field("Fecha y hora", "date", match?.date || "", "datetime-local")}<div></div></div><div class="grid grid-cols-2 gap-3">${field("Sets jugador A", "sa", match?.sa ?? "", "number", 'min="0" max="5"')}${field("Sets jugador B", "sb", match?.sb ?? "", "number", 'min="0" max="5"')}</div></div><p class="muted text-xs mt-3" id="match-modal-hint">${showGroupSelector && !existingGroupId ? "Selecciona un grupo para ver sus jugadores" : ""}</p>`, form => {
        const newStageId = form.get("stage");
        const newStage = tournament.stages.find(s => s.id === newStageId);
        const newIsBracket = newStage?.kind === "bracket";

        // When stage changes, update groupId accordingly
        let groupId = form.get("group") || null;
        if (newIsBracket) groupId = null; // Bracket matches don't have groups

        const x = (newIsBracket && !match && slot !== null) ? a : form.get("a");
        const y = (newIsBracket && !match && slot !== null) ? b : form.get("b");
        const sa = form.get("sa");
        const sb = form.get("sb");
        // For group matches, require group and players from that group
        if (!newIsBracket && !groupId) {
          notify("Los partidos de fase de grupos requieren seleccionar un grupo.");
          return false;
        }
        if (!newIsBracket && groupId) {
          const groupPlayers = getPlayersForGroup(groupId);
          if (!groupPlayers.includes(x) || !groupPlayers.includes(y)) {
            notify("Ambos jugadores deben pertenecer al grupo seleccionado.");
            return false;
          }
        }
        const data = {
          stageId: newStageId || stage?.id || match?.stageId,
          groupId,
          a: x || null,
          b: y || null,
          date: form.get("date"),
          sa: sa === "" ? null : +sa,
          sb: sb === "" ? null : +sb,
          slot: newIsBracket
            ? (slot !== null && slot !== undefined
                ? slot
                : (tournament.matches || [])
                    .filter(m => m.stageId === (newStageId || stage?.id))
                    .reduce((mx, m) => Math.max(mx, Number.isInteger(m.slot) ? m.slot : -1), -1) + 1)
            : null
        };
        if (match) Object.assign(match, data);
        else tournament.matches.push({ id: uid(), cardNo: nextCardNo(tournament), ...data });
        refresh("Partido y cuadro actualizados.");
      });

      // Dynamic updates: stage change -> show/hide group selector, group change -> filter players
      setTimeout(() => {
        const stageSel = document.getElementById("modal-stage");
        const groupContainer = document.getElementById("modal-group-container");
        const playerA = document.getElementById("modal-a");
        const playerB = document.getElementById("modal-b");
        const hint = document.getElementById("match-modal-hint");

        function updatePlayerDropdowns(groupId) {
          const isGroupStage = groupId && tournament.groups.some(g => g.id === groupId);
          const players = getPlayersForGroup(groupId);
          const options = players.map(playerId => `<option value="${esc(playerId)}" ${playerId === playerA?.value ? "selected" : ""}>${esc(name(playerId))}</option>`).join("");
          if (playerA) playerA.innerHTML = `<option value="">Por asignar${isGroupStage && !groupId ? " (selecciona grupo)" : ""}</option>${options}`;
          if (playerB) playerB.innerHTML = `<option value="">Por asignar${isGroupStage && !groupId ? " (selecciona grupo)" : ""}</option>${options}`;
          if (hint) hint.textContent = isGroupStage && !groupId ? "Selecciona un grupo para ver sus jugadores" : (isGroupStage && groupId && players.length < 2 ? "Este grupo necesita al menos 2 jugadores asignados" : "");
        }

        if (stageSel && groupContainer) {
          stageSel.addEventListener("change", () => {
            const selectedStage = tournament.stages.find(s => s.id === stageSel.value);
            const isGroupStage = selectedStage && selectedStage.kind === "groups";
            if (isGroupStage && tournament.groups.length) {
              groupContainer.innerHTML = `<div><label class="label" for="modal-group">Grupo <span class="text-red-500">*</span></label><select id="modal-group" name="group" class="field" required><option value="">Seleccionar grupo</option>${tournament.groups.map(group => `<option value="${esc(group.id)}">${esc(group.name)}</option>`).join("")}</select></div>`;
              updatePlayerDropdowns(null);
            } else {
              groupContainer.innerHTML = "";
              updatePlayerDropdowns(null);
            }
          });
        }
        if (groupContainer) {
          groupContainer.addEventListener("change", (e) => {
            if (e.target.id === "modal-group") {
              updatePlayerDropdowns(e.target.value);
            }
          });
        }
        // Initial update if preGroupId
        if (existingGroupId) updatePlayerDropdowns(existingGroupId);
      }, 0);
    }

    function wizardSave() {
      const w = wizard;
      if (!w) return false;
      if (w.step === 0) {
        const nameInput = $id("w-name");
        const capacityInput = $id("w-capacity");
        const startInput = $id("w-date");
        if (!nameInput.reportValidity() || !capacityInput.reportValidity() || !startInput.reportValidity()) return false;
        const endInput = $id("w-end");
        if (endInput.value && endInput.value < startInput.value) {
          notify("Revisa las fechas.");
          return false;
        }
        const oldMode = w.mode;
        Object.assign(w, {
          name: nameInput.value.trim(),
          capacity: +capacityInput.value,
          date: startInput.value,
          end: endInput.value,
          mode: $id("w-mode").value,
          status: $id("w-status").value,
          venue: $id("w-venue").value.trim(),
          category: $id("w-category").value.trim(),
          description: $id("w-description").value.trim()
        });
        if (oldMode !== w.mode) {
          w.stages = makeStages(w.mode);
          w.groups = makeGroups(w.mode);
        }
      } else if (w.step === 1) {
        root.querySelectorAll("[data-structure-input]").forEach(input => {
          const item = (input.dataset.structureInput === "stage" ? w.stages : w.groups).find(entry => entry.id === input.dataset.id);
          if (item) item.name = input.value.trim();
        });
        if (w.stages.some(stage => !stage.name) || w.groups.some(group => !group.name)) {
          notify("Todas las etapas y grupos necesitan un nombre.");
          return false;
        }
        w.participants = [...root.querySelectorAll(".w-member:checked")].map(input => input.value);
        if (w.participants.length > w.capacity) {
          notify("Hay más jugadores que cupos.");
          return false;
        }
      }
      return true;
    }

    function renderWizard() {
      const w = wizard;
      app.innerHTML = `<div class="fade max-w-5xl mx-auto"><button type="button" data-action="back" class="text-sm font-bold text-[#30634b] mb-5">← Volver a torneos</button><p class="eyebrow text-[#668957] mb-2">NUEVO TORNEO</p><h2 class="display text-3xl md:text-4xl font-bold">Construye tu torneo</h2><p class="muted mt-2 mb-5">Del primer saque al cuadro final, paso a paso.</p><ol class="grid grid-cols-3 gap-2 mb-5">${
        ["01 · Detalles", "02 · Etapas y grupos", "03 · Preview"].map((step, index) =>
          `<li class="rounded-xl p-3 text-xs md:text-sm font-bold ${index === w.step ? "bg-[#194f3d] text-white" : index < w.step ? "bg-[#e6f2d1]" : "bg-white border border-[#dce5d8]"}">${step}</li>`
        ).join("")
      }</ol><div id="wizard-content" class="card p-5 md:p-8"></div></div>`;
      const el = $id("wizard-content");

      if (w.step === 0) {
        el.innerHTML = `<h3 class="display text-2xl font-bold mb-5">Detalles del torneo</h3><div class="grid md:grid-cols-2 gap-4">${field("Nombre del torneo *", "name", w.name, "text", 'required maxlength="80"').replaceAll("modal-", "w-")}${field("Cantidad de participantes *", "capacity", w.capacity, "number", 'required min="2" max="128"').replaceAll("modal-", "w-")}<div><label class="label" for="w-mode">Tipo de campeonato</label><select class="field" id="w-mode">${Object.entries(FORMATS).map(([key, value]) => `<option value="${key}" ${key === w.mode ? "selected" : ""}>${value.label}</option>`).join("")}</select></div><div><label class="label" for="w-status">Estado</label><select class="field" id="w-status">${STATUSES.map(status => `<option ${w.status === status ? "selected" : ""}>${status}</option>`).join("")}</select></div>${field("Fecha de inicio *", "date", w.date, "date", "required").replaceAll("modal-", "w-")}${field("Fecha de término", "end", w.end, "date").replaceAll("modal-", "w-")}${field("Sede", "venue", w.venue).replaceAll("modal-", "w-")}${field("Categoría", "category", w.category).replaceAll("modal-", "w-")}<div class="md:col-span-2"><label class="label" for="w-description">Descripción</label><textarea id="w-description" class="field">${esc(w.description)}</textarea></div></div><div class="flex justify-end mt-7">${btn("Continuar →", "wizard-next", "", "")}</div>`;
      }

      if (w.step === 1) {
        el.innerHTML = `<h3 class="display text-2xl font-bold mb-2">Etapas y grupos</h3><p class="muted text-sm mb-5">Arrastra para reordenar o usa las flechas.</p><div class="grid md:grid-cols-2 gap-6">${
          [["stage", "Etapas", w.stages], ["group", "Grupos", w.groups]].map(([kind, title, items]) => `<div><h4 class="font-bold mb-3">${title}</h4><div class="space-y-2" style="max-height:260px;overflow-y:auto;padding-right:4px;">${
            items.map((item, index) => `<div class="flex flex-wrap gap-1 p-2 rounded-xl border border-[#dce5d8] bg-white draggable" draggable="true" data-drag="${kind}" data-drop="${kind}" data-id="${esc(item.id)}"><label class="sr-only" for="edit-${esc(item.id)}">Nombre ${title.toLowerCase()} ${index + 1}</label><input id="edit-${esc(item.id)}" data-structure-input="${kind}" data-id="${esc(item.id)}" class="field !w-[130px] flex-1" value="${esc(item.name)}">${btn("↑", "wizard-move-up", `${kind}:${item.id}`)}${btn("↓", "wizard-move-down", `${kind}:${item.id}`)}${btn("×", "wizard-remove", `${kind}:${item.id}`, "danger")}</div>`).join("")
          }</div><div class="mt-3">${btn(`+ Añadir ${kind === "stage" ? "etapa" : "grupo"}`, "wizard-add", kind, "")}</div></div>`).join("")
        }</div><div class="mt-7 border-t border-[#dce5d8] pt-5"><h4 class="font-bold mb-2">Participantes iniciales <span class="muted font-normal">(opcional)</span></h4><div class="grid sm:grid-cols-2 md:grid-cols-3 gap-2">${
          users.filter(user => member(user.id)).map(user => `<label class="flex gap-2 items-center text-sm rounded-lg border border-[#dce5d8] p-2"><input type="checkbox" class="w-member" value="${esc(user.id)}" ${w.participants.includes(user.id) ? "checked" : ""}>${esc(user.name)}</label>`).join("")
        }</div></div><div class="flex justify-between mt-7">${btn("← Atrás", "wizard-prev")}${btn("Ver preview →", "wizard-next", "", "")}</div>`;
      }

      if (w.step === 2) {
        el.innerHTML = `<h3 class="display text-2xl font-bold mb-2">Preview del Main Draw</h3><p class="muted text-sm mb-5">Revisa la estructura antes de crear el torneo.</p><div class="rounded-xl bg-[#edf5e3] p-4 text-sm"><strong>${esc(w.name)}</strong> · ${esc((FORMATS[w.mode] || FORMATS.knockout).label)} · ${w.participants.length}/${w.capacity} jugadores</div>${drawMarkup(w, false)}<div class="flex justify-between mt-7">${btn("← Atrás", "wizard-prev")}${btn("Crear torneo ✓", "wizard-finish", "", "")}</div>`;
      }
    }

    function startWizard() {
      wizard = {
        step: 0,
        name: "",
        mode: "groups",
        capacity: 8,
        date: today(),
        end: "",
        venue: "",
        category: "Singles",
        description: "",
        status: "abierto",
        stages: makeStages("groups"),
        groups: makeGroups("groups"),
        participants: [],
        matches: []
      };
      page = "wizard";
      render();
    }

    function createFromWizard() {
      const w = wizard;
      const created = {
        ...w,
        id: uid(),
        stages: w.stages.map(stage => ({ ...stage })),
        groups: w.groups.map(group => ({ ...group })),
        participants: [...w.participants],
        requests: [],
        matches: [],
        connections: []
      };
      tournaments.unshift(created);
      page = "home";
      wizard = null;
      render();
      notify("Torneo creado. Ya puedes gestionar toda su estructura.");
      queueSave(created);
    }

    async function serverAction(action, tournament, message) {
      try {
        const data = await request({ action, tournamentId: tournament.id });
        if (data.tournament) {
          const index = tournaments.findIndex(item => item.id === tournament.id);
          if (index >= 0) tournaments[index] = data.tournament;
        }
        notify(data.message || message || "Actualizado.");
        render();
      } catch (error) {
        notify(error.message);
      }
    }

    app.addEventListener("change", event => {
      if (event.target.id === "current-user") {
        selectedUser = event.target.value;
        render();
      }
      if (event.target.id === "ranking-tournament") {
        const body = $id("ranking-body");
        if (body) body.innerHTML = scoreTable(tournaments.find(item => item.id === event.target.value));
      }
      if (event.target.id === "t-status" && adminView()) {
        const tournament = tNow();
        if (tournament) {
          tournament.status = event.target.value;
          refresh("Estado actualizado.");
        }
      }
    });

    app.addEventListener("dblclick", event => {
      const target = event.target.closest("[data-match-id]");
      if (!target || !adminView()) return;
      const tournament = tNow();
      if (!tournament) return;
      const matchId = target.dataset.matchId;
      const match = (tournament.matches || []).find(m => m.id === matchId);
      if (!match) return;
      const otherMatches = (tournament.matches || []).filter(m => m.id !== matchId);
      if (!otherMatches.length) {
        notify("No hay otras tarjetas para conectar.");
        return;
      }
      const cardLabel = match.cardNo || match.id;
      const options = otherMatches.map(m => `<option value="${esc(m.id)}">#${esc(m.cardNo || m.id)} · ${esc(name(m.a))} vs ${esc(name(m.b))}</option>`).join("");
      modal(`Asignar línea a tarjeta número ${cardLabel}`, `<div><label class="label" for="modal-link-target">Tarjeta destino</label><select id="modal-link-target" name="targetId" class="field">${options}</select></div><p class="muted text-xs mt-2">Se dibujará una línea entre las tarjetas seleccionadas.</p>`, form => {
        const targetId = form.get("targetId");
        if (!targetId || !otherMatches.some(m => m.id === targetId)) {
          notify("Selecciona una tarjeta válida.");
          return;
        }
        if (!Array.isArray(tournament.connections)) tournament.connections = [];
        const exists = tournament.connections.some(c => (c.from === matchId && c.to === targetId) || (c.from === targetId && c.to === matchId));
        if (!exists) tournament.connections.push({ from: matchId, to: targetId });
        refresh("Línea asignada.");
      }, "Asignar línea");
    });

    app.addEventListener("submit", event => {
      if (event.target.id !== "match-form") return;
      event.preventDefault();
      const tournament = tNow();
      const a = $id("match-a").value;
      const b = $id("match-b").value;
      if (!a || !b || a === b) {
        notify("Elige dos participantes distintos.");
        return;
      }
      tournament.matches.push({
        id: uid(),
        cardNo: nextCardNo(tournament),
        stageId: $id("match-stage").value,
        groupId: $id("match-group").value || null,
        a,
        b,
        date: $id("match-date").value,
        sa: null,
        sb: null,
        slot: null
      });
      refresh("Partido asignado.");
    });

    app.addEventListener("click", event => {
      const target = event.target.closest("[data-action]");
      if (!target) return;
      const action = target.dataset.action;
      const id = target.dataset.id;
      const tournament = tNow();
      const admin = adminView();

      if (action === "back") {
        page = "home";
        render();
        return;
      }
      if (action === "retry") {
        load();
        return;
      }
      if (action === "wizard-start") {
        startWizard();
        return;
      }
      if (action === "open" || action === "open-draw") {
        activeId = id;
        tab = action === "open-draw" ? "draw" : "summary";
        page = "detail";
        render();
        return;
      }
      if (action === "tab") {
        tab = id;
        renderDetail();
        return;
      }
      if (action === "wizard-next" || action === "wizard-prev") {
        if (!wizardSave()) return;
        wizard.step += action === "wizard-next" ? 1 : -1;
        renderWizard();
        return;
      }
      if (action === "wizard-add" || action === "wizard-remove" || action.startsWith("wizard-move")) {
        wizardSave();
        const [kind, itemId] = id.split(":");
        const list = (kind || id) === "stage" ? wizard.stages : wizard.groups;
        if (action === "wizard-add") {
          list.push(id === "stage" ? { id: uid(), name: "Nueva etapa", kind: "bracket" } : { id: uid(), name: "Nuevo grupo" });
        } else if (action === "wizard-remove") {
          if (kind === "stage" && list.length === 1) {
            notify("Se necesita al menos una etapa.");
            return;
          }
          list.splice(list.findIndex(item => item.id === itemId), 1);
        } else {
          stepMove(list, itemId, action.endsWith("up") ? -1 : 1);
        }
        renderWizard();
        return;
      }
      if (action === "wizard-finish") {
        createFromWizard();
        return;
      }
      if (action === "zoom-in") {
        drawZoom = Math.min(2, Math.round((drawZoom + 0.1) * 100) / 100);
        applyDrawZoom();
        return;
      }
      if (action === "zoom-out") {
        drawZoom = Math.max(0.4, Math.round((drawZoom - 0.1) * 100) / 100);
        applyDrawZoom();
        return;
      }
      if (action === "zoom-reset") {
        drawZoom = 0.75;
        applyDrawZoom();
        return;
      }
      if (!admin) {
        if (!["enroll", "withdraw", "cancel-request"].includes(action)) return;
        if (!currentUserId) {
          notify("Inicia sesión para inscribirte.");
          if (typeof window.openModal === "function") window.openModal("loginModal");
          return;
        }
        if (id !== currentUserId) {
          notify("Solo puedes gestionar tu propia inscripción.");
          return;
        }
        if (action === "withdraw") {
          confirmAction("Retirar inscripción", "También se eliminarán los partidos asignados a este participante.", () => {
            serverAction("withdraw", tournament, "Inscripción retirada.");
          });
        } else {
          serverAction(action, tournament, action === "enroll" ? "Solicitud enviada; pendiente de aprobación." : "Solicitud retirada.");
        }
        return;
      }

      if (!tournament) return;

      if (action === "edit-tournament") {
        editTournament();
        return;
      }
      if (action === "add-stage" || action === "add-group") {
        const kind = action === "add-stage" ? "stage" : "group";
        modal(kind === "stage" ? "Crear etapa" : "Crear grupo", `${field("Nombre", "name", kind === "stage" ? "Nueva etapa" : "Nuevo grupo", "text", 'required maxlength="60"')}${kind === "stage" ? '<div class="mt-3"><label class="label" for="modal-kind">Tipo</label><select class="field" id="modal-kind" name="kind"><option value="bracket">Cuadro eliminatorio</option><option value="groups">Fase de grupos / liga</option></select></div>' : ""}`, form => {
          (kind === "stage" ? tournament.stages : tournament.groups).push(kind === "stage"
            ? { id: uid(), name: String(form.get("name")).trim(), kind: form.get("kind") }
            : { id: uid(), name: String(form.get("name")).trim() });
          refresh("Estructura ampliada.");
        }, "Crear");
        return;
      }
      if (action === "edit-stage" || action === "edit-group") {
        editStructure(action === "edit-stage" ? "stage" : "group", id);
        return;
      }
      if (action === "delete-stage") {
        const stage = tournament.stages.find(entry => entry.id === id);
        if (!stage) return;
        if (tournament.stages.length === 1) {
          notify("Debe quedar al menos una etapa.");
          return;
        }
        if (!window.confirm(`¿Eliminar la etapa «${stage.name}» y sus partidos asociados?`)) return;
        tournament.stages = tournament.stages.filter(entry => entry.id !== id);
        tournament.matches = tournament.matches.filter(match => match.stageId !== id);
        refresh("Etapa eliminada.");
        return;
      }
      if (action === "delete-structure") {
        const [kind, itemId] = id.split(":");
        const item = (kind === "stage" ? tournament.stages : tournament.groups).find(entry => entry.id === itemId);
        if (!item) return;
        closeModal();
        confirmAction(`Eliminar ${kind === "stage" ? "etapa" : "grupo"}`, `Se eliminará «${item.name}» y sus partidos asociados.`, () => {
          if (kind === "stage") {
            if (tournament.stages.length === 1) {
              notify("Debe quedar al menos una etapa.");
              return;
            }
            tournament.stages = tournament.stages.filter(entry => entry.id !== itemId);
            tournament.matches = tournament.matches.filter(match => match.stageId !== itemId);
          } else {
            tournament.groups = tournament.groups.filter(entry => entry.id !== itemId);
            tournament.matches = tournament.matches.filter(match => match.groupId !== itemId);
          }
          refresh("Elemento eliminado.");
        });
        return;
      }
      if (action.startsWith("move-")) {
        const [, kind, direction] = action.split("-");
        const list = kind === "stage" ? tournament.stages : kind === "group" ? tournament.groups : tournament.participants;
        if (stepMove(list, id, direction === "up" ? -1 : 1)) refresh("Orden actualizado.");
        return;
      }
      if (action === "edit-player") {
        editPlayer(id);
        return;
      }
      if (action === "edit-match") {
        editMatch(id);
        return;
      }
      if (action === "draw-match") {
        const matchId = target.dataset.matchId;
        const stageId = target.dataset.stage;
        const slot = target.dataset.slot !== undefined ? +target.dataset.slot : null;
        if (matchId) {
          editMatch(matchId, stageId, slot); // Pass stage/slot even for existing matches (needed for bracket position)
        } else {
          editMatch(null, stageId, slot);
        }
        return;
      }
      if (action === "add-participant-draw") {
        const enrolledParticipants = (tournament.participants || []).slice();
        if (!enrolledParticipants.length) {
          notify("No hay participantes inscritos.");
          return;
        }
        if (!tournament.groups || !tournament.groups.length) {
          notify("Crea al menos un grupo primero.");
          return;
        }
        const playerOptions = enrolledParticipants.map(id => `<option value="${esc(id)}">${esc(name(id))}</option>`).join("");
        const groupOptions = tournament.groups.map(g => `<option value="${esc(g.id)}">${esc(g.name)}</option>`).join("");
        modal("Añadir participante a un grupo", `<div><label class="label" for="modal-draw-player">Participante inscrito</label><select id="modal-draw-player" name="playerId" class="field">${playerOptions}</select></div><div class="mt-3"><label class="label" for="modal-draw-group">Grupo</label><select id="modal-draw-group" name="groupId" class="field">${groupOptions}</select></div><p class="muted text-xs mt-2">Solo participantes inscritos en el torneo.</p>`, form => {
          const selectedPlayer = form.get("playerId");
          const selectedGroup = form.get("groupId");
          if (!selectedPlayer || !enrolledParticipants.includes(selectedPlayer)) {
            notify("Selecciona un participante inscrito.");
            return;
          }
          if (!selectedGroup || !tournament.groups.some(g => g.id === selectedGroup)) {
            notify("Selecciona un grupo válido.");
            return;
          }
          setGroupForPlayer(tournament, selectedPlayer, selectedGroup);
          refresh("Participante agregado al grupo.");
        }, "Añadir");
        return;
      }
      if (action === "add-group-match") {
        const groupId = target.dataset.groupId;
        const stageId = target.dataset.stageId;
        editMatch(null, stageId, null, groupId); // pass preGroupId for filtering
        return;
      }
      if (action === "add-match-top") {
        editMatch(null); // fully manual: admin chooses stage, group and players
        return;
      }
      if (action === "assign-to-group") {
        const groupId = target.dataset.groupId;
        const select = root.querySelector(`[data-group-assign="${groupId}"]`);
        const playerId = select?.value;
        if (!playerId) { notify("Selecciona un jugador."); return; }
        setGroupForPlayer(tournament, playerId, groupId);
        refresh(`Jugador asignado a ${tournament.groups.find(g => g.id === groupId)?.name || "grupo"}.`);
        return;
      }
      if (action === "remove-from-group") {
        const playerId = target.dataset.playerId;
        const groupId = target.dataset.groupId;
        if (!playerId) return;
        setGroupForPlayer(tournament, playerId, null);
        refresh(`Jugador retirado de ${tournament.groups.find(g => g.id === groupId)?.name || "grupo"}.`);
        return;
      }
      if (action === "add-bracket-match") {
        const stageId = target.dataset.stage;
        const slot = +target.dataset.slot;
        editMatch(null, stageId, slot);
        return;
      }
      if (action === "unir-linea" || action === "join-line" || action === "unir linea") {
        const matchId = target.dataset.matchId || target.dataset.id;
        const match = (tournament.matches || []).find(m => m.id === matchId);
        if (!match) return;
        const cardLabel = match.cardNo || match.id;
        modal(`Unir linea a tarjeta número ${cardLabel}`, `<div><label class="label" for="modal-link-target-no">Número de tarjeta destino</label><input class="field" id="modal-link-target-no" name="targetNo" type="number" min="1" required></div><p class="muted text-xs mt-2">Se dibujará una línea entre las tarjetas seleccionadas.</p>`, form => {
          const targetNo = Number(form.get("targetNo"));
          const targetMatch = (tournament.matches || []).find(m => Number(m.cardNo) === targetNo);
          if (!targetMatch || targetMatch.id === match.id) {
            notify("Selecciona una tarjeta válida.");
            return;
          }
          if (!Array.isArray(tournament.connections)) tournament.connections = [];
          const exists = tournament.connections.some(c => (c.from === match.id && c.to === targetMatch.id) || (c.from === targetMatch.id && c.to === match.id));
          if (!exists) tournament.connections.push({ from: match.id, to: targetMatch.id });
          refresh("Línea asignada.");
        }, "Unir linea");
        return;
      }
      if (action === "desunir-linea" || action === "unjoin-line" || action === "desunir linea") {
        const matchId = target.dataset.matchId || target.dataset.id;
        if (!Array.isArray(tournament.connections)) tournament.connections = [];
        const before = tournament.connections.length;
        tournament.connections = tournament.connections.filter(c => c.from !== matchId && c.to !== matchId);
        if (tournament.connections.length !== before) refresh("Línea eliminada.");
        else notify("Esta tarjeta no tiene líneas anexadas.");
        return;
      }
      if (action === "delete-group") {
        const group = tournament.groups.find(entry => entry.id === id);
        if (!group) return;
        if (!window.confirm(`¿Eliminar el grupo «${group.name}» y sus partidos asociados?`)) return;
        tournament.groups = tournament.groups.filter(entry => entry.id !== id);
        tournament.matches = tournament.matches.filter(match => match.groupId !== id);
        refresh("Grupo eliminado.");
        return;
      }
      if (action === "delete-match") {
        confirmAction("Eliminar partido", "Se eliminará el partido y se actualizará el avance del cuadro.", () => {
          tournament.matches = tournament.matches.filter(match => match.id !== id);
          refresh("Partido eliminado.");
        });
        return;
      }
      if (action === "add-player" || action === "approve") {
        const playerId = action === "add-player" ? $id("add-player")?.value : id;
        if (!playerId || !member(playerId) || tournament.participants.includes(playerId)) {
          notify("Selecciona un miembro disponible.");
          return;
        }
        if (tournament.participants.length >= tournament.capacity) {
          notify("No quedan cupos.");
          return;
        }
        tournament.participants.push(playerId);
        tournament.requests = tournament.requests.filter(requestId => requestId !== playerId);
        refresh("Inscripción aprobada.");
        return;
      }
      if (action === "reject") {
        tournament.requests = tournament.requests.filter(requestId => requestId !== id);
        refresh("Solicitud retirada.");
        return;
      }
      if (action === "remove") {
        confirmAction("Retirar inscripción", "También se eliminarán los partidos asignados a este participante.", () => {
          tournament.participants = tournament.participants.filter(participantId => participantId !== id);
          tournament.matches = tournament.matches.filter(match => match.a !== id && match.b !== id);
          refresh("Inscripción retirada.");
        });
      }
    });

    app.addEventListener("keydown", event => {
      const node = event.target.closest('.match-node[data-action="draw-match"]');
      if (node && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        node.click();
      }
    });

    app.addEventListener("dragstart", event => {
      const node = event.target.closest("[data-drag]");
      if (!node || event.target.matches("input,button")) return;
      drag = { kind: node.dataset.drag, id: node.dataset.id };
      node.classList.add("is-dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", drag.id);
    });

    app.addEventListener("dragend", event => {
      drag = null;
      root.querySelectorAll(".drop-over, .is-dragging").forEach(node => {
        node.classList.remove("drop-over");
        node.classList.remove("is-dragging");
      });
    });

    app.addEventListener("dragover", event => {
      const target = event.target.closest("[data-drop]");
      if (!target || !drag) return;
      // Allow cross-kind drops: player->group, match->stage, match->group
      const allowDrop =
        (drag.kind === "player" && target.dataset.drop === "group") ||
        (drag.kind === "match" && (target.dataset.drop === "stage" || target.dataset.drop === "group")) ||
        (drag.kind === target.dataset.drop && drag.id !== target.dataset.id);
      if (allowDrop) {
        event.preventDefault();
        target.classList.add("drop-over");
      }
    });

    app.addEventListener("dragleave", event => {
      const target = event.target.closest("[data-drop]");
      if (target && !target.contains(event.relatedTarget)) target.classList.remove("drop-over");
    });

    app.addEventListener("drop", event => {
      const target = event.target.closest("[data-drop]");
      if (!target || !drag) return;
      event.preventDefault();
      root.querySelectorAll(".drop-over").forEach(node => node.classList.remove("drop-over"));
      const tournament = tNow();

      // Handle cross-group player moves (drag player, drop on group drop zone)
      if (drag.kind === "player" && target.dataset.drop === "group") {
        const playerId = drag.id;
        const groupId = target.dataset.id;
        setGroupForPlayer(tournament, playerId, groupId);
        refresh(`Jugador movido a ${tournament.groups.find(g => g.id === groupId)?.name || "grupo"}.`);
        drag = null;
        return;
      }

      // Handle match-to-stage moves (drag match, drop on stage)
      if (drag.kind === "match" && target.dataset.drop === "stage") {
        const matchId = drag.id;
        const stageId = target.dataset.id;
        const match = tournament.matches.find(m => m.id === matchId);
        if (match) {
          match.stageId = stageId;
          match.groupId = null; // Remove group assignment when moving to bracket stage
          match.slot = null; // Reset slot
          refresh("Partido movido a otra etapa.");
        }
        drag = null;
        return;
      }

      // Handle match-to-group moves (drag match, drop on group)
      if (drag.kind === "match" && target.dataset.drop === "group") {
        const matchId = drag.id;
        const groupId = target.dataset.id;
        const match = tournament.matches.find(m => m.id === matchId);
        const groupStage = tournament.stages.find(s => s.kind === "groups");
        if (match && groupStage) {
          match.groupId = groupId;
          match.stageId = groupStage.id;
          match.slot = null;
          refresh("Partido movido a fase de grupos.");
        }
        drag = null;
        return;
      }

      // Standard reordering within same list
      if (target.dataset.drop !== drag.kind) return;
      const list = page === "wizard"
        ? (drag.kind === "stage" ? wizard.stages : wizard.groups)
        : drag.kind === "stage" ? tournament.stages : drag.kind === "group" ? tournament.groups : tournament.participants;
      if (reorder(list, drag.id, target.dataset.id)) {
        if (page === "wizard") renderWizard();
        else refresh("Posiciones actualizadas.");
      }
      drag = null;
    });

    app.addEventListener("dragend", () => {
      drag = null;
      root.querySelectorAll(".drop-over").forEach(node => node.classList.remove("drop-over"));
    });

    modalRoot.addEventListener("keydown", event => {
      if (event.key === "Escape") closeModal();
      if (event.key === "Tab") {
        const nodes = [...modalRoot.querySelectorAll("button,input,select,textarea")].filter(node => !node.disabled);
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    });

    async function load() {
      app.innerHTML = '<div class="card p-6"><p class="muted">Cargando torneos…</p></div>';
      try {
        const response = await fetch("/api/tournaments", { credentials: "include" });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `Error del servidor (${response.status})`);
        tournaments = Array.isArray(data.tournaments) ? data.tournaments : [];
        users = (Array.isArray(data.users) ? data.users : []).map(user => ({
          id: user.id,
          name: user.name,
          role: "miembro"
        }));
        currentUserId = data.currentUserId || currentUserId;
        isAdmin = Boolean(data.isAdmin) || isAdmin;
        if (!selectedUser || !users.some(user => user.id === selectedUser)) {
          selectedUser = currentUserId || users[0]?.id || null;
        }
        render();
      } catch (error) {
        app.innerHTML = `<div class="card p-6"><h3 class="display text-2xl font-bold">No se pudieron cargar los torneos</h3><p class="muted text-sm mt-2">${esc(error.message)}</p><button type="button" class="button mt-4" data-action="retry">Reintentar</button></div>`;
      }
    }

    shell.dataset.mode = view;
    window.addEventListener("resize", () => { if (tab === "draw") drawConnections(); });
    load();
    return { reload: load, root, shell };
  }

  window.TournamentApp = { mount };
})();
