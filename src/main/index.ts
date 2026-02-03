import { SkinSelectorServer, type ServerConfig, type ServerState } from "./server";

export type { ServerConfig, ServerState };

// Create and export server instance
export function startServer(options: ServerConfig = {}): Promise<ServerState> {
  const isDevelopment = process.env.NODE_ENV === "development";
  serverInstance = new SkinSelectorServer(isDevelopment);
  return serverInstance.start(options);
}

// Store server instance for cleanup
let serverInstance: SkinSelectorServer | null = null;

// Handle graceful shutdown
const shutdown = async (signal: string) => {
  console.log(`\n\n${signal} received. Shutting down gracefully...`);
  
  if (serverInstance) {
    try {
      await serverInstance.shutdown();
      console.log("Cleanup completed");
    } catch (error) {
      console.error("Error during shutdown:", error);
      process.exit(1);
    }
  }
  
  process.exit(0);
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

if (require.main === module) {
  startServer().catch((error) => {
    console.error("Failed to start server:", error);
    process.exit(1);
  });
}
