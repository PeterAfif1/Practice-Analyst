import React, { useState } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend
} from 'recharts';
import './ProgressChart.css';

const PITCH_COLOR  = '#6dddff';
const RHYTHM_COLOR = '#bbffb3';

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <p className="tt-label">{label}</p>
      {payload.map((p, i) => (
        <div key={i} className="tt-row">
          <span className="tt-dot" style={{ background: p.color }} />
          <span className="tt-name">{p.name}</span>
          <span className="tt-val">{p.value}%</span>
        </div>
      ))}
    </div>
  );
};

export default function ProgressChart({ data }) {
  const [view, setView] = useState('both');
  const avg = Math.round(data.reduce((a, b) => a + b.pitchAccuracy + b.rhythmScore, 0) / (data.length * 2));

  return (
    <div className="progress-page">
      <div className="progress-top">
        <div>
          <h2 className="progress-heading">Your Progress</h2>
          <p className="progress-sub">Pitch and rhythm over {data.length} sessions</p>
        </div>
        <div className="view-tabs">
          {[['both','Both'], ['pitch','Pitch'], ['rhythm','Rhythm']].map(([v, l]) => (
            <button key={v} className={`view-tab ${view === v ? 'active' : ''}`} onClick={() => setView(v)}>{l}</button>
          ))}
        </div>
      </div>

      <div className="stat-cards">
        <StatCard label="Best pitch" value={`${Math.max(...data.map(d => d.pitchAccuracy))}%`} color={PITCH_COLOR} />
        <StatCard label="Best rhythm" value={`${Math.max(...data.map(d => d.rhythmScore))}%`} color={RHYTHM_COLOR} />
        <StatCard label="Sessions" value={data.length} color="var(--caution)" />
        <StatCard label="Overall avg" value={`${avg}%`} color="var(--text-body)" />
      </div>

      <div className="chart-card">
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={data} margin={{ top: 10, right: 16, left: -10, bottom: 0 }}>
            <defs>
              <linearGradient id="gPitch" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor={PITCH_COLOR}  stopOpacity={0.22} />
                <stop offset="95%" stopColor={PITCH_COLOR}  stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gRhythm" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor={RHYTHM_COLOR} stopOpacity={0.22} />
                <stop offset="95%" stopColor={RHYTHM_COLOR} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="rgba(255,255,255,0.04)" strokeDasharray="4 6" />
            <XAxis dataKey="session"
              tick={{ fill: '#72757d', fontSize: 11, fontFamily: 'Inter' }}
              axisLine={false} tickLine={false}
            />
            <YAxis domain={[0, 100]}
              tick={{ fill: '#72757d', fontSize: 11, fontFamily: 'Inter' }}
              axisLine={false} tickLine={false}
              tickFormatter={v => `${v}%`}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{ fontFamily: 'Inter', fontSize: 12, paddingTop: 12, color: '#a8abb3' }} />
            {view !== 'rhythm' && (
              <Area type="monotone" dataKey="pitchAccuracy" name="Pitch"
                stroke={PITCH_COLOR}  strokeWidth={2} fill="url(#gPitch)"
                dot={{ fill: PITCH_COLOR,  r: 3, strokeWidth: 0 }}
                activeDot={{ r: 5, strokeWidth: 0 }}
              />
            )}
            {view !== 'pitch' && (
              <Area type="monotone" dataKey="rhythmScore" name="Rhythm"
                stroke={RHYTHM_COLOR} strokeWidth={2} fill="url(#gRhythm)"
                dot={{ fill: RHYTHM_COLOR, r: 3, strokeWidth: 0 }}
                activeDot={{ r: 5, strokeWidth: 0 }}
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function StatCard({ label, value, color }) {
  return (
    <div className="stat-card">
      <span className="sc-value" style={{ color }}>{value}</span>
      <span className="sc-label">{label}</span>
    </div>
  );
}
