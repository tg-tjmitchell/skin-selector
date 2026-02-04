# League of Legends Skin Selector

An Electron desktop app (with web access) that uses the League Client Update (LCU) API to automatically select skins in champion select.

## Features

- **Electron Desktop App** - Native Windows application with built-in browser
- **Mobile Access** - QR code in the Electron app to open the UI on your phone for easy skin selection
- **Real-time Monitoring** - Automatically detects when you enter champion select
- **Skin Selection** - Browse and select any owned skin with loading screen previews
- **Chroma Support** - Select chromas for skins that have them
- **Random Selection** - Pick a random skin with one click, or enable auto-pick for automatic selection
- **Ready Check Accept** - Accept queue pop directly from the app
- **Live Status** - See connection status, summoner name, and current champion select state
- **Activity Log** - Track all actions and events

## Prerequisites

- Node.js (v18+) and npm installed
- League of Legends client installed and running

## Installation

```bash
npm install
```

## Usage

### Desktop App (Recommended)

```bash
npm run electron
```

The Electron window will open automatically with the skin selector UI.

### Web Server Only

```bash
npm run build
npm start
```

Then open `http://localhost:3000` in your browser.

### Development Mode

```bash
npm run dev
```

Runs the server with hot reload using `tsx`.

### Build Installer (Windows)

```bash
npm run dist
```

The installer will be generated in the `dist/` folder (NSIS installer and portable executable).

## How to Use

1. **Start the League of Legends client** and log in
2. **Run the app** using one of the methods above
3. **Enter champion select** in League of Legends
4. **Select your skin** from the grid - click a skin to select it
5. If the skin has chromas, you'll see a chroma picker
6. Use **Random Skin** button to pick a random skin, or enable the **Auto-pick** checkbox to automatically select a random skin each game

### Mobile Access

In the Electron app, click **Open on phone** (📱) in the header to display a QR code you can scan with your phone to access the skin selector remotely (must be on the same network).

## API Endpoints

### GET `/api/status`
Returns current connection and champion select status:
```json
{
  "connected": true,
  "summoner": "SummonerName",
  "inChampSelect": true,
  "selectedChampion": "Champion ID: 1",
  "selectedChampionId": 1,
  "lockedIn": false,
  "readyCheck": { "state": "InProgress", "playerResponse": "None" }
}
```

### GET `/api/skins/:championId`
Returns list of owned skins for a champion with loading screen URLs and chroma data.

### POST `/api/select-skin`
Selects a skin (and optionally a chroma) for the current champion:
```json
{
  "championId": 1,
  "skinId": 5,
  "chromaId": 123
}
```

### POST `/api/accept-ready-check`
Accepts the current ready check (queue pop).

### GET `/api/server-info`
Returns LAN IP and port for remote access.

### GET `/api/qr-code`
Returns a QR code image (data URL) for the server URL.

## Tech Stack

- **Electron** - Desktop application framework
- **Express.js** - Web server for the UI and API
- **TypeScript** - Type-safe code throughout
- **@hasagi/core** - LCU API client library
- **Data Dragon** - Champion and skin artwork from Riot's CDN

## Notes

- The League client must be running for the app to connect
- You can only select skins you own
- Works in all champion select modes (normal, ranked, ARAM, etc.)
- The UI polls for status updates every 2 seconds

## Future Enhancements

- **Favorites** - Save your favorite skins per champion
- **Skin Favorites Randomizer** - Random selection from favorites only
- **Champion Stats** - Show win rates and statistics

