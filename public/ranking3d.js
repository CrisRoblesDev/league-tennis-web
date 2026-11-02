// Ranking 3D interactivo con three.js (cargado desde CDN bajo demanda).
let sceneState = null;
let rankingContainer = null;

const THREE_CDN = "https://unpkg.com/three@0.160.0/build/three.module.js";
const NAVY = 0x10243a;
const NAVY2 = 0x1d3d5c;
const GREEN = 0xb7d96b;
const SILVER = 0xd9e2ea;
const BRONZE = 0xc98a5c;

function makeLabel(text, subtext) {
  const THREE = window.__threeModule;
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 160;
  const context = canvas.getContext("2d");
  const radius = 26;
  context.beginPath();
  context.moveTo(radius, 0);
  context.arcTo(canvas.width, 0, canvas.width, canvas.height, radius);
  context.arcTo(canvas.width, canvas.height, 0, canvas.height, radius);
  context.arcTo(0, canvas.height, 0, 0, radius);
  context.arcTo(0, 0, canvas.width, 0, radius);
  context.closePath();
  context.fillStyle = "rgba(13,28,45,0.94)";
  context.fill();
  context.strokeStyle = "rgba(183,217,107,0.55)";
  context.lineWidth = 6;
  context.stroke();
  context.fillStyle = "#ffffff";
  context.font = "bold 50px Arial";
  context.textAlign = "center";
  context.fillText(text.slice(0, 18), 256, 68);
  context.fillStyle = "#b7d96b";
  context.font = "bold 42px Arial";
  context.fillText(subtext, 256, 128);
  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true }));
  sprite.scale.set(2.6, 0.8, 1);
  return sprite;
}

function makeRankBadge(rank) {
  const THREE = window.__threeModule;
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  context.beginPath();
  context.arc(64, 64, 58, 0, Math.PI * 2);
  context.fillStyle = "rgba(255,255,255,0.92)";
  context.fill();
  context.fillStyle = "#10243a";
  context.font = "bold 72px Arial";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(String(rank), 64, 68);
  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true }));
  sprite.scale.set(0.9, 0.9, 1);
  return sprite;
}

function disposeState(state) {
  if (!state) return;
  state.observer?.disconnect();
  state.renderer?.dispose();
  if (state.renderer?.domElement?.parentNode) {
    state.renderer.domElement.parentNode.removeChild(state.renderer.domElement);
  }
  if (state === sceneState) sceneState = null;
}

function buildScene(container, players) {
  disposeState(sceneState);
  const top = players.slice(0, 8);
  container.innerHTML = "";
  if (!top.length) {
    container.innerHTML = '<p class="muted" style="padding:20px">Aún no hay jugadores para mostrar en 3D.</p>';
    return;
  }

  const THREE = window.__threeModule;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(NAVY);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
  camera.position.set(0, 7, 16);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);

  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const light = new THREE.DirectionalLight(0xffffff, 1.15);
  light.position.set(8, 14, 10);
  scene.add(light);
  const rim = new THREE.PointLight(0xb7d96b, 0.7, 40);
  rim.position.set(-8, 6, -6);
  scene.add(rim);

  const group = new THREE.Group();
  scene.add(group);
  const maxPoints = Math.max(...top.map(player => player.points || 0), 1);
  const spacing = 2.3;
  const podiumColors = [GREEN, SILVER, BRONZE];
  const podiumHeights = [3.4, 2.6, 2.0];
  const bars = [];
  top.forEach((player, index) => {
    const isPodium = index < 3;
    const height = isPodium ? podiumHeights[index] : 1.1 + ((player.points || 0) / maxPoints) * 1.8;
    const color = isPodium ? podiumColors[index] : NAVY2;
    const material = new THREE.MeshStandardMaterial({
      color,
      roughness: isPodium ? 0.3 : 0.55,
      metalness: isPodium ? 0.35 : 0.1
    });
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.6, height, 1.6), material);
    bar.position.set((index - (top.length - 1) / 2) * spacing, height / 2, 0);
    bar.userData = { player };
    group.add(bar);
    bars.push(bar);
    const label = makeLabel(player.name, `${player.points || 0} pts`);
    label.position.set(bar.position.x, height + 0.75, 0);
    group.add(label);
    const badge = makeRankBadge(index + 1);
    badge.position.set(bar.position.x, height / 2, 0.85);
    group.add(badge);
  });

  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(top.length * spacing * 0.72, top.length * spacing * 0.78, 0.35, 48),
    new THREE.MeshStandardMaterial({ color: 0x0b1a2b, roughness: 0.85 })
  );
  base.position.y = -0.18;
  group.add(base);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(top.length * spacing * 0.75, 0.05, 12, 64),
    new THREE.MeshStandardMaterial({ color: GREEN, roughness: 0.4, metalness: 0.3 })
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.02;
  group.add(ring);

  const info = document.createElement("div");
  info.className = "ranking3d-info";
  container.appendChild(info);

  let rotationY = 0.55;
  let zoom = 15;
  let dragging = false;
  let lastX = 0;
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  function render() {
    const width = container.clientWidth || 600;
    const height = container.clientHeight || 380;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    group.rotation.y = rotationY;
    camera.position.set(0, 5.2, zoom);
    camera.lookAt(0, 2.2, 0);
    renderer.render(scene, camera);
  }

  function pick(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(bars)[0];
    bars.forEach(bar => { bar.material.emissive = new THREE.Color(0x000000); });
    if (hit) {
      hit.object.material.emissive = new THREE.Color(0x33500f);
      const player = hit.object.userData.player;
      info.textContent = `${player.name} · ${player.level || "-"} · ${player.points || 0} pts · ${player.matches || 0} partidos`;
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
    zoom = Math.min(30, Math.max(8, zoom + event.deltaY * 0.01));
  }, { passive: false });

  const observer = new ResizeObserver(render);
  observer.observe(container);
  const state = { renderer, observer };
  sceneState = state;
  render();
  const loop = () => {
    if (sceneState !== state) return;
    if (container.offsetParent === null) {
      requestAnimationFrame(loop);
      return;
    }
    if (!dragging) rotationY += 0.0022;
    render();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

export async function initRanking3d(container, players) {
  if (!container) return;
  rankingContainer = container;
  if (!window.__threeModule) {
    try {
      window.__threeModule = await import(THREE_CDN);
    } catch {
      container.innerHTML = '<p class="muted" style="padding:20px">No se pudo cargar la vista 3D. Revisa tu conexión.</p>';
      return;
    }
  }
  buildScene(container, players);
}

export function updateRanking3d(players) {
  if (rankingContainer && window.__threeModule) buildScene(rankingContainer, players);
}
