import {
  DEFAULT_SPEECH_VOICE,
  communicationProfileSchema,
  interactionModeSettingKeySchema,
  questionStrategySchema,
  toSpeechVoice,
  userPublicSchema,
  type CommunicationProfile,
  type UserPublic,
} from '@intento/shared';
import type { UserModel, UserCommunicationProfileModel } from '../generated/prisma/models.js';

/**
 * Serialisatie van een gebruiker naar de publieke, gevalideerde weergave. Gedeeld door de
 * gebruiker-routes en de device-routes, zodat een tablet exact dezelfde
 * gebruikersvorm (incl. communicatieprofiel) krijgt als de beheeromgeving.
 */

/** De standaardinstellingen die bij een nieuwe gebruiker horen (INTENTO-NEW-DESIGN §50). */
export const DEFAULT_PROFILE: CommunicationProfile = {
  interactionMode: 'binary',
  optionsPerScreen: 4,
  questionStrategy: 'general_to_specific',
  experienceEnabled: true,
  maxQuestions: 15,
  showText: true,
  speechEnabled: false,
  speechVoice: DEFAULT_SPEECH_VOICE,
};

/**
 * Het opgeslagen profiel als gevalideerd `CommunicationProfile`. Opgeslagen data wordt **gerepareerd**,
 * niet geweigerd: een waarde die (niet meer) geldig is valt terug op de standaard, zodat een profiel
 * nooit onleesbaar wordt en de tablet blijft werken. Invoer wordt op de API-grens wél hard geweigerd.
 */
export function profileFromModel(profile: UserCommunicationProfileModel): CommunicationProfile {
  const mode = interactionModeSettingKeySchema.safeParse(profile.interactionMode);
  const strategy = questionStrategySchema.safeParse(profile.questionStrategy);
  const shape = communicationProfileSchema.shape;
  const options = shape.optionsPerScreen.safeParse(profile.optionsPerScreen);
  const max = shape.maxQuestions.safeParse(profile.maxQuestions);
  return {
    interactionMode: mode.success ? mode.data : DEFAULT_PROFILE.interactionMode,
    optionsPerScreen: options.success ? options.data : DEFAULT_PROFILE.optionsPerScreen,
    questionStrategy: strategy.success ? strategy.data : DEFAULT_PROFILE.questionStrategy,
    experienceEnabled: profile.experienceEnabled,
    maxQuestions: max.success ? max.data : DEFAULT_PROFILE.maxQuestions,
    showText: profile.showText,
    speechEnabled: profile.speechEnabled,
    // Een stem die uit de catalogus verdwijnt (bv. omdat hij onverstaanbaar bleek) valt terug op de
    // standaardstem in plaats van de tablet onbruikbaar te maken.
    speechVoice: toSpeechVoice(profile.speechVoice),
  };
}

export type UserWithProfile = UserModel & {
  communicationProfile: UserCommunicationProfileModel | null;
};

/**
 * Mapt een gebruiker (met communicatieprofiel) naar de publieke weergave. Ontbreekt het profiel
 * onverhoopt, dan vallen we terug op de standaardwaarden zodat de client altijd een volledig,
 * gevalideerd profiel krijgt.
 */
export function userToPublic(user: UserWithProfile): UserPublic {
  const profile = user.communicationProfile;
  return userPublicSchema.parse({
    id: user.id,
    name: user.name,
    organizationId: user.organizationId,
    active: user.active,
    createdAt: user.createdAt.toISOString(),
    communicationProfile: profile ? profileFromModel(profile) : DEFAULT_PROFILE,
  });
}
