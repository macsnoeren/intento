import {
  DEFAULT_SPEECH_VOICE,
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
  showText: true,
  speechEnabled: false,
  speechVoice: DEFAULT_SPEECH_VOICE,
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
          showText: profile.showText,
          speechEnabled: profile.speechEnabled,
          // Een stem die uit de catalogus verdwijnt (bv. omdat hij onverstaanbaar bleek) mag het
          // profiel niet onleesbaar maken — dan valt hij terug op de standaardstem in plaats van de
          // tablet onbruikbaar te maken.
          speechVoice: toSpeechVoice(profile.speechVoice),
        }
      : DEFAULT_PROFILE,
  });
}
