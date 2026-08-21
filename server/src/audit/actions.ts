/**
 * Stabiele, machine-leesbare actiesleutels voor de audit-log (T8.2, DESIGN §9.4).
 *
 * Eén centrale bron zodat de sleutels consistent blijven (namespace.werkwoord) en niet als
 * losse string-literals door de routes zwerven. Uitsluitend **gevoelige** acties (login,
 * instellingen, context, export/import, beheer) worden geaudit — nooit communicatie-inhoud.
 */
export const AUDIT_ACTIONS = {
  // Auth (T1.1/T1.3/T1.4)
  AUTH_LOGIN: 'auth.login',
  AUTH_LOGOUT: 'auth.logout',
  AUTH_REGISTER: 'auth.register',
  AUTH_EMAIL_VERIFIED: 'auth.email_verified',
  // Accountbeheer binnen de organisatie (T2.4)
  ACCOUNT_CREATE: 'account.create',
  // Gebruikersbeheer + instellingen (T2.1)
  USER_CREATE: 'user.create',
  USER_DELETE: 'user.delete',
  USER_SETTINGS_UPDATE: 'user.settings.update',
  // Begeleider-koppelingen (T2.2)
  CAREGIVER_LINK: 'caregiver.link',
  CAREGIVER_UNLINK: 'caregiver.unlink',
  // Tabletkoppeling (T2.3)
  DEVICE_CODE_CREATE: 'device.code.create',
  // Persoonlijke context (T6.1)
  CONTEXT_CREATE: 'context.create',
  CONTEXT_UPDATE: 'context.update',
  CONTEXT_DELETE: 'context.delete',
  // Profielexport/-import (T8.1)
  PROFILE_EXPORT: 'profile.export',
  PROFILE_IMPORT: 'profile.import',
  // Worker-tokens (T5.8)
  WORKER_TOKEN_CREATE: 'worker_token.create',
  WORKER_TOKEN_REVOKE: 'worker_token.revoke',
  // AI-conceptvoorstellen (T7.3)
  CONCEPT_PROPOSAL_APPROVE: 'concept_proposal.approve',
  CONCEPT_PROPOSAL_REJECT: 'concept_proposal.reject',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];
