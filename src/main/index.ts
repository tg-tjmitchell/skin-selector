import { SkinSelectorServer, type ServerConfig, type ServerState } from "./server";

export type { ServerConfig, ServerState };

// Create and export server instance
export function startServer(options: ServerConfig = {}): Promise<ServerState> {
  const isDevelopment = process.env.NODE_ENV === "development";
  const server = new SkinSelectorServer(isDevelopment);
  return server.start(options);
}

// Handle graceful shutdown
process.on("SIGINT", () => {
  console.log("\n\nShutting down...");
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("\n\nShutting down...");
  process.exit(0);
});

if (require.main === module) {
  startServer().catch((error) => {
    console.error("Failed to start server:", error);
    process.exit(1);
  });
}
