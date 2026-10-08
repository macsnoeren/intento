#!/usr/bin/env bash
# Start de hele Intento-stack in Docker. Zie docker/README.md.
#
#   docker/start.sh              bouwen (alleen wat gewijzigd is) en starten, wachten tot alles gezond is
#   docker/start.sh --no-build   starten met de images die er al zijn
#   docker/start.sh --logs       na het starten de logs volgen (Ctrl+C stopt het volgen, niet de stack)
#
# Bij de eerste start maakt dit script `docker/.env.docker` uit het sjabloon en vult het de lege
# geheimen met verse willekeurige waarden. Het werkt vanuit elke map.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$DIR/.env.docker"
EXAMPLE_FILE="$DIR/.env.docker.example"
# Zonder deze vijf start de stack niet (compose eist de tokens, de backend de secrets).
SECRETS=(SIGNING_SECRET ENCRYPTION_KEY ASSET_URL_SECRET SPEECH_SERVICE_TOKEN AGENT_SERVICE_TOKEN)
# Volume met de database; de projectnaam `intento` staat vast in compose.yaml.
DB_VOLUME=intento_intento-db
# De eerste start downloadt stemmen en de afbeeldingen van de Vocabulary; dat kan even duren.
WAIT_TIMEOUT=900

build=1
follow_logs=0
for arg in "$@"; do
  case "$arg" in
    --no-build) build=0 ;;
    --logs) follow_logs=1 ;;
    -h | --help)
      sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Onbekende optie: $arg (zie --help)" >&2
      exit 2
      ;;
  esac
done

compose() {
  docker compose -f "$DIR/compose.yaml" --env-file "$ENV_FILE" "$@"
}

# Waarde van een variabele uit .env.docker (leeg als hij ontbreekt).
env_value() {
  sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1
}

random_hex() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    od -An -N32 -tx1 /dev/urandom | tr -d ' \n'
  fi
}

# --- Docker aanwezig? -----------------------------------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  echo "✗ Docker is niet geïnstalleerd. Zie https://docs.docker.com/engine/install/" >&2
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "✗ De Compose-plugin ontbreekt ('docker compose'). Installeer docker-compose-plugin." >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "✗ Docker draait niet, of deze gebruiker mag er niet bij (zit je in de groep 'docker'?)." >&2
  exit 1
fi

# --- Omgevingsbestand -----------------------------------------------------------------------------
if [ ! -f "$ENV_FILE" ]; then
  if [ -f "$DIR/../.env.docker" ]; then
    # Vóór deze opzet stond het bestand in de repo-root. Verplaatsen, niet opnieuw maken: met nieuwe
    # geheimen is wat al versleuteld in de database staat niet meer te lezen.
    mv "$DIR/../.env.docker" "$ENV_FILE"
    echo "▸ .env.docker uit de repo-root verplaatst naar docker/.env.docker."
  elif docker volume inspect "$DB_VOLUME" >/dev/null 2>&1; then
    echo "✗ docker/.env.docker ontbreekt, maar er staat al een database (volume $DB_VOLUME)." >&2
    echo "  Nieuwe geheimen zouden de versleutelde gegevens daarin onleesbaar maken." >&2
    echo "  Zet je oude .env.docker terug in docker/, of begin echt opnieuw met: docker/stop.sh --wipe" >&2
    exit 1
  else
    cp "$EXAMPLE_FILE" "$ENV_FILE"
    echo "▸ docker/.env.docker aangemaakt uit het sjabloon."
  fi
fi
chmod 600 "$ENV_FILE"

# Lege geheimen vullen. Een leeg geheim heeft nooit gewerkt (de stack weigert dan te starten), dus er
# is geen bestaande data die erop leunt.
for name in "${SECRETS[@]}"; do
  if [ -z "$(env_value "$name")" ]; then
    value="$(random_hex)"
    if grep -q "^$name=" "$ENV_FILE"; then
      sed -i.bak "s/^$name=.*/$name=$value/" "$ENV_FILE" && rm -f "$ENV_FILE.bak"
    else
      printf '%s=%s\n' "$name" "$value" >>"$ENV_FILE"
    fi
    echo "▸ $name gegenereerd."
  fi
done

# --- Poorten vrij? --------------------------------------------------------------------------------
# Compose laat een variabele uit de shell voorgaan op .env.docker; hier dus ook.
server_port="${SERVER_PORT:-$(env_value SERVER_PORT)}"
server_port="${server_port:-3000}"
web_port="${WEB_PORT:-$(env_value WEB_PORT)}"
web_port="${web_port:-8080}"

port_in_use() {
  (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null
}

# Een poort van een dienst die al draait is van onszelf; alleen een vreemde bezetter is een probleem.
# Docker meldt dat pas halverwege, met een cryptische fout en een half gestarte stack.
running="$(compose ps --status running --services 2>/dev/null || true)"
for entry in "server:$server_port:SERVER_PORT" "web:$web_port:WEB_PORT"; do
  IFS=: read -r service port variable <<<"$entry"
  if ! grep -qx "$service" <<<"$running" && port_in_use "$port"; then
    echo "✗ Poort $port is al in gebruik door een ander programma." >&2
    echo "  Draait 'npm run dev' nog? Stop dat eerst (npm run stop), of kies in docker/.env.docker" >&2
    echo "  een andere $variable." >&2
    exit 1
  fi
done

# --- Starten --------------------------------------------------------------------------------------
up_args=(up -d --wait --wait-timeout "$WAIT_TIMEOUT")
if [ "$build" -eq 1 ]; then
  echo "▸ Images bouwen en de stack starten (de eerste keer duurt dit enkele minuten)…"
  up_args+=(--build)
else
  echo "▸ De stack starten…"
fi

if ! compose "${up_args[@]}"; then
  echo >&2
  echo "✗ Niet alles kwam gezond op. Status en de laatste logregels:" >&2
  compose ps -a >&2
  compose logs --tail 30 >&2
  exit 1
fi

echo
echo "✓ Intento draait."
echo "  Web-app:  http://localhost:$web_port"
echo "  API:      http://localhost:$server_port/health"
echo "  Stoppen:  docker/stop.sh"

if [ "$follow_logs" -eq 1 ]; then
  compose logs -f
fi
