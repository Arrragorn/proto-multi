// server/src/schema/State.ts
import { Schema, type as schemaType, MapSchema } from "@colyseus/schema";

export class Player extends Schema {
  @schemaType("string") id!: string;
  @schemaType("boolean") alive: boolean = true;
  @schemaType("number") x: number = 0;
  @schemaType("number") y: number = 0;
  @schemaType("number") z: number = 0;
  @schemaType("number") yaw: number = 0;
  @schemaType("boolean") spectator: boolean = false;
  @schemaType("number") color: number = 0xffffff; // 👈 couleur hex envoyée aux clients
  @schemaType("string") name: string = "";        // nom affiché (ou fallback id)

  @schemaType("number") kills: number = 0; 
  @schemaType("number") deaths: number = 0;
  @schemaType("string") targetId: string = "";   // id de la cible actuelle

  respawnAt?: number; // ms epoch
}

export class NPC extends Schema {
  @schemaType("string") id!: string;
  @schemaType("number") x: number = 0;
  @schemaType("number") y: number = 0;
  @schemaType("number") z: number = 0;
  @schemaType("number") yaw: number = 0;
  @schemaType("number") color: number = 0xffffff; // 👈 couleur hex envoyée aux clients
}

export class State extends Schema {
  @schemaType({ map: Player }) players = new MapSchema<Player>();
  @schemaType({ map: NPC }) npcs = new MapSchema<NPC>();
}
