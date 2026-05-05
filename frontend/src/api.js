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
    correct:    { severity: 'success', title: 'Steady rhythm',        detail: 'Your timing was consistent throughout.' },
    off_rhythm: { severity: 'error',   title: 'Timing inconsistency', detail: 'Focus on locking in with a metronome.' },
    rushed:     { severity: 'warning', title: "You're speeding up",   detail: "Focus on keeping the tempo steady — don't let it drift forward." },
    dragging:   { severity: 'warning', title: "You're slowing down",  detail: "Push to maintain the tempo — don't let it fall behind." },
  };

  const entry = map[prediction];
  if (!entry) {
    return [{ type: 'rhythm', severity: 'error', title: 'Unrecognized result', detail: 'The model returned an unrecognized prediction label.' }];
  }
  return [{ type: 'rhythm', ...entry }];
}
