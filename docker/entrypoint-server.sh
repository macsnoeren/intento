#!/bin/sh
# Entrypoint van de backend-container (T19.1).
#
# Migreren gebeurt hier en niet met de hand: een verse database (leeg volume) hoort vanzelf goed te
# komen, en een bestaande database hoort bij te zijn vóór de eerste request binnenkomt. `migrate
# deploy` past alleen bestaande migraties toe — hij bedenkt er nooit zelf een, dus dit is veilig in
# productie (CLAUDE.md kernprincipe 9).
set -eu

echo "▸ Migraties uitvoeren (prisma migrate deploy)…"
npx prisma migrate deploy

# Met een commando (bv. de klus `vocabulary-import` in compose) draait dat commando na de migratie;
# zonder commando de backend zelf.
if [ "$#" -gt 0 ]; then
  echo "▸ $*"
  exec "$@"
fi

echo "▸ Backend starten…"
exec node dist/server.js
