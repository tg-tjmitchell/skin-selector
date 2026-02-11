import { app, shell } from "electron";
import https from "https";
import path from "path";

const GITHUB_OWNER = "tg-tjmitchell";
const GITHUB_REPO = "skin-selector";
const RELEASES_URL = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  downloadUrl: string;
  isPortable: boolean;
}

/**
 * Detect if the app is running as a portable (zip) version vs installed (NSIS)
 * Portable apps typically run from a directory without proper installation markers
 */
export function isPortableVersion(): boolean {
  const exePath = app.getPath("exe");
  const exeDir = path.dirname(exePath);
  
  // Installed versions reside in Program Files directories, portable versions don't
  const isInProgramFiles = exeDir.toLowerCase().includes("program files");
  const isInLocalPrograms = exeDir.toLowerCase().includes("local\\programs");
  
  // NSIS installation creates an uninstaller file, portable versions don't
  const hasUninstaller = require("fs").existsSync(
    path.join(exeDir, "Uninstall League Skin Selector.exe")
  );
  
  return !isInProgramFiles && !isInLocalPrograms && !hasUninstaller;
}

/**
 * Check for updates using GitHub releases API (for portable version)
 */
export async function checkForPortableUpdate(): Promise<UpdateInfo> {
  const currentVersion = app.getVersion();
  const isPortable = isPortableVersion();
  
  return new Promise((resolve, reject) => {
    const apiUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;
    
    const options = {
      headers: {
        "User-Agent": `${GITHUB_REPO}/${currentVersion}`,
        "Accept": "application/vnd.github.v3+json"
      }
    };
    
    https.get(apiUrl, options, (res) => {
      let data = "";
      
      res.on("data", (chunk) => {
        data += chunk;
      });
      
      res.on("end", () => {
        try {
          if (res.statusCode !== 200) {
            reject(new Error(`GitHub API returned status ${res.statusCode}`));
            return;
          }
          
          const release = JSON.parse(data);
          const latestVersion = release.tag_name.replace(/^v/, "");
          
          const updateAvailable = compareVersions(latestVersion, currentVersion) > 0;
          
          resolve({
            currentVersion,
            latestVersion,
            updateAvailable,
            downloadUrl: RELEASES_URL,
            isPortable
          });
        } catch (err) {
          reject(err);
        }
      });
    }).on("error", reject);
  });
}

/**
 * Open the GitHub releases page in the default browser
 */
export function openReleasesPage(): void {
  shell.openExternal(RELEASES_URL);
}

/**
 * Compare two semver version strings
 * Returns: positive if a > b, negative if a < b, 0 if equal
 */
function compareVersions(a: string, b: string): number {
  const partsA = a.split(".").map(Number);
  const partsB = b.split(".").map(Number);
  
  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const partA = partsA[i] || 0;
    const partB = partsB[i] || 0;
    
    if (partA > partB) return 1;
    if (partA < partB) return -1;
  }
  
  return 0;
}
