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
  respawnAt?: number; // ms epoch
}

export class State extends Schema {
  @schemaType({ map: Player }) players = new MapSchema<Player>();
}
