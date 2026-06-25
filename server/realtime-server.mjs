import { WebSocketServer } from "ws";

const PORT = Number(process.env.PORT || process.env.REALTIME_PORT || 8787);
const API_URL = normalizeUrl(process.env.VERKUP_API_URL || "http://127.0.0.1/verkup/api");
const POLL_TIMEOUT_SECONDS = 25;

const clients = new Map();
let upstreamLastEventId = 0;
let upstreamLoopRunning = false;

const server = new WebSocketServer({ port: PORT });

server.on("connection", (socket, request) => {
  const client = {
    role: "",
    socket,
    userId: "",
  };
  clients.set(socket, client);

  socket.on("message", (raw) => {
    try {
      const payload = JSON.parse(String(raw));
      if (payload?.type !== "client.identify") return;
      client.role = String(payload.role || "");
      client.userId = String(payload.userId || "");
      const since = Math.max(0, Number(payload.since) || 0);
      if (since > 0) {
        void sendCatchup(client, since);
      }
    } catch {
      // Ignore malformed frames; the connection can keep receiving valid frames later.
    }
  });

  socket.on("close", () => {
    clients.delete(socket);
  });

  socket.send(JSON.stringify({ type: "server.hello", apiUrl: API_URL, connectedAt: new Date().toISOString() }));
});

server.on("listening", () => {
  console.log(`Verkup realtime server listening on :${PORT}`);
  if (!upstreamLoopRunning) {
    upstreamLoopRunning = true;
    void pollUpstream();
  }
});

async function pollUpstream() {
  while (true) {
    try {
      const url = new URL(`${API_URL}/events`);
      url.searchParams.set("since", String(upstreamLastEventId));
      url.searchParams.set("timeout", String(POLL_TIMEOUT_SECONDS));
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) throw new Error(`Upstream returned ${response.status}`);
      const payload = await response.json();
      const events = Array.isArray(payload.events) ? payload.events : [];
      for (const event of events) {
        upstreamLastEventId = Math.max(upstreamLastEventId, Number(event.id) || 0);
        broadcastEvent(event);
      }
      if (Number(payload.lastEventId) > upstreamLastEventId) {
        upstreamLastEventId = Number(payload.lastEventId);
      }
    } catch (error) {
      console.error(`Realtime upstream error: ${error instanceof Error ? error.message : String(error)}`);
      await delay(1500);
    }
  }
}

async function sendCatchup(client, since) {
  try {
    const url = new URL(`${API_URL}/events`);
    url.searchParams.set("since", String(since));
    url.searchParams.set("timeout", "0");
    if (client.userId) url.searchParams.set("userId", client.userId);
    if (client.role) url.searchParams.set("role", client.role);
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return;
    const payload = await response.json();
    const events = Array.isArray(payload.events) ? payload.events : [];
    if (events.length) client.socket.send(JSON.stringify({ type: "events", events }));
  } catch {
    // The main upstream loop will deliver newer events once it reconnects.
  }
}

function broadcastEvent(event) {
  for (const client of clients.values()) {
    if (client.socket.readyState !== 1) continue;
    if (!eventVisibleForClient(event, client)) continue;
    client.socket.send(JSON.stringify({ type: "event", event }));
  }
}

function eventVisibleForClient(event, client) {
  const targetEmployeeIds = Array.isArray(event.targetEmployeeIds) ? event.targetEmployeeIds : [];
  const targetRoles = Array.isArray(event.targetRoles) ? event.targetRoles : [];
  if (!targetEmployeeIds.length && !targetRoles.length) return true;
  if (client.userId && targetEmployeeIds.includes(client.userId)) return true;
  return Boolean(client.role && targetRoles.includes(client.role));
}

function normalizeUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
