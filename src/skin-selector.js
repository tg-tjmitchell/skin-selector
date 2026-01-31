const readline = require('readline');

class SkinSelector {
  constructor(lcuConnector) {
    this.lcu = lcuConnector;
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
  }

  /**
   * Wait for user input
   */
  question(query) {
    return new Promise(resolve => {
      this.rl.question(query, resolve);
    });
  }

  /**
   * Display available skins for a champion
   */
  displaySkins(skins) {
    console.log('\n=== Available Skins ===');
    skins.forEach((skin, index) => {
      console.log(`${index + 1}. ${skin.name} (ID: ${skin.id})`);
    });
    console.log('=======================\n');
  }

  /**
   * Main skin selection flow
   */
  async selectSkin() {
    try {
      console.log('Waiting for champion select...');
      
      // Wait for champion select
      while (!(await this.lcu.isInChampSelect())) {
        await this.sleep(1000);
      }

      console.log('Champion select detected!');
      await this.sleep(2000); // Wait a bit for champion to be locked

      // Get the selected champion
      const championId = await this.lcu.getSelectedChampion();
      
      if (!championId || championId === 0) {
        console.log('No champion selected yet. Please select a champion first.');
        return false;
      }

      console.log(`Champion ID: ${championId}`);

      // Get available skins
      const skins = await this.lcu.getChampionSkins(championId);
      
      if (skins.length === 0) {
        console.log('No skins available for this champion.');
        return false;
      }

      this.displaySkins(skins);

      // Ask user to select a skin
      const answer = await this.question('Enter the number of the skin you want to select (or 0 to skip): ');
      const selection = parseInt(answer);

      if (selection === 0) {
        console.log('Skin selection skipped.');
        return false;
      }

      if (selection < 1 || selection > skins.length) {
        console.log('Invalid selection.');
        return false;
      }

      const selectedSkin = skins[selection - 1];
      
      // Select the skin
      await this.lcu.selectSkin(championId, selectedSkin.id);
      console.log(`Successfully selected: ${selectedSkin.name}`);
      
      return true;
    } catch (error) {
      console.error('Error during skin selection:', error.message);
      return false;
    }
  }

  /**
   * Auto skin selection mode - automatically selects a random skin
   */
  async autoSelectRandomSkin() {
    try {
      console.log('Auto mode: Waiting for champion select...');
      
      // Wait for champion select
      while (!(await this.lcu.isInChampSelect())) {
        await this.sleep(1000);
      }

      console.log('Champion select detected!');
      await this.sleep(2000);

      const championId = await this.lcu.getSelectedChampion();
      
      if (!championId || championId === 0) {
        console.log('No champion selected yet.');
        return false;
      }

      const skins = await this.lcu.getChampionSkins(championId);
      
      if (skins.length === 0) {
        console.log('No skins available.');
        return false;
      }

      // Select random skin
      const randomSkin = skins[Math.floor(Math.random() * skins.length)];
      await this.lcu.selectSkin(championId, randomSkin.id);
      console.log(`Auto-selected: ${randomSkin.name}`);
      
      return true;
    } catch (error) {
      console.error('Error during auto skin selection:', error.message);
      return false;
    }
  }

  /**
   * Run the skin selector in continuous mode
   */
  async run(autoMode = false) {
    console.log('\n=== League Skin Selector ===');
    console.log('Monitoring for champion select...');
    console.log('Press Ctrl+C to exit\n');

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
          
          console.log('\nChampion select ended. Waiting for next game...\n');
        }
        
        await this.sleep(2000);
      } catch (error) {
        console.error('Error:', error.message);
        await this.sleep(5000);
      }
    }
  }

  /**
   * Sleep utility
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Close the readline interface
   */
  close() {
    this.rl.close();
  }
}

module.exports = SkinSelector;
