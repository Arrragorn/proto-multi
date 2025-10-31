// client/src/main.ts
import { joinGame } from "./net";
import * as THREE from "three";
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader.js";


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
document.body.appendChild(renderer.domElement);

// focus + pointer lock pour une souris fluide
renderer.domElement.addEventListener("click", () => {
    renderer.domElement.focus();
    if (renderer.domElement.requestPointerLock) {
        renderer.domElement.requestPointerLock();
    }
});


document.body.appendChild(renderer.domElement);



// --- HDRI environment ---
const pmrem = new THREE.PMREMGenerator(renderer);
pmrem.compileEquirectangularShader();

new RGBELoader()
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
const matAlive = new THREE.MeshStandardMaterial();
const matDead = new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.4 });
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
    const room = await joinGame();
    roomRef = room;

    myId = room.sessionId;

    // Attendre le 1er patch d’état pour être sûr que state.players existe
    room.onStateChange.once(() => {
        const players = room.state.players;

        players.onAdd = (p: any, id: string) => {
            console.log("[onAdd]", id);

            const m = new THREE.Mesh(
                capsuleGeo,
                new THREE.MeshStandardMaterial({ color: p.color }) // 👈 couleur unique
            ); m.castShadow = true;
            m.position.set(p.x, 0.9, p.z);
            meshes.set(id, m);
            scene.add(m);

            // si c'est nous, garde une ref pratique
            if (id === myId) myPlayerRef = p;

            p.onChange = () => {
                const mm = meshes.get(id)!;
                mm.position.set(p.x, 0.9, p.z);
                if (Math.random() < 0.05) {
                    console.log("[remote update]", id, { x: p.x, z: p.z });
                }
            };
        };

        players.onRemove = (_: any, id: string) => {
            if (id === myId) myPlayerRef = null;
            const m = meshes.get(id);
            if (m) scene.remove(m);
            meshes.delete(id);
        };

        // hydrate les déjà-présents
        players.forEach((p: any, id: string) => {
            const m = new THREE.Mesh(
                capsuleGeo,
                new THREE.MeshStandardMaterial({ color: p.color }) // 👈 couleur unique
            );
            m.castShadow = true;
            m.position.set(p.x, 0.9, p.z);
            meshes.set(id, m);
            scene.add(m);

            if (id === myId) myPlayerRef = p;

            p.onChange = () => {
                const mm = meshes.get(id)!;
                mm.position.set(p.x, 0.9, p.z);
                (mm.material as THREE.MeshStandardMaterial).opacity = p.alive ? 1 : 0.4;
            };
        });
    });


    function isMoveKey(code: string) {
        return code === "KeyW" || code === "KeyA" || code === "KeyS" || code === "KeyD" || code === "Space";
    }
    window.addEventListener("keydown", (e) => { if (isMoveKey(e.code)) e.preventDefault(); keys[e.code] = true; if (e.code === "Space") room.send("melee"); });
    window.addEventListener("keyup", (e) => { if (isMoveKey(e.code)) e.preventDefault(); keys[e.code] = false; });
    // souris = yaw (ultra simple)
    addEventListener("mousemove", (e) => { yaw -= e.movementX * 0.003; camera.rotation.y = yaw; });

    // boucle client
    let last = performance.now();

    function tick() {
        const now = performance.now();
        const dtSec = (now - last) / 1000;
        last = now;

        sendInput(room); // on continue d’envoyer l’état des touches

        const players = roomRef?.state?.players;
        if (players) {
            // a) créer les manquants
            players.forEach((p: any, id: string) => {
                if (!meshes.has(id)) {
                    const m = new THREE.Mesh(
                        capsuleGeo,
                        new THREE.MeshStandardMaterial({ color: p.color }) // 👈 couleur unique
                    );
                    m.castShadow = true;
                    m.position.set(p.x, 0.9, p.z);
                    meshes.set(id, m);
                    scene.add(m);
                    if (id === myId) myPlayerRef = p;
                    // (optionnel) log:
                    // console.log("[reconcile add]", id);
                }
            });

            // b) supprimer ceux qui n'existent plus côté serveur
            for (const [id, mesh] of Array.from(meshes.entries())) {
                if (!players.get(id)) {
                    scene.remove(mesh);
                    meshes.delete(id);
                    if (id === myId) myPlayerRef = null;
                    // console.log("[reconcile remove]", id);
                }
            }
        }

        // caméra 3e personne + prédiction locale du joueur
        const myMesh = meshes.get(myId);
        if (myMesh) {
            // prédiction locale (corrigée par p.onChange quand les patchs arrivent)
            const ax = (keys["KeyW"] ? 1 : 0) + (keys["KeyS"] ? -1 : 0);
            const ay = (keys["KeyD"] ? 1 : 0) + (keys["KeyA"] ? -1 : 0);
            const speed = 5; // mêmes unités que le serveur (u/s)
            const fwdX = Math.sin(yaw), fwdZ = Math.cos(yaw);

            myMesh.position.x += (fwdX * ax - fwdZ * ay) * speed * dtSec;
            myMesh.position.z += (fwdZ * ax + fwdX * ay) * speed * dtSec;

            // caméra qui suit
            const dist = 3.5, height = 1.6;
            const back = new THREE.Vector3(0, 0, -dist).applyEuler(new THREE.Euler(0, yaw, 0));
            camera.position.set(myMesh.position.x + back.x, height, myMesh.position.z + back.z);
            camera.lookAt(myMesh.position.x, 0.9, myMesh.position.z);
        }
        const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

        if (roomRef?.state?.players) {
            roomRef.state.players.forEach((p: any, id: string) => {
                const m = meshes.get(id);
                if (!m) return;
                const mat = m.material as THREE.MeshStandardMaterial;
                mat.transparent = !p.alive;
                mat.opacity = p.alive ? 1 : 0.4;
                mat.needsUpdate = true;

                // pour TOUS les joueurs (y compris toi), on suit la position serveur
                // - pour toi: ça sert de correction douce (après la prédiction locale)
                // - pour les autres: c'est leur position visible
                const targetX = p.x;
                const targetZ = p.z;

                // facteur de lissage (ajuste entre 0.2 et 0.5 selon ton goût)
                const s = 0.25;

                m.position.x = lerp(m.position.x, targetX, s);
                m.position.z = lerp(m.position.z, targetZ, s);
                //m.position.x = targetX;
                //m.position.z = targetZ;

            });
        }

        renderer.render(scene, camera);
        requestAnimationFrame(tick);
    }
    tick();
})();
