import React, { useState } from 'react';
import './SessionHistory.css';

function ScorePill({ value }) {
  const good = value >= 85;
  const ok   = value >= 65;
  return (
    <span className={`score-pill ${good ? 'good' : ok ? 'ok' : 'low'}`}>
      {value}%
    </span>
  );
}

export default function SessionHistory({ sessions }) {
  const [selected, setSelected] = useState(null);

  return (
    <div className="history-page">
      <div className="history-hero">
        <h2 className="history-heading">Session History</h2>
        <p className="history-sub">Review past practice sessions and track your growth</p>
      </div>

      <div className="history-layout">
        {/* List */}
        <div className="sessions-list">
          {sessions.map((s, i) => (
            <button
              key={s.id}
              className={`session-row ${selected?.id === s.id ? 'selected' : ''}`}
              onClick={() => setSelected(s)}
              style={{ animationDelay: `${i * 0.04}s` }}
            >
              <div className="session-num">{sessions.length - i}</div>
              <div className="session-info">
                <span className="session-date">{s.date}</span>
                <span className="session-meta">{s.duration} · {s.instrument}</span>
              </div>
              <div className="session-scores">
                <ScorePill value={s.pitchAccuracy} />
                <ScorePill value={s.rhythmScore} />
              </div>
              <svg className="session-arrow" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M7 10h6M10 7l3 3-3 3" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          ))}
        </div>

        {/* Detail */}
        <div className="detail-pane">
          {selected ? (
            <div className="detail-card" key={selected.id}>
              <div className="detail-top">
                <div>
                  <h3 className="detail-date">{selected.date}</h3>
                  <span className="detail-duration">{selected.duration} session</span>
                </div>
                <span className="detail-instrument-tag">{selected.instrument}</span>
              </div>

              <div className="detail-scores">
                <ScoreBar label="Pitch Accuracy" value={selected.pitchAccuracy} />
                <ScoreBar label="Rhythm Score" value={selected.rhythmScore} />
              </div>

              <div className="detail-grid">
                <MetaItem label="Tempo" value={`${selected.tempo} BPM`} />
                <MetaItem label="Notes Detected" value={selected.notesAnalyzed} />
                <MetaItem label="Duration" value={selected.duration} />
                <MetaItem label="Issues Found" value={selected.errors} highlight={selected.errors > 0} />
              </div>

              {selected.notes && (
                <div className="detail-notes">
                  <p className="detail-notes-label">Session notes</p>
                  <p className="detail-notes-text">{selected.notes}</p>
                </div>
              )}
            </div>
          ) : (
            <div className="detail-empty">
              <div className="detail-empty-icon">
                <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <rect x="8" y="12" width="32" height="28" rx="4"/>
                  <path d="M16 12V10a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2"/>
                  <path d="M18 24h12M18 30h8"/>
                </svg>
              </div>
              <p className="detail-empty-title">Select a session</p>
              <p className="detail-empty-sub">Click any row to see the full breakdown</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ScoreBar({ label, value }) {
  const color = value >= 85 ? 'var(--tertiary)' : value >= 65 ? 'var(--caution)' : 'var(--error)';
  return (
    <div className="score-bar-item">
      <div className="score-bar-top">
        <span className="score-bar-label">{label}</span>
        <span className="score-bar-val" style={{ color }}>{value}%</span>
      </div>
      <div className="score-bar-track">
        <div className="score-bar-fill" style={{ width: `${value}%`, background: color }} />
      </div>
    </div>
  );
}

function MetaItem({ label, value, highlight }) {
  return (
    <div className="meta-item">
      <span className="meta-label">{label}</span>
      <span className="meta-value" style={highlight ? { color: 'var(--error)' } : {}}>{value}</span>
    </div>
  );
}
