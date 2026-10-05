#!/usr/bin/env bash
# Kwaliteitschecks voor de Python-diensten (CLAUDE.md, Definition of Done).
#
#   npm run check:python   → ruff (lint + opmaak) en unittest voor agent-service en speech-service,
#                            plus mypy --strict voor agent-service
#   npm run audit:python   → pip-audit over de afhankelijkheden van beide diensten
#
# Eén ontwikkelomgeving: `agent-service/.venv`, met de agentdienst zelf (editable) en het gereedschap
# uit de `dev`-extra. De tests van de spraakdienst draaien met dezelfde interpreter: ze hebben Piper niet
# nodig (de import gebeurt pas bij een echte synthese).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AGENTS="$ROOT/agent-service"
SPEECH="$ROOT/speech-service"
VENV="$AGENTS/.venv"
PY="$VENV/bin/python"

ensure_venv() {
  if [ ! -x "$PY" ]; then
    echo "Python-omgeving ontbreekt; aanmaken in agent-service/.venv …"
    if ! python3 -m venv "$VENV" 2>/dev/null; then
      cat >&2 <<'EOF'
Kon geen venv met pip maken (ensurepip ontbreekt, bv. op Debian/Ubuntu zonder python3-venv).
Installeer python3-venv, of maak hem zonder pip en installeer pip met get-pip.py:
  python3 -m venv --without-pip agent-service/.venv
  curl -sSfL https://bootstrap.pypa.io/get-pip.py | agent-service/.venv/bin/python
EOF
      exit 1
    fi
  fi
  # Opnieuw installeren als pyproject.toml is gewijzigd sinds de vorige keer.
  local stamp="$VENV/.intento-installed"
  if [ ! -f "$stamp" ] || [ "$AGENTS/pyproject.toml" -nt "$stamp" ]; then
    "$PY" -m pip install -q -e "$AGENTS[dev]"
    touch "$stamp"
  fi
}

run_check() {
  ensure_venv
  echo "▶ ruff (agent-service, speech-service)"
  "$VENV/bin/ruff" check "$AGENTS" "$SPEECH"
  "$VENV/bin/ruff" format --check "$AGENTS" "$SPEECH"
  echo "▶ mypy --strict (agent-service)"
  (cd "$AGENTS" && "$VENV/bin/mypy")
  echo "▶ unittest (agent-service)"
  (cd "$AGENTS" && "$PY" -m unittest discover -s tests -t . -q)
  echo "▶ unittest (speech-service)"
  (cd "$SPEECH" && "$PY" -m unittest discover -s tests -t . -q)
  echo "✔ Python-checks groen"
}

run_audit() {
  ensure_venv
  echo "▶ pip-audit (agent-service + ontwikkelgereedschap)"
  # De omgeving zelf: pydantic en het dev-gereedschap. De agentdienst zelf staat niet op PyPI.
  "$VENV/bin/pip-audit" --progress-spinner off --skip-editable
  echo "▶ pip-audit (speech-service)"
  # De dependencies van de spraakdienst (Piper) komen in een eigen map, los van deze venv, en worden
  # daar gecontroleerd. pip-audit kan ze ook zelf oplossen, maar maakt daarvoor een tijdelijke venv —
  # en die lukt niet op een systeem zonder ensurepip.
  local deps="$SPEECH/.audit-deps"
  if [ ! -d "$deps" ] || [ "$SPEECH/pyproject.toml" -nt "$deps" ]; then
    rm -rf "$deps"
    "$PY" -m pip install -q --target "$deps" "$SPEECH"
    touch "$deps"
  fi
  "$VENV/bin/pip-audit" --progress-spinner off --path "$deps"
  echo "✔ geen bekende kwetsbaarheden"
}

case "${1:-}" in
  check) run_check ;;
  audit) run_audit ;;
  *)
    echo "Gebruik: $0 check|audit" >&2
    exit 2
    ;;
esac
