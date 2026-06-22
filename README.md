# Quick Connect

A Google Meet-style video calling app that runs entirely in the browser. No backend, no accounts — just instant peer-to-peer video meetings powered by [PeerJS](https://peerjs.com/).

## How It Works

- **Create a meeting** — generates a unique 8-character room code and makes you the host.
- **Join a meeting** — enter a code to connect to an existing room.
- **Full mesh networking** — the host coordinates a peer roster; every participant connects directly to every other participant via WebRTC.
- **Controls** — toggle mic, toggle camera, copy the meeting code, or leave.

All signaling goes through the free PeerJS cloud broker. Audio/video streams flow directly between browsers (peer-to-peer).

## Tech Stack

- **Next.js 16** (App Router) + TypeScript
- **Tailwind CSS** for styling
- **PeerJS** for WebRTC signaling and media connections

## Getting Started

```bash
# Install dependencies
npm install

# Start the dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

To test a call, open a second browser tab — click **Create Meeting** in one, then copy the code and **Join Meeting** in the other.

## Project Structure

```
src/app/
  page.tsx                  # Home — create or join a meeting
  meeting/[code]/page.tsx   # Meeting room — video grid + PeerJS logic
  layout.tsx                # Root layout
  globals.css               # Global styles (dark theme)
```

## Deployment

Works on any platform that hosts Next.js — [Vercel](https://vercel.com), Netlify, etc. Since there's no custom backend, a static or edge deployment is all you need.

> **Note:** WebRTC requires HTTPS in production for camera/mic access to work.
