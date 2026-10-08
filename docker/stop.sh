#!/usr/bin/env bash
# Stop de Intento-stack in Docker. Zie docker/README.md.
#
#   docker/stop.sh           containers stoppen en opruimen; database, afbeeldingen en stemmen blijven
#   docker/stop.sh --wipe    óók alle volumes wissen: database, afbeeldingen en stemmen zijn dan weg
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$DIR/.env.docker"

wipe=0
for arg in "$@"; do
  case "$arg" in
    --wipe) wipe=1 ;;
    -h | --help)
      sed -n '2,5p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Onbekende optie: $arg (zie --help)" >&2
      exit 2
      ;;
  esac
done

# `down` moet de compose-variabelen kunnen inlezen; zonder .env.docker vallen de verplichte tokens om.
# Dummywaarden zijn dan genoeg: er wordt niets gestart.
env_args=(--env-file "$ENV_FILE")
if [ ! -f "$ENV_FILE" ]; then
  env_args=()
  export AGENT_SERVICE_TOKEN=stoppen SPEECH_SERVICE_TOKEN=stoppen
fi

if [ "$wipe" -eq 1 ]; then
  echo "Dit wist de database (alle gebruikers, gesprekken en contacten), de afbeeldingen van de"
  echo "Vocabulary en de stemmodellen. Dat is niet terug te draaien."
  if [ ! -t 0 ]; then
    echo "✗ Geen terminal om te bevestigen; er is niets gewist." >&2
    exit 1
  fi
  read -r -p "Typ 'wissen' om door te gaan: " answer
  if [ "$answer" != "wissen" ]; then
    echo "Afgebroken; er is niets gewist."
    exit 1
  fi
  docker compose -f "$DIR/compose.yaml" "${env_args[@]}" down --volumes --remove-orphans
  echo "✓ Gestopt en gewist."
else
  docker compose -f "$DIR/compose.yaml" "${env_args[@]}" down --remove-orphans
  echo "✓ Gestopt. Database, afbeeldingen en stemmen staan nog in hun volumes."
fi
