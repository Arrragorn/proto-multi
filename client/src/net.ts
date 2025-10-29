import * as Colyseus from "colyseus.js";

// en dev, utilise VITE_WS_URL; en prod, retombe sur le même host que la page
const WS_URL =
  import.meta.env.VITE_WS_URL ||
  location.origin.replace(/^http/, "ws");

export const client = new Colyseus.Client(WS_URL);
export async function joinGame() {
  const room = await client.joinOrCreate("game");
  return room;
}
