const BASE = 'http://localhost:4000';

export async function analyzeAudio(audioBlob, userId) {
  const form = new FormData();

  // 'audio' must match the field name multer expects in server.js (.single('audio'))
  form.append('audio', audioBlob, 'recording.webm');

  form.append('userId', userId);

  const res = await fetch(`${BASE}/analyze`, {
    method: 'POST',
    body: form,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Server error ${res.status}`);
  }

  const json = await res.json();
  return json.data;
}

export async function fetchHistory(userId) {
  const res = await fetch(`${BASE}/history/${userId}`);

  if (!res.ok) {
    console.error('Failed to load history');
    return []; // return empty array so the UI degrades gracefully
  }

  const json = await res.json();

  return (json.sessions || []).map((row, i) => {
    const conf = row.confidence || {};

    const pitchAccuracy = Math.round((conf.correct ?? 0.5) * 100);
    const rhythmScore   = Math.round(((conf.correct ?? 0.5) + (1 - (conf.off_rhythm ?? 0))) / 2 * 100);

    return {
      id:            row.id,
      date:          new Date(row.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      duration:      '—',
      instrument:    'RECORDING',
      pitchAccuracy,
      rhythmScore,
      tempo:         0,
      notesAnalyzed: 0,
      errors:        row.prediction !== 'correct' ? 1 : 0,
      notes:         `Prediction: ${row.prediction}`,
    };
  });
}

function _transformRow(row) {
  const conf = row.confidence || {};

  const pitchAccuracy = Math.round((conf.correct ?? 0.5) * 100);
  const rhythmScore = row.rhythm_score != null
    ? Math.round(row.rhythm_score * 100)
    : Math.round(((conf.correct ?? 0.5) + (1 - (conf.off_rhythm ?? 0))) / 2 * 100);

  let duration = '—';
  if (row.duration_seconds != null && row.duration_seconds > 0) {
    const m = Math.floor(row.duration_seconds / 60);
    const s = Math.round(row.duration_seconds % 60);
    duration = `${m}:${String(s).padStart(2, '0')}`;
  }

  return {
    id:            row.id,
    date:          new Date(row.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    duration,
    instrument:    'RECORDING',
    pitchAccuracy,
    rhythmScore,
    tempo:         row.bpm != null ? Math.round(row.bpm) : 0,
    notesAnalyzed: row.chunks_analyzed ?? 0,
    errors:        row.prediction !== 'correct' ? 1 : 0,
    notes:         `Prediction: ${row.prediction}`,
  };
}

export async function getSessions() {
  const res = await fetch(`${BASE}/api/sessions`);
  if (!res.ok) {
    console.error('getSessions failed:', res.status);
    return [];
  }
  const json = await res.json();
  return (json.sessions || []).map(_transformRow);
}

export async function getSession(id) {
  const res = await fetch(`${BASE}/api/sessions/${id}`);
  if (!res.ok) {
    console.error(`getSession(${id}) failed:`, res.status);
    return null;
  }
  const json = await res.json();
  return json.session ? _transformRow(json.session) : null;
}

export function connectWebSocket(userId, onResult) {
  const ws = new WebSocket(`ws://localhost:4000`);

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'register', userId }));
    console.log('🔌 WebSocket registered for', userId);
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);

      if (msg.type === 'analysis_complete') {
        onResult(msg.data);
      }
    } catch {
      // Ignore malformed messages
    }
  };

  ws.onerror = (e) => console.warn('WebSocket error:', e);

  return ws;
}

export function transformMLResult({ prediction, confidence = {}, tempo, avg_confidence, chunks_analyzed }) {
  return {
    rhythmScore:    Math.round((confidence.correct ?? 0) * 100),
    tempo:          tempo != null ? Math.round(tempo) : null,
    prediction,
    confidence:     avg_confidence != null ? Math.round(avg_confidence * 100) : Math.round((confidence.correct ?? 0) * 100),
    chunksAnalyzed: chunks_analyzed ?? null,
  };
}

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

  return map[prediction] ?? [
    { type: 'pitch', severity: 'error', title: 'Unrecognized result', detail: 'The model returned an unrecognized prediction label. No feedback available.' },
  ];
}
