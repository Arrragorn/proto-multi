// client/src/main.ts
import { joinGame } from "./net";
import * as THREE from "three";
import { HDRLoader } from "three/examples/jsm/loaders/HDRLoader.js";
import { playAttackFX } from "./fx";
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const gltfLoader = new GLTFLoader();

const scene = new THREE.Scene();
let roomRef: any = null;


// --- Ground plane ---
const groundGeo = new THREE.PlaneGeometry(100, 100);
const groundMat = new THREE.MeshStandardMaterial({
    color: 0x333333,
    roughness: 1,
    metalness: 0,
});
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const grid = new THREE.GridHelper(100, 50, 0xdddddd, 0x777777); // (taille, divisions, couleurs)
grid.position.y = 0.01; // évite le z-fighting avec le ground
scene.add(grid);


const box1 = new THREE.Mesh(
    new THREE.BoxGeometry(10, 8, 10),
    new THREE.MeshStandardMaterial({ color: 0x88cc88 })
);
box1.position.set(0, 5, 0);
box1.castShadow = true;
box1.receiveShadow = true;
//scene.add(box1);


// --- Lighting ---
const ambient = new THREE.AmbientLight(0xffffff, 0.4);
scene.add(ambient);

const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
dirLight.position.set(5, 10, 7);
dirLight.castShadow = true;
dirLight.shadow.mapSize.width = 2048;
dirLight.shadow.mapSize.height = 2048;
dirLight.shadow.camera.near = 0.5;
dirLight.shadow.camera.far = 50;
scene.add(dirLight);

// Optional: visualiser la lumière
// const helper = new THREE.DirectionalLightHelper(dirLight);
// scene.add(helper);

//NPCs
const npcMeshes = new Map<string, THREE.Mesh>();
const npcGeo = new THREE.CapsuleGeometry(0.28, 0.9, 4, 8);


// --- Camera & renderer ---

const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 100);
camera.position.set(0, 1.6, 5);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

// Tonemapping + exposure (ajuste si c'est trop sombre/clair)
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

renderer.domElement.tabIndex = 0;           // focusable
// focus + pointer lock pour une souris fluide
renderer.domElement.addEventListener("click", () => {
    renderer.domElement.focus();
    if (renderer.domElement.requestPointerLock) {
        renderer.domElement.requestPointerLock();
    }
});

document.body.appendChild(renderer.domElement);

const toHex = (n: number) => "#" + n.toString(16).padStart(6, "0");
const wrapPi = (a: number) => {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
};
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const ATTACK_REACH = 1.8;
const ATTACK_MARKER_Y_OFFSET = 1.8;
const CAMERA_PITCH_MIN = -1.2;
const CAMERA_PITCH_MAX = 1.38;
let currentName = "";

const hud = document.createElement("div");
hud.style.position = "fixed";
hud.style.top = "12px";
hud.style.right = "12px";
hud.style.padding = "8px 10px";
hud.style.background = "rgba(0,0,0,0.5)";
hud.style.backdropFilter = "blur(4px)";
hud.style.borderRadius = "10px";
hud.style.fontFamily = "system-ui, sans-serif";
hud.style.fontSize = "14px";
hud.style.color = "#fff";
hud.style.lineHeight = "1.2";
hud.style.pointerEvents = "none";
document.body.appendChild(hud);

const compass = document.createElement("canvas");
compass.width = compass.height = 150;
Object.assign(compass.style, {
  position: "fixed",
  left: "50%",
  bottom: "16px",
  transform: "translateX(-50%)",
  pointerEvents: "none",
  filter: "drop-shadow(0 2px 6px rgba(0,0,0,0.45))",
});
const compassCtx = compass.getContext("2d")!;
document.body.appendChild(compass);

const attackMarker = document.createElement("div");
attackMarker.textContent = "X";
Object.assign(attackMarker.style, {
  position: "fixed",
  left: "0",
  top: "0",
  transform: "translate(-50%, -50%)",
  color: "#ff3535",
  fontFamily: "system-ui, sans-serif",
  fontSize: "34px",
  fontWeight: "900",
  lineHeight: "1",
  textShadow: "0 2px 8px rgba(0,0,0,0.75)",
  pointerEvents: "none",
  display: "none",
  zIndex: "10",
});
document.body.appendChild(attackMarker);

// nom chargé localement (défini via /config)
function loadName() {
  const stored = localStorage.getItem("playerName") || "";
  return stored.trim().slice(0, 24);
}
function setNameLocal(name: string) {
  const clean = name.replace(/\s+/g, " ").trim().slice(0, 24);
  const safe = clean || "Anonyme";
  currentName = safe;
  if (roomRef) roomRef.send("setName", { name: safe });
}
setNameLocal(loadName() || "Joueur");

function getTargetInfo(targetId?: string) {
  if (!targetId || !roomRef) return null;
  const p = roomRef.state.players.get(targetId);
  if (p) {
    if (!p.alive || p.spectator) return null;
    return { id: targetId, label: p.name || targetId.slice(0, 6), color: p.color ?? 0xffffff, x: p.x, z: p.z };
  }
  const n = roomRef.state.npcs.get(targetId);
  if (n) {
    return { id: targetId, label: targetId.slice(0, 6), color: n.color ?? 0xffffff, x: n.x, z: n.z };
  }
  return null;
}


function drawCompass() {
  compassCtx.clearRect(0, 0, compass.width, compass.height);
  if (!roomRef || !myPlayerRef || !myPlayerRef.targetId) return;

  const target = getTargetInfo(myPlayerRef.targetId);
  if (!target) return;

  const dx = target.x - myPlayerRef.x;
  const dz = target.z - myPlayerRef.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.01) return;

  const angleToTarget = -Math.atan2(dx, dz); // même convention que yaw
  const rel = wrapPi(angleToTarget + (myPlayerRef.yaw ?? yaw));
  const distMin = 100.0;
  const distMax = 20.0;
  const spreadMin = 0.2;
  const spreadMax = 2 * Math.PI;
  const spread = Math.min(spreadMax, Math.max(spreadMin,(dist-distMin)/(distMax-distMin) * (spreadMax-spreadMin) + spreadMin)); // plus proche -> plus large

  const w = compass.width, h = compass.height, r = w * 0.38;
  compassCtx.save();
  compassCtx.translate(w / 2, h / 2);
  compassCtx.rotate(-Math.PI / 2); // 0 rad = haut
  compassCtx.strokeStyle = "rgba(255,255,255,0.18)";
  compassCtx.lineWidth = 4;
  compassCtx.beginPath();
  compassCtx.arc(0, 0, r, 0, Math.PI * 2);
  compassCtx.stroke();

  compassCtx.strokeStyle = toHex(target.color ?? 0xffffff);
  compassCtx.lineWidth = 12;
  compassCtx.lineCap = "round";
  compassCtx.beginPath();
  compassCtx.arc(0, 0, r, rel - spread / 2, rel + spread / 2);
  compassCtx.stroke();
  compassCtx.restore();

  compassCtx.fillStyle = "#fff";
  compassCtx.font = "12px system-ui, sans-serif";
  compassCtx.textAlign = "center";
  //compassCtx.fillText(`${target.id.slice(0, 6)} • ${dist.toFixed(1)}m`, w / 2, h - 8);
}



function renderScoreboard() {
    const players = roomRef?.state?.players;
    if (!players) return;

    const rows: Array<{ id: string; name: string; kills: number; deaths: number; color: number }> = [];
    players.forEach((p: any, id: string) => {
        rows.push({ id, name: p.name || id.slice(0, 6), kills: p.kills ?? 0, deaths: p.deaths ?? 0, color: p.color ?? 0xffffff });
    });

    rows.sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);

    const targetInfo = getTargetInfo(myPlayerRef?.targetId);
    const stamina = Math.round(clamp(myPlayerRef?.stamina ?? 100, 0, 100));
    const sprinting = !!myPlayerRef?.isSprinting;
    const staminaColor = stamina < 20 ? "#ff8a8a" : stamina < 50 ? "#ffd37a" : "#8affb3";
    const targetHtml = targetInfo
        ? `<div style="margin-bottom:8px;">Cible: <span style="display:inline-block;width:10px;height:10px;border-radius:99px;background:${toHex(targetInfo.color)}"></span> ${targetInfo.label}</div>`
        : `<div style="margin-bottom:8px;opacity:.8">Cible: aucune pour l’instant</div>`;
    let html = targetHtml;
    html += `
      <div style="margin-bottom:8px;">
        <div style="display:flex;justify-content:space-between;gap:8px;">
          <span>Stamina${sprinting ? " (sprint)" : ""}</span>
          <span>${stamina}%</span>
        </div>
        <div style="height:8px;border-radius:99px;background:rgba(255,255,255,0.14);overflow:hidden;">
          <div style="height:100%;width:${stamina}%;background:${staminaColor};transition:width 80ms linear,background-color 120ms linear;"></div>
        </div>
      </div>
    `;
    // ...puis le tableau des scores existant

    html += `<div style="font-weight:600;margin-bottom:6px;">Score</div>`;
    html += `<div style="display:grid;grid-template-columns:auto 44px 60px;gap:4px 10px;align-items:center">`;
    html += `<div style="opacity:.8">Joueur</div><div style="opacity:.8">Kills</div><div style="opacity:.8">Deaths</div>`;
    for (const r of rows) {
        const me = r.id === myId;
        html += `
      <div style="display:flex;align-items:center;gap:6px;${me ? 'font-weight:700;' : ''}">
        <span style="display:inline-block;width:10px;height:10px;border-radius:99px;background:${toHex(r.color)}"></span>
        <span style="max-width:140px;overflow:hidden;text-overflow:ellipsis;">${r.name}</span>
      </div>
      <div>${r.kills}</div>
      <div>${r.deaths}</div>
    `;
    }
    html += `</div>`;
    hud.innerHTML = html;
}

// update close to the server patch rate so stamina feels fluid while sprinting
setInterval(renderScoreboard, 1000 / 30);

// --- HDRI environment ---
const pmrem = new THREE.PMREMGenerator(renderer);
pmrem.compileEquirectangularShader();

new HDRLoader()
    .setPath("/hdr/")      // correspond à client/public/hdr/
    .load("sky.hdr", (hdr) => {
        const envMap = pmrem.fromEquirectangular(hdr).texture;
        scene.environment = envMap;   // éclaire PBR (MeshStandard, etc.)
        scene.background = envMap;   // affiche l'image en fond (optionnel)
        hdr.dispose();
        pmrem.dispose();
    });


// joueurs = simples capsules visuelles au début
const meshes = new Map<string, THREE.Mesh>();
const capsuleGeo = new THREE.CapsuleGeometry(0.3, 1.0, 4, 8);
scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1));



let myId = "";
let myPlayerRef: any = null; // référence du joueur local côté état

let yaw = 0;
let pitch = 0;
let keys: Record<string, boolean> = {};
let currentAttackTargetId = "";

function sendInput(room: any) {
    const ax = (keys["KeyW"] || keys["ArrowUp"] ? 1 : 0) + (keys["KeyS"] || keys["ArrowDown"] ? -1 : 0);
    const ay = (keys["KeyD"] || keys["ArrowRight"] ? 1 : 0) + (keys["KeyA"] || keys["ArrowLeft"] ? -1 : 0);
    const sprint = !!(keys["ShiftLeft"] || keys["ShiftRight"]);
    room.send("input", { ax, ay, yaw, sprint });
}







function positionCamera(player: any) {
    const dist = 3.5, targetHeight = 0.95;
    const target = new THREE.Vector3(player.x, player.y + targetHeight, player.z);
    const cosP = Math.cos(pitch);
    const sinP = Math.sin(pitch);
    const back = new THREE.Vector3(0, sinP * dist, -cosP * dist).applyEuler(new THREE.Euler(0, yaw, 0));
    camera.position.copy(target).add(back);
    camera.lookAt(target);
}

function projectAttackMarkerPosition(x: number, y: number, z: number) {
    const p = new THREE.Vector3(x, y + ATTACK_MARKER_Y_OFFSET, z).project(camera);
    if (p.z < -1 || p.z > 1 || p.x < -1 || p.x > 1 || p.y < -1 || p.y > 1) return null;
    return {
        x: (p.x * 0.5 + 0.5) * window.innerWidth,
        y: (-p.y * 0.5 + 0.5) * window.innerHeight,
        centeredness: p.x * p.x + p.y * p.y,
    };
}

function updateAttackMarker() {
    currentAttackTargetId = "";
    attackMarker.style.display = "none";
    if (!roomRef || !myPlayerRef || !myPlayerRef.alive || myPlayerRef.spectator) return;

    let best: { id: string; x: number; y: number; centeredness: number } | null = null;
    const consider = (id: string, target: any) => {
        const dx = target.x - myPlayerRef.x;
        const dz = target.z - myPlayerRef.z;
        if ((dx * dx + dz * dz) > ATTACK_REACH * ATTACK_REACH) return;

        const marker = projectAttackMarkerPosition(target.x, target.y, target.z);
        if (!marker) return;
        if (!best || marker.centeredness < best.centeredness) {
            best = { id, ...marker };
        }
    };

    roomRef.state.players.forEach((p: any, id: string) => {
        if (id === myId || !p.alive || p.spectator) return;
        consider(id, p);
    });
    roomRef.state.npcs.forEach((n: any, id: string) => consider(id, n));

    if (!best) return;
    currentAttackTargetId = best.id;
    attackMarker.style.left = `${best.x}px`;
    attackMarker.style.top = `${best.y}px`;
    attackMarker.style.display = "block";
}


(async () => {

    const gltf = await gltfLoader.loadAsync('/models/city2.glb');
    gltf.scene.scale.set(5, 4, 5);
    scene.add(gltf.scene);


    const [room, $] = await joinGame();
    roomRef = room;
    if (currentName) roomRef.send("setName", { name: currentName });

    room.onMessage("attack", ({ id, yaw, t }) => {
        const m = meshes.get(id);
        if (!m) return;
        playAttackFX(m, yaw, scene);
    });

    myId = room.sessionId;

    // Attendre le 1er patch d’état pour être sûr que state.players existe
    room.onStateChange.once(() => {
        const players = room.state.players;
        $(room.state).players.onAdd((p: any, id: string) => {
            if (id === myId) myPlayerRef = p;
            console.log("[onAdd]", id);
            const m = new THREE.Mesh(
                capsuleGeo,
                new THREE.MeshStandardMaterial({ color: p.color }) // 👈 couleur unique
            ); m.castShadow = true;
            m.position.set(p.x, p.y + 0.95, p.z);
            meshes.set(id, m);
            scene.add(m);
            if (id === myId) {
                positionCamera(p);
            }

            $(p).onChange(() => {
                const mm = meshes.get(id)!;
                mm.position.set(p.x, p.y + 0.95, p.z);
                const mat = mm.material as THREE.MeshStandardMaterial;
                mat.transparent = !p.alive;
                mat.opacity = p.alive ? 1 : 0.4;
                mat.needsUpdate = true;
                if (id === myId) {
                    positionCamera(p);
                }
            });

        });

        $(room.state).players.onRemove((_: any, id: string) => {
            if (id === myId) myPlayerRef = null;
            const m = meshes.get(id);
            if (m) scene.remove(m);
            meshes.delete(id);
        });

        $(room.state).npcs.onAdd((n: any, id: string) => {
            const m = new THREE.Mesh(
                npcGeo,
                new THREE.MeshStandardMaterial({
                    color: n.color,
                    transparent: false,
                    opacity: 1.0,
                })
            );
            m.castShadow = true;
            m.position.set(n.x, n.y + 0.95, n.z);
            npcMeshes.set(id, m);
            scene.add(m);

            $(n).onChange(() => {
                const mm = npcMeshes.get(id); if (!mm) return;
                mm.position.set(n.x, n.y + 0.95, n.z);
            });
        });

        // onRemove
        $(room.state).npcs.onRemove((_: any, id: string) => {
            const m = npcMeshes.get(id);
            if (m) scene.remove(m);
            npcMeshes.delete(id);
        });

        // hydrate
        /*npcs.forEach((_n: any, id: string) => {
            if (!npcMeshes.has(id)) $(room.state).npcs.triggerOnAdd(id);
        });*/

    });




    function isMoveKey(code: string) {
        return code === "KeyW" || code === "KeyA" || code === "KeyS" || code === "KeyD" || code === "Space" ||
            code === "ShiftLeft" || code === "ShiftRight" ||
            code === "ArrowUp" || code === "ArrowDown" || code === "ArrowLeft" || code === "ArrowRight";
    }
    window.addEventListener("keydown", (e) => { if (isMoveKey(e.code)) e.preventDefault(); keys[e.code] = true; if (e.code === "Space") room.send("melee", { targetId: currentAttackTargetId }); });
    window.addEventListener("keyup", (e) => { if (isMoveKey(e.code)) e.preventDefault(); keys[e.code] = false; });
    // souris = yaw (ultra simple)
    addEventListener("mousemove", (e) => {
        yaw -= e.movementX * 0.003;
        pitch = clamp(pitch + e.movementY * 0.0025, CAMERA_PITCH_MIN, CAMERA_PITCH_MAX);
        if (myPlayerRef) positionCamera(myPlayerRef);
    });

    // boucle client
    let last = performance.now();

    function tick() {
        const now = performance.now();
        const dtSec = (now - last) / 1000;
        last = now;

        sendInput(room); // on continue d’envoyer l’état des touches
        drawCompass();
        updateAttackMarker();
        renderer.render(scene, camera);
        requestAnimationFrame(tick);
    }
    tick();
})();
