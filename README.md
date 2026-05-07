# Prosthetic Web Control App

React + Vite web app for prosthetic stiffness control using Web Serial.

## Run locally

```bash
npm install
npm run dev
```

Open the localhost link in Chrome or Edge.

## Build

```bash
npm run build
```

## Deploy to Vercel

Upload this project folder to GitHub, then import it into Vercel.

Vercel settings:

- Framework preset: Vite
- Build command: npm run build
- Output directory: dist

## Arduino / Web Serial Notes

Web Serial works on desktop Chrome or Edge. It will not work on iPhone Safari.
The app sends serial commands at 115200 baud.
