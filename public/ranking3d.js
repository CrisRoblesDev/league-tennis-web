// Ranking 3D interactivo con three.js (cargado desde CDN bajo demanda).
let sceneState = null;
let rankingContainer = null;

const THREE_CDN = "https://unpkg.com/three@0.160.0/build/three.module.js";
const NAVY = 0x10243a;
const NAVY2 = 0x183653;
const GREEN = 0xb7d96b;

function makeLabel(text, subtext) {
  const THREE = window.__threeModule;
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 160;
  const context = canvas.getContext("2d");
  context.fillStyle = "rgba(16,36,58,0.92)";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#ffffff";
  context.font = "bold 52px Arial";
  context.textAlign = "center";
  context.fillText(text.slice(0, 18), 256, 70);
  context.fillStyle = "#b7d96b";
  context.font = "bold 44px Arial";
  context.fillText(subtext, 256, 130);
  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true }));
  sprite.scale.set(2.4, 0.75, 1);
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

  scene.add(new THREE.AmbientLight(0xffffff, 0.7));
  const light = new THREE.DirectionalLight(0xffffff, 1.1);
  light.position.set(6, 12, 8);
  scene.add(light);

  const group = new THREE.Group();
  scene.add(group);
  const maxPoints = Math.max(...top.map(player => player.points || 0), 1);
  const spacing = 2.2;
  const bars = [];
  top.forEach((player, index) => {
    const height = 1.2 + ((player.points || 0) / maxPoints) * 4.8;
    const color = index === 0 ? GREEN : index < 3 ? 0x9cc455 : NAVY2;
    const material = new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.15 });
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.4, height, 1.4), material);
    bar.position.set((index - (top.length - 1) / 2) * spacing, height / 2, 0);
    bar.userData = { player };
    group.add(bar);
    bars.push(bar);
    const label = makeLabel(player.name, `${player.points || 0} pts`);
    label.position.set(bar.position.x, height + 0.6, 0);
    group.add(label);
  });

  const base = new THREE.Mesh(
    new THREE.BoxGeometry(top.length * spacing + 2, 0.3, 4),
    new THREE.MeshStandardMaterial({ color: 0x0b1a2b, roughness: 0.9 })
  );
  base.position.y = -0.15;
  group.add(base);

  const info = document.createElement("div");
  info.className = "ranking3d-info";
  container.appendChild(info);

  let rotationY = 0.5;
  let zoom = 16;
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
    camera.position.set(0, 5.5, zoom);
    camera.lookAt(0, 2.4, 0);
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
