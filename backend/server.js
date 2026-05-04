import express   from 'express';
import cors      from 'cors';
import multer    from 'multer';
import { exec }  from 'child_process';
import { WebSocketServer } from 'ws';
import http      from 'http';
import fs        from 'fs';
import path      from 'path';
import dotenv      from 'dotenv';
import ffmpeg      from 'fluent-ffmpeg';
import ffmpegPath  from 'ffmpeg-static';
import pool, { createTables } from './db.js';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

ffmpeg.setFfmpegPath(ffmpegPath);

dotenv.config();

const PORT        = process.env.PORT        || 4000;
const PYTHON_PATH = process.env.PYTHON_PATH || '../.venv/Scripts/python.exe';
const ML_SCRIPT   = process.env.ML_SCRIPT_PATH || '../ML/analyze.py';
const UPLOAD_DIR  = process.env.UPLOAD_DIR  || path.join(__dirname, 'uploads');

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const app = express();

app.use(cors());
app.use(express.json());

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const unique = `${Date.now()}-${file.originalname}`;
    cb(null, unique);
  },
});

const ACCEPTED_TYPES = ['audio/wav', 'audio/webm', 'audio/ogg', 'audio/mpeg'];
const ACCEPTED_EXT   = ['.wav', '.webm', '.ogg', '.mp3'];

const fileFilter = (req, file, cb) => {
  const okType = ACCEPTED_TYPES.includes(file.mimetype);
  const okExt  = ACCEPTED_EXT.some(ext => file.originalname.endsWith(ext));
  if (okType || okExt) {
    cb(null, true);
  } else {
    cb(new Error('Unsupported audio format. Use WAV, WebM, OGG, or MP3.'), false);
  }
};

const upload = multer({ storage, fileFilter }).single('audio');

// We create a plain Node HTTP server that wraps the Express app.
// This lets us attach the WebSocket server to the same port — one server, two protocols.
const server = http.createServer(app);

const wss = new WebSocketServer({ server });

const clients = new Map();

wss.on('connection', (ws) => {
  console.log('🔌  WebSocket client connected');

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);

      if (msg.type === 'register' && msg.userId) {
        clients.set(msg.userId, ws);
        console.log(`🔌  Registered WebSocket for user: ${msg.userId}`);
      }
    } catch {
      // Ignore malformed messages
    }
  });

  ws.on('close', () => {
    for (const [userId, socket] of clients.entries()) {
      if (socket === ws) {
        clients.delete(userId);
        console.log(`🔌  WebSocket disconnected for user: ${userId}`);
      }
    }
  });
});

function convertToWav(inputPath) {
  const outputPath = inputPath.replace(/\.[^.]+$/, '.wav');
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .toFormat('wav')
      .on('end',   () => resolve(outputPath))
      .on('error', (err) => reject(err))
      .save(outputPath);
  });
}

function pushToUser(userId, payload) {
  const ws = clients.get(userId);

  if (ws && ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

app.post('/analyze', (req, res) => {

  upload(req, res, async (uploadErr) => {

    if (uploadErr) {
      return res.status(400).json({ error: uploadErr.message });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No audio file provided' });
    }

    const userId   = req.body.userId || 'anonymous';
    const filePath = req.file.path;

    // librosa cannot read WebM on Windows without FFmpeg — this step fixes that.
    let wavPath;
    try {
      wavPath = await convertToWav(filePath);
      console.log(`🎵  Converted to WAV: ${wavPath}`);
    } catch (convErr) {
      console.error('FFmpeg conversion error:', convErr.message);
      fs.unlink(filePath, () => {});
      return res.status(500).json({ error: 'Audio conversion failed', detail: convErr.message });
    }

    // Wrap paths in quotes to handle spaces in folder names on Windows.
    const command = `"${PYTHON_PATH}" "${ML_SCRIPT}" "${wavPath}"`;

    console.log(`🐍  Running: ${command}`);

    exec(command, { cwd: path.join(__dirname) }, async (execErr, stdout, stderr) => {

      if (execErr) {
        console.error('Python error:', stderr);
        return res.status(500).json({ error: 'ML analysis failed', detail: stderr });
      }

      // analyze.py must print exactly one JSON object and nothing else.
      let mlResult;
      try {
        mlResult = JSON.parse(stdout.trim());
      } catch {
        return res.status(500).json({ error: 'Could not parse ML output', raw: stdout });
      }

      try {
        await pool.query(
          `INSERT INTO sessions
             (user_id, prediction, confidence, audio_file,
              duration_seconds, bpm, rhythm_score)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            userId,
            mlResult.prediction,
            mlResult.confidence,
            req.file.originalname,
            (mlResult.chunks_analyzed ?? 0) * 3,  // each chunk is 3 s
            mlResult.tempo   ?? null,
            mlResult.avg_confidence ?? null,
          ]
        );
      } catch (dbErr) {
        // A DB error shouldn't block the response — log it but continue
        console.error('DB insert error:', dbErr.message);
      }

      fs.unlink(filePath, (e) => { if (e) console.warn('Could not delete upload:', filePath); });
      fs.unlink(wavPath,  (e) => { if (e) console.warn('Could not delete wav:', wavPath); });

      pushToUser(userId, { type: 'analysis_complete', data: mlResult });

      res.json({ success: true, data: mlResult });
    });
  });
});

app.get('/history/:userId', async (req, res) => {

  const { userId } = req.params;

  try {
    const { rows } = await pool.query(
      `SELECT id, user_id, prediction, confidence, audio_file, created_at
       FROM sessions
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userId]
    );

    res.json({ success: true, sessions: rows });

  } catch (dbErr) {
    console.error('DB query error:', dbErr.message);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

app.post('/api/sessions', async (req, res) => {
  const {
    user_id, prediction, confidence, audio_file,
    duration_seconds, bpm, rhythm_score, feedback,
  } = req.body;

  if (!user_id || !prediction || !confidence) {
    return res.status(400).json({ error: 'user_id, prediction, and confidence are required' });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO sessions
         (user_id, prediction, confidence, audio_file,
          duration_seconds, bpm, rhythm_score, feedback)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        user_id, prediction, confidence, audio_file ?? null,
        duration_seconds ?? null, bpm ?? null,
        rhythm_score ?? null, feedback ?? null,
      ]
    );
    res.status(201).json({ success: true, session: rows[0] });
  } catch (dbErr) {
    console.error('POST /api/sessions error:', dbErr.message);
    res.status(500).json({ error: 'Failed to create session' });
  }
});

app.get('/api/sessions', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM sessions ORDER BY created_at DESC`
    );
    res.json({ success: true, sessions: rows });
  } catch (dbErr) {
    console.error('GET /api/sessions error:', dbErr.message);
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
});

app.get('/api/sessions/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    return res.status(400).json({ error: 'id must be an integer' });
  }

  try {
    const { rows } = await pool.query(
      `SELECT * FROM sessions WHERE id = $1`,
      [id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: `Session ${id} not found` });
    }
    res.json({ success: true, session: rows[0] });
  } catch (dbErr) {
    console.error('GET /api/sessions/:id error:', dbErr.message);
    res.status(500).json({ error: 'Failed to fetch session' });
  }
});

await createTables();

server.listen(PORT, () => {
  console.log(`🚀  Server running on http://localhost:${PORT}`);
  console.log(`🔌  WebSocket ready on ws://localhost:${PORT}`);
});
