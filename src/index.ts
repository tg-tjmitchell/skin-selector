import express, { type Express, type Request, type Response } from "express";
import path from "path";
import type { AddressInfo } from "net";
import type { Server } from "http";
import os from "os";
import QRCode from "qrcode";
import LCUConnector from "./lcu-client";

const app: Express = express();
const DEFAULT_PORT = 3000;

let lcu: LCUConnector | null = null;
let clientConnected = false;
let server: Server | undefined;
let serverStarting: Promise<StartServerResult> | null = null;

// Get LAN IP address
function getLanIp(): string {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    const iface = interfaces[name];
    if (!iface) continue;
    
    for (const addr of iface) {
      // Skip internal and non-IPv4 addresses
      if (addr.family === "IPv4" && !addr.internal) {
        return addr.address;
      }
    }
  }
  return "localhost";
}

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, "../public")));

// Initialize LCU connection
async function initializeLCU(): Promise<void> {
  try {
    if (!lcu) {
      lcu = new LCUConnector();
      // Pass a reconnect callback for automatic state updates
      await lcu.connectWithRetry(() => {
        clientConnected = true;
        console.log("LCU connection established/reconnected");
      });
      
      // Check if we're already connected (client was running)
      if (await lcu.isConnected()) {
        clientConnected = true;
        console.log("LCU Connection established");
      } else {
        clientConnected = false;
        console.log("LCU Connection pending - waiting for League Client");
      }
    } else if (!clientConnected && lcu) {
      // If we previously failed to connect, try again
      // This handles the case where the client wasn't running but is now
      if (await lcu.isConnected()) {
        clientConnected = true;
        console.log("LCU connection re-established");
      }
    }
  } catch (error) {
    clientConnected = false;
    const message = error instanceof Error ? error.message : String(error);
    console.error("LCU Connection failed:", message);
  }
}

// API Routes

// Get server info (including LAN IP for QR code)
app.get("/api/server-info", (_req: Request, res: Response) => {
  const lanIp = getLanIp();
  const port = (server?.address() as AddressInfo)?.port || DEFAULT_PORT;
  const url = `http://${lanIp}:${port}`;
  
  return res.json({
    lanIp,
    port,
    url
  });
});

// Generate QR code image
app.get("/api/qr-code", async (_req: Request, res: Response) => {
  try {
    const lanIp = getLanIp();
    const port = (server?.address() as AddressInfo)?.port || DEFAULT_PORT;
    const url = `http://${lanIp}:${port}`;
    
    const qrImage = await QRCode.toDataURL(url, {
      errorCorrectionLevel: 'H',
      type: 'image/png',
      margin: 1,
      width: 300
    });
    
    return res.json({ qrCodeUrl: qrImage });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: message });
  }
});

// Get status
app.get("/api/status", async (_req: Request, res: Response) => {
  try {
    // Initialize LCU connector if not yet created
    if (!lcu) {
      await initializeLCU();
    }

    // Check if we have an active connection
    if (!lcu || !(await lcu.isConnected())) {
      return res.json({
        connected: false,
        inChampSelect: false
      });
    }

    const summoner = await lcu.getCurrentSummoner();
    const session = await lcu.getChampSelectSession();
    const readyCheck = await lcu.getReadyCheck();
    const inChampSelect = session !== null;

    let selectedChampion = "None";
    let selectedChampionId: number | null = null;
    let lockedIn = false;

    if (inChampSelect && session) {
      selectedChampionId = lcu.getSelectedChampionFromSession(session);
      lockedIn = lcu.isLocalPlayerLockedIn(session);
      if (selectedChampionId) {
        selectedChampion = `Champion ID: ${selectedChampionId}`;
      }
    }

    return res.json({
      connected: true,
      summoner: summoner.displayName,
      inChampSelect,
      selectedChampion,
      selectedChampionId,
      lockedIn,
      readyCheck
    });
  } catch (error) {
    clientConnected = false;
    const message = error instanceof Error ? error.message : String(error);
    return res.json({
      connected: false,
      inChampSelect: false,
      error: message
    });
  }
});

// Get skins for a champion
app.get("/api/skins/:championId", async (req: Request, res: Response) => {
  try {
    if (!lcu || !(await lcu.isConnected())) {
      return res.json({ error: "Not connected to League Client" });
    }

    const championIdParam = req.params.championId;
    if (!championIdParam) {
      return res.json({ error: "Missing championId" });
    }
    const championId = Number.parseInt(championIdParam, 10);
    const skins = await lcu.getChampionSkins(championId);

    return res.json(skins);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.json({ error: message });
  }
});

// Select a skin
app.post("/api/select-skin", async (req: Request, res: Response) => {
  try {
    if (!lcu || !(await lcu.isConnected())) {
      return res.json({ error: "Not connected to League Client" });
    }

    const { championId, skinId, chromaId } = req.body as {
      championId?: number;
      skinId?: number;
      chromaId?: number | null;
    };

    if (!championId || !skinId) {
      return res.json({ error: "Missing championId or skinId" });
    }

    await lcu.selectSkin(championId, skinId, chromaId ?? null);
    const message = chromaId
      ? `Selected skin ${skinId} with chroma ${chromaId}`
      : `Selected skin ${skinId}`;
    return res.json({ success: true, message });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.json({ error: message });
  }
});

// Accept ready check (queue pop)
app.post("/api/accept-ready-check", async (_req: Request, res: Response) => {
  try {
    if (!lcu || !(await lcu.isConnected())) {
      return res.json({ error: "Not connected to League Client" });
    }

    await lcu.acceptReadyCheck();
    return res.json({ success: true, message: "Ready check accepted" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.json({ error: message });
  }
});

// Serve the main page
app.get("/", (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

export interface StartServerOptions {
  port?: number;
  isElectron?: boolean;
}

export interface StartServerResult {
  port: number;
  server: Server;
  app: Express;
  lcu: LCUConnector | null;
}

// Start server
export async function startServer(options: StartServerOptions = {}): Promise<StartServerResult> {
  if (server) {
    const address = server.address() as AddressInfo;
    return { port: address.port, server, app, lcu };
  }

  if (serverStarting) {
    return serverStarting;
  }

  const { port = DEFAULT_PORT, isElectron = false } = options;

  serverStarting = new Promise((resolve, reject) => {
    const currentServer = app.listen(port, async () => {
      const address = server?.address() as AddressInfo | null;
      const actualPort = address?.port ?? port;
      console.log("=================================");
      console.log("League Skin Selector - Web UI");
      console.log("=================================\n");
      console.log(`Server running at http://localhost:${actualPort}`);
      if (!isElectron) {
        console.log("Open your browser and navigate to that address\n");
      }

      // Try to connect to League Client
      console.log("Connecting to League Client...");
      await initializeLCU();

      if (lcu && (await lcu.isConnected())) {
        try {
          const summoner = await lcu.getCurrentSummoner();
          console.log(`Connected as: ${summoner.displayName}\n`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`Error getting summoner info: ${message}\n`);
        }
      } else {
        console.log("League Client not detected. Please start the client and log in.\n");
      }

      if (!server) {
        reject(new Error("Server failed to start"));
        return;
      }
      resolve({ port: actualPort, server, app, lcu });
    });

    server = currentServer;
    currentServer.on("error", (error: Error) => {
      serverStarting = null;
      reject(error);
    });
  });

  return serverStarting;
}

// Handle graceful shutdown
process.on("SIGINT", () => {
  console.log("\n\nShutting down...");
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("\n\nShutting down...");
  process.exit(0);
});

if (require.main === module) {
  void startServer();
}

export { app };
