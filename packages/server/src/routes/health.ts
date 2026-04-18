import type { FastifyInstance } from "fastify";
import { SERVER_VERSION } from "../ws-hub.js";

const STARTED_AT = Date.now();

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/health", async () => {
    return {
      ok: true,
      version: SERVER_VERSION,
      uptime: Date.now() - STARTED_AT,
    };
  });
}
