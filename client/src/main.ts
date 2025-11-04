// client/src/main.ts
import { joinGame } from "./net";
import * as THREE from "three";
import { HDRLoader } from "three/examples/jsm/loaders/HDRLoader.js";
import { playAttackFX } from "./fx";


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


function renderScoreboard() {
  const players = roomRef?.state?.players;
  if (!players) return;

  const rows: Array<{id:string; kills:number; deaths:number; color:number}> = [];
  players.forEach((p:any, id:string) => {
    rows.push({ id, kills: p.kills ?? 0, deaths: p.deaths ?? 0, color: p.color ?? 0xffffff });
  });

  rows.sort((a,b) => b.kills - a.kills || a.deaths - b.deaths);

  const toHex = (n:number)=>"#"+n.toString(16).padStart(6,"0");

  let html = `<div style="font-weight:600;margin-bottom:6px;">Score</div>`;
  html += `<div style="display:grid;grid-template-columns:auto 44px 60px;gap:4px 10px;align-items:center">`;
  html += `<div style="opacity:.8">Joueur</div><div style="opacity:.8">Kills</div><div style="opacity:.8">Deaths</div>`;
  for (const r of rows) {
    const me = r.id === myId;
    html += `
      <div style="display:flex;align-items:center;gap:6px;${me?'font-weight:700;':''}">
        <span style="display:inline-block;width:10px;height:10px;border-radius:99px;background:${toHex(r.color)}"></span>
        <span style="max-width:140px;overflow:hidden;text-overflow:ellipsis;">${r.id.slice(0,6)}</span>
      </div>
      <div>${r.kills}</div>
      <div>${r.deaths}</div>
    `;
  }
  html += `</div>`;
  hud.innerHTML = html;
}

// update toutes les 500 ms (simple et suffisant)
setInterval(renderScoreboard, 500);

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
let keys: Record<string, boolean> = {};

function sendInput(room: any) {
    const ax = (keys["KeyW"] ? 1 : 0) + (keys["KeyS"] ? -1 : 0);
    const ay = (keys["KeyD"] ? 1 : 0) + (keys["KeyA"] ? -1 : 0);
    room.send("input", { ax, ay, yaw });
}








(async () => {
    const [room, $] = await joinGame();
    roomRef = room;

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
            console.log("[onAdd]", id);
            const m = new THREE.Mesh(
                capsuleGeo,
                new THREE.MeshStandardMaterial({ color: p.color }) // 👈 couleur unique
            ); m.castShadow = true;
            m.position.set(p.x, 0.9, p.z);
            meshes.set(id, m);
            scene.add(m);


            $(p).onChange(() => {
                const mm = meshes.get(id)!;
                mm.position.set(p.x, 0.9, p.z);
                const mat = mm.material as THREE.MeshStandardMaterial;
                mat.transparent = !p.alive;
                mat.opacity = p.alive ? 1 : 0.4;
                mat.needsUpdate = true;
                if (id === myId) {
                    const dist = 3.5, height = 1.6;
                    const back = new THREE.Vector3(0, 0, -dist).applyEuler(new THREE.Euler(0, yaw, 0));
                    camera.position.set(p.x + back.x, height, p.z + back.z);
                    camera.lookAt(p.x, 0.9, p.z);
                }
            });

        });

        $(room.state).players.onRemove((_: any, id: string) => {
            if (id === myId) myPlayerRef = null;
            const m = meshes.get(id);
            if (m) scene.remove(m);
            meshes.delete(id);
        });
    });


    function isMoveKey(code: string) {
        return code === "KeyW" || code === "KeyA" || code === "KeyS" || code === "KeyD" || code === "Space";
    }
    window.addEventListener("keydown", (e) => { if (isMoveKey(e.code)) e.preventDefault(); keys[e.code] = true; if (e.code === "Space") room.send("melee"); });
    window.addEventListener("keyup", (e) => { if (isMoveKey(e.code)) e.preventDefault(); keys[e.code] = false; });
    // souris = yaw (ultra simple)
    addEventListener("mousemove", (e) => { yaw -= e.movementX * 0.003; /*camera.rotation.y = yaw;*/ });

    // boucle client
    let last = performance.now();

    function tick() {
        const now = performance.now();
        const dtSec = (now - last) / 1000;
        last = now;

        sendInput(room); // on continue d’envoyer l’état des touches
        renderer.render(scene, camera);
        requestAnimationFrame(tick);
    }
    tick();
})();
