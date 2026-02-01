import readline from "readline";
import LCUConnector from "./lcu-connector";

type Skin = { id: number; name: string };

class SkinSelector {
  private lcu: LCUConnector;
  private rl: readline.Interface;

  constructor(lcuConnector: LCUConnector) {
    this.lcu = lcuConnector;
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
  }

  /**
   * Wait for user input
   */
  question(query: string): Promise<string> {
    return new Promise((resolve) => {
      this.rl.question(query, resolve);
    });
  }

  /**
   * Display available skins for a champion
   */
  displaySkins(skins: Skin[]): void {
    console.log("\n=== Available Skins ===");
    skins.forEach((skin, index) => {
      console.log(`${index + 1}. ${skin.name} (ID: ${skin.id})`);
    });
    console.log("=======================\n");
  }

  /**
   * Main skin selection flow
   */
  async selectSkin(): Promise<boolean> {
    try {
      console.log("Waiting for champion select...");

      // Wait for champion select
      while (!(await this.lcu.isInChampSelect())) {
        await this.sleep(1000);
      }

      console.log("Champion select detected!");
      await this.sleep(2000); // Wait a bit for champion to be locked

      // Get the selected champion
      const championId = await this.lcu.getSelectedChampion();

      if (!championId || championId === 0) {
        console.log("No champion selected yet. Please select a champion first.");
        return false;
      }

      console.log(`Champion ID: ${championId}`);

      // Get available skins
      const skins = await this.lcu.getChampionSkins(championId);

      if (skins.length === 0) {
        console.log("No skins available for this champion.");
        return false;
      }

      this.displaySkins(skins);

      // Ask user to select a skin
      const answer = await this.question(
        "Enter the number of the skin you want to select (or 0 to skip): "
      );
      const selection = Number.parseInt(answer, 10);

      if (selection === 0) {
        console.log("Skin selection skipped.");
        return false;
      }

      if (selection < 1 || selection > skins.length) {
        console.log("Invalid selection.");
        return false;
      }

      const selectedSkin = skins[selection - 1];
      if (!selectedSkin) {
        console.log("Invalid selection.");
        return false;
      }

      // Select the skin
      await this.lcu.selectSkin(championId, selectedSkin.id);
      console.log(`Successfully selected: ${selectedSkin.name}`);

      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("Error during skin selection:", message);
      return false;
    }
  }

  /**
   * Auto skin selection mode - automatically selects a random skin
   */
  async autoSelectRandomSkin(): Promise<boolean> {
    try {
      console.log("Auto mode: Waiting for champion select...");

      // Wait for champion select
      while (!(await this.lcu.isInChampSelect())) {
        await this.sleep(1000);
      }

      console.log("Champion select detected!");
      await this.sleep(2000);

      const championId = await this.lcu.getSelectedChampion();

      if (!championId || championId === 0) {
        console.log("No champion selected yet.");
        return false;
      }

      const skins = await this.lcu.getChampionSkins(championId);

      if (skins.length === 0) {
        console.log("No skins available.");
        return false;
      }

      // Select random skin
      const randomSkin = skins[Math.floor(Math.random() * skins.length)];
      await this.lcu.selectSkin(championId, randomSkin.id);
      console.log(`Auto-selected: ${randomSkin.name}`);

      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("Error during auto skin selection:", message);
      return false;
    }
  }

  /**
   * Run the skin selector in continuous mode
   */
  async run(autoMode = false): Promise<void> {
    console.log("\n=== League Skin Selector ===");
    console.log("Monitoring for champion select...");
    console.log("Press Ctrl+C to exit\n");

    while (true) {
      try {
        if (await this.lcu.isInChampSelect()) {
          if (autoMode) {
            await this.autoSelectRandomSkin();
          } else {
            await this.selectSkin();
          }

          // Wait for champion select to end
          while (await this.lcu.isInChampSelect()) {
            await this.sleep(1000);
          }

          console.log("\nChampion select ended. Waiting for next game...\n");
        }

        await this.sleep(2000);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("Error:", message);
        await this.sleep(5000);
      }
    }
  }

  /**
   * Sleep utility
   */
  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Close the readline interface
   */
  close(): void {
    this.rl.close();
  }
}

export default SkinSelector;
