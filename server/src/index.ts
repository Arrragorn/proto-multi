// server/src/index.ts
import express from "express";
import { createServer } from "http";
import { Server } from "colyseus";
import { GameRoom } from "./rooms/GameRoom.js";

const app = express();
app.use(express.static("../client/dist")); // sert le build Vite

const httpServer = createServer(app);
const gameServer = new Server({ server: httpServer });

gameServer.define("game", GameRoom);

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Server on http://localhost:${PORT}`);
});
