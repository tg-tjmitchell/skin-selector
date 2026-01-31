const fs = require('fs');
const path = require('path');
const https = require('https');
const axios = require('axios');

class LCUConnector {
  constructor() {
    this.credentials = null;
    this.httpsAgent = null;
    this.axiosInstance = null;
    this.championMap = null; // Cache for champion ID to name mapping
  }

  /**
   * Find the League Client lockfile and extract connection credentials
   */
  async connect() {
    try {
      const lockfilePath = this.findLockfile();
      if (!lockfilePath) {
        throw new Error('League Client is not running. Please start the client first.');
      }

      const lockfileContent = fs.readFileSync(lockfilePath, 'utf8');
      const parts = lockfileContent.split(':');

      this.credentials = {
        process: parts[0],
        pid: parts[1],
        port: parts[2],
        password: parts[3],
        protocol: parts[4]
      };

      // Create HTTPS agent that ignores self-signed certificate
      this.httpsAgent = new https.Agent({
        rejectUnauthorized: false
      });

      // Create axios instance with auth
      this.axiosInstance = axios.create({
        baseURL: `https://127.0.0.1:${this.credentials.port}`,
        auth: {
          username: 'riot',
          password: this.credentials.password
        },
        httpsAgent: this.httpsAgent
      });

      console.log('Successfully connected to League Client');
      return true;
    } catch (error) {
      throw new Error(`Failed to connect to League Client: ${error.message}`);
    }
  }

  /**
   * Find the lockfile in common League of Legends installation paths
   */
  findLockfile() {
    const possiblePaths = [
      path.join(process.env.LOCALAPPDATA || '', 'Riot Games', 'League of Legends', 'lockfile'),
      path.join('C:', 'Riot Games', 'League of Legends', 'lockfile'),
      path.join(process.env.ProgramFiles || '', 'Riot Games', 'League of Legends', 'lockfile')
    ];

    for (const filePath of possiblePaths) {
      if (fs.existsSync(filePath)) {
        return filePath;
      }
    }

    return null;
  }

  /**
   * Make a GET request to the LCU API
   */
  async get(endpoint) {
    try {
      const response = await this.axiosInstance.get(endpoint);
      return response.data;
    } catch (error) {
      if (error.response?.status === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Make a POST request to the LCU API
   */
  async post(endpoint, data) {
    try {
      const response = await this.axiosInstance.post(endpoint, data);
      return response.data;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Make a PATCH request to the LCU API
   */
  async patch(endpoint, data) {
    try {
      const response = await this.axiosInstance.patch(endpoint, data);
      return response.data;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Make a PUT request to the LCU API
   */
  async put(endpoint, data) {
    try {
      const response = await this.axiosInstance.put(endpoint, data);
      return response.data;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get current summoner information
   */
  async getCurrentSummoner() {
    return await this.get('/lol-summoner/v1/current-summoner');
  }

  /**
   * Check if in champion select
   */
  async isInChampSelect() {
    const session = await this.get('/lol-champ-select/v1/session');
    return session !== null;
  }

  /**
   * Get current champion select session
   */
  async getChampSelectSession() {
    return await this.get('/lol-champ-select/v1/session');
  }

  /**
   * Get champion details by ID
   */
  async getChampion(championId) {
    return await this.get(`/lol-champions/v1/inventories/${await this.getSummonerId()}/champions/${championId}`);
  }

  /**
   * Fetch champion name mapping from Data Dragon
   */
  async getChampionNameMap() {
    if (this.championMap) {
      return this.championMap;
    }

    try {
      // Fetch the champion list from Data Dragon
      const response = await axios.get(
        'https://ddragon.leagueoflegends.com/cdn/14.1.1/data/en_US/champion.json'
      );

      const champions = response.data.data;
      this.championMap = {};

      // Create a map of champion ID to champion name (key)
      for (const [key, champ] of Object.entries(champions)) {
        this.championMap[champ.key] = key;
      }

      return this.championMap;
    } catch (error) {
      console.error('Failed to fetch champion map from Data Dragon:', error.message);
      return {};
    }
  }

  /**
   * Get champion name by ID
   */
  async getChampionNameById(championId) {
    const championMap = await this.getChampionNameMap();
    return championMap[championId] || `Champion${championId}`;
  }

  /**
   * Get all owned skins for a champion
   */
  async getChampionSkins(championId) {
    const champion = await this.getChampion(championId);
    if (!champion || !champion.skins) {
      return [];
    }

    // Get champion name from Data Dragon mapping
    const championName = await this.getChampionNameById(championId);

    return champion.skins
      .filter(skin => skin.ownership.owned)
      .map(skin => {
        // Calculate skin number from skin ID
        // Skin IDs are formatted as: championId * 1000 + skinNum
        // e.g., Caitlyn (51) skin 5 = 51005
        const skinNum = skin.id % 1000;
        
        return {
          id: skin.id,
          name: skin.name,
          ownership: skin.ownership,
          // Use loading screen image (full champion art)
          loadingUrl: `https://ddragon.leagueoflegends.com/cdn/img/champion/loading/${championName}_${skinNum}.jpg`
        };
      });
  }

  /**
   * Get summoner ID
   */
  async getSummonerId() {
    const summoner = await this.getCurrentSummoner();
    return summoner.summonerId;
  }

  /**
   * Select a skin in champion select
   */
  async selectSkin(championId, skinId) {
    try {
      const session = await this.getChampSelectSession();
      if (!session) {
        throw new Error('Not in champion select');
      }

      // Find the local player's cell ID
      const localPlayerCellId = session.localPlayerCellId;

      // Update the skin selection
      await this.patch(`/lol-champ-select/v1/session/actions/${localPlayerCellId}`, {
        championId: championId,
        completed: true
      });

      // Select the skin
      await this.patch('/lol-champ-select/v1/session/my-selection', {
        selectedSkinId: skinId
      });

      console.log(`Successfully selected skin ID: ${skinId}`);
      return true;
    } catch (error) {
      throw new Error(`Failed to select skin: ${error.message}`);
    }
  }

  /**
   * Get the currently selected champion ID
   */
  async getSelectedChampion() {
    const session = await this.getChampSelectSession();
    if (!session) return null;

    const localPlayerCellId = session.localPlayerCellId;
    const myTeam = session.myTeam || [];
    
    const myCell = myTeam.find(member => member.cellId === localPlayerCellId);
    return myCell ? myCell.championId : null;
  }
}

module.exports = LCUConnector;
