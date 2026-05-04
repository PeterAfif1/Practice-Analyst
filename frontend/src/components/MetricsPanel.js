import React from 'react';
import './MetricsPanel.css';

function ScoreRing({ value, label, prediction }) {
  const r     = 34;
  const circ  = 2 * Math.PI * r;
  const pct   = typeof value === 'number' ? value / 100 : 0;
  const color = prediction ? (PREDICTION_COLOR[prediction] ?? 'var(--outline-variant)') : 'var(--outline-variant)';
  const track = prediction ? (PREDICTION_TRACK[prediction] ?? 'rgba(68,72,79,0.3)')     : 'rgba(68,72,79,0.3)';
  const grade = prediction ?  PREDICTION_GRADE[prediction]                               : null;

  return (
    <div className="ring-wrap">
      <svg viewBox="0 0 88 88" className="ring-svg">
        {/* Track */}
        <circle cx="44" cy="44" r={r} fill="none" stroke={track} strokeWidth="6" />
        {/* Progress */}
        <circle cx="44" cy="44" r={r} fill="none"
          stroke={color} strokeWidth="6" strokeLinecap="round"
          strokeDasharray={`${pct * circ} ${(1 - pct) * circ}`}
          strokeDashoffset={circ / 4}
        />
      </svg>
      <div className="ring-center">
        {typeof value === 'number' ? (
          <>
            <span className="ring-grade" style={{ color }}>{grade ?? '—'}</span>
            <span className="ring-pct">{value}%</span>
          </>
        ) : (
          <span className="ring-empty">—</span>
        )}
      </div>
      <span className="ring-label">{label}</span>
    </div>
  );
}

function StatRow({ label, value, unit, color }) {
  return (
    <div className="stat-row">
      <span className="stat-label">{label}</span>
      <span className="stat-val" style={color ? { color } : {}}>
        {value ?? '—'}{unit && value != null && value !== '--' ? <span className="stat-unit"> {unit}</span> : null}
      </span>
    </div>
  );
}

const PREDICTION_GRADE = {
  correct:    'A',
  off_rhythm: 'C',
  rushed:     'D',
  dragging:   'D',
};

const PREDICTION_LABEL = {
  correct:    'Correct',
  off_rhythm: 'Off rhythm',
  rushed:     'Rushed',
  dragging:   'Dragging',
};

const PREDICTION_COLOR = {
  correct:    'var(--tertiary)',
  off_rhythm: 'var(--error)',
  rushed:     'var(--caution)',
  dragging:   'var(--caution)',
};

const PREDICTION_TRACK = {
  correct:    'rgba(187,255,179,0.12)',
  off_rhythm: 'rgba(255,113,108,0.12)',
  rushed:     'rgba(252,211,77,0.12)',
  dragging:   'rgba(252,211,77,0.12)',
};

export default function MetricsPanel({ metrics, isRecording, stage }) {
  return (
    <div className="metrics-panel">
      <div className="metrics-top">
        <h3 className="metrics-heading">Your Scores</h3>
        {isRecording && <span className="live-tag">Live</span>}
      </div>

      <div className="rings-row">
        <ScoreRing value={metrics?.rhythmScore} label="Rhythm" prediction={metrics?.prediction} />
      </div>

      <div className="divider" />

      <div className="stats-list">
        <StatRow label="Tempo"           value={metrics?.tempo}          unit="BPM" />
        <StatRow label="Prediction"
          value={metrics?.prediction ? (PREDICTION_LABEL[metrics.prediction] ?? metrics.prediction) : null}
          color={metrics?.prediction ? PREDICTION_COLOR[metrics.prediction] : undefined} />
        <StatRow label="Confidence"
          value={metrics?.confidence != null ? `${metrics.confidence}%` : null} />
        <StatRow label="Chunks analyzed" value={metrics?.chunksAnalyzed} />
      </div>

      {!metrics && (
        <div className="metrics-empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
            <path d="M9 18V5l12-2v13"/>
            <circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
          </svg>
          <p>{stage === 'idle' ? 'Record a session to see your scores' : 'Scores will appear here shortly'}</p>
        </div>
      )}
    </div>
  );
}
