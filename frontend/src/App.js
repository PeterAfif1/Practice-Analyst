import React, { useState, useEffect, useRef, useCallback } from "react";
import "./App.css";
import AudioVisualizer from "./components/AudioVisualizer";
import MetricsPanel from "./components/MetricsPanel";
import FeedbackPanel from "./components/FeedbackPanel";
import ProgressChart from "./components/ProgressChart";
import SessionHistory from "./components/SessionHistory";
import {
  analyzeAudio,
  fetchHistory,
  connectWebSocket,
  transformMLResult,
  generateFeedbackFromPrediction,
} from "./api";

const NAV_ITEMS = [
  { key: "dashboard", label: "Dashboard", icon: "dashboard" },
  { key: "practice", label: "Live Session", icon: "mic_external_on" },
  { key: "progress", label: "Analysis", icon: "analytics" },
  { key: "history", label: "History", icon: "history" },
];

export default function App() {
  const [isRecording, setIsRecording] = useState(false);
  const [sessionTime, setSessionTime] = useState(0);
  const [metrics, setMetrics] = useState(null);
  const [feedback, setFeedback] = useState([]);
  const audioDataRef = useRef(new Float32Array(256));
  const [activeTab, setActiveTab] = useState("dashboard");
  const [analysisStage, setAnalysisStage] = useState("idle");
  const [analysisError, setAnalysisError] = useState(null);

  const [userId] = useState(() => {
    const stored = localStorage.getItem("apa_userId");
    if (stored) return stored;
    const id = "user_" + Date.now();
    localStorage.setItem("apa_userId", id);
    return id;
  });

  const [sessions, setSessions] = useState([]);
  const [progressData, setProgressData] = useState([]);

  useEffect(() => {
    fetchHistory(userId).then((rows) => {
      setSessions(rows);

      const progress = rows.map((s, i) => ({
        session: `S${i + 1}`,
        pitchAccuracy: s.pitchAccuracy,
        rhythmScore: s.rhythmScore,
      }));
      setProgressData(progress);
    });
  }, [userId]);

  useEffect(() => {
    const ws = connectWebSocket(userId, (mlData) => {
      // Clear the timeout so the "timed out" error doesn't fire after results arrive.
      clearTimeout(analysisTimeoutRef.current);
      setMetrics(transformMLResult(mlData));
      setFeedback(generateFeedbackFromPrediction(mlData.prediction));
      setAnalysisStage("done");
    });
    return () => ws.close();
  }, [userId]);

  const streamRef = useRef(null);
  const animFrameRef = useRef(null);
  const timerRef = useRef(null);
  const audioChunksRef = useRef([]);
  const mediaRecorderRef = useRef(null);
  const analysisTimeoutRef = useRef(null);

  const stopRecording = useCallback(async () => {
    setIsRecording(false);
    setAnalysisStage("analyzing");

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    if (timerRef.current) clearInterval(timerRef.current);

    // Stop the MediaRecorder — this triggers the 'stop' event which fires
    // after all pending data chunks have been delivered to audioChunksRef.
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state !== "inactive"
    ) {
      mediaRecorderRef.current.stop();
    }

    // Wait a tick for the MediaRecorder 'stop' event to finish delivering chunks
    await new Promise((resolve) => setTimeout(resolve, 200));

    const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });

    try {
      await analyzeAudio(blob, userId);

      analysisTimeoutRef.current = setTimeout(() => {
        setAnalysisError("Analysis timed out. Please try again.");
        setAnalysisStage("idle");
      }, 30000);

      fetchHistory(userId).then((rows) => {
        setSessions(rows);
        setProgressData(
          rows.map((s, i) => ({
            session: `S${i + 1}`,
            pitchAccuracy: s.pitchAccuracy,
            rhythmScore: s.rhythmScore,
          })),
        );
      });
    } catch (err) {
      console.error("Analysis failed:", err.message);
      setAnalysisError("Analysis failed — please try again.");
      setAnalysisStage("idle");
    }
  }, [userId]);

  const startRecording = useCallback(async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setAnalysisError(
        "Microphone access requires a secure connection (HTTPS) or localhost.",
      );
      setIsRecording(false);
      return;
    }
    setIsRecording(true);
    setAnalysisStage("listening");
    setAnalysisError(null);
    setSessionTime(0);
    setMetrics(null);
    setFeedback([]);
    audioChunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const buf = new Float32Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getFloatTimeDomainData(buf);
        audioDataRef.current = new Float32Array(buf);
        animFrameRef.current = requestAnimationFrame(tick);
      };
      animFrameRef.current = requestAnimationFrame(tick);

      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      recorder.start(250); // collect a chunk every 250ms
    } catch {
      setAnalysisError(
        "Microphone access was denied. Please allow mic access and try again.",
      );
      setIsRecording(false);
      return;
    }

    timerRef.current = setInterval(() => setSessionTime((s) => s + 1), 1000);
  }, []);

  useEffect(
    () => () => {
      if (streamRef.current)
        streamRef.current.getTracks().forEach((t) => t.stop());
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
    },
    [],
  );

  const fmt = (s) =>
    `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  const statusText = isRecording
    ? `REC — ${fmt(sessionTime)}`
    : analysisStage === "analyzing"
      ? "Analyzing…"
      : analysisStage === "done"
        ? "Ready"
        : "Ready";

  const tabTitles = {
    dashboard: "Dashboard",
    practice: "Live Session",
    progress: "Analysis",
    history: "History",
  };

  const vizTitle = isRecording
    ? "Recording in progress"
    : analysisStage === "analyzing"
      ? "Analyzing your session"
      : analysisStage === "done"
        ? "Session complete"
        : "Start a session";

  const vizSub = isRecording
    ? `${sessionTime}s recorded`
    : analysisStage === "analyzing"
      ? "This will only take a moment"
      : analysisStage === "done"
        ? "Your feedback is below"
        : "Press the button and start playing";

  const showDashboard = activeTab === "dashboard" || activeTab === "practice";

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="sidebar-logo">
            <svg viewBox="0 0 32 32" fill="none">
              <path
                d="M4 16 Q8 7 12 16 Q16 25 20 16 Q24 7 28 16"
                stroke="var(--primary)"
                strokeWidth="2.5"
                strokeLinecap="round"
                fill="none"
              />
              <circle cx="16" cy="16" r="2.5" fill="var(--primary)" />
            </svg>
          </div>
          <span className="sidebar-brand-name">Backbeat AI</span>
        </div>

        <nav className="sidebar-nav">
          {NAV_ITEMS.map(({ key, label, icon }) => (
            <button
              key={key}
              className={`nav-item ${activeTab === key ? "active" : ""}`}
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
            onClick={() => {
              setActiveTab("practice");
              if (!isRecording && analysisStage !== "analyzing")
                startRecording();
            }}
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

      <header className="top-bar">
        <span className="top-bar-title">{tabTitles[activeTab]}</span>
        <div className="top-bar-right">
          <div
            className={`session-pill ${isRecording ? "recording" : analysisStage === "analyzing" ? "analyzing" : ""}`}
          >
            {(isRecording ||
              analysisStage === "analyzing" ||
              analysisStage === "done") && (
              <span
                className={`session-dot ${analysisStage === "analyzing" ? "analyzing" : analysisStage === "done" ? "done" : ""}`}
              />
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

                <AudioVisualizer
                  audioDataRef={audioDataRef}
                  isRecording={isRecording}
                  stage={analysisStage}
                />

                <div className="record-controls">
                  <div
                    className={`record-btn-wrap ${isRecording ? "is-recording" : ""}`}
                  >
                    <div className="record-ring" />
                    <button
                      className={`record-btn ${isRecording ? "stop" : ""}`}
                      onClick={isRecording ? stopRecording : startRecording}
                      disabled={analysisStage === "analyzing"}
                      aria-label={
                        isRecording ? "Stop recording" : "Start recording"
                      }
                    >
                      {analysisStage === "analyzing" ? (
                        <span className="btn-spinner" />
                      ) : isRecording ? (
                        <svg viewBox="0 0 24 24" fill="currentColor">
                          <rect x="5" y="5" width="14" height="14" rx="2" />
                        </svg>
                      ) : (
                        <svg viewBox="0 0 24 24" fill="currentColor">
                          <circle cx="12" cy="12" r="7" />
                        </svg>
                      )}
                    </button>
                  </div>
                  <span className={`record-label ${isRecording ? "hot" : ""}`}>
                    {analysisStage === "analyzing"
                      ? "Analyzing…"
                      : isRecording
                        ? "Stop recording"
                        : "Start recording"}
                  </span>
                  {analysisError && (
                    <p
                      style={{
                        color: "#f87171",
                        fontSize: "0.8rem",
                        marginTop: "0.5rem",
                        textAlign: "center",
                      }}
                    >
                      {analysisError}
                    </p>
                  )}
                </div>
              </section>

              <aside className="metrics-aside">
                <MetricsPanel
                  metrics={metrics}
                  isRecording={isRecording}
                  stage={analysisStage}
                />
              </aside>
            </div>

            {(feedback.length > 0 || analysisStage === "analyzing") && (
              <section className="feedback-section">
                <FeedbackPanel feedback={feedback} stage={analysisStage} />
              </section>
            )}
          </div>
        )}

        {activeTab === "progress" && (
          <div className="tab-content">
            <ProgressChart data={progressData} />
          </div>
        )}

        {activeTab === "history" && (
          <div className="tab-content">
            <SessionHistory />
          </div>
        )}
      </main>

      <nav className="mobile-bottom-nav">
        {NAV_ITEMS.map(({ key, label, icon }) =>
          key === "practice" ? (
            <button
              key={key}
              className="mobile-nav-fab"
              onClick={() => {
                setActiveTab("practice");
                if (!isRecording && analysisStage !== "analyzing")
                  startRecording();
              }}
            >
              <span className="material-symbols-outlined">add</span>
            </button>
          ) : (
            <button
              key={key}
              className={`mobile-nav-btn ${activeTab === key ? "active" : ""}`}
              onClick={() => setActiveTab(key)}
            >
              <span className="material-symbols-outlined">{icon}</span>
              {label}
            </button>
          ),
        )}
      </nav>
    </div>
  );
}
