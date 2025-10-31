// server/src/rooms/GameRoom.ts
import { Room } from "colyseus";
import type { Client } from "colyseus";
import { State, Player } from "../schema/State.js";

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

onCreate() {
  this.setState(new State());
  this.setPatchRate(1000/30); // 33 Hz
 this.onMessage("input", (client, data: { ax:number; ay:number; yaw:number }) => {
  const p = this.state.players.get(client.sessionId);
  if (!p || p.spectator || !p.alive) return;
  this.inputs.set(client.sessionId, data);
  // ⬇️ log throttle (1/10) pour vérifier que ça arrive
  if (Math.random() < 0.1) {
    console.log("[input]", client.sessionId, data);
  }
});
  this.onMessage("melee", (client) => this.handleMelee(client));
  let once = false;
  this.setSimulationInterval((dt) => {
    if (!once) { console.log("[tick] started"); once = true; }
    this.update(dt);
  });
}

onLeave(client: Client) {
  this.state.players.delete(client.sessionId);
  this.inputs.delete(client.sessionId); // ⬅️ nettoyage
}

private update(dt: number) {
  const dtSec = dt / 1000;
  const speed = 5; // unités / seconde

  // appliquer les inputs stockés
  this.state.players.forEach((p, id) => {
    if (p.spectator || !p.alive) return;
    const inp = this.inputs.get(id);
    if (!inp) return;

    p.yaw = inp.yaw;
    const fwdX = Math.sin(p.yaw), fwdZ = Math.cos(p.yaw);
    p.x += (fwdX * inp.ax - fwdZ * inp.ay) * speed * dtSec;
    p.z += (fwdZ * inp.ax + fwdX * inp.ay) * speed * dtSec;
  });

  // respawn
  const now = Date.now();
  this.state.players.forEach(p => {
    if (!p.alive && p.respawnAt && now >= p.respawnAt) {
      p.alive = true;
      delete p.respawnAt;
      [p.x, p.y, p.z] = [Math.random()*10, 0, Math.random()*10];
    }
  });
}



  onJoin(client: Client) {
    const p = new Player();
    p.id = client.sessionId;
    p.spectator = this.countActivePlayers() >= 8;
    // spawn aléatoire simple
    [p.x, p.y, p.z] = [Math.random()*10, 0, Math.random()*10];

// 👇 couleur stable basée sur l'ID
  const hue = hashHue(client.sessionId);
  p.color = hslToHex(hue);

    this.state.players.set(client.sessionId, p);
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

  // position & radius (ton joueur peut avoir rayon 0.3)
  const ar = 0.3;
  const range = this.ATTACK_RANGE;

  // loop targets
  this.state.players.forEach((target, id) => {
    if (id === client.sessionId) return;
    if (!target.alive || target.spectator) return;

    // distance 2D simple (ignore Y) -> plus rapide
    const dx = attacker.x - target.x;
    const dz = attacker.z - target.z;
    const dist2 = dx*dx + dz*dz;
    const minDist = (ar + (target.radius ?? 0.3) + range); // si tu stockes radius
    if (dist2 <= minDist * minDist) {
      // (optionnel) vérif direction du coup :
      // const forwardX = Math.sin(attacker.yaw), forwardZ = Math.cos(attacker.yaw);
      // const dot = (forwardX * (target.x - attacker.x) + forwardZ * (target.z - attacker.z)) / Math.sqrt(dist2);
      // if (dot < 0.2) return; // pas assez face à la cible

      // kill
      target.alive = false;
      target.respawnAt = Date.now() + 30_000;
      console.log("[hit]");
      // tu peux broadcast un message kill pour jouer son animation
      this.broadcast("killed", { by: client.sessionId, target: id });
    }
  });
}

}
