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
  this.onMessage("shoot", (client, data) => this.handleShoot(client, data));
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

  private handleShoot(client: Client, s: ShootMsg) {
    const shooter = this.state.players.get(client.sessionId);
    if (!shooter || shooter.spectator || !shooter.alive) return;

    // Raycast ultra-simple contre des boîtes 0.6x1.8x0.6 autour de (x,y,z)
    const maxDist = 30;
    this.state.players.forEach((target, id) => {
      if (id === client.sessionId || !target.alive) return;
      if (this.rayHitsAABB(s, target, maxDist)) {
        // kill
        target.alive = false;
        target.respawnAt = Date.now() + 30_000; // 30s
      }
    });
  }

  private rayHitsAABB(s: ShootMsg, t: Player, maxDist: number) {
    // AABB centered at (t.x, 0.9, t.z) with half extents (0.3,0.9,0.3)
    const min = { x: t.x - 0.3, y: 0,   z: t.z - 0.3 };
    const max = { x: t.x + 0.3, y: 1.8, z: t.z + 0.3 };
    // Ray-box test (slab), early-out if > maxDist
    const inv = (v: number) => (Math.abs(v) < 1e-6 ? 1e6 : 1 / v);
    const dir = { x: s.dx, y: s.dy, z: s.dz };
    const t1 = (min.x - s.ox) * inv(dir.x), t2 = (max.x - s.ox) * inv(dir.x);
    const t3 = (min.y - s.oy) * inv(dir.y), t4 = (max.y - s.oy) * inv(dir.y);
    const t5 = (min.z - s.oz) * inv(dir.z), t6 = (max.z - s.oz) * inv(dir.z);
    const tmin = Math.max(Math.min(t1,t2), Math.min(t3,t4), Math.min(t5,t6));
    const tmax = Math.min(Math.max(t1,t2), Math.max(t3,t4), Math.max(t5,t6));
    if (tmax < 0 || tmin > tmax) return false;
    return tmin >= 0 && tmin <= maxDist;
  }

}
