import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import type { ApiError } from '@intento/shared';

/**
 * Applicatiefout met een expliciete HTTP-status en een stabiele foutcode.
 * De centrale handler zet deze om naar de consistente foutstructuur uit DESIGN §8.1.
 */
export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

function toApiError(code: string, message: string): ApiError {
  return { error: { code, message } };
}

/**
 * Centrale foutafhandeling. Mapt bekende fouten naar nette responses:
 * - `ZodError` → 400 (validatie mislukt);
 * - `HttpError` → de eigen status/code;
 * - Fastify-validatiefouten → 400;
 * - overige/onbekende fouten → 500 zonder interne details te lekken.
 */
export function errorHandler(
  error: FastifyError | Error,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  if (error instanceof ZodError) {
    const message = error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    reply.status(400).send(toApiError('VALIDATION_ERROR', message));
    return;
  }

  if (error instanceof HttpError) {
    reply.status(error.statusCode).send(toApiError(error.code, error.message));
    return;
  }

  const fastifyError = error as FastifyError;
  if (fastifyError.validation) {
    reply.status(400).send(toApiError('VALIDATION_ERROR', fastifyError.message));
    return;
  }
  if (typeof fastifyError.statusCode === 'number' && fastifyError.statusCode < 500) {
    reply
      .status(fastifyError.statusCode)
      .send(toApiError(fastifyError.code ?? 'REQUEST_ERROR', fastifyError.message));
    return;
  }

  // Onbekende fout: loggen, maar geen interne details naar de client.
  request.log.error({ err: error }, 'Onverwachte serverfout');
  reply.status(500).send(toApiError('INTERNAL_ERROR', 'Er ging intern iets mis.'));
}

/** 404-handler in dezelfde consistente foutstructuur. */
export function notFoundHandler(request: FastifyRequest, reply: FastifyReply): void {
  reply
    .status(404)
    .send(toApiError('NOT_FOUND', `Route ${request.method} ${request.url} bestaat niet.`));
}
