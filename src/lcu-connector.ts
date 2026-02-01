import https from "https";
import axios, { type AxiosInstance } from "axios";
import { execSync } from "child_process";

interface ClientCredentials {
  port: string;
  token: string;
}

interface LcuCredentials {
  port: string;
  password: string;
  protocol: "https";
}

type ChampionMap = Record<string, string>;

type ChampSelectSession = {
  localPlayerCellId?: number;
  myTeam?: Array<{ cellId: number; championId: number }>;
  actions?: Array<Array<{ actorCellId: number; type: string; completed?: boolean }>>;
};

type ChampionSkin = {
  id: number;
  name: string;
  ownership: { owned: boolean };
  chromas?: Array<{
    id: number;
    name: string;
    chromaPath?: string;
    colors?: string[];
    ownership?: { owned: boolean };
  }>;
};

type ChampionData = {
  skins?: ChampionSkin[];
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

class LCUConnector {
  private credentials: LcuCredentials | null = null;
  private httpsAgent: https.Agent | null = null;
  private axiosInstance: AxiosInstance | null = null;
  private championMap: ChampionMap | null = null;
  private reconnectCallback: (() => void) | null = null;
  private pollInterval: NodeJS.Timeout | null = null;

  /**
   * Find the League Client lockfile and extract connection credentials
   * Uses process list method (recommended by Hextech docs)
   */
  async connect(_onReconnect: (() => void) | null = null): Promise<boolean> {
    try {
      const credentials = this.findClientCredentials();
      if (!credentials) {
        throw new Error("League Client is not running. Please start the client first.");
      }

      this.credentials = {
        port: credentials.port,
        password: credentials.token,
        protocol: "https"
      };

      // Create HTTPS agent that ignores self-signed certificate
      this.httpsAgent = new https.Agent({
        rejectUnauthorized: false
      });

      // Create axios instance with auth
      this.axiosInstance = axios.create({
        baseURL: `https://127.0.0.1:${this.credentials.port}`,
        auth: {
          username: "riot",
          password: this.credentials.password
        },
        httpsAgent: this.httpsAgent
      });

      console.log("Successfully connected to League Client");

      return true;
    } catch (error) {
      throw new Error(`Failed to connect to League Client: ${getErrorMessage(error)}`);
    }
  }

  /**
   * Connect with retry logic - keeps trying if client not running
   * Sets up polling to detect when client starts
   */
  async connectWithRetry(onReconnect: (() => void) | null = null): Promise<boolean> {
    this.reconnectCallback = onReconnect;

    try {
      await this.connect(onReconnect);
      // Connection successful, start polling for disconnects/restarts
      this.startPolling();
      return true;
    } catch (_error) {
      console.log("League Client not yet running, will retry...");
      // Connection failed, start polling to wait for client to launch
      this.startPollingForInitialConnection();
      return false;
    }
  }

  /**
   * Find the League Client by querying the process list
   * Uses wmic on Windows and ps/grep on macOS to find LeagueClientUx and extract port and auth token
   * Recommended method per Hextech docs: https://hextechdocs.dev/getting-started-with-the-lcu-api/
   */
  findClientCredentials(): ClientCredentials | null {
    try {
      let output = "";

      if (process.platform === "win32") {
        // Windows: use wmic
        const command = "wmic PROCESS WHERE name='LeagueClientUx.exe' GET commandline";
        output = execSync(command, { encoding: "utf8" });
      } else if (process.platform === "darwin") {
        // macOS: use ps and grep
        const command = "ps -A | grep LeagueClientUx";
        output = execSync(command, { encoding: "utf8", shell: "/bin/bash" });
      } else {
        // Unsupported platform
        return null;
      }

      if (!output) {
        return null;
      }

      // Extract port using regex: --app-port=([0-9]*)
      const portMatch = output.match(/--app-port=([0-9]*)/);
      const port = portMatch ? portMatch[1] : null;

      // Extract auth token using regex: --remoting-auth-token=([\w-]*)
      const tokenMatch = output.match(/--remoting-auth-token=([\w-]*)/);
      const token = tokenMatch ? tokenMatch[1] : null;

      if (!port || !token) {
        return null;
      }

      return { port, token };
    } catch (_error) {
      // Process not found or command error
      return null;
    }
  }

  private getAxios(): AxiosInstance {
    if (!this.axiosInstance) {
      throw new Error("Not connected to League Client");
    }
    return this.axiosInstance;
  }

  /**
   * Make a GET request to the LCU API
   */
  async get(endpoint: string): Promise<any> {
    try {
      const response = await this.getAxios().get(endpoint);
      return response.data;
    } catch (error: any) {
      if (error?.response?.status === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Poll for client restart by checking if port/token change
   * Auto-reconnects when credentials change (client restart)
   */
  startPolling(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
    }

    this.pollInterval = setInterval(async () => {
      try {
        const newCredentials = this.findClientCredentials();

        // If no client found, stop polling
        if (!newCredentials) {
          console.log("Client no longer detected");
          this.stopPolling();
          return;
        }

        // If credentials changed, the client restarted
        if (
          !this.credentials ||
          newCredentials.port !== this.credentials.port ||
          newCredentials.token !== this.credentials.password
        ) {
          console.log("Client restart detected, reconnecting...");
          await this.connect();
          if (this.reconnectCallback) {
            this.reconnectCallback();
          }
        }
      } catch (error) {
        console.error("Polling check failed:", getErrorMessage(error));
      }
    }, 2000); // Check every 2 seconds
  }

  /**
   * Poll for initial client connection when app starts before League
   */
  startPollingForInitialConnection(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
    }

    this.pollInterval = setInterval(async () => {
      try {
        const credentials = this.findClientCredentials();

        if (credentials) {
          console.log("League Client detected, connecting...");
          await this.connect();
          if (this.reconnectCallback) {
            this.reconnectCallback();
          }
          // Switch to regular polling once connected
          this.startPolling();
        }
      } catch (error) {
        console.error("Connection attempt failed:", getErrorMessage(error));
      }
    }, 2000); // Check every 2 seconds
  }

  /**
   * Stop polling for client changes
   */
  stopPolling(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  /**
   * Make a POST request to the LCU API
   */
  async post(endpoint: string, data: unknown): Promise<any> {
    const response = await this.getAxios().post(endpoint, data);
    return response.data;
  }

  /**
   * Make a PATCH request to the LCU API
   */
  async patch(endpoint: string, data: unknown): Promise<any> {
    const response = await this.getAxios().patch(endpoint, data);
    return response.data;
  }

  /**
   * Make a PUT request to the LCU API
   */
  async put(endpoint: string, data: unknown): Promise<any> {
    const response = await this.getAxios().put(endpoint, data);
    return response.data;
  }

  /**
   * Get current summoner information
   */
  async getCurrentSummoner(): Promise<any> {
    return this.get("/lol-summoner/v1/current-summoner");
  }

  /**
   * Check if in champion select
   */
  async isInChampSelect(): Promise<boolean> {
    const session = await this.get("/lol-champ-select/v1/session");
    return session !== null;
  }

  /**
   * Get current champion select session
   */
  async getChampSelectSession(): Promise<ChampSelectSession | null> {
    return this.get("/lol-champ-select/v1/session");
  }

  /**
   * Get selected champion ID from a session payload
   */
  getSelectedChampionFromSession(session: ChampSelectSession | null): number | null {
    if (!session) return null;

    const localPlayerCellId = session.localPlayerCellId;
    const myTeam = session.myTeam || [];
    const myCell = myTeam.find((member) => member.cellId === localPlayerCellId);
    return myCell ? myCell.championId : null;
  }

  /**
   * Get local player's pick action from a session payload
   */
  getLocalPlayerPickAction(session: ChampSelectSession | null): { actorCellId: number; type: string; completed?: boolean } | null {
    if (!session || !Array.isArray(session.actions)) return null;

    const localPlayerCellId = session.localPlayerCellId;
    const actions = session.actions.flat();
    return (
      actions.find((action) => action.actorCellId === localPlayerCellId && action.type === "pick") ||
      null
    );
  }

  /**
   * Check if local player has locked in
   */
  isLocalPlayerLockedIn(session: ChampSelectSession | null): boolean {
    const action = this.getLocalPlayerPickAction(session);
    return !!action && action.completed === true;
  }

  /**
   * Get champion details by ID
   */
  async getChampion(championId: number): Promise<ChampionData | null> {
    return this.get(
      `/lol-champions/v1/inventories/${await this.getSummonerId()}/champions/${championId}`
    );
  }

  /**
   * Fetch champion name mapping from Data Dragon
   */
  async getChampionNameMap(): Promise<ChampionMap> {
    if (this.championMap) {
      return this.championMap;
    }

    try {
      // Fetch the champion list from Data Dragon
      const response = await axios.get(
        "https://ddragon.leagueoflegends.com/cdn/14.1.1/data/en_US/champion.json"
      );

      const champions = response.data.data;
      this.championMap = {};

      // Create a map of champion ID to champion name (key)
      for (const [key, champ] of Object.entries<any>(champions)) {
        this.championMap[champ.key] = key;
      }

      return this.championMap;
    } catch (error) {
      console.error("Failed to fetch champion map from Data Dragon:", getErrorMessage(error));
      return {};
    }
  }

  /**
   * Get champion name by ID
   */
  async getChampionNameById(championId: number): Promise<string> {
    const championMap = await this.getChampionNameMap();
    return championMap[championId] || `Champion${championId}`;
  }

  /**
   * Get all owned skins for a champion
   */
  async getChampionSkins(championId: number): Promise<any[]> {
    const champion = await this.getChampion(championId);
    if (!champion || !champion.skins) {
      return [];
    }

    // Get champion name from Data Dragon mapping
    const championName = await this.getChampionNameById(championId);

    return champion.skins
      .filter((skin) => skin.ownership.owned)
      .map((skin) => {
        // Calculate skin number from skin ID
        // Skin IDs are formatted as: championId * 1000 + skinNum
        // e.g., Caitlyn (51) skin 5 = 51005
        const skinNum = skin.id % 1000;

        // Map chromas with images
        const chromas = (skin.chromas || [])
          .map((chroma) => {
            const chromaPath = chroma.chromaPath || "";
            // Extract chroma number from path if available
            const chromaMatch = chromaPath.match(/(\d+)\.(png|jpg)$/i);
            const chromaNum = chromaMatch ? chromaMatch[1] : chroma.id;

            return {
              id: chroma.id,
              name: chroma.name,
              chromaPath: chroma.chromaPath,
              colors: chroma.colors || [],
              owned: chroma.ownership?.owned || false,
              // Use Community Dragon for chroma images
              imageUrl: `https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-chroma-images/${championId}/${chroma.id}.png`,
              chromaNum
            };
          })
          .filter((chroma) => chroma.owned);

        return {
          id: skin.id,
          name: skin.name,
          ownership: skin.ownership,
          chromas,
          hasOwnedChromas: chromas.length > 0,
          // Use loading screen image (full champion art)
          loadingUrl: `https://ddragon.leagueoflegends.com/cdn/img/champion/loading/${championName}_${skinNum}.jpg`
        };
      });
  }

  /**
   * Get summoner ID
   */
  async getSummonerId(): Promise<number> {
    const summoner = await this.getCurrentSummoner();
    return summoner.summonerId;
  }

  /**
   * Select a skin in champion select
   */
  async selectSkin(championId: number, skinId: number, chromaId: number | null = null): Promise<boolean> {
    try {
      const session = await this.getChampSelectSession();
      if (!session) {
        throw new Error("Not in champion select");
      }

      // Find the local player's cell ID
      const localPlayerCellId = session.localPlayerCellId;

      // Update the skin selection
      await this.patch(`/lol-champ-select/v1/session/actions/${localPlayerCellId}`, {
        championId,
        completed: true
      });

      // Select the skin with optional chroma
      const selectionData: { selectedSkinId: number; wardSkinId?: number } = {
        selectedSkinId: skinId
      };

      if (chromaId !== null && chromaId !== undefined) {
        selectionData.wardSkinId = -1; // Required for chroma selection
        await this.patch("/lol-champ-select/v1/session/my-selection", selectionData);
        // Select the chroma in a separate call
        await this.patch("/lol-champ-select/v1/session/my-selection", {
          selectedSkinId: chromaId
        });
        console.log(`Successfully selected skin ID: ${skinId} with chroma ID: ${chromaId}`);
      } else {
        await this.patch("/lol-champ-select/v1/session/my-selection", selectionData);
        console.log(`Successfully selected skin ID: ${skinId}`);
      }

      return true;
    } catch (error) {
      throw new Error(`Failed to select skin: ${getErrorMessage(error)}`);
    }
  }

  /**
   * Get the currently selected champion ID
   */
  async getSelectedChampion(): Promise<number | null> {
    const session = await this.getChampSelectSession();
    return this.getSelectedChampionFromSession(session);
  }
}

export default LCUConnector;
