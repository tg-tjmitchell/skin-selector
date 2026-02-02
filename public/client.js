class SkinSelectorUI {
    constructor() {
        this.autoMode = false;
        this.currentChampionId = null;
        this.currentSkins = [];
        this.selectedSkin = null;
        this.lockedIn = false;
        this.focusedChampionId = null;
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
            readyCheckPopup: document.getElementById('readyCheckPopup'),
            acceptQueueBtn: document.getElementById('acceptQueueBtn'),
            skinSelectionArea: document.getElementById('skinSelectionArea'),
            skinGrid: document.getElementById('skinGrid'),
            chromaSelectionArea: document.getElementById('chromaSelectionArea'),
            chromaGrid: document.getElementById('chromaGrid'),
            selectedSkinName: document.getElementById('selectedSkinName'),
            backToSkinsBtn: document.getElementById('backToSkinsBtn'),
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

        if (this.elements.acceptQueueBtn) {
            this.elements.acceptQueueBtn.addEventListener('click', () => this.acceptReadyCheck());
        }
        
        if (this.elements.backToSkinsBtn) {
            this.elements.backToSkinsBtn.addEventListener('click', () => this.showSkinSelection());
        }
        
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
                const isLockedIn = !!data.lockedIn;
                const championChanged = data.selectedChampionId && this.currentChampionId !== data.selectedChampionId;
                
                // If champion ID changed, refresh skins
                if (championChanged) {
                    this.currentChampionId = data.selectedChampionId;
                    this.focusedChampionId = null;
                    this.log(`Champion selected: ID ${data.selectedChampionId}`, 'warning');
                    await this.refreshSkins();
                    
                    if (this.autoMode) {
                        await this.sleep(500);
                        await this.autoSelectRandomSkin();
                    }
                }

                // Focus window when player locks in and has skins
                if (isLockedIn && !this.lockedIn) {
                    if (this.currentSkins.length === 0) {
                        await this.refreshSkins();
                    }
                    if (this.currentSkins.length > 0 && this.hasNonBaseSkins() && this.focusedChampionId !== this.currentChampionId) {
                        this.requestWindowFocus();
                        this.focusedChampionId = this.currentChampionId;
                    }
                }

                this.lockedIn = isLockedIn;
                this.currentChampionId = data.selectedChampionId;
            } else {
                this.elements.inChampSelect.textContent = '❌ No';
                this.elements.selectedChampion.textContent = 'None';
                this.currentChampionId = null;
                this.lockedIn = false;
                this.focusedChampionId = null;
                this.elements.skinSelectionArea.style.display = 'none';
            }

            const readyCheck = data.readyCheck;
            if (this.elements.readyCheckPopup && this.elements.acceptQueueBtn) {
                if (readyCheck && readyCheck.state === 'InProgress') {
                    const playerResponse = readyCheck.playerResponse || 'None';
                    if (playerResponse === 'Accepted') {
                        this.elements.readyCheckPopup.classList.add('hidden');
                    } else {
                        this.elements.readyCheckPopup.classList.remove('hidden');
                        this.elements.acceptQueueBtn.disabled = false;
                        this.requestWindowFocus();
                    }
                } else {
                    this.elements.readyCheckPopup.classList.add('hidden');
                    this.elements.acceptQueueBtn.disabled = false;
                }
            }
        } catch (error) {
            this.log(`Status update failed: ${error.message}`, 'error');
            this.elements.clientStatus.classList.remove('connected');
            this.elements.statusText.textContent = '❌ Disconnected';
        }
    }

    async acceptReadyCheck() {
        if (!this.elements.acceptQueueBtn) return;
        try {
            this.elements.acceptQueueBtn.disabled = true;
            const response = await fetch('/api/accept-ready-check', { method: 'POST' });
            const result = await response.json();

            if (result.error) {
                this.log(`Failed to accept ready check: ${result.error}`, 'error');
                this.elements.acceptQueueBtn.disabled = false;
                return;
            }

            this.log('Ready check accepted', 'success');
        } catch (error) {
            this.log(`Error accepting ready check: ${error.message}`, 'error');
            this.elements.acceptQueueBtn.disabled = false;
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

    requestWindowFocus() {
        if (window.electronAPI && typeof window.electronAPI.requestFocus === 'function') {
            window.electronAPI.requestFocus();
            this.log('Window focused (locked-in with skins)', 'info');
        }
    }

    hasNonBaseSkins() {
        return this.currentSkins.some(skin => (skin.id % 1000) !== 0);
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
            
            // Add chroma indicator badge if skin has chromas
            if (skin.hasOwnedChromas) {
                const chromaBadge = document.createElement('div');
                chromaBadge.className = 'chroma-badge';
                chromaBadge.innerHTML = `<span>🎨 ${skin.chromas.length}</span>`;
                chromaBadge.title = `${skin.chromas.length} chroma(s) available`;
                skinCard.appendChild(chromaBadge);
            }
            
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
            
            // Click handler: if has chromas, show chroma selection; otherwise select skin directly
            skinCard.addEventListener('click', () => {
                if (skin.hasOwnedChromas) {
                    this.showChromaSelection(skin);
                } else {
                    this.selectSkin(skin.id, skin.name);
                }
            });
            
            this.elements.skinGrid.appendChild(skinCard);
        });
    }

    async selectSkin(skinId, skinName, chromaId = null) {
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
                    skinId: skinId,
                    chromaId: chromaId
                })
            });

            const result = await response.json();

            if (result.error) {
                this.log(`Failed to select skin: ${result.error}`, 'error');
            } else {
                const message = chromaId 
                    ? `Selected ${skinName} with chroma` 
                    : `Selected skin: ${skinName}`;
                this.log(message, 'success');
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

    showChromaSelection(skin) {
        this.selectedSkin = skin;
        this.elements.skinSelectionArea.style.display = 'none';
        
        if (this.elements.chromaSelectionArea) {
            this.elements.chromaSelectionArea.style.display = 'block';
        }
        
        if (this.elements.selectedSkinName) {
            this.elements.selectedSkinName.textContent = skin.name;
        }
        
        this.renderChromas(skin);
        this.log(`Viewing chromas for ${skin.name}`, 'info');
    }

    showSkinSelection() {
        if (this.elements.chromaSelectionArea) {
            this.elements.chromaSelectionArea.style.display = 'none';
        }
        this.elements.skinSelectionArea.style.display = 'block';
        this.selectedSkin = null;
    }

    renderChromas(skin) {
        if (!this.elements.chromaGrid) return;
        
        this.elements.chromaGrid.innerHTML = '';

        // Add base skin option
        const baseSkinCard = document.createElement('div');
        baseSkinCard.className = 'chroma-card';
        
        const baseImg = document.createElement('img');
        baseImg.className = 'chroma-image';
        baseImg.alt = 'Base ' + skin.name;
        baseImg.src = skin.loadingUrl;
        baseImg.onerror = () => {
            baseImg.style.display = 'none';
            const placeholder = document.createElement('div');
            placeholder.className = 'chroma-image-placeholder';
            placeholder.textContent = '🎮';
            baseImg.parentNode?.insertBefore(placeholder, baseImg);
        };

        const baseInfo = document.createElement('div');
        baseInfo.className = 'chroma-info';
        baseInfo.innerHTML = `<div class="chroma-name">Base Skin</div>`;

        baseSkinCard.appendChild(baseImg);
        baseSkinCard.appendChild(baseInfo);
        baseSkinCard.addEventListener('click', () => {
            this.selectSkin(skin.id, skin.name);
            this.showSkinSelection();
        });
        this.elements.chromaGrid.appendChild(baseSkinCard);

        // Add chromas
        if (skin.chromas && skin.chromas.length > 0) {
            skin.chromas.forEach(chroma => {
                const chromaCard = document.createElement('div');
                chromaCard.className = 'chroma-card';
                
                const img = document.createElement('img');
                img.className = 'chroma-image';
                img.alt = chroma.name;
                img.src = chroma.imageUrl;
                
                img.onerror = () => {
                    img.style.display = 'none';
                    const placeholder = document.createElement('div');
                    placeholder.className = 'chroma-image-placeholder';
                    placeholder.textContent = '🎨';
                    img.parentNode?.insertBefore(placeholder, img);
                };

                const infoDiv = document.createElement('div');
                infoDiv.className = 'chroma-info';
                infoDiv.innerHTML = `<div class="chroma-name">${chroma.name}</div>`;

                chromaCard.appendChild(img);
                chromaCard.appendChild(infoDiv);
                chromaCard.addEventListener('click', () => {
                    this.selectSkin(skin.id, skin.name, chroma.id);
                    this.showSkinSelection();
                });
                this.elements.chromaGrid.appendChild(chromaCard);
            });
        }
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

    initCollapsibleSections() {
        const collapseButtons = document.querySelectorAll('.collapse-btn');
        
        collapseButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const sectionName = btn.getAttribute('data-section');
                const contentId = `${sectionName}-content`;
                const content = document.getElementById(contentId);
                
                if (content) {
                    content.classList.toggle('collapsed');
                    btn.textContent = content.classList.contains('collapsed') ? '+' : '−';
                    
                    // Save collapse state to localStorage
                    localStorage.setItem(`section-${sectionName}-collapsed`, 
                        content.classList.contains('collapsed'));
                }
            });

            // Restore collapse state from localStorage
            const sectionName = btn.getAttribute('data-section');
            const contentId = `${sectionName}-content`;
            const content = document.getElementById(contentId);
            const wasCollapsed = localStorage.getItem(`section-${sectionName}-collapsed`) === 'true';
            
            if (content && wasCollapsed) {
                content.classList.add('collapsed');
                btn.textContent = '+';
            }
        });
    }
}

// Initialize the UI when the page loads
document.addEventListener('DOMContentLoaded', () => {
    window.ui = new SkinSelectorUI();
    window.ui.initCollapsibleSections();
    window.ui.log('Application initialized', 'success');
});
