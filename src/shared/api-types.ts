/**
 * Shared API types between client and server
 * Defines all request/response payloads for REST endpoints
 */

/**
 * Server info endpoint response
 */
export interface ServerInfoResponse {
  lanIp: string;
  port: number;
  url: string;
}

/**
 * QR code endpoint response
 */
export interface QRCodeResponse {
  qrCodeUrl: string;
}

/**
 * Ready check state
 */
export interface ReadyCheckState {
  state: string;
  playerResponse?: string;
}

/**
 * Status endpoint response
 */
export interface StatusResponse {
  connected: boolean;
  summoner?: string;
  inChampSelect?: boolean;
  selectedChampion?: string;
  selectedChampionId?: number | null;
  lockedIn?: boolean;
  readyCheck?: ReadyCheckState | null;
}

/**
 * Chroma data for skins
 */
export interface ChromaData {
  id: number;
  name: string;
  chromaPath?: string | undefined;
  colors: string[];
  owned: boolean;
  imageUrl: string;
  chromaNum: string | number;
}

/**
 * Skin data
 */
export interface SkinData {
  id: number;
  name: string;
  ownership: { owned: boolean };
  chromas: ChromaData[];
  hasOwnedChromas: boolean;
  loadingUrl: string;
}

/**
 * Skins endpoint response (array of SkinData)
 */
export type SkinsResponse = SkinData[];

/**
 * Select skin request payload
 */
export interface SelectSkinRequest {
  championId: number;
  skinId: number;
  chromaId?: number | null;
}

/**
 * Select skin response
 */
export interface SelectSkinResponse {
  success: boolean;
  message: string;
}

/**
 * Accept ready check response
 */
export interface AcceptReadyCheckResponse {
  success: boolean;
  message: string;
}

/**
 * Generic error response
 */
export interface ErrorResponse {
  error: string;
}

/**
 * API endpoint paths
 */
export const API_ENDPOINTS = {
  SERVER_INFO: "/api/server-info",
  QR_CODE: "/api/qr-code",
  STATUS: "/api/status",
  SKINS: (championId: number) => `/api/skins/${championId}`,
  SELECT_SKIN: "/api/select-skin",
  ACCEPT_READY_CHECK: "/api/accept-ready-check"
} as const;
