import express, { type Express, type Request, type Response } from "express";
import path from "path";
import type { AddressInfo } from "net";
import type { Server } from "http";
import LCUConnector from "./lcu-connector";

const app: Express = express();
const DEFAULT_PORT = 3000;

let lcu: LCUConnector | null = null;
let clientConnected = false;
let server: Server | undefined;
let serverStarting: Promise<StartServerResult> | null = null;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, "../public")));

// Initialize LCU connection
async function initializeLCU(): Promise<void> {
  try {
    if (!lcu) {
      lcu = new LCUConnector();
      // Pass a reconnect callback for polling
      await lcu.connectWithRetry(() => {
        clientConnected = true;
        console.log("LCU connection established/reconnected");
      });
      clientConnected = true;
      console.log("LCU Connection established");
    }
  } catch (error) {
    clientConnected = false;
    const message = error instanceof Error ? error.message : String(error);
    console.error("LCU Connection failed:", message);
  }
}

// API Routes

// Get status
app.get("/api/status", async (_req: Request, res: Response) => {
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
      lockedIn
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
    if (!lcu || !clientConnected) {
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
    if (!lcu || !clientConnected) {
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

      if (clientConnected && lcu) {
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
