import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  approveConceptProposalRequestSchema,
  conceptProposalListResponseSchema,
  conceptProposalSchema,
  type ConceptProposal,
  type ConceptProposalListResponse,
} from '@intento/shared';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { ConceptProposalModel, AacSymbolModel } from '../generated/prisma/models.js';
import { HttpError } from '../errors.js';
import { authorize } from '../auth/authorize.js';
import { buildSearchText, normalizeSearch, symbolToPublic } from '../aac/library.js';
import { recordAudit } from '../audit/audit.js';
import { AUDIT_ACTIONS } from '../audit/actions.js';

export interface ConceptProposalRoutesDeps {
  prisma: PrismaClient;
}

/** Route-parameter: het voorstel-id uit het pad. */
const idParamsSchema = z.object({ id: z.string().min(1) });

/** Optioneel filter op de reviewlijst: alleen voorstellen met een bepaalde status. */
const listQuerySchema = z.object({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
});

/**
 * Serialiseert een voorstel (+ optioneel gekoppeld symbool) naar de publieke, zod-gevalideerde vorm.
 * Het gekoppelde pictogram wordt als `AacSymbolPublic` meegegeven, zodat de reviewlijst het meteen
 * kan tonen; `null` zolang niet gekoppeld.
 */
function proposalToPublic(
  proposal: ConceptProposalModel,
  linkedSymbol: AacSymbolModel | null,
): ConceptProposal {
  return conceptProposalSchema.parse({
    id: proposal.id,
    concept: proposal.concept,
    reason: proposal.reason,
    status: proposal.status,
    linkedSymbol: linkedSymbol ? symbolToPublic(linkedSymbol) : null,
    createdAt: proposal.createdAt.toISOString(),
    updatedAt: proposal.updatedAt.toISOString(),
  });
}

/** Haalt (best-effort) de gekoppelde symbolen op voor een set voorstellen, in één query. */
async function loadLinkedSymbols(
  prisma: PrismaClient,
  proposals: ConceptProposalModel[],
): Promise<Map<string, AacSymbolModel>> {
  const ids = proposals
    .map((p) => p.linkedSymbolId)
    .filter((id): id is string => typeof id === 'string');
  if (ids.length === 0) return new Map();
  const symbols = await prisma.aacSymbol.findMany({ where: { id: { in: ids } } });
  return new Map(symbols.map((s) => [s.id, s]));
}

/**
 * AI-conceptvoorstellen: reviewlijst en beoordeling (T7.3, DESIGN §5.2, §6.2, §7.6, FR-016).
 *
 * De validatielaag (T5.2, `ai/validation.ts`) legt een `ConceptProposal` vast telkens als de AI een
 * begrip aandraagt dat niet in de AAC-bibliotheek bestaat: de optie **bereikt de gebruiker nooit** en
 * het begrip belandt hier ter beoordeling. Deze routes zijn de beheerkant:
 *
 * - `GET  /admin/concept-proposals` — reviewlijst (openstaande eerst).
 * - `POST /admin/concept-proposals/:id/approve` — koppel het begrip aan een bestaand pictogram: het
 *   concept wordt als **synoniem** aan dat pictogram toegevoegd, zodat de validatielaag het voortaan
 *   herkent en de AI het mag aanbieden (FR-016: "pas na goedkeuring beschikbaar voor de AI").
 * - `POST /admin/concept-proposals/:id/reject` — afwijzen; het begrip blijft buiten de begrenzing.
 *
 * Net als het AAC-beheer (DESIGN §5.2) zijn voorstellen **platformbreed gedeeld** (de bibliotheek is
 * niet tenant-gefilterd); rolcontrole (ADMIN) volstaat.
 */
export function registerConceptProposalRoutes(
  app: FastifyInstance,
  { prisma }: ConceptProposalRoutesDeps,
): void {
  const preHandler = authorize(prisma, { roles: ['ADMIN'] });

  // Reviewlijst — openstaande (PENDING) eerst, daarna op recentheid.
  app.get(
    '/admin/concept-proposals',
    { preHandler },
    async (request): Promise<ConceptProposalListResponse> => {
      const { status } = listQuerySchema.parse(request.query);
      const proposals = await prisma.conceptProposal.findMany({
        where: status ? { status } : {},
        orderBy: { createdAt: 'desc' },
      });
      // PENDING bovenaan (belangrijkst voor de reviewer), daarna de rest op recentheid.
      const rank = (s: string): number => (s === 'PENDING' ? 0 : 1);
      proposals.sort((a, b) => rank(a.status) - rank(b.status));

      const linked = await loadLinkedSymbols(prisma, proposals);
      return conceptProposalListResponseSchema.parse({
        proposals: proposals.map((p) =>
          proposalToPublic(p, p.linkedSymbolId ? (linked.get(p.linkedSymbolId) ?? null) : null),
        ),
      });
    },
  );

  // Goedkeuren — koppel aan een bestaand pictogram en voeg het concept als synoniem toe.
  app.post(
    '/admin/concept-proposals/:id/approve',
    { preHandler },
    async (request): Promise<ConceptProposal> => {
      const { id } = idParamsSchema.parse(request.params);
      const { symbolId } = approveConceptProposalRequestSchema.parse(request.body);

      const proposal = await prisma.conceptProposal.findUnique({ where: { id } });
      if (!proposal)
        throw new HttpError(404, 'PROPOSAL_NOT_FOUND', 'Conceptvoorstel bestaat niet.');
      if (proposal.status === 'APPROVED') {
        throw new HttpError(409, 'PROPOSAL_ALREADY_HANDLED', 'Dit voorstel is al goedgekeurd.');
      }

      const symbol = await prisma.aacSymbol.findUnique({ where: { id: symbolId } });
      if (!symbol) throw new HttpError(404, 'SYMBOL_NOT_FOUND', 'Pictogram bestaat niet.');

      // Voeg het voorgestelde begrip als synoniem toe (idempotent, genormaliseerd ontdubbeld), zodat de
      // validatielaag (T5.2) het concept voortaan naar dit pictogram resolvet en de AI het mag aanbieden.
      const existing = Array.isArray(symbol.synonyms)
        ? symbol.synonyms.filter((s): s is string => typeof s === 'string')
        : [];
      const already = existing.some((s) => normalizeSearch(s) === proposal.concept);
      const synonyms = already ? existing : [...existing, proposal.concept];

      const updatedSymbol = await prisma.aacSymbol.update({
        where: { id: symbolId },
        data: {
          synonyms,
          searchText: buildSearchText({ concept: symbol.concept, label: symbol.label, synonyms }),
        },
      });

      const updated = await prisma.conceptProposal.update({
        where: { id },
        data: { status: 'APPROVED', linkedSymbolId: symbolId },
      });

      // Platformbrede AAC-beheeractie (voorstellen zijn niet tenant-gefilterd): auditen zonder tenant.
      await recordAudit(prisma, request, {
        action: AUDIT_ACTIONS.CONCEPT_PROPOSAL_APPROVE,
        organizationId: null,
        targetType: 'conceptProposal',
        targetId: id,
        metadata: { concept: proposal.concept, symbolId },
      });

      return proposalToPublic(updated, updatedSymbol);
    },
  );

  // Afwijzen — het begrip blijft buiten de AAC-begrenzing; de AI kan het niet aanbieden.
  app.post(
    '/admin/concept-proposals/:id/reject',
    { preHandler },
    async (request): Promise<ConceptProposal> => {
      const { id } = idParamsSchema.parse(request.params);

      const proposal = await prisma.conceptProposal.findUnique({ where: { id } });
      if (!proposal)
        throw new HttpError(404, 'PROPOSAL_NOT_FOUND', 'Conceptvoorstel bestaat niet.');
      if (proposal.status === 'APPROVED') {
        throw new HttpError(
          409,
          'PROPOSAL_ALREADY_HANDLED',
          'Een goedgekeurd voorstel kan niet worden afgewezen.',
        );
      }

      const updated = await prisma.conceptProposal.update({
        where: { id },
        data: { status: 'REJECTED', linkedSymbolId: null },
      });

      await recordAudit(prisma, request, {
        action: AUDIT_ACTIONS.CONCEPT_PROPOSAL_REJECT,
        organizationId: null,
        targetType: 'conceptProposal',
        targetId: id,
        metadata: { concept: proposal.concept },
      });

      return proposalToPublic(updated, null);
    },
  );
}
