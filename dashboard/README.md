# Control Deck dashboard

The local web UI for Bitwig Control Deck. A plain Next.js app that reads the
read-only status service at `http://127.0.0.1:50702` and renders bridge health,
the current Bitwig session, loaded devices, and the searchable plug-in
inventory at `http://127.0.0.1:50703`.

Everything binds to loopback only; nothing is published to the network.

## Commands

```bash
npm install
npm run dev     # local development on 127.0.0.1:50703
npm run build   # production build
npm run start   # serve the production build on 127.0.0.1:50703
npm run check   # build + server-rendered page tests
```

The deck's preferences (bridge address, refresh cadence, library defaults,
density, color, motion) live in the browser's localStorage — see the Settings
page.
