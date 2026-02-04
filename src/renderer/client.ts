import { getErrorMessage } from '../shared/errors';
import type {
  QRCodeResponse,
  StatusResponse,
  SkinsResponse,
  SkinData,
  ChromaData,
  SelectSkinRequest,
  SelectSkinResponse,
  AcceptReadyCheckResponse,
  ErrorResponse
} from '../shared/api-types';

interface ElectronAPI {
    requestFocus: () => void;
    onUpdateChecking?: (callback: () => void) => void;
    onUpdateAvailable?: (callback: (version: string) => void) => void;
    onUpdateProgress?: (callback: (percent: number) => void) => void;
    onUpdateDownloaded?: (callback: (version: string) => void) => void;
}

const STATUS_POLL_INTERVAL_MS = 2000;
const AUTO_SELECT_DELAY_MS = 500;
const MAX_LOG_ENTRIES = 100;

interface WindowWithExtensions extends Window {
    electronAPI?: ElectronAPI;
    ui?: SkinSelectorUI;
}

interface DOMElements {
    clientStatus: HTMLElement;
    statusText: HTMLElement;
    summonerName: HTMLElement;
    inChampSelect: HTMLElement;
    selectedChampion: HTMLElement;
    readyCheckPopup: HTMLElement;
    acceptQueueBtn: HTMLButtonElement;
    skinSelectionArea: HTMLElement;
    skinGrid: HTMLElement;
    chromaSelectionArea: HTMLElement;
    chromaGrid: HTMLElement;
    selectedSkinName: HTMLElement;
    backToSkinsBtn: HTMLButtonElement;
    autoSelectBtn: HTMLButtonElement;
    refreshBtn: HTMLButtonElement;
    manualModeBtn: HTMLButtonElement;
    autoModeBtn: HTMLButtonElement;
    autoModeToggle: HTMLInputElement;
    logContainer: HTMLElement;
}

type LogType = 'info' | 'success' | 'warning' | 'error';

class SkinSelectorUI {
    private autoMode: boolean = false;
    private currentChampionId: number | null = null;
    private currentSkins: SkinData[] = [];
    private selectedSkin: SkinData | null = null;
    private lockedIn: boolean = false;
    private focusedChampionId: number | null = null;
    private elements!: DOMElements;
    private qrGenerated: boolean = false;

    constructor() {
        this.init();
    }

    private init(): void {
        this.cacheElements();
        this.setupEventListeners();
        this.startStatusMonitor();
    }

    private cacheElements(): void {
        this.elements = {
            clientStatus: this.getElement('clientStatus'),
            statusText: this.getElement('statusText'),
            summonerName: this.getElement('summonerName'),
            inChampSelect: this.getElement('inChampSelect'),
            selectedChampion: this.getElement('selectedChampion'),
            readyCheckPopup: this.getElement('readyCheckPopup'),
            acceptQueueBtn: this.getElement('acceptQueueBtn') as HTMLButtonElement,
            skinSelectionArea: this.getElement('skinSelectionArea'),
            skinGrid: this.getElement('skinGrid'),
            chromaSelectionArea: this.getElement('chromaSelectionArea'),
            chromaGrid: this.getElement('chromaGrid'),
            selectedSkinName: this.getElement('selectedSkinName'),
            backToSkinsBtn: this.getElement('backToSkinsBtn') as HTMLButtonElement,
            autoSelectBtn: this.getElement('autoSelectBtn') as HTMLButtonElement,
            refreshBtn: this.getElement('refreshBtn') as HTMLButtonElement,
            manualModeBtn: this.getElement('manualModeBtn') as HTMLButtonElement,
            autoModeBtn: this.getElement('autoModeBtn') as HTMLButtonElement,
            autoModeToggle: this.getElement('autoModeToggle') as HTMLInputElement,
            logContainer: this.getElement('logContainer')
        };
    }

    private getElement<T extends HTMLElement>(id: string): T {
        const element = document.getElementById(id);
        if (!element) {
            throw new Error(`Element with id '${id}' not found`);
        }
        return element as T;
    }

    private setupEventListeners(): void {
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

        // QR Code toggle
        const toggleQrBtn = document.getElementById('toggleQrBtn');
        const qrContainer = document.getElementById('qrContainer');
        if (toggleQrBtn && qrContainer) {
            toggleQrBtn.addEventListener('click', () => {
                qrContainer.classList.toggle('hidden');
                toggleQrBtn.textContent = qrContainer.classList.contains('hidden') ? 'Show QR' : 'Hide QR';
                if (!qrContainer.classList.contains('hidden') && !this.qrGenerated) {
                    this.generateQRCode();
                }
            });
        }
    }

    private setMode(mode: 'manual' | 'auto'): void {
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

    private async updateStatus(): Promise<void> {
        try {
            const response = await fetch('/api/status');
            const data: StatusResponse = await response.json();

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
                if (championChanged && data.selectedChampionId) {
                    this.currentChampionId = data.selectedChampionId;
                    this.focusedChampionId = null;
                    this.log(`Champion selected: ID ${data.selectedChampionId}`, 'warning');
                    await this.refreshSkins();
                    
                    if (this.autoMode) {
                        await this.sleep(AUTO_SELECT_DELAY_MS);
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
                this.currentChampionId = data.selectedChampionId || null;
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
            this.log(`Status update failed: ${getErrorMessage(error)}`, 'error');
            this.elements.clientStatus.classList.remove('connected');
            this.elements.statusText.textContent = '❌ Disconnected';
        }
    }

    private async acceptReadyCheck(): Promise<void> {
        if (!this.elements.acceptQueueBtn) return;
        try {
            this.elements.acceptQueueBtn.disabled = true;
            const response = await fetch('/api/accept-ready-check', { method: 'POST' });
            const result = await response.json() as AcceptReadyCheckResponse | ErrorResponse;

            if ('error' in result) {
                this.log(`Failed to accept ready check: ${result.error}`, 'error');
                this.elements.acceptQueueBtn.disabled = false;
                return;
            }

            this.log('Ready check accepted', 'success');
        } catch (error) {
            this.log(`Error accepting ready check: ${getErrorMessage(error)}`, 'error');
            this.elements.acceptQueueBtn.disabled = false;
        }
    }

    private async refreshSkins(): Promise<void> {
        if (!this.currentChampionId) {
            this.log('No champion selected', 'error');
            return;
        }

        try {
            this.elements.refreshBtn.disabled = true;
            const response = await fetch(`/api/skins/${this.currentChampionId}`);
            const data = await response.json() as SkinsResponse | ErrorResponse;

            if ('error' in data) {
                this.log(`Error: ${data.error}`, 'error');
                return;
            }

            if (!Array.isArray(data)) {
                this.log(`Error: Invalid skin data received`, 'error');
                return;
            }

            const skins: SkinData[] = data;
            this.currentSkins = skins;
            this.renderSkins(skins);
            this.log(`Loaded ${skins.length} skins for champion ID ${this.currentChampionId}`, 'success');
        } catch (error) {
            this.log(`Failed to refresh skins: ${getErrorMessage(error)}`, 'error');
        } finally {
            this.elements.refreshBtn.disabled = false;
        }
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    private requestWindowFocus(): void {
        const win = window as WindowWithExtensions;
        if (win.electronAPI && typeof win.electronAPI.requestFocus === 'function') {
            win.electronAPI.requestFocus();
            this.log('Window focused (locked-in with skins)', 'info');
        }
    }

    private hasNonBaseSkins(): boolean {
        return this.currentSkins.some(skin => (skin.id % 1000) !== 0);
    }

    private renderSkins(skins: SkinData[]): void {
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
            if (skin.hasOwnedChromas && skin.chromas) {
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

    private async selectSkin(skinId: number, skinName: string, chromaId: number | null = null): Promise<void> {
        if (!this.currentChampionId) {
            this.log('No champion selected', 'error');
            return;
        }

        try {
            const payload: SelectSkinRequest = {
                championId: this.currentChampionId,
                skinId: skinId,
                chromaId: chromaId ?? undefined
            };

            const response = await fetch('/api/select-skin', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            const result = await response.json() as SelectSkinResponse | ErrorResponse;

            if ('error' in result) {
                this.log(`Failed to select skin: ${result.error}`, 'error');
            } else {
                const message = chromaId 
                    ? `Selected ${skinName} with chroma` 
                    : `Selected skin: ${skinName}`;
                this.log(message, 'success');
            }
        } catch (error) {
            this.log(`Error selecting skin: ${getErrorMessage(error)}`, 'error');
        }
    }

    private async autoSelectRandomSkin(): Promise<void> {
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
        if (!randomSkin) return;
        await this.selectSkin(randomSkin.id, randomSkin.name);
    }

    private showChromaSelection(skin: SkinData): void {
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

    private showSkinSelection(): void {
        if (this.elements.chromaSelectionArea) {
            this.elements.chromaSelectionArea.style.display = 'none';
        }
        this.elements.skinSelectionArea.style.display = 'block';
        this.selectedSkin = null;
    }

    private renderChromas(skin: SkinData): void {
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
            skin.chromas.forEach((chroma: ChromaData) => {
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

    public log(message: string, type: LogType = 'info'): void {
        const entry = document.createElement('p');
        entry.className = `log-entry ${type}`;
        const timestamp = new Date().toLocaleTimeString();
        entry.textContent = `[${timestamp}] ${message}`;
        
        this.elements.logContainer.appendChild(entry);
        this.elements.logContainer.scrollTop = this.elements.logContainer.scrollHeight;

        // Keep only last 100 entries
        const entries = this.elements.logContainer.querySelectorAll('.log-entry');
        if (entries.length > MAX_LOG_ENTRIES) {
            entries[0]?.remove();
        }
    }

    private startStatusMonitor(): void {
        // Add a small delay before the first status check to ensure server is ready
        setTimeout(() => this.updateStatus(), 100);
        setInterval(() => this.updateStatus(), STATUS_POLL_INTERVAL_MS);
    }

    public initCollapsibleSections(): void {
        const collapseButtons = document.querySelectorAll<HTMLButtonElement>('.collapse-btn');
        
        collapseButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const sectionName = btn.getAttribute('data-section');
                if (!sectionName) return;
                
                const contentId = `${sectionName}-content`;
                const content = document.getElementById(contentId);
                
                if (content) {
                    content.classList.toggle('collapsed');
                    btn.textContent = content.classList.contains('collapsed') ? '+' : '−';
                    
                    // Save collapse state to localStorage
                    localStorage.setItem(`section-${sectionName}-collapsed`, 
                        content.classList.contains('collapsed').toString());
                }
            });

            // Restore collapse state from localStorage
            const sectionName = btn.getAttribute('data-section');
            if (!sectionName) return;
            
            const contentId = `${sectionName}-content`;
            const content = document.getElementById(contentId);
            const wasCollapsed = localStorage.getItem(`section-${sectionName}-collapsed`) === 'true';
            
            if (content && wasCollapsed) {
                content.classList.add('collapsed');
                btn.textContent = '+';
            }
        });
    }

    private generateQRCode(): void {
        const canvas = document.getElementById('qrCanvas') as HTMLCanvasElement | null;
        if (!canvas) return;

        // Fetch the QR code image from the server
        fetch('/api/qr-code')
            .then(response => response.json() as Promise<QRCodeResponse | ErrorResponse>)
            .then(data => {
                if ('error' in data) {
                    this.log(`Failed to get QR code: ${data.error}`, 'error');
                    return;
                }

                const img = new Image();
                img.onload = () => {
                    const ctx = canvas.getContext('2d');
                    if (ctx) {
                        canvas.width = img.width;
                        canvas.height = img.height;
                        ctx.drawImage(img, 0, 0);
                        this.qrGenerated = true;
                        this.log('QR code generated', 'success');
                    }
                };
                img.onerror = () => {
                    console.error('Error loading QR code image');
                    this.log('Failed to load QR code', 'error');
                };
                img.src = data.qrCodeUrl;
            })
            .catch(error => {
                console.error('Error fetching QR code:', error);
                this.log('Failed to fetch QR code', 'error');
            });
    }
}

// Initialize the UI when the page loads
document.addEventListener('DOMContentLoaded', () => {
    const win = window as WindowWithExtensions;
    win.ui = new SkinSelectorUI();
    win.ui.initCollapsibleSections();
    win.ui.log('Application initialized', 'success');
    
    // Listen for update events from Electron
    if (win.electronAPI) {
        if (win.electronAPI.onUpdateChecking) {
            win.electronAPI.onUpdateChecking(() => {
                win.ui?.log('Checking for updates...', 'info');
            });
        }
        if (win.electronAPI.onUpdateAvailable) {
            win.electronAPI.onUpdateAvailable((version) => {
                win.ui?.log(`Update available: v${version}. Downloading...`, 'warning');
            });
        }
        if (win.electronAPI.onUpdateProgress) {
            win.electronAPI.onUpdateProgress((percent) => {
                win.ui?.log(`Downloading update: ${percent}%`, 'info');
            });
        }
        if (win.electronAPI.onUpdateDownloaded) {
            win.electronAPI.onUpdateDownloaded((version) => {
                win.ui?.log(`✅ Update v${version} downloaded! Will install on restart.`, 'success');
            });
        }
    }
});
