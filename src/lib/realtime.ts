import type { ProductionAccessRole, RealtimeEvent } from "../types";

export type RealtimeConnectionState =
  | "connecting"
  | "open"
  | "fallback"
  | "closed"
  | "error";

type RealtimeSubscriptionOptions = {
  apiUrl: string;
  onEvent: (event: RealtimeEvent) => void;
  onStateChange?: (state: RealtimeConnectionState) => void;
  role?: ProductionAccessRole;
  userId?: string;
};

const LAST_EVENT_ID_KEY = "verkup:realtime:last-event-id";
const configuredWsUrl = (import.meta.env.VITE_REALTIME_WS_URL || "").trim();
const ACTIVE_POLL_DELAY_MS = 1_200;
const EMPTY_POLL_DELAY_MS = 5_000;
const HIDDEN_TAB_POLL_DELAY_MS = 30_000;
const ERROR_POLL_DELAY_MS = 10_000;

export function subscribeToRealtime(options: RealtimeSubscriptionOptions) {
  const apiUrl = normalizeUrl(options.apiUrl);
  const wsUrl = defaultRealtimeWsUrl();
  let closed = false;
  let currentSocket: WebSocket | undefined;
  let pollTimeoutId: number | undefined;
  let pollController: AbortController | undefined;
  let lastEventId = readLastEventId();

  const emitState = (state: RealtimeConnectionState) => options.onStateChange?.(state);
  const handleEvents = (events: RealtimeEvent[]) => {
    for (const event of events) {
      if (!event || typeof event.id !== "number") continue;
      if (event.id <= lastEventId) continue;
      lastEventId = event.id;
      writeLastEventId(lastEventId);
      options.onEvent(event);
    }
  };

  const startLongPolling = () => {
    if (closed || !apiUrl) return;
    emitState("fallback");

    const poll = async () => {
      if (closed) return;
      pollController?.abort();
      pollController = new AbortController();

      try {
        const url = new URL(`${apiUrl}/events`, window.location.origin);
        url.searchParams.set("since", String(lastEventId));
        url.searchParams.set("timeout", "0");
        if (options.userId) url.searchParams.set("userId", options.userId);
        if (options.role) url.searchParams.set("role", options.role);

        const response = await fetch(url.toString(), {
          cache: "no-store",
          signal: pollController.signal,
        });
        let receivedEvents = 0;
        if (response.ok) {
          const payload = (await response.json()) as {
            events?: RealtimeEvent[];
            lastEventId?: number;
          };
          const events = Array.isArray(payload.events) ? payload.events : [];
          receivedEvents = events.length;
          handleEvents(events);
          if (typeof payload.lastEventId === "number" && payload.lastEventId > lastEventId) {
            lastEventId = payload.lastEventId;
            writeLastEventId(lastEventId);
          }
        }
        const delay = document.hidden
          ? HIDDEN_TAB_POLL_DELAY_MS
          : receivedEvents
            ? ACTIVE_POLL_DELAY_MS
            : EMPTY_POLL_DELAY_MS;
        if (!closed) pollTimeoutId = window.setTimeout(poll, delay);
      } catch {
        if (!closed) emitState("error");
        if (!closed) pollTimeoutId = window.setTimeout(poll, ERROR_POLL_DELAY_MS);
      }
    };

    void poll();
  };

  const startWebSocket = () => {
    if (closed || !wsUrl) {
      startLongPolling();
      return;
    }

    emitState("connecting");
    try {
      currentSocket = new WebSocket(wsUrl);
    } catch {
      startLongPolling();
      return;
    }

    currentSocket.addEventListener("open", () => {
      if (closed || !currentSocket) return;
      emitState("open");
      currentSocket.send(
        JSON.stringify({
          type: "client.identify",
          role: options.role || "",
          since: lastEventId,
          userId: options.userId || "",
        }),
      );
    });

    currentSocket.addEventListener("message", (message) => {
      try {
        const payload = JSON.parse(String(message.data)) as {
          event?: RealtimeEvent;
          events?: RealtimeEvent[];
          type?: string;
        };
        if (Array.isArray(payload.events)) handleEvents(payload.events);
        if (payload.event) handleEvents([payload.event]);
      } catch {
        // Ignore malformed realtime frames.
      }
    });

    currentSocket.addEventListener("close", () => {
      if (closed) return;
      window.setTimeout(startLongPolling, 700);
    });

    currentSocket.addEventListener("error", () => {
      if (!closed) emitState("error");
    });
  };

  startWebSocket();

  return () => {
    closed = true;
    if (pollTimeoutId) window.clearTimeout(pollTimeoutId);
    pollController?.abort();
    if (currentSocket && currentSocket.readyState <= WebSocket.OPEN) currentSocket.close();
    emitState("closed");
  };
}

function defaultRealtimeWsUrl() {
  if (typeof window === "undefined") return "";
  const runtime = String(window.VERKUP_CONFIG?.REALTIME_WS_URL || "").trim();
  return normalizeUrl(runtime || configuredWsUrl);
}

function normalizeUrl(value: string) {
  return value.trim().replace(/\/+$/, "");
}

function readLastEventId() {
  if (typeof window === "undefined") return 0;
  return Math.max(0, Number(localStorage.getItem(LAST_EVENT_ID_KEY)) || 0);
}

function writeLastEventId(value: number) {
  try {
    localStorage.setItem(LAST_EVENT_ID_KEY, String(value));
  } catch {
    // Storage can be unavailable in private mode; realtime still works for this session.
  }
}
