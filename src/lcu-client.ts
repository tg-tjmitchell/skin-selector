import axios from "axios";
import { HasagiClient, LCUError } from "@hasagi/core";
import type { LCUTypes } from "@hasagi/core";

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

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

class LCUConnector {
  private client: HasagiClient;
  private championMap: ChampionMap | null = null;
  private reconnectCallback: (() => void) | null = null;

  constructor() {
    this.client = new HasagiClient({
      defaultRetryOptions: {
        maxRetries: 3,
        retryDelay: 1000,
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
      
      if (this.reconnectCallback) {
        this.reconnectCallback();
      }
    });

    this.client.on("disconnected", () => {
      console.log("Disconnected from League Client");
    });

    this.client.on("connection-attempt-failed", () => {
      // Silent - hasagi will keep retrying
    });
  }

  /**
   * Check if we have an active connection to the League Client
   */
  isConnected(): boolean {
    return this.client.isConnected;
  }

  /**
   * Connect to the League Client
   */
  async connect(_onReconnect: (() => void) | null = null): Promise<boolean> {
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
    
    try {
      await this.client.connect({
        authenticationStrategy: "process",
        maxConnectionAttempts: -1, // Infinite retries
        connectionAttemptDelay: 2000,
        useWebSocket: true
      });
      return true;
    } catch (error) {
      console.log("League Client not yet running, will retry automatically...");
      return false;
    }
  }

  /**
   * Stop the connector and cleanup
   */
  stopPolling(): void {
    // Hasagi handles connection lifecycle automatically
    // No manual cleanup needed
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
  async getCurrentSummoner(): Promise<any> {
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
  async getReadyCheck(): Promise<any | null> {
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
