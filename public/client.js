class SkinSelectorUI {
    constructor() {
        this.autoMode = false;
        this.currentChampionId = null;
        this.currentSkins = [];
        this.init();
    }

    init() {
        this.cacheElements();
        this.setupEventListeners();
        this.startStatusMonitor();
    }

    cacheElements() {
        this.elements = {
            clientStatus: document.getElementById('clientStatus'),
            statusText: document.getElementById('statusText'),
            summonerName: document.getElementById('summonerName'),
            inChampSelect: document.getElementById('inChampSelect'),
            selectedChampion: document.getElementById('selectedChampion'),
            skinSelectionArea: document.getElementById('skinSelectionArea'),
            skinGrid: document.getElementById('skinGrid'),
            autoSelectBtn: document.getElementById('autoSelectBtn'),
            refreshBtn: document.getElementById('refreshBtn'),
            manualModeBtn: document.getElementById('manualModeBtn'),
            autoModeBtn: document.getElementById('autoModeBtn'),
            autoModeToggle: document.getElementById('autoModeToggle'),
            logContainer: document.getElementById('logContainer')
        };
    }

    setupEventListeners() {
        this.elements.autoSelectBtn.addEventListener('click', () => this.autoSelectRandomSkin());
        this.elements.refreshBtn.addEventListener('click', () => this.refreshSkins());
        
        this.elements.manualModeBtn.addEventListener('click', () => this.setMode('manual'));
        this.elements.autoModeBtn.addEventListener('click', () => this.setMode('auto'));
        this.elements.autoModeToggle.addEventListener('change', () => {
            this.autoMode = this.elements.autoModeToggle.checked;
            this.log(this.autoMode ? 'Auto mode enabled' : 'Auto mode disabled', 'warning');
        });
    }

    setMode(mode) {
        if (mode === 'manual') {
            this.autoMode = false;
            this.elements.manualModeBtn.classList.add('active');
            this.elements.autoModeBtn.classList.remove('active');
            this.elements.autoModeToggle.checked = false;
        } else {
            this.autoMode = true;
            this.elements.autoModeBtn.classList.add('active');
            this.elements.manualModeBtn.classList.remove('active');
            this.elements.autoModeToggle.checked = true;
        }
        this.log(`Switched to ${mode} mode`, 'warning');
    }

    async updateStatus() {
        try {
            const response = await fetch('/api/status');
            const data = await response.json();

            if (data.connected) {
                this.elements.clientStatus.classList.add('connected');
                this.elements.statusText.textContent = '✅ Connected to League Client';
                this.elements.summonerName.textContent = data.summoner || 'Loading...';
            } else {
                this.elements.clientStatus.classList.remove('connected');
                this.elements.clientStatus.classList.add('warning');
                this.elements.statusText.textContent = '⏳ Connecting...';
                this.elements.summonerName.textContent = '';
            }

            // Update champion select status
            if (data.inChampSelect) {
                this.elements.inChampSelect.textContent = '✅ Yes';
                this.elements.selectedChampion.textContent = data.selectedChampion || 'Loading...';
                
                // If champion ID changed, refresh skins
                if (data.selectedChampionId && this.currentChampionId !== data.selectedChampionId) {
                    this.currentChampionId = data.selectedChampionId;
                    this.log(`Champion selected: ID ${data.selectedChampionId}`, 'warning');
                    await this.refreshSkins();
                    
                    if (this.autoMode) {
                        await this.sleep(500);
                        await this.autoSelectRandomSkin();
                    }
                }
                
                this.currentChampionId = data.selectedChampionId;
            } else {
                this.elements.inChampSelect.textContent = '❌ No';
                this.elements.selectedChampion.textContent = 'None';
                this.currentChampionId = null;
                this.elements.skinSelectionArea.style.display = 'none';
            }
        } catch (error) {
            this.log(`Status update failed: ${error.message}`, 'error');
            this.elements.clientStatus.classList.remove('connected');
            this.elements.statusText.textContent = '❌ Disconnected';
        }
    }

    async refreshSkins() {
        if (!this.currentChampionId) {
            this.log('No champion selected', 'error');
            return;
        }

        try {
            this.elements.refreshBtn.disabled = true;
            const response = await fetch(`/api/skins/${this.currentChampionId}`);
            const skins = await response.json();

            if (skins.error) {
                this.log(`Error: ${skins.error}`, 'error');
                return;
            }

            if (!Array.isArray(skins)) {
                this.log(`Error: Invalid skin data received`, 'error');
                return;
            }

            this.currentSkins = skins;
            this.renderSkins(skins);
            this.log(`Loaded ${skins.length} skins for champion ID ${this.currentChampionId}`, 'success');
        } catch (error) {
            this.log(`Failed to refresh skins: ${error.message}`, 'error');
        } finally {
            this.elements.refreshBtn.disabled = false;
        }
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    renderSkins(skins) {
        this.elements.skinSelectionArea.style.display = 'block';
        this.elements.skinGrid.innerHTML = '';

        if (skins.length === 0) {
            const emptyMsg = document.createElement('p');
            emptyMsg.className = 'text-center';
            emptyMsg.style.gridColumn = '1 / -1';
            emptyMsg.textContent = 'No skins available for this champion';
            this.elements.skinGrid.appendChild(emptyMsg);
            return;
        }

        skins.forEach(skin => {
            const skinCard = document.createElement('div');
            skinCard.className = 'skin-card';
            
            // Try to load image
            const img = document.createElement('img');
            img.className = 'skin-image';
            img.alt = skin.name;
            img.src = skin.loadingUrl;
            
            let imageLoaded = false;
            img.onload = () => {
                imageLoaded = true;
            };

            img.onerror = () => {
                if (!imageLoaded) {
                    // Show placeholder instead
                    img.style.display = 'none';
                    const placeholder = document.createElement('div');
                    placeholder.className = 'skin-image-placeholder';
                    placeholder.textContent = '🎮';
                    img.parentNode?.insertBefore(placeholder, img);
                }
            };

            const infoDiv = document.createElement('div');
            infoDiv.className = 'skin-info';
            infoDiv.innerHTML = `
                <div class="skin-name">${skin.name}</div>
                <div class="skin-id">ID: ${skin.id}</div>
            `;

            skinCard.appendChild(img);
            skinCard.appendChild(infoDiv);
            skinCard.addEventListener('click', () => this.selectSkin(skin.id, skin.name));
            this.elements.skinGrid.appendChild(skinCard);
        });
    }

    async selectSkin(skinId, skinName) {
        if (!this.currentChampionId) {
            this.log('No champion selected', 'error');
            return;
        }

        try {
            const response = await fetch('/api/select-skin', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    championId: this.currentChampionId,
                    skinId: skinId
                })
            });

            const result = await response.json();

            if (result.error) {
                this.log(`Failed to select skin: ${result.error}`, 'error');
            } else {
                this.log(`Selected skin: ${skinName}`, 'success');
            }
        } catch (error) {
            this.log(`Error selecting skin: ${error.message}`, 'error');
        }
    }

    async autoSelectRandomSkin() {
        if (!this.currentChampionId) {
            this.log('No champion selected', 'error');
            return;
        }

        if (this.currentSkins.length === 0) {
            await this.refreshSkins();
        }

        if (this.currentSkins.length === 0) {
            this.log('No skins available to select', 'error');
            return;
        }

        const randomSkin = this.currentSkins[Math.floor(Math.random() * this.currentSkins.length)];
        await this.selectSkin(randomSkin.id, randomSkin.name);
    }

    log(message, type = 'info') {
        const entry = document.createElement('p');
        entry.className = `log-entry ${type}`;
        const timestamp = new Date().toLocaleTimeString();
        entry.textContent = `[${timestamp}] ${message}`;
        
        this.elements.logContainer.appendChild(entry);
        this.elements.logContainer.scrollTop = this.elements.logContainer.scrollHeight;

        // Keep only last 100 entries
        const entries = this.elements.logContainer.querySelectorAll('.log-entry');
        if (entries.length > 100) {
            entries[0].remove();
        }
    }

    startStatusMonitor() {
        this.updateStatus();
        setInterval(() => this.updateStatus(), 2000);
    }
}

// Initialize the UI when the page loads
document.addEventListener('DOMContentLoaded', () => {
    window.ui = new SkinSelectorUI();
    window.ui.log('Application initialized', 'success');
});
