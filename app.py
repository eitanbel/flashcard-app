import json
import logging
import os
import tempfile
import traceback

import anthropic
import pdfplumber
from flask import Flask, jsonify, render_template, request

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 32 * 1024 * 1024  # 32 MB max

logger.info("Initialisation du client Anthropic...")
client = anthropic.Anthropic()
logger.info("Client Anthropic initialisé.")


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/upload", methods=["POST"])
def upload():
    logger.info("Requête /upload reçue")

    if "pdf" not in request.files:
        logger.warning("Aucun fichier dans la requête")
        return jsonify({"error": "Aucun fichier fourni"}), 400

    file = request.files["pdf"]
    if not file.filename:
        logger.warning("Nom de fichier vide")
        return jsonify({"error": "Aucun fichier sélectionné"}), 400

    if not file.filename.lower().endswith(".pdf"):
        logger.warning("Fichier non-PDF : %s", file.filename)
        return jsonify({"error": "Le fichier doit être un PDF"}), 400

    logger.info("Sauvegarde du fichier temporaire : %s", file.filename)
    with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
        file.save(tmp.name)
        tmp_path = tmp.name

    try:
        logger.info("Extraction du texte PDF...")
        text = _extract_pdf_text(tmp_path)
        logger.info("Texte extrait : %d caractères", len(text))

        if not text.strip():
            logger.warning("Aucun texte trouvé dans le PDF")
            return jsonify({"error": "Aucun texte trouvé dans le PDF"}), 400

        logger.info("Génération des flashcards via Anthropic...")
        flashcards = _generate_flashcards(text)
        logger.info("Flashcards générées : %d", len(flashcards))

        return jsonify({"flashcards": flashcards})
    except json.JSONDecodeError as e:
        logger.error("Erreur JSON : %s", e)
        return jsonify({"error": "Impossible de parser les flashcards générées"}), 500
    except Exception as e:
        logger.error("Erreur inattendue : %s\n%s", e, traceback.format_exc())
        return jsonify({"error": str(e)}), 500
    finally:
        os.unlink(tmp_path)
        logger.info("Fichier temporaire supprimé")


def _extract_pdf_text(path: str) -> str:
    pages = []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            page_text = page.extract_text()
            if page_text:
                pages.append(page_text)
    return "\n\n".join(pages)


def _generate_flashcards(text: str) -> list[dict]:
    if len(text) > 60_000:
        logger.info("Texte tronqué de %d à 60000 caractères", len(text))
        text = text[:60_000]

    prompt = f"""Analyse le document suivant et crée entre 10 et 20 flashcards de révision de haute qualité.

Chaque flashcard doit :
- Avoir une question claire et précise au recto
- Avoir une réponse concise et exacte au verso
- Couvrir les concepts clés, définitions, faits ou relations importants du document
- Être autonome (compréhensible sans les autres cartes)
- Être en français si le document est en français, sinon dans la langue du document

Réponds UNIQUEMENT avec un tableau JSON, sans aucun autre texte, dans ce format exact :
[
  {{"question": "...", "answer": "..."}},
  ...
]

Contenu du document :
{text}"""

    logger.info("Appel API Anthropic (model=claude-opus-4-6, max_tokens=4096)...")
    response = client.messages.create(
        model="claude-opus-4-6",
        max_tokens=4096,
        messages=[{"role": "user", "content": prompt}],
        timeout=120,
    )
    logger.info("Réponse Anthropic reçue, stop_reason=%s", response.stop_reason)

    raw = response.content[0].text.strip()
    logger.info("Réponse brute (100 premiers chars) : %s", raw[:100])

    start = raw.find("[")
    end = raw.rfind("]") + 1
    if start == -1 or end == 0:
        logger.error("Pas de tableau JSON dans la réponse : %s", raw[:200])
        raise ValueError("Aucun tableau JSON trouvé dans la réponse")

    flashcards = json.loads(raw[start:end])

    validated = []
    for card in flashcards:
        if isinstance(card, dict) and "question" in card and "answer" in card:
            validated.append(
                {"question": str(card["question"]), "answer": str(card["answer"])}
            )

    if not validated:
        raise ValueError("Aucune flashcard valide générée")

    return validated


if __name__ == "__main__":
    app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 5000)), debug=False)
