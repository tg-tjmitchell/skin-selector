/**
 * Log level configuration for controlling output of different log types.
 */
export interface LogLevel {
  debug: boolean;
  info: boolean;
  warn: boolean;
  error: boolean;
}

/**
 * Simple logger with configurable levels.
 * Debug logging is enabled only in development mode.
 */
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

  /**
   * Log a debug message (only in development mode).
   */
  debug(message: string, ...args: unknown[]): void {
    if (this.levels.debug) {
      console.log(`[DEBUG] ${message}`, ...args);
    }
  }

  /**
   * Log an info message.
   */
  info(message: string, ...args: unknown[]): void {
    if (this.levels.info) {
      console.log(`[INFO] ${message}`, ...args);
    }
  }

  /**
   * Log a warning message.
   */
  warn(message: string, ...args: unknown[]): void {
    if (this.levels.warn) {
      console.warn(`[WARN] ${message}`, ...args);
    }
  }

  /**
   * Log an error message.
   */
  error(message: string, ...args: unknown[]): void {
    if (this.levels.error) {
      console.error(`[ERROR] ${message}`, ...args);
    }
  }
}
