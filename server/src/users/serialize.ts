import {
  DEFAULT_CONVERSATION_STRATEGY,
  DEFAULT_SPEECH_VOICE,
  toConversationStrategy,
  toSpeechVoice,
  userPublicSchema,
  type CommunicationProfile,
  type UserPublic,
} from '@intento/shared';
import type { UserModel, UserCommunicationProfileModel } from '../generated/prisma/models.js';

/**
 * Serialisatie van een gebruiker naar de publieke, gevalideerde weergave. Gedeeld door de
 * gebruiker-routes (T2.1) en de device-routes (T2.3), zodat een tablet exact dezelfde
 * gebruikersvorm (incl. communicatieprofiel) krijgt als de beheeromgeving.
 */

/** De standaardinstellingen die bij een nieuwe gebruiker horen (DESIGN §5.3). */
export const DEFAULT_PROFILE: CommunicationProfile = {
  iconsPerScreen: 4,
  showText: true,
  aiLearningEnabled: true,
  supportMode: false,
  contextIndicator: true,
  conversationStrategy: DEFAULT_CONVERSATION_STRATEGY,
  speechEnabled: false,
  speechVoice: DEFAULT_SPEECH_VOICE,
  speechHints: true,
};

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
    communicationProfile: profile
      ? {
          iconsPerScreen: profile.iconsPerScreen,
          showText: profile.showText,
          aiLearningEnabled: profile.aiLearningEnabled,
          supportMode: profile.supportMode,
          contextIndicator: profile.contextIndicator,
          // De sleutel komt als `String` uit de db en wordt genormaliseerd: een waarde die niet (meer)
          // in de registry staat valt terug op de standaard. Een verdwenen strategie mag een profiel
          // nooit onleesbaar maken — dan zou de gebruiker zijn tablet niet meer kunnen koppelen.
          conversationStrategy: toConversationStrategy(profile.conversationStrategy),
          speechEnabled: profile.speechEnabled,
          // Zelfde reparatie als bij de strategie: een stem die uit de catalogus verdwijnt (bv. omdat
          // hij onverstaanbaar bleek) mag het profiel niet onleesbaar maken — dan valt hij terug op de
          // standaardstem in plaats van de tablet onbruikbaar te maken.
          speechVoice: toSpeechVoice(profile.speechVoice),
          speechHints: profile.speechHints,
        }
      : DEFAULT_PROFILE,
  });
}
