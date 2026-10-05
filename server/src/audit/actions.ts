/**
 * Stabiele, machine-leesbare actiesleutels voor de audit-log (INTENTO-NEW-DESIGN §53).
 *
 * Eén centrale bron zodat de sleutels consistent blijven (namespace.werkwoord) en niet als
 * losse string-literals door de routes zwerven. Uitsluitend **gevoelige** acties (login,
 * instellingen, export/import, beheer) worden geaudit — nooit communicatie-inhoud.
 */
export const AUDIT_ACTIONS = {
  // Auth (T1.1/T1.3/T1.4)
  AUTH_LOGIN: 'auth.login',
  AUTH_LOGOUT: 'auth.logout',
  AUTH_REGISTER: 'auth.register',
  AUTH_EMAIL_VERIFIED: 'auth.email_verified',
  // Eigen wachtwoord wijzigen (T2.5) — nooit het wachtwoord zelf, alleen dát het gewijzigd is
  AUTH_PASSWORD_CHANGE: 'auth.password_change',
  // Accountbeheer binnen de organisatie (T2.4)
  ACCOUNT_CREATE: 'account.create',
  // Nieuw tijdelijk wachtwoord uitgegeven door een beheerder (T2.7) — nooit het wachtwoord zelf
  ACCOUNT_PASSWORD_RESET: 'account.password_reset',
  // Gebruikersbeheer + instellingen (T2.1)
  USER_CREATE: 'user.create',
  USER_DELETE: 'user.delete',
  USER_SETTINGS_UPDATE: 'user.settings.update',
  // Begeleider-koppelingen (T2.2)
  CAREGIVER_LINK: 'caregiver.link',
  CAREGIVER_UNLINK: 'caregiver.unlink',
  // Tabletkoppeling (T2.3)
  DEVICE_CODE_CREATE: 'device.code.create',
  // Profielexport/-import (T8.1)
  PROFILE_EXPORT: 'profile.export',
  PROFILE_IMPORT: 'profile.import',
  // Platform-operatorconsole (T8.3) — cross-tenant beheer, altijd met de operator als actor
  OPERATOR_ORGANIZATION_CREATE: 'operator.organization.create',
  OPERATOR_ORGANIZATION_DEACTIVATE: 'operator.organization.deactivate',
  OPERATOR_ORGANIZATION_ACTIVATE: 'operator.organization.activate',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];
