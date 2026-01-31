const express = require('express');
const path = require('path');
const LCUConnector = require('./lcu-connector');

const app = express();
const DEFAULT_PORT = 3000;

let lcu = null;
let clientConnected = false;
let server = null;
let serverStarting = null;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Initialize LCU connection
async function initializeLCU() {
  try {
    if (!lcu) {
      lcu = new LCUConnector();
      await lcu.connect();
      clientConnected = true;
      console.log('LCU Connection established');
    }
  } catch (error) {
    clientConnected = false;
    console.error('LCU Connection failed:', error.message);
  }
}

// API Routes

// Get status
app.get('/api/status', async (req, res) => {
  try {
    if (!clientConnected) {
      await initializeLCU();
    }

    if (!clientConnected || !lcu) {
      return res.json({
        connected: false,
        inChampSelect: false
      });
    }

    const summoner = await lcu.getCurrentSummoner();
    const session = await lcu.getChampSelectSession();
    const inChampSelect = session !== null;
    
    let selectedChampion = 'None';
    let selectedChampionId = null;
    let lockedIn = false;

    if (inChampSelect) {
      selectedChampionId = lcu.getSelectedChampionFromSession(session);
      lockedIn = lcu.isLocalPlayerLockedIn(session);
      if (selectedChampionId) {
        selectedChampion = `Champion ID: ${selectedChampionId}`;
      }
    }

    res.json({
      connected: true,
      summoner: summoner.displayName,
      inChampSelect: inChampSelect,
      selectedChampion: selectedChampion,
      selectedChampionId: selectedChampionId,
      lockedIn: lockedIn
    });
  } catch (error) {
    clientConnected = false;
    res.json({
      connected: false,
      inChampSelect: false,
      error: error.message
    });
  }
});

// Get skins for a champion
app.get('/api/skins/:championId', async (req, res) => {
  try {
    if (!lcu || !clientConnected) {
      return res.json({ error: 'Not connected to League Client' });
    }

    const championId = parseInt(req.params.championId);
    const skins = await lcu.getChampionSkins(championId);

    res.json(skins);
  } catch (error) {
    res.json({ error: error.message });
  }
});

// Select a skin
app.post('/api/select-skin', async (req, res) => {
  try {
    if (!lcu || !clientConnected) {
      return res.json({ error: 'Not connected to League Client' });
    }

    const { championId, skinId, chromaId } = req.body;

    if (!championId || !skinId) {
      return res.json({ error: 'Missing championId or skinId' });
    }

    await lcu.selectSkin(championId, skinId, chromaId);
    const message = chromaId 
      ? `Selected skin ${skinId} with chroma ${chromaId}` 
      : `Selected skin ${skinId}`;
    res.json({ success: true, message });
  } catch (error) {
    res.json({ error: error.message });
  }
});

// Serve the main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Start server
async function startServer(options = {}) {
  if (server) {
    return { port: server.address().port, server, app };
  }

  if (serverStarting) {
    return serverStarting;
  }

  const { port = DEFAULT_PORT, isElectron = false } = options;

  serverStarting = new Promise((resolve, reject) => {
    server = app.listen(port, async () => {
      const actualPort = server.address().port;
      console.log('=================================');
      console.log('League Skin Selector - Web UI');
      console.log('=================================\n');
      console.log(`Server running at http://localhost:${actualPort}`);
      if (!isElectron) {
        console.log('Open your browser and navigate to that address\n');
      }

      // Try to connect to League Client
      console.log('Connecting to League Client...');
      await initializeLCU();

      if (clientConnected) {
        try {
          const summoner = await lcu.getCurrentSummoner();
          console.log(`Connected as: ${summoner.displayName}\n`);
        } catch (error) {
          console.error(`Error getting summoner info: ${error.message}\n`);
        }
      } else {
        console.log('League Client not detected. Please start the client and log in.\n');
      }

      resolve({ port: actualPort, server, app });
    });

    server.on('error', (error) => {
      serverStarting = null;
      reject(error);
    });
  });

  return serverStarting;
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\nShutting down...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n\nShutting down...');
  process.exit(0);
});

if (require.main === module) {
  startServer();
}

module.exports = {
  startServer,
  app
};
