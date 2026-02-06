import express, { type Express, type Request, type Response } from "express";
import path from "path";
import type { AddressInfo } from "net";
import type { Server } from "http";
import os from "os";
import { promises as fs } from "fs";
import QRCode from "qrcode";
import LCUConnector from "./lcu-client";
import { getErrorMessage } from "../shared/errors";
import { Logger } from "../shared/logger";
import type {
  ServerInfoResponse,
  QRCodeResponse,
  StatusResponse,
  SkinsResponse,
  SelectSkinRequest,
  SelectSkinResponse,
  AcceptReadyCheckResponse,
  ErrorResponse,
  FavoritesResponse,
  ToggleFavoriteRequest,
  ToggleFavoriteResponse
} from "../shared/api-types";

const DEFAULT_PORT = 3000;

export interface ServerConfig {
  port?: number;
  isElectron?: boolean;
}

export interface ServerState {
  port: number;
  server: Server;
  app: Express;
  lcu: LCUConnector | null;
}

/**
 * Server module - manages Express server, LCU connection, and API endpoints
 */
export class SkinSelectorServer {
  private app: Express;
  private server: Server | undefined;
  private lcu: LCUConnector | null = null;
  private clientConnected = false;
  private serverStarting: Promise<ServerState> | null = null;
  private logger: Logger;
  private favoritesCache: Record<string, number[]> | null = null;
  private favoritesPath: string;

  constructor(isDevelopment = false) {
    this.app = express();
    this.logger = new Logger(isDevelopment);
    this.favoritesPath = this.getFavoritesPath();
    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware(): void {
    this.app.use(express.json());
    this.app.use(express.static(path.join(__dirname, "../renderer")));
  }

  private setupRoutes(): void {
    // Get server info
    this.app.get("/api/server-info", (_req: Request, res: Response<ServerInfoResponse>) => {
      const lanIp = this.getLanIp();
      const port = (this.server?.address() as AddressInfo)?.port || DEFAULT_PORT;
      const url = `http://${lanIp}:${port}`;
      return res.json({ lanIp, port, url });
    });

    // Generate QR code
    this.app.get("/api/qr-code", async (_req: Request, res: Response<QRCodeResponse | ErrorResponse>) => {
      try {
        const lanIp = this.getLanIp();
        const port = (this.server?.address() as AddressInfo)?.port || DEFAULT_PORT;
        const url = `http://${lanIp}:${port}`;
        const qrImage = await QRCode.toDataURL(url, {
          errorCorrectionLevel: "H",
          type: "image/png",
          margin: 1,
          width: 300
        });
        return res.json({ qrCodeUrl: qrImage });
      } catch (error) {
        const message = getErrorMessage(error);
        return this.respondError(res, 500, message);
      }
    });

    // Get status
    this.app.get("/api/status", async (_req: Request, res: Response<StatusResponse | ErrorResponse>) => {
      try {
        if (!this.lcu) {
          await this.initializeLCU();
        }

        if (!this.lcu || !(await this.lcu.isConnected())) {
          return res.json({ connected: false, inChampSelect: false });
        }

        const summoner = await this.lcu.getCurrentSummoner();
        const session = await this.lcu.getChampSelectSession();
        const readyCheck = await this.lcu.getReadyCheck();
        const inChampSelect = session !== null;

        let selectedChampion = "None";
        let selectedChampionId: number | null = null;
        let lockedIn = false;

        if (inChampSelect && session) {
          selectedChampionId = this.lcu.getSelectedChampionFromSession(session);
          lockedIn = this.lcu.isLocalPlayerLockedIn(session);
          if (selectedChampionId) {
            selectedChampion = `Champion ID: ${selectedChampionId}`;
          }
        }

        const response: StatusResponse = {
          connected: true,
          summoner: summoner.displayName,
          inChampSelect,
          selectedChampion,
          selectedChampionId,
          lockedIn,
          readyCheck
        };
        return res.json(response);
      } catch (error) {
        this.clientConnected = false;
        const message = getErrorMessage(error);
        return this.respondError(res, 500, message);
      }
    });

    // Get skins
    this.app.get("/api/skins/:championId", async (req: Request, res: Response<SkinsResponse | ErrorResponse>) => {
      try {
        if (!this.lcu || !(await this.lcu.isConnected())) {
          return this.respondError(res, 503, "Not connected to League Client");
        }

        const championIdParam = req.params.championId;
        const championIdStr = Array.isArray(championIdParam) ? championIdParam[0] : championIdParam;
        if (!championIdStr) {
          return this.respondError(res, 400, "Missing championId");
        }
        const championId = Number.parseInt(championIdStr, 10);
        const skins = await this.lcu.getChampionSkins(championId);
        return res.json(skins as SkinsResponse);
      } catch (error) {
        const message = getErrorMessage(error);
        return this.respondError(res, 500, message);
      }
    });

    // Select skin
    this.app.post("/api/select-skin", async (req: Request, res: Response<SelectSkinResponse | ErrorResponse>) => {
      try {
        if (!this.lcu || !(await this.lcu.isConnected())) {
          return this.respondError(res, 503, "Not connected to League Client");
        }

        const { championId, skinId, chromaId } = req.body as SelectSkinRequest;

        if (!championId || !skinId) {
          return this.respondError(res, 400, "Missing championId or skinId");
        }

        await this.lcu.selectSkin(championId, skinId, chromaId ?? null);
        const message = chromaId
          ? `Selected skin ${skinId} with chroma ${chromaId}`
          : `Selected skin ${skinId}`;
        return res.json({ success: true, message });
      } catch (error) {
        const message = getErrorMessage(error);
        return this.respondError(res, 500, message);
      }
    });

    // Get favorites
    this.app.get("/api/favorites", async (_req: Request, res: Response<FavoritesResponse | ErrorResponse>) => {
      try {
        const favorites = await this.loadFavorites();
        return res.json({ favorites });
      } catch (error) {
        const message = getErrorMessage(error);
        return this.respondError(res, 500, message);
      }
    });

    // Toggle favorite
    this.app.post("/api/favorites/toggle", async (req: Request, res: Response<ToggleFavoriteResponse | ErrorResponse>) => {
      try {
        const { championId, skinId } = req.body as ToggleFavoriteRequest;

        if (!championId || !skinId) {
          return this.respondError(res, 400, "Missing championId or skinId");
        }

        const favorites = await this.loadFavorites();
        const key = String(championId);
        const current = new Set<number>(favorites[key] || []);

        let isFavorited = false;
        if (current.has(skinId)) {
          current.delete(skinId);
        } else {
          current.add(skinId);
          isFavorited = true;
        }

        if (current.size === 0) {
          delete favorites[key];
        } else {
          favorites[key] = Array.from(current);
        }

        await this.saveFavorites(favorites);
        return res.json({ favorites, isFavorited });
      } catch (error) {
        const message = getErrorMessage(error);
        return this.respondError(res, 500, message);
      }
    });

    // Accept ready check
    this.app.post("/api/accept-ready-check", async (_req: Request, res: Response<AcceptReadyCheckResponse | ErrorResponse>) => {
      try {
        if (!this.lcu || !(await this.lcu.isConnected())) {
          return this.respondError(res, 503, "Not connected to League Client");
        }

        await this.lcu.acceptReadyCheck();
        return res.json({ success: true, message: "Ready check accepted" });
      } catch (error) {
        const message = getErrorMessage(error);
        return this.respondError(res, 500, message);
      }
    });

    // Serve main page
    this.app.get("/", (_req: Request, res: Response) => {
      res.sendFile(path.join(__dirname, "../renderer/index.html"));
    });
  }

  private getLanIp(): string {
    const interfaces = os.networkInterfaces();
    
    // Prioritize physical network interfaces over VPN/virtual adapters
    const physicalPatterns = [
      /^eth/i,      // Ethernet
      /^en\d/i,     // macOS en0, en1, etc.
      /^wlan/i,     // WiFi
      /^wifi/i,     // WiFi alternative
      /^ethernet/i, // Explicit ethernet name
    ];
    
    // VPN/virtual adapter patterns to skip
    const vpnPatterns = [
      /^tap/i,
      /^tun/i,
      /openvpn/i,
      /wireguard/i,
      /vpn/i,
      /cisco/i,
      /anyconnect/i,
      /hamachi/i,
      /docker/i,
      /vboxnet/i,
      /veth/i,
    ];
    
    // First pass: look for physical interfaces matching preferred patterns
    for (const pattern of physicalPatterns) {
      for (const name of Object.keys(interfaces)) {
        if (!pattern.test(name)) continue;
        const iface = interfaces[name];
        if (!iface) continue;
        
        for (const addr of iface) {
          if (addr.family === "IPv4" && !addr.internal) {
            return addr.address;
          }
        }
      }
    }
    
    // Second pass: look for any non-internal IPv4 address, excluding known VPN adapters
    for (const name of Object.keys(interfaces)) {
      // Skip VPN/virtual adapters
      if (vpnPatterns.some(pattern => pattern.test(name))) continue;
      
      const iface = interfaces[name];
      if (!iface) continue;
      
      for (const addr of iface) {
        if (addr.family === "IPv4" && !addr.internal) {
          return addr.address;
        }
      }
    }
    
    // Final fallback: return any non-internal IPv4 address (including VPN if necessary)
    for (const name of Object.keys(interfaces)) {
      const iface = interfaces[name];
      if (!iface) continue;
      
      for (const addr of iface) {
        if (addr.family === "IPv4" && !addr.internal) {
          return addr.address;
        }
      }
    }
    
    this.logger.error("No external network interface found");
    throw new Error("Unable to determine LAN IP address");
  }

  private getFavoritesPath(): string {
    const appDataRoot = this.getAppDataRoot();
    return path.join(appDataRoot, "favorites.json");
  }

  private getAppDataRoot(): string {
    const platform = os.platform();
    if (platform === "win32") {
      const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
      return path.join(appData, "LeagueSkinSelector");
    }
    if (platform === "darwin") {
      return path.join(os.homedir(), "Library", "Application Support", "LeagueSkinSelector");
    }
    return path.join(os.homedir(), ".config", "league-skin-selector");
  }

  private async ensureFavoritesDir(): Promise<void> {
    const dir = path.dirname(this.favoritesPath);
    await fs.mkdir(dir, { recursive: true });
  }

  private async loadFavorites(): Promise<Record<string, number[]>> {
    if (this.favoritesCache) {
      return this.favoritesCache;
    }

    await this.ensureFavoritesDir();
    try {
      const raw = await fs.readFile(this.favoritesPath, "utf-8");
      const parsed = JSON.parse(raw) as Record<string, number[]>;
      this.favoritesCache = parsed;
      return parsed;
    } catch (error) {
      this.favoritesCache = {};
      return this.favoritesCache;
    }
  }

  private async saveFavorites(favorites: Record<string, number[]>): Promise<void> {
    await this.ensureFavoritesDir();
    this.favoritesCache = favorites;
    await fs.writeFile(this.favoritesPath, JSON.stringify(favorites, null, 2), "utf-8");
  }

  private respondError(res: Response<ErrorResponse>, status: number, message: string): Response<ErrorResponse> {
    return res.status(status).json({ error: message });
  }

  private async initializeLCU(): Promise<void> {
    try {
      if (!this.lcu) {
        this.lcu = new LCUConnector();
        await this.lcu.connectWithRetry(() => {
          this.clientConnected = true;
          this.logger.info("LCU connection established/reconnected");
        });

        if (await this.lcu.isConnected()) {
          this.clientConnected = true;
          this.logger.info("LCU Connection established");
        } else {
          this.clientConnected = false;
          this.logger.info("LCU Connection pending - waiting for League Client");
        }
      } else if (!this.clientConnected && this.lcu) {
        if (await this.lcu.isConnected()) {
          this.clientConnected = true;
          this.logger.info("LCU connection re-established");
        }
      }
    } catch (error) {
      this.clientConnected = false;
      const message = getErrorMessage(error);
      this.logger.error(`LCU Connection failed: ${message}`);
    }
  }

  async start(config: ServerConfig = {}): Promise<ServerState> {
    if (this.server) {
      const address = this.server.address() as AddressInfo;
      return { port: address.port, server: this.server, app: this.app, lcu: this.lcu };
    }

    if (this.serverStarting) {
      return this.serverStarting;
    }

    const { port = DEFAULT_PORT, isElectron = false } = config;

    this.serverStarting = new Promise((resolve, reject) => {
      const currentServer = this.app.listen(port, async () => {
        const address = this.server?.address() as AddressInfo | null;
        const actualPort = address?.port ?? port;

        this.logger.info("=================================");
        this.logger.info("League Skin Selector - Web UI");
        this.logger.info("=================================");
        this.logger.info(`Server running at http://localhost:${actualPort}`);
        if (!isElectron) {
          this.logger.info("Open your browser and navigate to that address\n");
        }

        this.logger.info("Connecting to League Client...");
        await this.initializeLCU();

        if (this.lcu && (await this.lcu.isConnected())) {
          try {
            const summoner = await this.lcu.getCurrentSummoner();
            this.logger.info(`Connected as: ${summoner.displayName}\n`);
          } catch (error) {
            const message = getErrorMessage(error);
            this.logger.error(`Error getting summoner info: ${message}\n`);
          }
        } else {
          this.logger.info("League Client not detected. Please start the client and log in.\n");
        }

        if (!this.server) {
          reject(new Error("Server failed to start"));
          return;
        }
        resolve({ port: actualPort, server: this.server, app: this.app, lcu: this.lcu });
      });

      this.server = currentServer;
      currentServer.on("error", (error: Error) => {
        this.serverStarting = null;
        reject(error);
      });
    });

    return this.serverStarting;
  }

  getApp(): Express {
    return this.app;
  }

  getServer(): Server | undefined {
    return this.server;
  }

  getLCU(): LCUConnector | null {
    return this.lcu;
  }

  /**
   * Gracefully shutdown the server and cleanup all resources
   */
  async shutdown(): Promise<void> {
    this.logger.info("Shutting down server...");
    
    // Disconnect from LCU
    if (this.lcu) {
      try {
        await this.lcu.disconnect();
      } catch (error) {
        this.logger.error(`Error disconnecting LCU: ${getErrorMessage(error)}`);
      }
      this.lcu = null;
    }
    
    // Close the HTTP server
    if (this.server) {
      return new Promise<void>((resolve) => {
        this.server?.close((err) => {
          if (err) {
            this.logger.error(`Error closing server: ${getErrorMessage(err)}`);
          } else {
            this.logger.info("Server closed successfully");
          }
          this.server = undefined;
          this.serverStarting = null;
          resolve();
        });
      });
    }
  }
}
