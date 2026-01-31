# League of Legends Skin Selector

A web-based application that uses the League Client API (LCU) to automatically select skins in champion select.

## Features

- **Web Interface** - Beautiful, responsive UI accessible in your browser
- **Real-time Monitoring** - Automatically detects when you enter champion select
- **Manual Selection** - Browse and click on any owned skin to select it
- **Auto Mode** - Automatically select random skins
- **Live Status** - See connection status, summoner name, and current champion select state
- **Activity Log** - Track all actions and events

## Prerequisites

- Node.js and npm installed
- League of Legends client installed and running

## Installation

1. Install dependencies:
```bash
npm install
```

## Usage

1. **Start the League of Legends client** and log in
2. **Run the application**:
```bash
npm start
```

3. **Open your browser** and go to `http://localhost:3000`
4. **Enter champion select** in League of Legends
5. **Select your skin** from the web interface or use auto mode

## How it works

### Web Interface
- The app starts an Express.js server on `http://localhost:3000`
- A beautiful web UI displays your connection status, available skins, and activity log
- The frontend communicates with the backend through REST API endpoints

### League Client Connection
The application connects to the League Client Update (LCU) API:
- Reads the `lockfile` from your League installation
- Uses the file's credentials to authenticate with the local API
- Monitors champion select state and available skins
- Updates skin selection through the API

## API Endpoints

### GET `/api/status`
Returns current connection and champion select status:
```json
{
  "connected": true,
  "summoner": "SummonerName",
  "inChampSelect": true,
  "selectedChampion": "Champion ID: 1",
  "selectedChampionId": 1
}
```

### GET `/api/skins/:championId`
Returns list of owned skins for a champion:
```json
[
  {
    "id": 0,
    "name": "Garen",
    "ownership": { "owned": true }
  },
  {
    "id": 1,
    "name": "Commando Garen",
    "ownership": { "owned": true }
  }
]
```

### POST `/api/select-skin`
Selects a skin for the current champion:
```json
{
  "championId": 1,
  "skinId": 5
}
```

## Modes

### Manual Mode
- Browse available skins in a grid layout
- Click on any skin to select it
- Refresh button to reload the skin list

### Auto Mode
- Automatically selects a random skin when you enter champion select
- Useful for fast-paced games or if you don't care which skin you use

## Configuration

The app automatically detects:
- LCU port from the lockfile
- Authentication token
- Current summoner information
- Available skins for your champion
- Champion select state

## Notes

- The League client must be running for the app to work
- You can only select skins you own
- The app works in both normal and ranked champion select
- The web UI updates every 2 seconds

## Future Enhancements

- **Electron Desktop App** - Standalone application for easier use
- **Skin Preview Images** - Display actual skin artwork
- **Champion Stats** - Show win rates and statistics
- **Custom Keybinds** - Quick select skins with keyboard shortcuts
- **Favorites** - Save your favorite skins per champion

