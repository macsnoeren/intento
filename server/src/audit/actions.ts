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
  // Eigen wachtwoord wijzigen — nooit het wachtwoord zelf, alleen dát het gewijzigd is
  AUTH_PASSWORD_CHANGE: 'auth.password_change',
  // Accountbeheer binnen de organisatie
  ACCOUNT_CREATE: 'account.create',
  // Nieuw tijdelijk wachtwoord uitgegeven door een beheerder — nooit het wachtwoord zelf
  ACCOUNT_PASSWORD_RESET: 'account.password_reset',
  // Gebruikersbeheer + instellingen
  USER_CREATE: 'user.create',
  USER_DELETE: 'user.delete',
  USER_SETTINGS_UPDATE: 'user.settings.update',
  // Begeleider-koppelingen
  CAREGIVER_LINK: 'caregiver.link',
  CAREGIVER_UNLINK: 'caregiver.unlink',
  // Tabletkoppeling
  DEVICE_CODE_CREATE: 'device.code.create',
  // Profielexport/-import
  PROFILE_EXPORT: 'profile.export',
  PROFILE_IMPORT: 'profile.import',
  // Platform-operatorconsole — cross-tenant beheer, altijd met de operator als actor
  OPERATOR_ORGANIZATION_CREATE: 'operator.organization.create',
  OPERATOR_ORGANIZATION_DEACTIVATE: 'operator.organization.deactivate',
  OPERATOR_ORGANIZATION_ACTIVATE: 'operator.organization.activate',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];
