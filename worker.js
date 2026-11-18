// Didine Fighter - سيرفر أونلاين 1v1 على Cloudflare Workers + Durable Objects
// البروتوكول مطابق لكود اللعبة: hello / start / c / i / s / rm / left / p
export class Room {
  constructor(state) { this.state = state; }

  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket")
      return new Response("Expected WebSocket", { status: 426 });

    const sockets = this.state.getWebSockets();
    if (sockets.length >= 2)
      return new Response("Room full", { status: 403 });

    const taken = sockets.map(s => s.deserializeAttachment()?.slot);
    const slot = taken.includes(1) ? 2 : 1;

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.state.acceptWebSocket(server);
    server.serializeAttachment({ slot });
    server.send(JSON.stringify({ t: "hello", slot }));

    if (sockets.length === 1) {
      const msg = JSON.stringify({ t: "start" });
      server.send(msg);
      sockets[0].send(msg);
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws, data) {
    let m;
    try { m = JSON.parse(data); } catch { return; }
    if (m.t === "p") return; // ping
    if (!["c", "i", "s", "rm"].includes(m.t)) return;
    for (const s of this.state.getWebSockets())
      if (s !== ws) { try { s.send(data); } catch {} }
  }

  webSocketClose(ws) { this.#left(ws); }
  webSocketError(ws) { this.#left(ws); }

  #left(ws) {
    try { ws.close(); } catch {}
    for (const s of this.state.getWebSockets())
      if (s !== ws) { try { s.send(JSON.stringify({ t: "left" })); } catch {} }
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const m = url.pathname.match(/^\/room\/([A-Za-z0-9]{3,8})$/);
    if (!m) return new Response("Didine Fighter server OK");
    const id = env.ROOM.idFromName(m[1].toUpperCase());
    return env.ROOM.get(id).fetch(request);
  },
};
