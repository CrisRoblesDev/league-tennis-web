// Ranking 3D interactivo con three.js (cargado desde CDN bajo demanda).
let sceneState = null;
let rankingContainer = null;

const THREE_CDN = "https://unpkg.com/three@0.160.0/build/three.module.js";
const NAVY = 0x10243a;
const NAVY2 = 0x1d3d5c;
const GREEN = 0xb7d96b;
const GOLD = 0xf5c542;
const SILVER = 0xd9e2ea;
const BRONZE = 0xc98a5c;

function makeLabel(text, subtext, accent) {
  const THREE = window.__threeModule;
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 176;
  const context = canvas.getContext("2d");
  const radius = 30;
  context.beginPath();
  context.moveTo(radius, 0);
  context.arcTo(canvas.width, 0, canvas.width, canvas.height, radius);
  context.arcTo(canvas.width, canvas.height, 0, canvas.height, radius);
  context.arcTo(0, canvas.height, 0, 0, radius);
  context.arcTo(0, 0, canvas.width, 0, radius);
  context.closePath();
  context.fillStyle = "rgba(11,24,40,0.95)";
  context.fill();
  context.strokeStyle = accent;
  context.lineWidth = 8;
  context.stroke();
  context.fillStyle = "#ffffff";
  context.font = "bold 52px Arial";
  context.textAlign = "center";
  context.fillText(text.slice(0, 18), 256, 72);
  context.fillStyle = accent;
  context.font = "bold 44px Arial";
  context.fillText(subtext, 256, 138);
  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true }));
  sprite.scale.set(2.35, 0.81, 1);
  return sprite;
}

function makeRankBadge(rank, accent) {
  const THREE = window.__threeModule;
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  context.beginPath();
  context.arc(64, 64, 58, 0, Math.PI * 2);
  context.fillStyle = accent;
  context.fill();
  context.lineWidth = 8;
  context.strokeStyle = "rgba(255,255,255,0.9)";
  context.stroke();
  context.fillStyle = "#10243a";
  context.font = "bold 68px Arial";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(String(rank), 64, 68);
  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true }));
  sprite.scale.set(0.95, 0.95, 1);
  return sprite;
}

function makeTrophy() {
  const THREE = window.__threeModule;
  const gold = new THREE.MeshStandardMaterial({ color: GOLD, metalness: 0.85, roughness: 0.25 });
  const trophy = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.42, 0.16, 24), gold);
  trophy.add(base);
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.14, 0.34, 16), gold);
  stem.position.y = 0.24;
  trophy.add(stem);
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.1, 0.44, 24, 1, true), gold);
  cup.position.y = 0.6;
  trophy.add(cup);
  const cupBottom = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 12), gold);
  cupBottom.position.y = 0.38;
  trophy.add(cupBottom);
  for (const side of [-1, 1]) {
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.035, 10, 20, Math.PI), gold);
    handle.position.set(side * 0.34, 0.62, 0);
    handle.rotation.z = side * Math.PI / 2;
    trophy.add(handle);
  }
  return trophy;
}

function makeParticles(THREE) {
  const count = 260;
  const positions = new Float32Array(count * 3);
  for (let index = 0; index < count; index++) {
    const radius = 8 + Math.random() * 22;
    const angle = Math.random() * Math.PI * 2;
    positions[index * 3] = Math.cos(angle) * radius;
    positions[index * 3 + 1] = Math.random() * 14 + 0.5;
    positions[index * 3 + 2] = Math.sin(angle) * radius;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: GREEN,
    size: 0.14,
    transparent: true,
    opacity: 0.4,
    depthWrite: false
  });
  return new THREE.Points(geometry, material);
}

function makeTennisBalls(THREE) {
  const material = new THREE.MeshStandardMaterial({ color: GREEN, roughness: 0.55, metalness: 0.05 });
  const balls = [];
  for (let index = 0; index < 6; index++) {
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.2, 20, 16), material);
    ball.userData = {
      radius: 6.5 + index * 1.1,
      angle: (index / 6) * Math.PI * 2,
      speed: 0.12 + (index % 3) * 0.05,
      height: 2.5 + (index % 4) * 1.4,
      bob: Math.random() * Math.PI * 2
    };
    balls.push(ball);
  }
  return balls;
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
  container.innerHTML = "";
  const top = players.slice(0, 8);
  if (!top.length) {
    container.innerHTML = '<p class="muted" style="padding:20px">Aún no hay jugadores para mostrar en 3D.</p>';
    return;
  }

  const THREE = window.__threeModule;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(NAVY);
  scene.fog = new THREE.Fog(NAVY, 24, 58);
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);

  scene.add(new THREE.AmbientLight(0xffffff, 0.5));
  const key = new THREE.DirectionalLight(0xffffff, 1.2);
  key.position.set(8, 16, 10);
  scene.add(key);
  const rim = new THREE.PointLight(GREEN, 0.9, 45);
  rim.position.set(-9, 7, -7);
  scene.add(rim);
  const warm = new THREE.PointLight(0xffe9b0, 0.5, 40);
  warm.position.set(9, 6, 6);
  scene.add(warm);

  // Focos de escenario sobre el podio
  for (const side of [-1, 1]) {
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(2.6, 9, 24, 1, true),
      new THREE.MeshBasicMaterial({
        color: GREEN,
        transparent: true,
        opacity: 0.06,
        side: THREE.DoubleSide,
        depthWrite: false
      })
    );
    cone.position.set(side * 3.4, 8.2, -1.5);
    cone.rotation.z = side * 0.32;
    scene.add(cone);
  }

  const group = new THREE.Group();
  scene.add(group);
  const maxPoints = Math.max(...top.map(player => player.points || 0), 1);
  const spacing = 3.1;
  const podiumColors = [GOLD, SILVER, BRONZE];
  const podiumAccents = ["#f5c542", "#d9e2ea", "#c98a5c"];
  const podiumHeights = [3.2, 2.5, 1.9];
  const bars = [];
  top.forEach((player, index) => {
    const isPodium = index < 3;
    const height = isPodium ? podiumHeights[index] : 1.1 + ((player.points || 0) / maxPoints) * 1.6;
    const color = isPodium ? podiumColors[index] : NAVY2;
    const material = new THREE.MeshStandardMaterial({
      color,
      roughness: isPodium ? 0.28 : 0.55,
      metalness: isPodium ? 0.55 : 0.12
    });
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.7, height, 1.7), material);
    bar.position.set((index - (top.length - 1) / 2) * spacing, height / 2, 0);
    bar.userData = { player };
    group.add(bar);
    bars.push(bar);
    const accent = isPodium ? podiumAccents[index] : "#b7d96b";
    const label = makeLabel(player.name, `${player.points || 0} pts`, accent);
    label.position.set(bar.position.x, height + (index === 0 ? 1.75 : 0.85), 0);
    group.add(label);
    const badge = makeRankBadge(index + 1, accent);
    badge.position.set(bar.position.x, height / 2, 0.9);
    group.add(badge);
    if (index === 0) {
      const trophy = makeTrophy();
      trophy.position.set(bar.position.x, height + 0.55, 0);
      trophy.scale.setScalar(0.72);
      group.add(trophy);
    }
  });

  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(top.length * spacing * 0.62, top.length * spacing * 0.7, 0.4, 56),
    new THREE.MeshStandardMaterial({ color: 0x0b1a2b, roughness: 0.85, metalness: 0.2 })
  );
  base.position.y = -0.2;
  group.add(base);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(top.length * spacing * 0.66, 0.06, 14, 72),
    new THREE.MeshStandardMaterial({ color: GREEN, roughness: 0.35, metalness: 0.4 })
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.02;
  group.add(ring);

  const grid = new THREE.PolarGridHelper(16, 12, 6, 64, 0x2a4a6b, 0x1d3d5c);
  grid.position.y = -0.38;
  scene.add(grid);

  const particles = makeParticles(THREE);
  scene.add(particles);
  const balls = makeTennisBalls(THREE);
  balls.forEach(ball => scene.add(ball));

  const info = document.createElement("div");
  info.className = "ranking3d-info";
  container.appendChild(info);

  let rotationY = 0.9;
  let zoom = 15;
  let dragging = false;
  let lastX = 0;
  let intro = 0;
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  function render() {
    const width = container.clientWidth || 600;
    const height = container.clientHeight || 380;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    group.rotation.y = rotationY;
    const eased = 1 - Math.pow(1 - Math.min(intro, 1), 3);
    camera.position.set(0, 4.6 + (1 - eased) * 4, zoom + (1 - eased) * 10);
    camera.lookAt(0, 2.1, 0);
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
      hit.object.material.emissive = new THREE.Color(0x2f4d0d);
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
    intro = Math.min(1, intro + 0.016);
    if (container.offsetParent === null) {
      requestAnimationFrame(loop);
      return;
    }
    if (!dragging) rotationY += 0.0022;
    particles.rotation.y += 0.0006;
    balls.forEach(ball => {
      const config = ball.userData;
      config.angle += config.speed * 0.004;
      config.bob += 0.01;
      ball.position.set(
        Math.cos(config.angle) * config.radius,
        config.height + Math.sin(config.bob) * 0.4,
        Math.sin(config.angle) * config.radius
      );
    });
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
