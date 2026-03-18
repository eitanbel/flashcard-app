'use strict';

// ─── State ──────────────────────────────────────────────────────────────────
const state = {
  allCards: [],       // original deck
  deck: [],           // current session deck
  index: 0,
  flipped: false,
  correct: 0,
  incorrect: 0,
  answered: [],       // 'correct' | 'incorrect' | null per card
  wrongCards: [],
};

// ─── DOM refs ────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const screens = {
  upload:  $('screen-upload'),
  loading: $('screen-loading'),
  review:  $('screen-review'),
  results: $('screen-results'),
};

const dropZone      = $('drop-zone');
const fileInput     = $('file-input');
const btnGenerate   = $('btn-generate');
const uploadError   = $('upload-error');

const progressFill  = $('progress-fill');
const progressLabel = $('progress-label');
const scoreCorrect  = $('score-correct');
const scoreIncorrect= $('score-incorrect');

const flashcard     = $('flashcard');
const cardQuestion  = $('card-question');
const cardAnswer    = $('card-answer');
const actionButtons = $('action-buttons');

const btnCorrect    = $('btn-correct');
const btnIncorrect  = $('btn-incorrect');
const btnPrev       = $('btn-prev');
const btnNext       = $('btn-next');
const btnRestart    = $('btn-restart');

const finalCorrect  = $('final-correct');
const finalIncorrect= $('final-incorrect');
const finalTotal    = $('final-total');
const resultsEmoji  = $('results-emoji');
const resultsTitle  = $('results-title');
const resultsSub    = $('results-subtitle');
const btnRetryWrong = $('btn-retry-wrong');
const btnRestartAll = $('btn-restart-all');

// ─── Screen navigation ────────────────────────────────────────────────────────
function showScreen(name) {
  Object.entries(screens).forEach(([k, el]) => {
    el.classList.toggle('active', k === name);
  });
}

// ─── Upload logic ─────────────────────────────────────────────────────────────
let selectedFile = null;

function setFile(file) {
  if (!file || !file.name.toLowerCase().endsWith('.pdf')) {
    showError('Veuillez sélectionner un fichier PDF.');
    return;
  }
  selectedFile = file;
  dropZone.classList.add('has-file');
  dropZone.querySelector('.drop-icon').textContent = '✅';
  dropZone.querySelector('.drop-title').textContent = file.name;
  dropZone.querySelector('.drop-hint').textContent =
    `${(file.size / 1024).toFixed(0)} Ko`;
  btnGenerate.classList.remove('hidden');
  hideError();
}

function showError(msg) {
  uploadError.textContent = msg;
  uploadError.classList.remove('hidden');
}

function hideError() {
  uploadError.classList.add('hidden');
}

dropZone.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', () => {
  if (fileInput.files.length) setFile(fileInput.files[0]);
});

dropZone.addEventListener('dragover', e => {
  e.preventDefault();
  dropZone.classList.add('dragover');
});

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('dragover');
});

dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  if (e.dataTransfer.files.length) setFile(e.dataTransfer.files[0]);
});

btnGenerate.addEventListener('click', async () => {
  if (!selectedFile) return;

  showScreen('loading');

  const formData = new FormData();
  formData.append('pdf', selectedFile);

  try {
    const res = await fetch('/upload', { method: 'POST', body: formData });
    const data = await res.json();

    if (!res.ok || data.error) {
      showScreen('upload');
      showError(data.error || 'Erreur lors de la génération.');
      return;
    }

    startSession(data.flashcards);
  } catch {
    showScreen('upload');
    showError('Erreur réseau. Vérifie ta connexion et réessaie.');
  }
});

// ─── Session ──────────────────────────────────────────────────────────────────
function startSession(cards) {
  state.allCards  = cards;
  state.deck      = [...cards];
  state.index     = 0;
  state.flipped   = false;
  state.correct   = 0;
  state.incorrect = 0;
  state.answered  = new Array(cards.length).fill(null);
  state.wrongCards = [];

  scoreCorrect.textContent  = '0';
  scoreIncorrect.textContent= '0';

  showScreen('review');
  renderCard();
}

function renderCard() {
  const card = state.deck[state.index];

  // Reset flip
  flashcard.classList.remove('flipped');
  state.flipped = false;

  cardQuestion.textContent = card.question;
  cardAnswer.textContent   = card.answer;

  // Action buttons visible only if answered already (for navigation review)
  actionButtons.classList.add('hidden');

  updateProgress();
  updateNav();
}

function updateProgress() {
  const total   = state.deck.length;
  const current = state.index + 1;
  const answered = state.answered.filter(a => a !== null).length;

  progressFill.style.width = `${(answered / total) * 100}%`;
  progressLabel.textContent = `${current} / ${total}`;
}

function updateNav() {
  btnPrev.disabled = state.index === 0;
  btnNext.disabled = state.index === state.deck.length - 1;
}

// Card flip
flashcard.addEventListener('click', () => {
  flashcard.classList.toggle('flipped');
  state.flipped = !state.flipped;

  if (state.flipped && state.answered[state.index] === null) {
    actionButtons.classList.remove('hidden');
  }
});

// Mark correct
btnCorrect.addEventListener('click', () => {
  if (state.answered[state.index] !== null) return;
  state.answered[state.index] = 'correct';
  state.correct++;
  scoreCorrect.textContent = state.correct;
  actionButtons.classList.add('hidden');
  updateProgress();
  advanceOrFinish();
});

// Mark incorrect
btnIncorrect.addEventListener('click', () => {
  if (state.answered[state.index] !== null) return;
  state.answered[state.index] = 'incorrect';
  state.incorrect++;
  state.wrongCards.push(state.deck[state.index]);
  scoreIncorrect.textContent = state.incorrect;
  actionButtons.classList.add('hidden');
  updateProgress();
  advanceOrFinish();
});

function advanceOrFinish() {
  // Auto-advance if not last card
  if (state.index < state.deck.length - 1) {
    setTimeout(() => {
      state.index++;
      renderCard();
    }, 300);
  } else {
    // All answered?
    const unanswered = state.answered.filter(a => a === null).length;
    if (unanswered === 0) {
      setTimeout(showResults, 500);
    }
  }
}

// Manual navigation
btnPrev.addEventListener('click', () => {
  if (state.index > 0) { state.index--; renderCard(); }
});

btnNext.addEventListener('click', () => {
  if (state.index < state.deck.length - 1) { state.index++; renderCard(); }
});

// ─── Results ──────────────────────────────────────────────────────────────────
function showResults() {
  const total = state.deck.length;
  const pct   = Math.round((state.correct / total) * 100);

  finalCorrect.textContent  = state.correct;
  finalIncorrect.textContent= state.incorrect;
  finalTotal.textContent    = total;

  if (pct >= 80) {
    resultsEmoji.textContent = '🎉';
    resultsTitle.textContent = 'Excellent travail !';
  } else if (pct >= 50) {
    resultsEmoji.textContent = '💪';
    resultsTitle.textContent = 'Bien joué !';
  } else {
    resultsEmoji.textContent = '📚';
    resultsTitle.textContent = 'Continue tes révisions !';
  }

  resultsSub.textContent = `Tu as répondu correctement à ${pct}% des flashcards.`;

  btnRetryWrong.disabled = state.wrongCards.length === 0;

  showScreen('results');
}

// Retry wrong cards
btnRetryWrong.addEventListener('click', () => {
  if (state.wrongCards.length === 0) return;
  startSession(state.wrongCards);
});

// Full restart
btnRestartAll.addEventListener('click', resetUpload);
btnRestart.addEventListener('click', resetUpload);

function resetUpload() {
  selectedFile = null;
  fileInput.value = '';
  dropZone.classList.remove('has-file');
  dropZone.querySelector('.drop-icon').textContent = '📄';
  dropZone.querySelector('.drop-title').textContent = 'Glisse ton PDF ici';
  dropZone.querySelector('.drop-hint').textContent = 'ou clique pour sélectionner';
  btnGenerate.classList.add('hidden');
  hideError();
  showScreen('upload');
}
