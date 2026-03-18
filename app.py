import json
import os
import tempfile

import anthropic
import pdfplumber
from flask import Flask, jsonify, render_template, request

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 32 * 1024 * 1024  # 32 MB max

client = anthropic.Anthropic()


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/upload", methods=["POST"])
def upload():
    if "pdf" not in request.files:
        return jsonify({"error": "Aucun fichier fourni"}), 400

    file = request.files["pdf"]
    if not file.filename:
        return jsonify({"error": "Aucun fichier sélectionné"}), 400

    if not file.filename.lower().endswith(".pdf"):
        return jsonify({"error": "Le fichier doit être un PDF"}), 400

    with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
        file.save(tmp.name)
        tmp_path = tmp.name

    try:
        text = _extract_pdf_text(tmp_path)
        if not text.strip():
            return jsonify({"error": "Aucun texte trouvé dans le PDF"}), 400

        flashcards = _generate_flashcards(text)
        return jsonify({"flashcards": flashcards})
    except json.JSONDecodeError:
        return jsonify({"error": "Impossible de parser les flashcards générées"}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        os.unlink(tmp_path)


def _extract_pdf_text(path: str) -> str:
    pages = []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            page_text = page.extract_text()
            if page_text:
                pages.append(page_text)
    return "\n\n".join(pages)


def _generate_flashcards(text: str) -> list[dict]:
    # Truncate to avoid exceeding context limits
    if len(text) > 60_000:
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

    response = client.messages.create(
        model="claude-opus-4-6",
        max_tokens=4096,
        messages=[{"role": "user", "content": prompt}],
    )

    raw = response.content[0].text.strip()

    # Extract JSON array robustly
    start = raw.find("[")
    end = raw.rfind("]") + 1
    if start == -1 or end == 0:
        raise ValueError("Aucun tableau JSON trouvé dans la réponse")

    flashcards = json.loads(raw[start:end])

    # Validate structure
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
    app.run(debug=True)
