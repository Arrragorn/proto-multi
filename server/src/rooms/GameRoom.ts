// server/src/rooms/GameRoom.ts
import { Room } from "colyseus";
import type { Client } from "colyseus";
import { State, Player, NPC } from "../schema/State.js";

import { HeightField } from "../heightfield.js";
const HF = new HeightField("public/heightmap.bin", "public/heightmap.meta.json");

const N_NPCS = 100;
const NPC_SPEED = 3.3;      // un peu plus lent que joueur?
const PLAYER_SPEED = 5.0;
const RABBIT_ID = "rabbit";


type InputMsg = { ax: number; ay: number; yaw: number }; // ax=avant/arrière, ay=gauche/droite
type ShootMsg = { ox: number; oy: number; oz: number; dx: number; dy: number; dz: number; t: number };

function hashHue(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return (h % 360);
}
function hslToHex(h: number, s = 0.6, l = 0.55): number {
  // h: 0..360
  h /= 360;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
    return Math.round(255 * c);
  };
  const r = f(0), g = f(8), b = f(4);
  return (r << 16) | (g << 8) | b;
}


export class GameRoom extends Room<State> {
  maxClients = 32; // on accepte des spectateurs mais limitera les “joueurs”
  private inputs = new Map<string, { ax: number; ay: number; yaw: number }>();
  private huntOrder: string[] = []; // ordre chainé des chasseurs

  onCreate() {
    this.setState(new State());
    this.setPatchRate(1000 / 30); // 33 Hz
    this.onMessage("input", (client, data: { ax: number; ay: number; yaw: number }) => {
      const p = this.state.players.get(client.sessionId);
      if (!p || p.spectator || !p.alive) return;
      this.inputs.set(client.sessionId, data);
      // ⬇️ log throttle (1/10) pour vérifier que ça arrive
      if (Math.random() < 0.1) {
        console.log("[input]", client.sessionId, data);
      }
    });
    this.onMessage("melee", (client) => this.handleMelee(client));
    this.onMessage("setName", (client, data: { name: string }) => this.handleSetName(client, data));

    this.spawnRabbit();
    this.spawnNPCs(Math.max(0, N_NPCS - 1)); // lapin + reste des NPCs

    let once = false;
    this.setSimulationInterval((dt) => {
      if (!once) { console.log("[tick] started"); once = true; }
      this.update(dt);
    });
  }

  onLeave(client: Client) {
    this.state.players.delete(client.sessionId);
    this.inputs.delete(client.sessionId); // ⬅️ nettoyage
    this.removeFromHuntOrder(client.sessionId);
    this.rebuildHuntChain();
  }


  private randomXZ(): [number, number] {
    // pique les bornes depuis HF meta si tu les exposes; sinon borne “raisonnable”
    const minX = HF.minX, maxX = HF.maxX, minZ = HF.minZ, maxZ = HF.maxZ;
    const x = minX + Math.random() * (maxX - minX);
    const z = minZ + Math.random() * (maxZ - minZ);
    return [x, z];
  }

  private randColor(): number {
    // palette simple HSL -> rgb
    const h = Math.floor(Math.random() * 360);
    const s = 60, l = 55;
    // convert quickly:
    const c = (1 - Math.abs(2 * l / 100 - 1)) * s / 100;
    const X = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = l / 100 - c / 2;
    const [r, g, b] = ((h: number) => {
      if (h < 60) return [c, X, 0];
      if (h < 120) return [X, c, 0];
      if (h < 180) return [0, c, X];
      if (h < 240) return [0, X, c];
      if (h < 300) return [X, 0, c];
      return [c, 0, X];
    })(h).map(v => Math.round((v + m) * 255));
    return (r << 16) | (g << 8) | b;
  }

  private spawnNPCs(n: number) {
    for (let i = 0; i < n; i++) {
      const npc = new NPC();
      npc.id = `npc_${i}`;
      [npc.x, npc.z] = this.randomXZ();
      npc.y = HF.H(npc.x, npc.z);
      npc.yaw = Math.random() * Math.PI * 2;
      npc.color = this.randColor();
      this.state.npcs.set(npc.id, npc);
    }
  }

  private spawnRabbit() {
    const rabbit = new NPC();
    rabbit.id = RABBIT_ID;
    [rabbit.x, rabbit.z] = this.randomXZ();
    rabbit.y = HF.H(rabbit.x, rabbit.z);
    rabbit.yaw = Math.random() * Math.PI * 2;
    rabbit.color = 0xffe08a; // couleur douce pour le repérer
    this.state.npcs.set(rabbit.id, rabbit);
  }

  private update(dt: number) {
    const dtSec = dt / 1000;

    // appliquer les inputs stockés
    this.state.players.forEach((p, id) => {
      if (p.spectator || !p.alive) return;
      const inp = this.inputs.get(id);
      if (!inp) return;
      p.yaw = inp.yaw;
      if (inp.ax === 0 && inp.ay === 0) {
        return;
      }

      const fwdX = Math.sin(p.yaw), fwdZ = Math.cos(p.yaw);
      const L = PLAYER_SPEED * dtSec;
      const dx = L * (fwdX * inp.ax - fwdZ * inp.ay);
      const dz = L * (fwdZ * inp.ax + fwdX * inp.ay);
      const x = p.x + dx;
      const z = p.z + dz;
      const y = HF.H(x, z);
      const dy = y - p.y;
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (len < 0.001) {
        return;
      }
      const ratio = L / len;
      p.x += dx * ratio;
      p.z += dz * ratio;
      p.y += dy * ratio;
    });

    // respawn
    const now = Date.now();
    this.state.players.forEach(p => {
      if (!p.alive && p.respawnAt && now >= p.respawnAt) {
        p.alive = true;
        delete p.respawnAt;
        [p.x, p.z] = this.randomXZ();
        p.y = HF.H(p.x, p.z);
        // revient en chasse à la fin de la chaîne
        if (!this.huntOrder.includes(p.id)) this.huntOrder.push(p.id);
        this.rebuildHuntChain();
      }
    });

    // NPCs movement
    this.state.npcs.forEach((n) => {

      const L = NPC_SPEED * dtSec;
      const dx = Math.sin(n.yaw) * L;
      const dz = Math.cos(n.yaw) * L;
      const x = n.x + dx;
      const z = n.z + dz;
      const y = HF.H(x, z);
      const dy = y - n.y;
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (len < 0.001) {
        return;
      }
      const ratio = L / len;
      n.x += dx * ratio;
      n.z += dz * ratio;
      n.y += dy * ratio;
      if(n.x < HF.minX || n.x > HF.maxX || n.z < HF.minZ || n.z > HF.maxZ) n.yaw += Math.PI; // turn back
      if (n.x < HF.minX) n.x = HF.minX;
      if (n.x > HF.maxX) n.x = HF.maxX;
      if (n.z < HF.minZ) n.z = HF.minZ;
      if (n.z > HF.maxZ) n.z = HF.maxZ;
      
      n.yaw += (Math.random() - 0.5) * 0.1;

      // colle au heightfield
      n.y = HF.H(n.x, n.z);
    });
  }

  private rebuildHuntChain() {
    // conserve l'ordre existant des vivants non-spectateurs
    const alive = new Set<string>();
    this.state.players.forEach(p => { if (p.alive && !p.spectator) alive.add(p.id); });

    this.huntOrder = this.huntOrder.filter(id => alive.has(id));

    // ajoute les vivants manquants à la fin
    this.state.players.forEach(p => {
      if (alive.has(p.id) && !this.huntOrder.includes(p.id)) {
        this.huntOrder.push(p.id);
      }
    });

    // reset des cibles pour tout le monde
    this.state.players.forEach(p => p.targetId = "");

    if (this.huntOrder.length === 0) return;

    // premier chasse le lapin, suivant chasse le précédent
    this.huntOrder.forEach((id, idx) => {
      const hunter = this.state.players.get(id);
      if (!hunter) return;
      hunter.targetId = idx === 0 ? RABBIT_ID : this.huntOrder[idx - 1];
    });
  }




  onJoin(client: Client) {
    const p = new Player();
    p.id = client.sessionId;
    p.name = "Anonyme";
    p.spectator = this.countActivePlayers() >= 32;
    //p.spectator = false;
    // spawn aléatoire simple
    [p.x, p.z] = this.randomXZ();
    p.y = HF.H(p.x, p.z);

    // 👇 couleur stable basée sur l'ID
    const hue = hashHue(client.sessionId);
    p.color = hslToHex(hue);

    this.state.players.set(client.sessionId, p);
    if (!p.spectator) this.huntOrder.push(p.id);
    this.rebuildHuntChain();
  }


  private countActivePlayers() {
    let n = 0;
    this.state.players.forEach(p => { if (!p.spectator) n++; });
    return n;
  }

  // server/src/rooms/GameRoom.ts (extrait)
  private lastAttackAt = new Map<string, number>();
  private ATTACK_RANGE = 1.2;     // mètre, ajuster
  private ATTACK_COOLDOWN = 800;  // ms

  private handleMelee(client: Client) {
    const attacker = this.state.players.get(client.sessionId);
    if (!attacker || attacker.spectator || !attacker.alive) return;

    const now = Date.now();
    const last = this.lastAttackAt.get(client.sessionId) ?? 0;
    if (now - last < this.ATTACK_COOLDOWN) return; // cooldown
    this.lastAttackAt.set(client.sessionId, now);

    this.broadcast("attack", { id: client.sessionId, yaw: attacker.yaw, t: now });

    // position & radius (ton joueur peut avoir rayon 0.3)
    const ar = 0.3;
    const range = this.ATTACK_RANGE;

    const targetId = attacker.targetId;
    if (!targetId) return;

    const targetPlayer = this.state.players.get(targetId);
    const targetNpc = this.state.npcs.get(targetId);
    if (targetPlayer) {
      if (targetPlayer.spectator || !targetPlayer.alive) return;
    } else if (!targetNpc) {
      return;
    }


    // loop targets
    //this.state.players.forEach((target, id) => {
    //if (id === client.sessionId) return;
    //if (!target.alive || target.spectator) return;

    // distance 2D simple (ignore Y) -> plus rapide
    const tx = targetPlayer ? targetPlayer.x : targetNpc!.x;
    const tz = targetPlayer ? targetPlayer.z : targetNpc!.z;

    const dx = attacker.x - tx;
    const dz = attacker.z - tz;
    const dist2 = dx * dx + dz * dz;
    const minDist = (ar + (targetPlayer?.radius ?? 0.3) + range); // si tu stockes radius
    if (dist2 <= minDist * minDist) {
      // (optionnel) vérif direction du coup :
      const forwardX = Math.sin(attacker.yaw), forwardZ = Math.cos(attacker.yaw);
      const dot = (forwardX * (tx - attacker.x) + forwardZ * (tz - attacker.z)) / Math.sqrt(dist2);
      if (dot < 0.2) return; // pas assez face à la cible

      if (targetNpc) {
        // lapin touché : téléporte-le, score pour l'attaquant
        if (targetNpc.id === RABBIT_ID) {
          [targetNpc.x, targetNpc.z] = this.randomXZ();
          targetNpc.y = HF.H(targetNpc.x, targetNpc.z);
          targetNpc.yaw = Math.random() * Math.PI * 2;
          attacker.kills++;
          console.log("[hit rabbit]");
          this.broadcast("killed", { by: client.sessionId, target: targetNpc.id });
        }
        return;
      }

      // kill joueur
      targetPlayer.alive = false;
      targetPlayer.respawnAt = Date.now() + 10_000;

      // scores
      attacker.kills++;
      targetPlayer.deaths++;

      console.log("[hit]");
      this.removeFromHuntOrder(targetPlayer.id);
      this.rebuildHuntChain();
      this.broadcast("killed", { by: client.sessionId, target: targetPlayer.id });
    }
    //});
  }

  private removeFromHuntOrder(id: string) {
    const idx = this.huntOrder.indexOf(id);
    if (idx >= 0) this.huntOrder.splice(idx, 1);
  }

  private handleSetName(client: Client, data: { name: string }) {
    const p = this.state.players.get(client.sessionId);
    if (!p) return;
    const raw = typeof data?.name === "string" ? data.name : "";
    const cleaned = raw.replace(/\s+/g, " ").trim().slice(0, 24);
    const safe = cleaned || "Anonyme";
    p.name = safe;
  }

}
