"""Standalone Ollama AI-worker voor Intento (T5.6).

Een aparte, deploybare applicatie die met een *worker-token* (T5.5, ADR-0010) verbinding maakt met de
Intento-backend, AI-jobs van de wachtrij ophaalt, ze tegen een **Ollama**-endpoint verwerkt en de
gestructureerde uitvoer (question/options/reason of message) terugstuurt. De worker is
backend-infrastructuur: de tablet-client praat nog steeds nooit rechtstreeks met de AI.

De worker is bewust **dependency-vrij** (alleen de Python-stdlib): dat maakt hem eenvoudig te deployen op
een losse GPU-machine en zijn tests draaien offline zonder een echte backend of Ollama.
"""

__all__ = ["__version__"]

__version__ = "0.1.0"
