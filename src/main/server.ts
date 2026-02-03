import express, { type Express, type Request, type Response } from "express";
import path from "path";
import type { AddressInfo } from "net";
import type { Server } from "http";
import os from "os";
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
  ErrorResponse
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

  constructor(isDevelopment = false) {
    this.app = express();
    this.logger = new Logger(isDevelopment);
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
        if (!championIdParam) {
          return this.respondError(res, 400, "Missing championId");
        }
        const championId = Number.parseInt(championIdParam, 10);
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
    for (const name of Object.keys(interfaces)) {
      const iface = interfaces[name];
      if (!iface) continue;

      for (const addr of iface) {
        if (addr.family === "IPv4" && !addr.internal) {
          return addr.address;
        }
      }
    }
    return "localhost";
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

  shutdown(): void {
    if (this.lcu) {
      this.lcu.stopPolling();
    }
    if (this.server) {
      this.server.close();
    }
  }
}
