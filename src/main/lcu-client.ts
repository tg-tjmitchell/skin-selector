import axios from "axios";
import { HasagiClient, LCUError } from "@hasagi/core";
import type { LCUTypes } from "@hasagi/core";
import { getErrorMessage } from "../shared/errors";

const DEFAULT_RETRY_DELAY_MS = 1000;
const CONNECTION_RETRY_INTERVAL_MS = 5000;
const CONNECTION_TEST_TIMEOUT_MS = 5000;
const MAX_CONNECTION_ATTEMPTS = 3;

type ChampionMap = Record<string, string>;

type ChampSelectSession = LCUTypes.TeamBuilderDirect_ChampSelectSession;
type ChampSelectAction = LCUTypes.TeamBuilderDirect_ChampSelectAction;
type ChampSelectMySelection = LCUTypes.TeamBuilderDirect_ChampSelectMySelection;

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

type SummonerProfile = {
  displayName: string;
  summonerId: number;
};

type ReadyCheckState = {
  state: string;
  playerResponse?: string;
};

type OwnedSkin = {
  id: number;
  name: string;
  ownership: { owned: boolean };
  chromas: Array<{
    id: number;
    name: string;
    chromaPath?: string | undefined;
    colors: string[];
    owned: boolean;
    imageUrl: string;
    chromaNum: string | number;
  }>;
  hasOwnedChromas: boolean;
  loadingUrl: string;
  splashUrl?: string;
};

type DDragonChampion = {
  key: string;
};

type DDragonChampionList = {
  data: Record<string, DDragonChampion>;
};

type DDragonVersions = string[];

class LCUConnector {
  private client: HasagiClient;
  private championMap: ChampionMap | null = null;
  private ddragonVersion: string | null = null;
  private reconnectCallback: (() => void) | null = null;
  private lastConnectionState: boolean = false;
  private connectionAttemptTimer: NodeJS.Timeout | null = null;
  private isAttemptingConnection: boolean = false;

  constructor() {
    this.client = new HasagiClient({
      defaultRetryOptions: {
        maxRetries: MAX_CONNECTION_ATTEMPTS,
        retryDelay: DEFAULT_RETRY_DELAY_MS,
        noRetryStatusCodes: [400, 404]
      }
    });
    this.setupEventHandlers();
  }

  /**
   * Setup event handlers for connection events
   */
  private setupEventHandlers(): void {
    this.client.on("connected", () => {
      console.log("Successfully connected to League Client");
      this.lastConnectionState = true;
      this.isAttemptingConnection = false;
      
      if (this.connectionAttemptTimer) {
        clearInterval(this.connectionAttemptTimer);
        this.connectionAttemptTimer = null;
      }
      
      if (this.reconnectCallback) {
        this.reconnectCallback();
      }
    });

    this.client.on("disconnected", () => {
      console.log("Disconnected from League Client");
      this.lastConnectionState = false;
      // Start trying to reconnect
      this.startConnectionRetries();
    });

    this.client.on("connection-attempt-failed", () => {
      // Connection attempt failed, will retry
      console.log("Connection attempt failed, will retry in 2 seconds...");
    });
  }

  /**
   * Start attempting to connect with retries
   */
  private startConnectionRetries(): void {
    if (this.isAttemptingConnection) {
      return; // Already attempting
    }

    this.isAttemptingConnection = true;
    const attemptConnection = async () => {
      try {
        console.log("Attempting to connect to League Client...");
        await this.client.connect({
          authenticationStrategy: "process",
          maxConnectionAttempts: MAX_CONNECTION_ATTEMPTS,
          connectionAttemptDelay: DEFAULT_RETRY_DELAY_MS,
          useWebSocket: true
        });
        // If connection succeeds, the "connected" event will be fired
        this.isAttemptingConnection = false;
      } catch (error) {
        // Failed to connect, will retry after delay
        console.log("Connection attempt failed:", getErrorMessage(error));
      }
    };

    // Attempt connection immediately
    attemptConnection();

    // Set up periodic retry attempts every 5 seconds
    if (this.connectionAttemptTimer) {
      clearInterval(this.connectionAttemptTimer);
    }
    
    this.connectionAttemptTimer = setInterval(() => {
      if (!this.lastConnectionState) {
        attemptConnection();
      }
    }, CONNECTION_RETRY_INTERVAL_MS);
  }

  /**
   * Check if we have an active connection to the League Client
   * Uses a combination of the client's internal state and a test request
   */
  async isConnected(): Promise<boolean> {
    // First check if client claims to be connected
    if (!this.client.isConnected) {
      this.lastConnectionState = false;
      return false;
    }

    // Verify connection with a lightweight test request
    try {
      // Use a short timeout for the test request
      const summoner = await Promise.race([
        this.client.request("get", "/lol-summoner/v1/current-summoner"),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error("Connection test timeout")), CONNECTION_TEST_TIMEOUT_MS)
        )
      ]);
      
      if (summoner) {
        this.lastConnectionState = true;
        return true;
      }
    } catch (_error) {
      // Connection test failed - try to reconnect
      if (!this.isAttemptingConnection) {
        this.startConnectionRetries();
      }
      this.lastConnectionState = false;
    }
    
    return false;
  }

  /**
   * Get the last known connection state (synchronous check)
   */
  wasLastConnected(): boolean {
    return this.lastConnectionState;
  }

  /**
   * Connect to the League Client
   */
  async connect(): Promise<boolean> {
    try {
      await this.client.connect({
        authenticationStrategy: "process",
        maxConnectionAttempts: 1,
        useWebSocket: true
      });
      return true;
    } catch (error) {
      throw new Error(`Failed to connect to League Client: ${getErrorMessage(error)}`);
    }
  }

  /**
   * Connect with retry logic - keeps trying if client not running
   * Sets up automatic reconnection on disconnect
   */
  async connectWithRetry(onReconnect: (() => void) | null = null): Promise<boolean> {
    this.reconnectCallback = onReconnect;
    this.startConnectionRetries();
    
    // Return immediately - connection will happen in the background
    return this.client.isConnected;
  }

  /**
   * Stop the connector and cleanup
   */
  stopPolling(): void {
    if (this.connectionAttemptTimer) {
      clearInterval(this.connectionAttemptTimer);
      this.connectionAttemptTimer = null;
    }
    this.isAttemptingConnection = false;
  }

  /**
   * Disconnect from the League Client and cleanup all resources
   */
  async disconnect(): Promise<void> {
    console.log("Disconnecting from League Client...");
    
    // Stop all polling and reconnection attempts
    this.stopPolling();
    
    // Clear the reconnect callback
    this.reconnectCallback = null;
    
    // Update connection state
    this.lastConnectionState = false;
    
    // Note: HasagiClient doesn't expose a disconnect method
    // The client will disconnect automatically when the process exits
    // We've cleaned up all our internal state and timers
    
    console.log("LCU disconnected successfully");
  }

  /**
   * Check if an error is a 404 from LCU
   */
  private isNotFoundError(error: unknown): boolean {
    return error instanceof LCUError && error.statusCode === 404;
  }

  /**
   * Get current summoner information
   */
  async getCurrentSummoner(): Promise<SummonerProfile> {
    return this.client.request("get", "/lol-summoner/v1/current-summoner");
  }

  /**
   * Check if in champion select
   */
  async isInChampSelect(): Promise<boolean> {
    const session = await this.getChampSelectSession();
    return session !== null;
  }

  /**
   * Get current champion select session
   */
  async getChampSelectSession(): Promise<ChampSelectSession | null> {
    try {
      return await this.client.request("get", "/lol-champ-select/v1/session");
    } catch (error) {
      if (this.isNotFoundError(error)) {
        return null;
      }
      throw error;
    }
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
  getLocalPlayerPickAction(session: ChampSelectSession | null): ChampSelectAction | null {
    if (!session || !Array.isArray(session.actions)) return null;

    const localPlayerCellId = session.localPlayerCellId;
    const actions = (session.actions as ChampSelectAction[][]).flat();
    return actions.find((action) => action.actorCellId === localPlayerCellId && action.type === "pick") || null;
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
    const summonerId = await this.getSummonerId();
    return this.client.request(
      "get",
      "/lol-champions/v1/inventories/{summonerId}/champions/{championId}",
      {
        path: {
          summonerId: String(summonerId),
          championId: String(championId)
        }
      }
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
      const version = await this.getLatestDdragonVersion();
      // Fetch the champion list from Data Dragon
      const response = await axios.get<DDragonChampionList>(
        `https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/champion.json`
      );

      const champions = response.data.data;
      this.championMap = {};

      // Create a map of champion ID to champion name (key)
      for (const [key, champ] of Object.entries(champions)) {
        this.championMap[champ.key] = key;
      }

      return this.championMap;
    } catch (error) {
      console.error("Failed to fetch champion map from Data Dragon:", getErrorMessage(error));
      return {};
    }
  }

  private async getLatestDdragonVersion(): Promise<string> {
    if (this.ddragonVersion) {
      return this.ddragonVersion;
    }

    try {
      const response = await axios.get<DDragonVersions>(
        "https://ddragon.leagueoflegends.com/api/versions.json"
      );
      const [latest] = response.data;
      this.ddragonVersion = latest || "latest";
      return this.ddragonVersion;
    } catch (error) {
      console.error("Failed to fetch Data Dragon versions:", getErrorMessage(error));
      this.ddragonVersion = "latest";
      return this.ddragonVersion;
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
  async getChampionSkins(championId: number): Promise<OwnedSkin[]> {
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
            const chromaNum = chromaMatch?.[1] ?? chroma.id;

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
          loadingUrl: `https://ddragon.leagueoflegends.com/cdn/img/champion/loading/${championName}_${skinNum}.jpg`,
          // Use splash art image
          splashUrl: `https://ddragon.leagueoflegends.com/cdn/img/champion/splash/${championName}_${skinNum}.jpg`
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

      const pickAction = this.getLocalPlayerPickAction(session);
      if (!pickAction) {
        throw new Error("Pick action not found for local player");
      }

      // Update the skin selection
      await this.client.request(
        "patch",
        "/lol-champ-select/v1/session/actions/{id}",
        {
          path: { id: String(pickAction.id) },
          body: {
            ...pickAction,
            championId,
            completed: true
          }
        }
      );

      // Select the skin with optional chroma
      const selectionData: ChampSelectMySelection = {
        selectedSkinId: skinId
      };

      if (chromaId !== null && chromaId !== undefined) {
        await this.client.request(
          "patch",
          "/lol-champ-select/v1/session/my-selection",
          { body: selectionData }
        );
        // Select the chroma in a separate call
        await this.client.request(
          "patch",
          "/lol-champ-select/v1/session/my-selection",
          { body: { selectedSkinId: chromaId } }
        );
        console.log(`Successfully selected skin ID: ${skinId} with chroma ID: ${chromaId}`);
      } else {
        await this.client.request(
          "patch",
          "/lol-champ-select/v1/session/my-selection",
          { body: selectionData }
        );
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

  /**
   * Get current ready check state (queue pop)
   */
  async getReadyCheck(): Promise<ReadyCheckState | null> {
    try {
      return await this.client.request("get", "/lol-matchmaking/v1/ready-check");
    } catch (error) {
      if (this.isNotFoundError(error)) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Accept ready check (queue pop)
   */
  async acceptReadyCheck(): Promise<boolean> {
    try {
      await this.client.request("post", "/lol-matchmaking/v1/ready-check/accept");
      return true;
    } catch (error) {
      throw new Error(`Failed to accept ready check: ${getErrorMessage(error)}`);
    }
  }
}

export default LCUConnector;
