/// <reference types="vite/client" />

/** Getypeerde build-time env-variabelen (Vite). Zie `api.ts` voor `VITE_API_URL`. */
interface ImportMetaEnv {
  /** Basis-URL van de backend-API; standaard `http://localhost:3000` (zie `.env.example`). */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
