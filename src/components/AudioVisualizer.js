import React, { useRef, useEffect } from 'react';
import './AudioVisualizer.css';

export default function AudioVisualizer({ audioDataRef, isRecording, stage }) {
  const canvasRef      = useRef(null);
  const isRecordingRef = useRef(isRecording);
  const stageRef       = useRef(stage);

  useEffect(() => { isRecordingRef.current = isRecording; }, [isRecording]);
  useEffect(() => { stageRef.current = stage; }, [stage]);

  useEffect(() => {
    let frame;

    const draw = () => {
      frame = requestAnimationFrame(draw);
      const canvas = canvasRef.current;
      if (!canvas) return;

      const ctx  = canvas.getContext('2d');
      const dpr  = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();

      // Resize only when dimensions actually change — avoids clearing mid-frame
      if (
        canvas.width  !== Math.round(rect.width  * dpr) ||
        canvas.height !== Math.round(rect.height * dpr)
      ) {
        canvas.width  = rect.width  * dpr;
        canvas.height = rect.height * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }

      const W   = rect.width;
      const H   = rect.height;
      const mid = H / 2;
      const isRec = isRecordingRef.current;
      const stg   = stageRef.current;
      const data  = audioDataRef.current;

      ctx.clearRect(0, 0, W, H);

      // Idle state: staff lines + dashed centre line
      if (!isRec && stg === 'idle') {
        const staffColor = 'rgba(255,255,255,0.04)';
        [0.2, 0.35, 0.5, 0.65, 0.8].forEach(p => {
          ctx.beginPath();
          ctx.strokeStyle = staffColor;
          ctx.lineWidth = 1;
          ctx.moveTo(0, H * p);
          ctx.lineTo(W, H * p);
          ctx.stroke();
        });

        ctx.beginPath();
        ctx.strokeStyle = 'rgba(109,221,255,0.18)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 10]);
        ctx.moveTo(0, mid);
        ctx.lineTo(W, mid);
        ctx.stroke();
        ctx.setLineDash([]);
        return;
      }

      const len       = data.length;
      const step      = W / len;
      const waveColor = isRec ? '249,115,22' : '109,221,255';

      // Outer glow
      ctx.beginPath();
      ctx.strokeStyle = `rgba(${waveColor},0.10)`;
      ctx.lineWidth   = 10;
      ctx.lineJoin    = 'round';
      for (let i = 0; i < len; i++) {
        const x = i * step, y = mid + (data[i] || 0) * mid * 0.82;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Mid glow
      ctx.beginPath();
      ctx.strokeStyle = `rgba(${waveColor},0.25)`;
      ctx.lineWidth   = 4;
      ctx.lineJoin    = 'round';
      for (let i = 0; i < len; i++) {
        const x = i * step, y = mid + (data[i] || 0) * mid * 0.82;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Main line
      ctx.beginPath();
      ctx.strokeStyle = isRec ? '#F97316' : '#6dddff';
      ctx.lineWidth   = 2;
      ctx.lineJoin    = 'round';
      ctx.lineCap     = 'round';
      for (let i = 0; i < len; i++) {
        const x = i * step, y = mid + (data[i] || 0) * mid * 0.82;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Fill
      const grad = ctx.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, `rgba(${waveColor},0.10)`);
      grad.addColorStop(1, `rgba(${waveColor},0)`);
      ctx.beginPath();
      for (let i = 0; i < len; i++) {
        const x = i * step, y = mid + (data[i] || 0) * mid * 0.82;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.lineTo(W, mid); ctx.lineTo(0, mid); ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();
    };

    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [audioDataRef]);

  return (
    <div className={`viz-wrap ${isRecording ? 'recording' : ''} ${stage}`}>
      <canvas ref={canvasRef} className="viz-canvas" />

      {!isRecording && stage === 'idle' && (
        <div className="viz-hint">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M12 1a3 3 0 0 1 3 3v8a3 3 0 0 1-6 0V4a3 3 0 0 1 3-3z"/>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4"/>
          </svg>
          <span>Tap the button to start your session</span>
        </div>
      )}

      {stage === 'analyzing' && (
        <div className="viz-analyzing">
          <div className="eq-bars">
            {[...Array(12)].map((_, i) => (
              <div key={i} className="eq-bar" style={{ animationDelay: `${i * 0.07}s` }} />
            ))}
          </div>
          <span>Working on your feedback…</span>
        </div>
      )}
    </div>
  );
}
