#!/usr/bin/env bash
# Stopt alle draaiende processen van dit project: backend, web-app, spraakdienst en AI-worker.
#
# Waarom een script en geen `pkill -f intento`: dat patroon staat óók in de commandoregel waarmee je
# pkill aanroept, dus je schiet er je eigen shell mee af. En een simpele "kill alles met de projectmap
# als werkmap" is nog gevaarlijker — je editor, je terminals en je AI-assistent staan daar ook in.
#
# Daarom twee voorwaarden tegelijk: een proces moet (1) in deze repo draaien én (2) herkenbaar een van
# ónze processen zijn. Alles daarbuiten blijft met rust — Ollama (poort 11434) dus ook: dat is een
# losse dienst die je meestal juist wilt laten staan.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Wat we stoppen: een label + een patroon dat op de commandoregel moet passen (grep -E).
# De patronen zijn bewust strak: ze eisen het pad naar de binary of een letterlijk commando. Een losse
# `tsx` of `vite` zou namelijk ook passen op een terminal waarin iemand een `.tsx`-bestand bewerkt, en
# zo'n shell hoort hier niet gestopt te worden.
TARGETS=(
  "backend|node_modules/\.bin/tsx|tsx watch|tsx/dist/loader|src/server\.ts|dist/server\.js"
  "web-app|node_modules/\.bin/vite|-c vite( |$)|esbuild --service"
  "spraakdienst|speech_service"
  "AI-worker|ai_worker|ai-worker/run\.py|python3? \./run\.py"
  "dev-starter|node_modules/\.bin/concurrently"
)

# Processen die we nóóit mogen stoppen: onszelf en al onze voorouders (de shell, npm, de terminal,
# de editor). Zonder deze lijst stopt het script zichzelf halverwege.
protected=""
pid=$$
while [ -n "$pid" ] && [ "$pid" != "0" ] && [ "$pid" != "1" ]; do
  protected="$protected $pid"
  pid="$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ')"
done

is_protected() {
  case " $protected " in *" $1 "*) return 0 ;; *) return 1 ;; esac
}

# Draait dit proces ín deze repo? (werkmap onder de projectmap)
in_project() {
  local cwd
  cwd="$(readlink "/proc/$1/cwd" 2>/dev/null)" || return 1
  case "$cwd" in "$ROOT" | "$ROOT"/*) return 0 ;; *) return 1 ;; esac
}

cmdline_of() {
  tr '\0' ' ' <"/proc/$1/cmdline" 2>/dev/null
}

if [ ! -d /proc/self ]; then
  echo "Dit script leunt op /proc en werkt daardoor alleen op Linux." >&2
  echo "Stop de processen anders met: fuser -k -n tcp 3000 5173 5002" >&2
  exit 1
fi

found=0
declare -a stopped_pids=()

for target in "${TARGETS[@]}"; do
  label="${target%%|*}"
  pattern="${target#*|}"
  for dir in /proc/[0-9]*; do
    p="${dir#/proc/}"
    is_protected "$p" && continue
    in_project "$p" || continue
    cmd="$(cmdline_of "$p")"
    [ -n "$cmd" ] || continue
    printf '%s' "$cmd" | grep -Eq "$pattern" || continue
    # Kan intussen al gestopt zijn (bv. een kind van een proces dat we net stopten).
    kill -0 "$p" 2>/dev/null || continue
    printf 'stoppen: %-13s pid %-8s %s\n' "$label" "$p" "$(printf '%s' "$cmd" | cut -c1-70)"
    kill "$p" 2>/dev/null && stopped_pids+=("$p")
    found=1
  done
done

if [ "$found" -eq 0 ]; then
  echo "Er draaide niets van dit project. Ollama (indien actief) is met rust gelaten."
  exit 0
fi

# Even de tijd geven om netjes af te sluiten; wie dan nog leeft, krijgt SIGKILL.
for _ in 1 2 3 4 5 6 7 8 9 10; do
  alive=0
  for p in "${stopped_pids[@]}"; do
    kill -0 "$p" 2>/dev/null && alive=1
  done
  [ "$alive" -eq 0 ] && break
  sleep 0.5
done

for p in "${stopped_pids[@]}"; do
  if kill -0 "$p" 2>/dev/null; then
    echo "reageerde niet op SIGTERM, forceren: pid $p"
    kill -9 "$p" 2>/dev/null
  fi
done

echo "Klaar. Ollama is met rust gelaten (losse dienst, poort 11434)."
