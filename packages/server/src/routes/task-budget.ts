import type { FastifyInstance } from "fastify";

import { getProject } from "../db.js";
import { budgetManager } from "../task-budget.js";

export async function registerTaskBudgetRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get<{ Params: { id: string } }>(
    "/api/projects/:id/task-budgets",
    async (req, reply) => {
      const proj = getProject(req.params.id);
      if (!proj) return reply.code(404).send({ error: "project_not_found" });
      return reply.send({ budgets: budgetManager.listActive(proj.id) });
    },
  );

  app.get<{ Params: { id: string; taskName: string } }>(
    "/api/projects/:id/task-budgets/:taskName",
    async (req, reply) => {
      const proj = getProject(req.params.id);
      if (!proj) return reply.code(404).send({ error: "project_not_found" });
      const state = budgetManager.getState(req.params.taskName);
      if (!state || state.projectId !== proj.id) {
        return reply.code(404).send({ error: "budget_not_found" });
      }
      return reply.send({ budget: state });
    },
  );
}
