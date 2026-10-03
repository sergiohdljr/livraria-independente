import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { AppError } from "./shared/errors.js";

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({ error: error.code });
    }
    if (isValidationError(error)) {
      return reply.code(400).send({ error: "invalid_request" });
    }
    request.log.error(error);
    return reply.code(500).send({ error: "internal_error" });
  });
}

export function requireInternalKey(internalApiKey: string) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (request.headers["x-internal-key"] !== internalApiKey) {
      await reply.code(401).send({ error: "unauthorized" });
    }
  };
}

function isValidationError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "validation" in error && Boolean(error.validation);
}
