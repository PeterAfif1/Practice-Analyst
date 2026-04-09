import React from 'react';
import './MetricsPanel.css';

function letterGrade(val) {
  if (val == null) return null;
  if (val >= 93) return 'A';
  if (val >= 90) return 'A-';
  if (val >= 87) return 'B+';
  if (val >= 83) return 'B';
  if (val >= 80) return 'B-';
  if (val >= 77) return 'C+';
  if (val >= 73) return 'C';
  if (val >= 70) return 'C-';
  if (val >= 65) return 'D';
  return 'F';
}

function gradeColor(val) {
  if (val == null) return 'var(--outline-variant)';
  if (val >= 85) return 'var(--tertiary)';
  if (val >= 70) return 'var(--caution)';
  return 'var(--error)';
}

function gradeTrack(val) {
  if (val == null) return 'rgba(68,72,79,0.3)';
  if (val >= 85) return 'rgba(187,255,179,0.12)';
  if (val >= 70) return 'rgba(252,211,77,0.12)';
  return 'rgba(255,113,108,0.12)';
}

function ScoreRing({ value, label }) {
  const r     = 34;
  const circ  = 2 * Math.PI * r;
  const pct   = typeof value === 'number' ? value / 100 : 0;
  const color = gradeColor(value);
  const grade = letterGrade(value);

  return (
    <div className="ring-wrap">
      <svg viewBox="0 0 88 88" className="ring-svg">
        {/* Track */}
        <circle cx="44" cy="44" r={r} fill="none" stroke={gradeTrack(value)} strokeWidth="6" />
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
            <span className="ring-grade" style={{ color }}>{grade}</span>
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

export default function MetricsPanel({ metrics, isRecording, stage }) {
  return (
    <div className="metrics-panel">
      <div className="metrics-top">
        <h3 className="metrics-heading">Your Scores</h3>
        {isRecording && <span className="live-tag">Live</span>}
      </div>

      <div className="rings-row">
        <ScoreRing value={metrics?.pitchAccuracy} label="Pitch" />
        <ScoreRing value={metrics?.rhythmScore}   label="Rhythm" />
      </div>

      <div className="divider" />

      <div className="stats-list">
        <StatRow label="Tempo"          value={metrics?.tempo}          unit="BPM" />
        <StatRow label="Pitch deviation" value={metrics?.pitchDeviation} unit="cents"
          color={metrics?.pitchDeviation > 20 ? 'var(--caution)' : undefined} />
        <StatRow label="Notes detected"  value={metrics?.notesAnalyzed} />
        <StatRow label="Issues flagged"  value={metrics?.errorCount}
          color={metrics?.errorCount > 0 ? 'var(--danger)' : 'var(--success)'} />
      </div>

      {metrics && (
        <>
          <div className="divider" />
          <div className="confidence-block">
            <div className="confidence-row">
              <span className="stat-label">Model confidence</span>
              <span className="stat-val">{metrics.confidence}%</span>
            </div>
            <div className="conf-track">
              <div className="conf-fill" style={{
                width: `${metrics.confidence}%`,
                background: gradeColor(metrics.confidence)
              }} />
            </div>
          </div>
        </>
      )}

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
