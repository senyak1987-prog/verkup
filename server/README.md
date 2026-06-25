# Verkup realtime server

The app works on Beget with PHP long-polling at `/api/events`. This Node service is an optional WebSocket bridge for a full realtime channel when a Node/VPS runtime is available.

## Run

```bash
VERKUP_API_URL=https://manager.verkup.ru/verkup/api PORT=8787 npm run realtime:server
```

Then expose the process through HTTPS/WSS, for example:

```nginx
location /realtime/ {
  proxy_pass http://127.0.0.1:8787/;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_set_header Host $host;
}
```

Set the frontend runtime config without storing secrets:

```js
window.VERKUP_CONFIG = {
  ...(window.VERKUP_CONFIG || {}),
  REALTIME_WS_URL: "wss://manager.verkup.ru/realtime/",
};
```

If `REALTIME_WS_URL` is empty, the frontend automatically falls back to `/api/events`.
