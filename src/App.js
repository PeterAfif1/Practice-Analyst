import React, { useState, useEffect, useRef, useCallback } from 'react';
import './App.css';
import AudioVisualizer    from './components/AudioVisualizer';
import MetricsPanel       from './components/MetricsPanel';
import FeedbackPanel      from './components/FeedbackPanel';
import ProgressChart      from './components/ProgressChart';
import SessionHistory     from './components/SessionHistory';
import {
  analyzeAudio,
  fetchHistory,
  connectWebSocket,
  transformMLResult,
  generateFeedbackFromPrediction,
} from './api';

const NAV_ITEMS = [
  { key: 'dashboard', label: 'Dashboard',   icon: 'dashboard' },
  { key: 'practice',  label: 'Live Session', icon: 'mic_external_on' },
  { key: 'progress',  label: 'Analysis',     icon: 'analytics' },
  { key: 'history',   label: 'History',      icon: 'history' },
];

export default function App() {
  const [isRecording, setIsRecording]     = useState(false);
  const [sessionTime, setSessionTime]     = useState(0);
  const [metrics, setMetrics]             = useState(null);
  const [feedback, setFeedback]           = useState([]);
  const [audioData, setAudioData]         = useState(new Float32Array(256));
  const [activeTab, setActiveTab]         = useState('dashboard');
  const [analysisStage, setAnalysisStage] = useState('idle');
  const [analysisError, setAnalysisError] = useState(null);

  // ── userId ──────────────────────────────────────────────────────────────────
  // Persist a unique user ID in localStorage so history survives page refreshes.
  // On first visit, generate one; on return visits, reuse the stored one.
  const [userId] = useState(() => {
    const stored = localStorage.getItem('apa_userId');
    if (stored) return stored;
    const id = 'user_' + Date.now();
    localStorage.setItem('apa_userId', id);
    return id;
  });

  // ── Session history + progress data ─────────────────────────────────────────
  const [sessions,      setSessions]      = useState([]);
  const [progressData,  setProgressData]  = useState([]);

  // Load the user's past sessions from the backend whenever the userId is known.
  // This populates the History and Analysis tabs with real data.
  useEffect(() => {
    fetchHistory(userId).then(rows => {
      setSessions(rows);

      // Derive progress chart data from the loaded sessions.
      // Each session becomes one point on the chart: { session, pitchAccuracy, rhythmScore }
      const progress = rows.map((s, i) => ({
        session:       `S${i + 1}`,
        pitchAccuracy: s.pitchAccuracy,
        rhythmScore:   s.rhythmScore,
      }));
      setProgressData(progress);
    });
  }, [userId]);

  // ── WebSocket ────────────────────────────────────────────────────────────────
  // Connect once on mount so the backend can push real-time results to us.
  // The cleanup function closes the socket when the component unmounts.
  useEffect(() => {
    const ws = connectWebSocket(userId, (mlData) => {
      // This fires when the backend finishes ML analysis and pushes the result.
      // Update metrics and mark the stage as done so the UI renders the results.
      setMetrics(transformMLResult(mlData));
      setFeedback(generateFeedbackFromPrediction(mlData.prediction));
      setAnalysisStage('done');
    });
    return () => ws.close(); // cleanup on unmount
  }, [userId]);

  // ── Refs ─────────────────────────────────────────────────────────────────────
  const streamRef          = useRef(null);
  const animFrameRef       = useRef(null);
  const timerRef           = useRef(null);
  const audioChunksRef     = useRef([]);   // accumulates recorded audio chunks
  const mediaRecorderRef   = useRef(null); // holds the MediaRecorder instance

  // ── stopRecording ────────────────────────────────────────────────────────────
  // Stops the microphone, collects the recorded audio blob, and sends it
  // to the backend for ML analysis. Results come back via HTTP response.
  const stopRecording = useCallback(async () => {
    setIsRecording(false);
    setAnalysisStage('analyzing');

    // Stop all microphone tracks so the browser releases the mic
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }

    // Cancel the waveform animation and timers
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    if (timerRef.current)     clearInterval(timerRef.current);

    // Stop the MediaRecorder — this triggers the 'stop' event which fires
    // after all pending data chunks have been delivered to audioChunksRef.
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }

    // Wait a tick for the MediaRecorder 'stop' event to finish delivering chunks
    await new Promise(resolve => setTimeout(resolve, 200));

    // Combine all the recorded chunks into a single audio Blob
    const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });

    try {
      // POST the audio to the backend. The backend runs Python analysis,
      // saves to DB, and returns the ML result.
      // UI state (metrics, feedback, stage) is updated by the WebSocket handler below.
      await analyzeAudio(blob, userId);

      // Refresh the history list so the new session appears immediately
      fetchHistory(userId).then(rows => {
        setSessions(rows);
        setProgressData(rows.map((s, i) => ({
          session:       `S${i + 1}`,
          pitchAccuracy: s.pitchAccuracy,
          rhythmScore:   s.rhythmScore,
        })));
      });

    } catch (err) {
      console.error('Analysis failed:', err.message);
      setAnalysisError('Analysis failed — please try again.');
      setAnalysisStage('idle');
    }
  }, [userId]);

  // ── startRecording ───────────────────────────────────────────────────────────
  const startRecording = useCallback(async () => {
    setIsRecording(true);
    setAnalysisStage('listening');
    setAnalysisError(null);
    setSessionTime(0);
    setMetrics(null);
    setFeedback([]);
    audioChunksRef.current = []; // clear any previous recording chunks

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Set up the waveform visualiser
      const ctx      = new AudioContext();
      const source   = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const buf = new Float32Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getFloatTimeDomainData(buf);
        setAudioData(new Float32Array(buf));
        animFrameRef.current = requestAnimationFrame(tick);
      };
      animFrameRef.current = requestAnimationFrame(tick);

      // Set up MediaRecorder to capture the audio as a binary blob.
      // ondataavailable fires periodically; we collect the chunks.
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      recorder.start(250); // collect a chunk every 250ms

    } catch {
      setAnalysisError('Microphone access was denied. Please allow mic access and try again.');
      setIsRecording(false);
      return;
    }

    timerRef.current = setInterval(() => setSessionTime(s => s + 1), 1000);
  }, []);

  // ── Cleanup on unmount ───────────────────────────────────────────────────────
  useEffect(() => () => {
    if (streamRef.current)    streamRef.current.getTracks().forEach(t => t.stop());
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    if (timerRef.current)     clearInterval(timerRef.current);
  }, []);

  // ── Helpers ──────────────────────────────────────────────────────────────────
  const fmt = s => `${String(Math.floor(s / 60)).padStart(2,'0')}:${String(s % 60).padStart(2,'0')}`;

  const statusText = isRecording
    ? `REC — ${fmt(sessionTime)}`
    : analysisStage === 'analyzing' ? 'Analyzing…'
    : analysisStage === 'done'      ? 'Ready'
    : 'Ready';

  const tabTitles = {
    dashboard: 'Dashboard',
    practice:  'Live Session',
    progress:  'Analysis',
    history:   'History',
  };

  const vizTitle = isRecording
    ? 'Recording in progress'
    : analysisStage === 'analyzing' ? 'Analyzing your session'
    : analysisStage === 'done'      ? 'Session complete'
    : 'Start a session';

  const vizSub = isRecording
    ? `${sessionTime}s recorded`
    : analysisStage === 'analyzing' ? 'This will only take a moment'
    : analysisStage === 'done'      ? 'Your feedback is below'
    : 'Press the button and start playing';

  const showDashboard = activeTab === 'dashboard' || activeTab === 'practice';

  return (
    <div className="app">
      {/* ── Sidebar ── */}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="sidebar-logo">
            <svg viewBox="0 0 32 32" fill="none">
              <path d="M4 16 Q8 7 12 16 Q16 25 20 16 Q24 7 28 16"
                stroke="var(--primary)" strokeWidth="2.5" strokeLinecap="round" fill="none"/>
              <circle cx="16" cy="16" r="2.5" fill="var(--primary)"/>
            </svg>
          </div>
          <span className="sidebar-brand-name">Sonic Atelier</span>
        </div>

        <nav className="sidebar-nav">
          {NAV_ITEMS.map(({ key, label, icon }) => (
            <button
              key={key}
              className={`nav-item ${activeTab === key ? 'active' : ''}`}
              onClick={() => setActiveTab(key)}
            >
              <span className="material-symbols-outlined">{icon}</span>
              {label}
            </button>
          ))}
        </nav>

        <div className="sidebar-cta">
          <button
            className="btn-start-session"
            onClick={() => { setActiveTab('practice'); if (!isRecording && analysisStage !== 'analyzing') startRecording(); }}
          >
            <span className="material-symbols-outlined">add</span>
            Start Session
          </button>
        </div>

        <div className="sidebar-footer">
          <button className="sidebar-footer-link">
            <span className="material-symbols-outlined">settings</span>
            Settings
          </button>
          <button className="sidebar-footer-link">
            <span className="material-symbols-outlined">help_outline</span>
            Support
          </button>
        </div>
      </aside>

      {/* ── Top bar ── */}
      <header className="top-bar">
        <span className="top-bar-title">{tabTitles[activeTab]}</span>
        <div className="top-bar-right">
          <div className={`session-pill ${isRecording ? 'recording' : analysisStage === 'analyzing' ? 'analyzing' : ''}`}>
            {(isRecording || analysisStage === 'analyzing' || analysisStage === 'done') && (
              <span className={`session-dot ${analysisStage === 'analyzing' ? 'analyzing' : analysisStage === 'done' ? 'done' : ''}`} />
            )}
            {statusText}
          </div>
          <button className="top-bar-icon-btn" title="Live monitoring">
            <span className="material-symbols-outlined">sensors</span>
          </button>
          <button className="top-bar-icon-btn" title="Account">
            <span className="material-symbols-outlined">account_circle</span>
          </button>
        </div>
      </header>

      {/* ── Main ── */}
      <main className="app-main">
        {showDashboard && (
          <div className="dashboard-layout">
            <div className="bento-row">
              <section className="viz-section">
                <div className="viz-header">
                  <div>
                    <p className="viz-label">Current Session</p>
                    <h2 className="viz-title">{vizTitle}</h2>
                    <p className="viz-sub">{vizSub}</p>
                  </div>
                  {isRecording && (
                    <div className="rec-indicator">
                      <span className="rec-dot" /> REC
                    </div>
                  )}
                </div>

                <AudioVisualizer audioData={audioData} isRecording={isRecording} stage={analysisStage} />

                <div className="record-controls">
                  <div className={`record-btn-wrap ${isRecording ? 'is-recording' : ''}`}>
                    <div className="record-ring" />
                    <button
                      className={`record-btn ${isRecording ? 'stop' : ''}`}
                      onClick={isRecording ? stopRecording : startRecording}
                      disabled={analysisStage === 'analyzing'}
                      aria-label={isRecording ? 'Stop recording' : 'Start recording'}
                    >
                      {analysisStage === 'analyzing' ? (
                        <span className="btn-spinner" />
                      ) : isRecording ? (
                        <svg viewBox="0 0 24 24" fill="currentColor">
                          <rect x="5" y="5" width="14" height="14" rx="2"/>
                        </svg>
                      ) : (
                        <svg viewBox="0 0 24 24" fill="currentColor">
                          <circle cx="12" cy="12" r="7"/>
                        </svg>
                      )}
                    </button>
                  </div>
                  <span className={`record-label ${isRecording ? 'hot' : ''}`}>
                    {analysisStage === 'analyzing' ? 'Analyzing…'
                      : isRecording ? 'Stop recording'
                      : 'Start recording'}
                  </span>
                  {analysisError && (
                    <p style={{ color: '#f87171', fontSize: '0.8rem', marginTop: '0.5rem', textAlign: 'center' }}>
                      {analysisError}
                    </p>
                  )}
                </div>
              </section>

              <aside className="metrics-aside">
                <MetricsPanel metrics={metrics} isRecording={isRecording} stage={analysisStage} />
              </aside>
            </div>

            {(feedback.length > 0 || analysisStage === 'analyzing') && (
              <section className="feedback-section">
                <FeedbackPanel feedback={feedback} stage={analysisStage} />
              </section>
            )}
          </div>
        )}

        {activeTab === 'progress' && (
          <div className="tab-content"><ProgressChart data={progressData} /></div>
        )}

        {activeTab === 'history' && (
          <div className="tab-content"><SessionHistory sessions={sessions} /></div>
        )}
      </main>

      {/* ── Mobile bottom nav ── */}
      <nav className="mobile-bottom-nav">
        {NAV_ITEMS.map(({ key, label, icon }) =>
          key === 'practice' ? (
            <button
              key={key}
              className="mobile-nav-fab"
              onClick={() => { setActiveTab('practice'); if (!isRecording && analysisStage !== 'analyzing') startRecording(); }}
            >
              <span className="material-symbols-outlined">add</span>
            </button>
          ) : (
            <button
              key={key}
              className={`mobile-nav-btn ${activeTab === key ? 'active' : ''}`}
              onClick={() => setActiveTab(key)}
            >
              <span className="material-symbols-outlined">{icon}</span>
              {label}
            </button>
          )
        )}
      </nav>
    </div>
  );
}
