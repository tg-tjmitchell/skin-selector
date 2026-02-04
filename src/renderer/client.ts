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
    ErrorResponse,
    FavoritesResponse,
    ToggleFavoriteRequest,
    ToggleFavoriteResponse
} from '../shared/api-types';

interface PortableUpdateInfo {
    currentVersion: string;
    latestVersion: string;
    downloadUrl: string;
}

interface ElectronAPI {
    requestFocus: () => void;
    openReleasesPage?: () => void;
    getAppVersion?: () => Promise<string>;
    onUpdateChecking?: (callback: () => void) => void;
    onUpdateAvailable?: (callback: (version: string) => void) => void;
    onUpdateProgress?: (callback: (percent: number) => void) => void;
    onUpdateDownloaded?: (callback: (version: string) => void) => void;
    onPortableUpdateAvailable?: (callback: (info: PortableUpdateInfo) => void) => void;
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
    autoPickToggle: HTMLInputElement;
    logContainer: HTMLElement;
    showFavoritesBtn: HTMLButtonElement | null;
    previewModal: HTMLElement | null;
    previewImage: HTMLImageElement | null;
    previewClose: HTMLElement | null;
}

type LogType = 'info' | 'success' | 'warning' | 'error';

class FavoritesManager {
    private static favorites: Map<number, Set<number>> = new Map();

    private static applyFavoritesPayload(payload: Record<string, number[]>): void {
        const map = new Map<number, Set<number>>();
        for (const [championId, skinIds] of Object.entries(payload)) {
            map.set(parseInt(championId, 10), new Set(skinIds));
        }
        this.favorites = map;
    }

    static async loadFavorites(): Promise<boolean> {
        try {
            const response = await fetch('/api/favorites');
            const data = await response.json() as FavoritesResponse | ErrorResponse;

            if ('error' in data) {
                return false;
            }

            this.applyFavoritesPayload(data.favorites);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Get all favorites as a map of championId -> Set of skinIds
     */
    static getFavorites(): Map<number, Set<number>> {
        return this.favorites;
    }

    /**
     * Check if a skin is favorited
     */
    static isFavorited(championId: number, skinId: number): boolean {
        const favorites = this.getFavorites();
        return favorites.get(championId)?.has(skinId) || false;
    }

    /**
     * Toggle favorite status for a skin
     */
    static async toggleFavoriteAsync(championId: number, skinId: number): Promise<boolean> {
        const payload: ToggleFavoriteRequest = { championId, skinId };
        const response = await fetch('/api/favorites/toggle', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json() as ToggleFavoriteResponse | ErrorResponse;
        if ('error' in data) {
            throw new Error(data.error);
        }

        this.applyFavoritesPayload(data.favorites);
        return data.isFavorited;
    }

    /**
     * Add a skin to favorites
     */
    static async addFavorite(championId: number, skinId: number): Promise<void> {
        if (!this.isFavorited(championId, skinId)) {
            await this.toggleFavoriteAsync(championId, skinId);
        }
    }

    /**
     * Remove a skin from favorites
     */
    static async removeFavorite(championId: number, skinId: number): Promise<void> {
        if (this.isFavorited(championId, skinId)) {
            await this.toggleFavoriteAsync(championId, skinId);
        }
    }

    /**
     * Get all favorited skins for a champion
     */
    static getFavoriteSkinsForChampion(championId: number): Set<number> {
        return this.getFavorites().get(championId) || new Set();
    }
}

class SkinSelectorUI {
    private favoritesOnlyMode: boolean = false;
    private currentChampionId: number | null = null;
    private currentSkins: SkinData[] = [];
    private selectedSkin: SkinData | null = null;
    private lockedIn: boolean = false;
    private focusedChampionId: number | null = null;
    private elements!: DOMElements;
    private qrGenerated: boolean = false;
    private showFavoritesOnly: boolean = false;
    private keyboardShortcutsEnabled: boolean = true;
    private displayedSkinCards: HTMLElement[] = [];

    constructor() {
        this.init();
    }

    private init(): void {
        this.cacheElements();
        this.hideQrForWeb();
        this.setupEventListeners();
        this.loadAutoPickState();
        this.loadFavoritesFilterState();
        this.updateAutoPickToggleState();
        this.updateFavoritesButtonState();
        void this.loadFavorites();
        this.setupKeyboardShortcuts();
        this.setupPreviewModal();
        this.startStatusMonitor();
    }

    private isElectronApp(): boolean {
        const win = window as WindowWithExtensions;
        return Boolean(win.electronAPI);
    }

    private hideQrForWeb(): void {
        if (this.isElectronApp()) return;
        const headerActions = document.querySelector('.header-actions');
        if (headerActions) {
            headerActions.remove();
        }
    }

    private async loadFavorites(): Promise<void> {
        const success = await FavoritesManager.loadFavorites();
        if (!success) {
            this.log('Failed to load favorites from server', 'warning');
        }
        this.updateAutoPickToggleState();
        if (this.currentSkins.length > 0) {
            this.renderSkins(this.currentSkins);
        }
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
            autoPickToggle: this.getElement('autoPickToggle') as HTMLInputElement,
            logContainer: this.getElement('logContainer'),
            showFavoritesBtn: document.getElementById('showFavoritesBtn') as HTMLButtonElement | null,
            previewModal: document.getElementById('skinPreviewModal'),
            previewImage: document.getElementById('previewImage') as HTMLImageElement | null,
            previewClose: document.getElementById('previewClose')
        };
    }

    private getElement<T extends HTMLElement>(id: string): T {
        const element = document.getElementById(id);
        if (!element) {
            throw new Error(`Element with id '${id}' not found`);
        }
        return element as T;
    }

    private loadAutoPickState(): void {
        const saved = localStorage.getItem('favoritesOnlyMode');
        if (saved === 'true') {
            this.favoritesOnlyMode = true;
            this.elements.autoPickToggle.checked = true;
        }
    }

    private loadFavoritesFilterState(): void {
        const saved = localStorage.getItem('showFavoritesOnly');
        if (saved === 'true') {
            this.showFavoritesOnly = true;
        }
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
        
        this.elements.autoPickToggle.addEventListener('change', () => {
            this.favoritesOnlyMode = this.elements.autoPickToggle.checked;
            localStorage.setItem('favoritesOnlyMode', this.favoritesOnlyMode.toString());
            this.log(this.favoritesOnlyMode ? 'Favorites-only mode enabled' : 'Favorites-only mode disabled', 'info');
        });

        // Favorites filter toggle
        if (this.elements.showFavoritesBtn) {
            this.elements.showFavoritesBtn.addEventListener('click', () => {
                this.showFavoritesOnly = !this.showFavoritesOnly;
                localStorage.setItem('showFavoritesOnly', this.showFavoritesOnly.toString());
                this.updateFavoritesButtonState();
                this.renderSkins(this.currentSkins);
                this.log(this.showFavoritesOnly ? 'Showing favorites only' : 'Showing all skins', 'info');
            });
        }

        // QR Code toggle (Electron only)
        if (this.isElectronApp()) {
            const toggleQrBtn = document.getElementById('toggleQrBtn') as HTMLButtonElement | null;
            const qrContainer = document.getElementById('qrContainer');
            if (toggleQrBtn && qrContainer) {
                toggleQrBtn.addEventListener('click', (event) => {
                    event.stopPropagation();
                    qrContainer.classList.toggle('hidden');
                    const isOpen = !qrContainer.classList.contains('hidden');
                    toggleQrBtn.classList.toggle('active', isOpen);
                    toggleQrBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
                    if (isOpen && !this.qrGenerated) {
                        this.generateQRCode();
                    }
                });

                document.addEventListener('click', (event) => {
                    const target = event.target as Node;
                    if (!qrContainer.classList.contains('hidden')
                        && !qrContainer.contains(target)
                        && !toggleQrBtn.contains(target)) {
                        qrContainer.classList.add('hidden');
                        toggleQrBtn.classList.remove('active');
                        toggleQrBtn.setAttribute('aria-expanded', 'false');
                    }
                });
            }
        }
    }

    private setupKeyboardShortcuts(): void {
        document.addEventListener('keydown', (e: KeyboardEvent) => {
            if (!this.keyboardShortcutsEnabled) return;
            
            // Check if input/textarea is focused
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
                return;
            }

            const key = parseInt(e.key, 10);
            
            // Check if key is a number 1-9
            if (!isNaN(key) && key >= 1 && key <= 9) {
                e.preventDefault();
                this.selectSkinByKeyboardShortcut(key);
            }
        });
    }

    private selectSkinByKeyboardShortcut(position: number): void {
        // Filter skins based on current display mode
        let skinsToUse = this.currentSkins;
        if (this.showFavoritesOnly && this.currentChampionId) {
            const favorites = FavoritesManager.getFavoriteSkinsForChampion(this.currentChampionId);
            skinsToUse = this.currentSkins.filter(skin => favorites.has(skin.id));
        }

        if (position > skinsToUse.length) {
            this.log(`Only ${skinsToUse.length} skins available`, 'warning');
            return;
        }

        const selectedSkin = skinsToUse[position - 1];
        if (selectedSkin) {
            if (selectedSkin.hasOwnedChromas) {
                this.showChromaSelection(selectedSkin);
                this.log(`Opened chromas for ${selectedSkin.name} (Press 1-9 to select chroma)`, 'info');
            } else {
                this.selectSkin(selectedSkin.id, selectedSkin.name);
            }
        }
    }

    private setupPreviewModal(): void {
        // Create modal if it doesn't exist
        if (!this.elements.previewModal) {
            const modal = document.createElement('div');
            modal.id = 'skinPreviewModal';
            modal.className = 'preview-modal hidden';
            modal.innerHTML = `
                <div class="preview-modal-content">
                    <button class="preview-close" id="previewClose">&times;</button>
                    <img id="previewImage" class="preview-image" alt="Skin preview">
                </div>
            `;
            document.body.appendChild(modal);
            
            // Recache elements
            this.elements.previewModal = modal;
            this.elements.previewImage = document.getElementById('previewImage') as HTMLImageElement;
            this.elements.previewClose = document.getElementById('previewClose');
        }

        // Setup event listeners
        if (this.elements.previewModal) {
            this.elements.previewModal.addEventListener('click', (e) => {
                if (e.target === this.elements.previewModal) {
                    this.closePreviewModal();
                }
            });
        }

        if (this.elements.previewClose) {
            this.elements.previewClose.addEventListener('click', () => this.closePreviewModal());
        }

        // Close on Escape key
        document.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Escape' && this.elements.previewModal && !this.elements.previewModal.classList.contains('hidden')) {
                this.closePreviewModal();
            }
        });
    }

    private openPreviewModal(imageUrl: string): void {
        if (!this.elements.previewModal || !this.elements.previewImage) return;
        
        this.elements.previewImage.src = imageUrl;
        this.elements.previewModal.classList.remove('hidden');
        this.keyboardShortcutsEnabled = false;
    }

    private closePreviewModal(): void {
        if (!this.elements.previewModal) return;
        
        this.elements.previewModal.classList.add('hidden');
        this.keyboardShortcutsEnabled = true;
    }

    private async updateStatus(): Promise<void> {
        try {
            const response = await fetch('/api/status');
            const data: StatusResponse = await response.json();

            if (data.connected) {
                this.elements.clientStatus.classList.remove('warning');
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
                    this.updateAutoPickToggleState();
                    
                    if (this.favoritesOnlyMode) {
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
                this.updateAutoPickToggleState();
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
            
            // Show skeleton loader while fetching
            this.showSkeletonLoader(6);
            
            const response = await fetch(`/api/skins/${this.currentChampionId}`);
            const data = await response.json() as SkinsResponse | ErrorResponse;

            if ('error' in data) {
                this.log(`Error: ${data.error}`, 'error');
                this.showToast(data.error, 'error');
                return;
            }

            if (!Array.isArray(data)) {
                this.log(`Error: Invalid skin data received`, 'error');
                this.showToast('Invalid skin data received', 'error');
                return;
            }

            const skins: SkinData[] = data;
            this.currentSkins = skins;
            this.renderSkins(skins);
            this.log(`Loaded ${skins.length} skins for champion ID ${this.currentChampionId}`, 'success');
        } catch (error) {
            this.log(`Failed to refresh skins: ${getErrorMessage(error)}`, 'error');
            this.showToast('Failed to refresh skins', 'error');
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

    private showSkeletonLoader(count: number = 6): void {
        this.elements.skinSelectionArea.style.display = 'block';
        this.elements.skinGrid.innerHTML = '';
        this.elements.skinGrid.className = 'skeleton-loader';

        for (let i = 0; i < count; i++) {
            const skeletonCard = document.createElement('div');
            skeletonCard.className = 'skeleton-card';
            skeletonCard.innerHTML = `
                <div class="skeleton-image"></div>
                <div class="skeleton-info">
                    <div class="skeleton-text"></div>
                    <div class="skeleton-text short"></div>
                </div>
            `;
            this.elements.skinGrid.appendChild(skeletonCard);
        }
    }

    private showToast(message: string, type: 'success' | 'error' | 'warning' = 'success', duration: number = 3000): void {
        const toast = document.createElement('div');
        toast.className = `toast-notification ${type}`;
        
        const icons = {
            success: '✅',
            error: '❌',
            warning: '⚠️'
        };
        
        toast.innerHTML = `
            <span class="toast-icon">${icons[type]}</span>
            <span>${message}</span>
        `;
        
        document.body.appendChild(toast);
        
        setTimeout(() => {
            toast.remove();
        }, duration);
    }

    private renderSkins(skins: SkinData[]): void {
        this.elements.skinSelectionArea.style.display = 'block';
        this.elements.skinGrid.innerHTML = '';
        this.elements.skinGrid.className = 'skin-grid'; // Reset from skeleton-loader
        this.displayedSkinCards = [];

        // Filter to favorites if enabled
        let skinsToDisplay = skins;
        if (this.showFavoritesOnly && this.currentChampionId) {
            const favorites = FavoritesManager.getFavoriteSkinsForChampion(this.currentChampionId);
            skinsToDisplay = skins.filter(skin => favorites.has(skin.id));
        }

        if (skinsToDisplay.length === 0) {
            const emptyMsg = document.createElement('p');
            emptyMsg.className = 'text-center';
            emptyMsg.style.gridColumn = '1 / -1';
            if (this.showFavoritesOnly) {
                emptyMsg.textContent = 'No favorite skins for this champion. Click the ⭐ icon to favorite skins!';
            } else {
                emptyMsg.textContent = 'No skins available for this champion';
            }
            this.elements.skinGrid.appendChild(emptyMsg);
            return;
        }

        skinsToDisplay.forEach((skin, index) => {
            const skinCard = document.createElement('div');
            skinCard.className = 'skin-card';
            
            // Add favorite button
            const favoriteBtn = document.createElement('button');
            favoriteBtn.className = 'favorite-btn';
            const isFavorited = this.currentChampionId ? FavoritesManager.isFavorited(this.currentChampionId, skin.id) : false;
            favoriteBtn.innerHTML = isFavorited ? '⭐' : '☆';
            favoriteBtn.title = isFavorited ? 'Remove from favorites' : 'Add to favorites';
            favoriteBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (this.currentChampionId) {
                    try {
                        const isNowFavorited = await FavoritesManager.toggleFavoriteAsync(this.currentChampionId, skin.id);
                        favoriteBtn.innerHTML = isNowFavorited ? '⭐' : '☆';
                        favoriteBtn.title = isNowFavorited ? 'Remove from favorites' : 'Add to favorites';
                        this.log(isNowFavorited ? `Added ${skin.name} to favorites` : `Removed ${skin.name} from favorites`, 'info');
                        this.showToast(isNowFavorited ? `Added ${skin.name} to favorites` : `Removed ${skin.name} from favorites`, 'success');
                        this.updateAutoPickToggleState();
                        if (this.showFavoritesOnly && !isNowFavorited) {
                            this.renderSkins(this.currentSkins);
                        }
                    } catch (error) {
                        this.log(`Failed to update favorite: ${getErrorMessage(error)}`, 'error');
                        this.showToast('Failed to update favorite', 'error');
                    }
                }
            });
            skinCard.appendChild(favoriteBtn);
            
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
                <div class="skin-shortcut">Press ${index + 1}</div>
            `;

            skinCard.appendChild(img);
            skinCard.appendChild(infoDiv);
            
            // Add keyboard shortcut number badge
            const shortcutBadge = document.createElement('div');
            shortcutBadge.className = 'keyboard-shortcut-badge';
            shortcutBadge.textContent = (index + 1).toString();
            skinCard.appendChild(shortcutBadge);
            
            // Add preview button in corner
            const previewBtn = document.createElement('button');
            previewBtn.className = 'preview-btn';
            previewBtn.title = 'Preview full image';
            previewBtn.innerHTML = '🔍';
            previewBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.openPreviewModal(skin.splashUrl || skin.loadingUrl);
            });
            skinCard.appendChild(previewBtn);
            
            // Click handler: if has chromas, show chroma selection; otherwise select skin directly
            skinCard.addEventListener('click', () => {
                if (skin.hasOwnedChromas) {
                    this.showChromaSelection(skin);
                } else {
                    this.selectSkin(skin.id, skin.name);
                }
            });
            
            this.elements.skinGrid.appendChild(skinCard);
            this.displayedSkinCards.push(skinCard);
        });
        
        // Update toggle state since favorites may have changed
        this.updateAutoPickToggleState();
    }

    private updateFavoritesButtonState(): void {
        if (!this.elements.showFavoritesBtn) return;
        this.elements.showFavoritesBtn.className = this.showFavoritesOnly 
            ? 'btn btn-secondary active' 
            : 'btn btn-secondary';
        this.elements.showFavoritesBtn.textContent = this.showFavoritesOnly 
            ? '⭐ Favorites Only' 
            : '☆ All Skins';
    }

    private updateAutoPickToggleState(): void {
        const hasFavorites = this.currentChampionId 
            ? FavoritesManager.getFavoriteSkinsForChampion(this.currentChampionId).size > 0 
            : false;
        
        this.elements.autoPickToggle.disabled = !hasFavorites;
        const toggleLabel = this.elements.autoPickToggle.closest('.checkbox-label') as HTMLElement | null;
        
        if (toggleLabel) {
            if (hasFavorites) {
                toggleLabel.style.opacity = '1';
                toggleLabel.style.cursor = 'pointer';
                toggleLabel.title = '';
            } else {
                toggleLabel.style.opacity = '0.5';
                toggleLabel.style.cursor = 'not-allowed';
                toggleLabel.title = 'Favorite some skins first to use auto-pick';
            }
        }
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
                this.showToast(`Failed to select skin: ${result.error}`, 'error');
            } else {
                const message = chromaId 
                    ? `Selected ${skinName} with chroma` 
                    : `Selected skin: ${skinName}`;
                this.log(message, 'success');
                this.showToast(message, 'success');
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

        // If favorites-only mode is enabled, pick from favorites only
        let skinsToPickFrom = this.currentSkins;
        if (this.favoritesOnlyMode) {
            const favorites = FavoritesManager.getFavoriteSkinsForChampion(this.currentChampionId);
            skinsToPickFrom = this.currentSkins.filter(skin => favorites.has(skin.id));
            
            if (skinsToPickFrom.length === 0) {
                this.log('No favorited skins to auto-pick', 'warning');
                return;
            }
        }

        const randomSkin = skinsToPickFrom[Math.floor(Math.random() * skinsToPickFrom.length)];
        if (!randomSkin) return;
        await this.selectSkin(randomSkin.id, randomSkin.name);
        this.showToast(`🎲 Randomly selected: ${randomSkin.name}`, 'success');
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
        entry.innerHTML = `[${timestamp}] ${message}`;
        
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

    if (win.electronAPI?.getAppVersion) {
        win.electronAPI.getAppVersion()
            .then((version) => {
                win.ui?.log(`Version ${version}`, 'info');
            })
            .catch((error) => {
                console.warn('Failed to get app version:', error);
            });
    }
    
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
        if (win.electronAPI.onPortableUpdateAvailable) {
            win.electronAPI.onPortableUpdateAvailable((info) => {
                win.ui?.log(
                    `🆕 Update v${info.latestVersion} available! <a href="#" onclick="window.electronAPI?.openReleasesPage(); return false;" style="color: #4fc3f7; text-decoration: underline;">Download from GitHub</a>`,
                    'warning'
                );
            });
        }
    }
});
