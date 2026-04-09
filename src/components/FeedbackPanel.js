import React from 'react';
import './FeedbackPanel.css';

// Pitch clef icon
const PitchIcon = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 2c0 0 4 3 4 7s-4 7-4 7M10 2C10 2 6 5 6 9s4 7 4 7M10 2v16"/>
  </svg>
);

// Rhythm pulse icon
const RhythmIcon = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 10h3l2-6 3 12 2-8 2 4h4"/>
  </svg>
);

const severityConfig = {
  success: {
    border: '#bbffb3',
    iconColor: '#bbffb3',
    tag: 'Well done',
    tagColor: 'var(--tertiary)',
  },
  warning: {
    border: '#FCD34D',
    iconColor: '#FCD34D',
    tag: 'Needs work',
    tagColor: 'var(--caution)',
  },
  error: {
    border: '#ff716c',
    iconColor: '#ff716c',
    tag: 'Needs attention',
    tagColor: 'var(--error)',
  },
};

export default function FeedbackPanel({ feedback, stage }) {
  if (stage === 'analyzing') {
    return (
      <div className="feedback-panel">
        <div className="feedback-header">
          <h3 className="feedback-heading">Feedback</h3>
        </div>
        <div className="feedback-skeletons">
          {[1, 2, 3].map(i => (
            <div key={i} className="fb-skeleton" style={{ animationDelay: `${i * 0.1}s` }}>
              <div className="sk-line short" />
              <div className="sk-line" />
              <div className="sk-line mid" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="feedback-panel">
      <div className="feedback-header">
        <h3 className="feedback-heading">Feedback</h3>
        <span className="feedback-count">
          {feedback.filter(f => f.severity === 'success').length} positive ·{' '}
          {feedback.filter(f => f.severity !== 'success').length} to improve
        </span>
      </div>

      <div className="feedback-grid">
        {feedback.map((item, i) => {
          const c = severityConfig[item.severity] || severityConfig.warning;
          return (
            <div
              key={i}
              className="fb-card"
              style={{ '--left-color': c.border, animationDelay: `${i * 0.07}s` }}
            >
              <div className="fb-card-top">
                <div className="fb-icon" style={{ color: c.iconColor }}>
                  {item.type === 'pitch' ? <PitchIcon /> : <RhythmIcon />}
                </div>
                <div className="fb-titles">
                  <span className="fb-tag" style={{ color: c.tagColor }}>{c.tag}</span>
                  <h4 className="fb-title">{item.title}</h4>
                </div>
                <span className="fb-type-badge">{item.type}</span>
              </div>
              <p className="fb-detail">{item.detail}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
