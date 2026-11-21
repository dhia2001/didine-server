// Didine Fighter online server (Cloudflare Worker + Durable Object)
// 1v1 rooms: /room/CODE      2v2 rooms (4 players): /room/CODE?m=4  (decided by the first player)
const RELAY = new Set(["c", "i", "s", "rm", "e", "cfg"]);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const m = url.pathname.match(/^\/room\/([A-Za-z0-9]{3,8})$/);
    if (!m) return new Response("Didine Fighter server OK");
    const id = env.ROOM.idFromName(m[1].toUpperCase());
    return env.ROOM.get(id).fetch(request);
  },
};

export class Room {
  constructor(state, env) {
    this.state = state;
    this.cap = 2;
    this.slots = new Map(); // slot number -> WebSocket
  }

  broadcast(obj, except) {
    const s = JSON.stringify(obj);
    for (const [k, w] of this.slots) {
      if (k !== except) {
        try { w.send(s); } catch (e) {}
      }
    }
  }

  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }
    // The first player in an empty room decides the room size.
    if (this.slots.size === 0) {
      this.cap = new URL(request.url).searchParams.get("m") === "4" ? 4 : 2;
    }
    let slot = 0;
    for (let i = 1; i <= this.cap; i++) {
      if (!this.slots.has(i)) { slot = i; break; }
    }
    if (!slot) return new Response("Room full", { status: 403 });

    const pair = new WebSocketPair();
    const client = pair[0], server = pair[1];
    server.accept();
    this.slots.set(slot, server);

    // Announce after the 101 response has been returned, so the client is ready.
    setTimeout(() => {
      try { server.send(JSON.stringify({ t: "hello", slot, cap: this.cap })); } catch (e) {}
      this.broadcast({ t: "n", n: this.slots.size, cap: this.cap });
      if (this.slots.size === this.cap) this.broadcast({ t: "start" });
    }, 0);

    server.addEventListener("message", (ev) => {
      if (typeof ev.data !== "string" || ev.data.length > 2000) return;
      let m;
      try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (!m || typeof m !== "object") return;
      if (m.t === "p") {
        try { server.send(JSON.stringify({ t: "q", ts: m.ts })); } catch (e) {}
        return;
      }
      if (!RELAY.has(m.t)) return;
      m.f = slot; // sender slot, trusted (set by the server)
      this.broadcast(m, slot);
    });

    const gone = () => {
      if (this.slots.get(slot) !== server) return;
      this.slots.delete(slot);
      this.broadcast({ t: "left", f: slot });
      this.broadcast({ t: "n", n: this.slots.size, cap: this.cap });
    };
    server.addEventListener("close", gone);
    server.addEventListener("error", gone);

    return new Response(null, { status: 101, webSocket: client });
  }
}
