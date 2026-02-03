export interface LogLevel {
  debug: boolean;
  info: boolean;
  warn: boolean;
  error: boolean;
}

export class Logger {
  private levels: LogLevel;

  constructor(isDevelopment = false) {
    this.levels = {
      debug: isDevelopment,
      info: true,
      warn: true,
      error: true
    };
  }

  debug(message: string, ...args: unknown[]): void {
    if (this.levels.debug) {
      console.log(`[DEBUG] ${message}`, ...args);
    }
  }

  info(message: string, ...args: unknown[]): void {
    if (this.levels.info) {
      console.log(`[INFO] ${message}`, ...args);
    }
  }

  warn(message: string, ...args: unknown[]): void {
    if (this.levels.warn) {
      console.warn(`[WARN] ${message}`, ...args);
    }
  }

  error(message: string, ...args: unknown[]): void {
    if (this.levels.error) {
      console.error(`[ERROR] ${message}`, ...args);
    }
  }
}
