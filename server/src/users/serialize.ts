import { userPublicSchema, type CommunicationProfile, type UserPublic } from '@intento/shared';
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
        }
      : DEFAULT_PROFILE,
  });
}
