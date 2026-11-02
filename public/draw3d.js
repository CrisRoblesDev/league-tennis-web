// Main Draw 3D interactivo con three.js (cargado desde CDN bajo demanda).
let drawState = null;

const THREE_CDN = "https://unpkg.com/three@0.160.0/build/three.module.js";
const NAVY = 0x10243a;
const NAVY2 = 0x183653;
const GREEN = 0xb7d96b;

function makeMatchLabel(match) {
  const THREE = window.__threeModule;
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 200;
  const context = canvas.getContext("2d");
  context.fillStyle = "rgba(16,36,58,0.94)";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#ffffff";
  context.font = "bold 40px Arial";
  context.textAlign = "center";
  const a = (match.playerAName || "Por definir").slice(0, 20);
  const b = (match.playerBName || "Por definir").slice(0, 20);
  context.fillText(`${a} vs ${b}`, 256, 70);
  context.fillStyle = match.status === "completed" ? "#b7d96b" : "#9fb3c4";
  context.font = "bold 36px Arial";
  context.fillText(match.score || (match.status === "cancelled" ? "Cancelado" : "Por jugar"), 256, 125);
  context.fillStyle = "#6d7885";
  context.font = "28px Arial";
  context.fillText((match.round || "Ronda").slice(0, 24), 256, 170);
  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true }));
  sprite.scale.set(3.2, 1.25, 1);
  return sprite;
}

function disposeState(state) {
  if (!state) return;
  state.observer?.disconnect();
  state.renderer?.dispose();
  if (state.renderer?.domElement?.parentNode) {
    state.renderer.domElement.parentNode.removeChild(state.renderer.domElement);
  }
  if (state === drawState) drawState = null;
}

function buildScene(container, matches) {
  disposeState(drawState);
  container.innerHTML = "";
  const rounds = [];
  matches.forEach(match => {
    const round = match.round || "Ronda";
    let bucket = rounds.find(item => item.name === round);
    if (!bucket) {
      bucket = { name: round, matches: [] };
      rounds.push(bucket);
    }
    bucket.matches.push(match);
  });
  if (!rounds.length) {
    container.innerHTML = '<p class="muted" style="padding:20px">Este torneo aún no tiene partidos programados.</p>';
    return;
  }

  const THREE = window.__threeModule;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(NAVY);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 300);
  camera.position.set(0, 10, 22);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);

  scene.add(new THREE.AmbientLight(0xffffff, 0.75));
  const light = new THREE.DirectionalLight(0xffffff, 1);
  light.position.set(8, 16, 10);
  scene.add(light);

  const group = new THREE.Group();
  scene.add(group);
  const columnSpacing = 5.2;
  const rowSpacing = 2.6;
  const nodes = [];
  rounds.forEach((round, roundIndex) => {
    round.matches.forEach((match, matchIndex) => {
      const x = (roundIndex - (rounds.length - 1) / 2) * columnSpacing;
      const y = 6 - matchIndex * rowSpacing;
      const completed = match.status === "completed";
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(2.6, 1.6, 0.6),
        new THREE.MeshStandardMaterial({
          color: completed ? GREEN : NAVY2,
          roughness: 0.4,
          metalness: 0.1,
          transparent: true,
          opacity: match.status === "cancelled" ? 0.45 : 1
        })
      );
      box.position.set(x, y, 0);
      box.userData = { match };
      group.add(box);
      nodes.push(box);
      const label = makeMatchLabel(match);
      label.position.set(x, y + 1.5, 0.4);
      group.add(label);
      if (roundIndex > 0) {
        const previous = nodes.filter(node =>
          node.userData.roundIndex === roundIndex - 1 &&
          Math.abs(node.userData.matchIndex - matchIndex) <= 1
        );
        previous.forEach(source => {
          const geometry = new THREE.BufferGeometry().setFromPoints([
            source.position.clone(),
            box.position.clone()
          ]);
          group.add(new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0x4a6274 })));
        });
      }
      box.userData.roundIndex = roundIndex;
      box.userData.matchIndex = matchIndex;
    });
  });

  const info = document.createElement("div");
  info.className = "ranking3d-info";
  container.appendChild(info);

  let rotationY = 0.35;
  let zoom = 22;
  let dragging = false;
  let lastX = 0;
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  function render() {
    const width = container.clientWidth || 700;
    const height = container.clientHeight || 420;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    group.rotation.y = rotationY;
    camera.position.set(0, 10, zoom);
    camera.lookAt(0, 2, 0);
    renderer.render(scene, camera);
  }

  function pick(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(nodes)[0];
    nodes.forEach(node => { node.material.emissive = new THREE.Color(0x000000); });
    if (hit) {
      hit.object.material.emissive = new THREE.Color(0x33500f);
      const match = hit.object.userData.match;
      info.textContent = `${match.round || "Ronda"}: ${match.playerAName || "Por definir"} vs ${match.playerBName || "Por definir"}${match.score ? ` · ${match.score}` : ""}${match.date ? ` · ${match.date}` : ""}`;
    } else {
      info.textContent = "";
    }
  }

  renderer.domElement.addEventListener("pointerdown", event => {
    dragging = true;
    lastX = event.clientX;
  });
  window.addEventListener("pointerup", () => { dragging = false; });
  renderer.domElement.addEventListener("pointermove", event => {
    if (!dragging) return;
    rotationY += (event.clientX - lastX) * 0.008;
    lastX = event.clientX;
  });
  renderer.domElement.addEventListener("click", pick);
  renderer.domElement.addEventListener("wheel", event => {
    event.preventDefault();
    zoom = Math.min(45, Math.max(10, zoom + event.deltaY * 0.015));
  }, { passive: false });

  const observer = new ResizeObserver(render);
  observer.observe(container);
  const state = { renderer, observer };
  drawState = state;
  render();
  const loop = () => {
    if (drawState !== state) return;
    if (!dragging) rotationY += 0.0016;
    render();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

export async function initDraw3d(container, matches) {
  if (!container) return;
  if (!window.__threeModule) {
    try {
      window.__threeModule = await import(THREE_CDN);
    } catch {
      container.innerHTML = '<p class="muted" style="padding:20px">No se pudo cargar la vista 3D. Revisa tu conexión.</p>';
      return;
    }
  }
  buildScene(container, matches);
}
