import {
  buildAiPrompt,
  buildMessagePrompt,
  type AiMessagePromptInput,
  type AiPromptInput,
} from './prompt.js';
import {
  aiMessageResultSchema,
  aiQuestionDecisionSchema,
  type AiMessagePrompt,
  type AiMessageResult,
  type AiPrompt,
  type AiProvider,
  type AiQuestionDecision,
} from './provider.js';

/**
 * AI-Orchestrator (T5.1, DESIGN §7.2, §9.2).
 *
 * De tussenlaag tussen de gespreksflow en de LLM-provider. Per aanroep stelt de orchestrator de
 * **beperkte context** samen (via `buildAiPrompt`), roept de provider aan en **valideert de uitvoer
 * opnieuw** met zod — een provider (en straks een externe worker, T5.5) wordt nooit vertrouwd. De
 * validatielaag die voorgestelde concepten tegen de AAC-bibliotheek toetst en de confidence-drempels
 * toepast, volgt in T5.2; de orchestrator dwingt hier alléén de **vorm** af.
 *
 * De orchestrator is bewust vrij van DB- en HTTP-afhankelijkheden: de aanroeper (de gespreksroute in
 * T5.2) laadt de gesprekscontext en de toegestane opties uit de AAC-boom en geeft ze mee. Zo is de
 * orchestrator volledig deterministisch te testen met de mock-provider.
 */
export class AiOrchestrator {
  constructor(private readonly provider: AiProvider) {}

  /** De actieve provider (voor logging/diagnose). */
  get providerName(): string {
    return this.provider.name;
  }

  /**
   * Stelt de beperkte prompt samen, laat de provider de volgende vraag kiezen en valideert de uitvoer.
   * Gooit als de provider een ongeldige vorm teruggeeft (zod-fout) — die bereikt de gebruiker nooit.
   */
  async selectNextQuestion(input: AiPromptInput): Promise<AiQuestionDecision> {
    const prompt: AiPrompt = buildAiPrompt(input);
    const raw = await this.provider.selectNextQuestion(prompt);
    return aiQuestionDecisionSchema.parse(raw);
  }

  /** Of de actieve provider een boodschap kan formuleren (T5.3). Zo niet: sjabloon-terugval. */
  get canGenerateMessage(): boolean {
    return typeof this.provider.generateMessage === 'function';
  }

  /**
   * Vormt met de provider een natuurlijke zin uit de bevestigde concepten (T5.3, §7.1 taak 4). Stelt de
   * beperkte prompt samen, roept de provider aan en valideert de **vorm** opnieuw met zod. Geeft `null`
   * terug als de provider deze taak niet ondersteunt — de conversatie-laag valt dan terug op de
   * deterministische sjabloon-zin. De **inhoudelijke** AAC-begrenzing (§7.8: geen concept buiten de
   * sessie) wordt door de conversatie-laag afgedwongen; de orchestrator blijft DB-vrij.
   */
  async generateMessage(input: AiMessagePromptInput): Promise<AiMessageResult | null> {
    if (!this.provider.generateMessage) return null;
    const prompt: AiMessagePrompt = buildMessagePrompt(input);
    const raw = await this.provider.generateMessage(prompt);
    return aiMessageResultSchema.parse(raw);
  }
}
