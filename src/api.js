// api.js — all communication with the backend lives here.
// Centralizing API calls means if the backend URL or shape ever changes,
// we only need to update one file instead of hunting through the whole app.

// Base URL of the Express backend. Change this if deploying to a server.
const BASE = 'http://localhost:4000';

// ─── analyzeAudio ────────────────────────────────────────────────────────────
// Sends the recorded audio blob to the backend for ML analysis.
// Returns the raw ML result: { prediction, confidence, tempo }
//
// audioBlob  — the Blob from MediaRecorder (WebM, WAV, etc.)
// userId     — string identifying the user (stored in localStorage)
export async function analyzeAudio(audioBlob, userId) {
  // FormData lets us send a file (binary) alongside a text field in one request
  const form = new FormData();

  // 'audio' must match the field name multer expects in server.js (.single('audio'))
  form.append('audio', audioBlob, 'recording.webm');

  // userId is read from req.body on the server side
  form.append('userId', userId);

  const res = await fetch(`${BASE}/analyze`, {
    method: 'POST',
    body: form, // fetch sets the Content-Type to multipart/form-data automatically
  });

  if (!res.ok) {
    // Surface the server's error message if the request failed
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Server error ${res.status}`);
  }

  const json = await res.json();
  return json.data; // { prediction, confidence, tempo }
}

// ─── fetchHistory ─────────────────────────────────────────────────────────────
// Loads all past analysis sessions for a user from the database.
// Returns an array of session rows ready to display in SessionHistory.
//
// userId — string identifying the user
export async function fetchHistory(userId) {
  const res = await fetch(`${BASE}/history/${userId}`);

  if (!res.ok) {
    console.error('Failed to load history');
    return []; // return empty array so the UI degrades gracefully
  }

  const json = await res.json();

  // Transform each DB row into the shape SessionHistory component expects.
  // DB row: { id, user_id, prediction, confidence, audio_file, created_at }
  // Component expects: { id, date, instrument, pitchAccuracy, rhythmScore, tempo, notesAnalyzed, errors, notes }
  return (json.sessions || []).map((row, i) => {
    const conf = row.confidence || {};

    // Derive display scores from the ML confidence values
    const pitchAccuracy = Math.round((conf.correct ?? 0.5) * 100);
    const rhythmScore   = Math.round(((conf.correct ?? 0.5) + (1 - (conf.off_rhythm ?? 0))) / 2 * 100);

    return {
      id:            row.id,
      date:          new Date(row.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      duration:      '—',           // not tracked yet
      instrument:    'RECORDING',   // not tracked yet
      pitchAccuracy,
      rhythmScore,
      tempo:         0,             // not stored in DB yet (only in the HTTP response)
      notesAnalyzed: 0,
      errors:        row.prediction !== 'correct' ? 1 : 0,
      notes:         `Prediction: ${row.prediction}`,
    };
  });
}

// ─── connectWebSocket ─────────────────────────────────────────────────────────
// Opens a WebSocket connection to the backend and registers the userId.
// Calls onResult(data) whenever the backend pushes an 'analysis_complete' event.
// Returns the WebSocket instance so the caller can close it on cleanup.
//
// userId    — string identifying the user (must match what was sent in analyzeAudio)
// onResult  — callback: (mlData: { prediction, confidence, tempo }) => void
export function connectWebSocket(userId, onResult) {
  const ws = new WebSocket(`ws://localhost:4000`);

  // As soon as the connection is open, register this user so the backend
  // knows which socket to push results to after analysis completes.
  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'register', userId }));
    console.log('🔌 WebSocket registered for', userId);
  };

  // Handle incoming messages from the backend
  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);

      // 'analysis_complete' is sent by the backend right after Python finishes
      if (msg.type === 'analysis_complete') {
        onResult(msg.data); // pass { prediction, confidence, tempo } to the callback
      }
    } catch {
      // Ignore malformed messages
    }
  };

  ws.onerror = (e) => console.warn('WebSocket error:', e);

  // Return the socket so App.js can call ws.close() on component unmount
  return ws;
}

// ─── transformMLResult ────────────────────────────────────────────────────────
// Converts the raw ML output into the metrics shape the UI components expect.
// ML output: { prediction, confidence: { correct, flat, sharp, off_rhythm }, tempo }
// UI needs:  { pitchAccuracy, rhythmScore, tempo, pitchDeviation, notesAnalyzed, errorCount, confidence }
export function transformMLResult({ prediction, confidence = {}, tempo = 120 }) {
  const correct    = confidence.correct    ?? 0.5;
  const offRhythm  = confidence.off_rhythm ?? 0;

  return {
    pitchAccuracy:  Math.round(correct * 100),
    rhythmScore:    Math.round(((correct + (1 - offRhythm)) / 2) * 100),
    tempo:          Math.round(tempo),
    pitchDeviation: prediction === 'correct' ? 4 : prediction === 'flat' ? 22 : 18,
    notesAnalyzed:  48,  // placeholder until the ML model returns this
    errorCount:     prediction === 'correct' ? 0 : 2,
    confidence:     Math.round(correct * 100),
  };
}

// ─── generateFeedbackFromPrediction ───────────────────────────────────────────
// Returns a small set of feedback cards based on the ML prediction label.
// Keeps the familiar card UI working with real data.
export function generateFeedbackFromPrediction(prediction) {
  const map = {
    correct: [
      { type: 'pitch',  severity: 'success', title: 'Pitch on target',      detail: 'Your intonation was accurate throughout the session. Keep this up.' },
      { type: 'rhythm', severity: 'success', title: 'Steady rhythm',         detail: 'Timing was consistent. Your internal pulse is reliable.' },
    ],
    flat: [
      { type: 'pitch',  severity: 'error',   title: 'Playing flat',          detail: 'Notes were consistently below pitch. Try raising your air support and listening critically to each note.' },
      { type: 'rhythm', severity: 'success', title: 'Rhythm was steady',     detail: 'Good timing despite the pitch issue — focus on intonation next session.' },
    ],
    sharp: [
      { type: 'pitch',  severity: 'error',   title: 'Playing sharp',         detail: 'Notes are slightly above pitch. Relax your embouchure and focus on breath control.' },
      { type: 'rhythm', severity: 'success', title: 'Rhythm was steady',     detail: 'Timing was solid — direct your attention to pitch accuracy next.' },
    ],
    off_rhythm: [
      { type: 'rhythm', severity: 'error',   title: 'Timing issues detected', detail: 'Significant rhythmic variance found. Practice with a metronome at 70% tempo and build up gradually.' },
      { type: 'pitch',  severity: 'warning', title: 'Pitch was inconsistent', detail: 'Rushing or dragging can affect intonation. Stabilise your rhythm first, then revisit pitch.' },
    ],
  };

  return map[prediction] ?? map.correct;
}
