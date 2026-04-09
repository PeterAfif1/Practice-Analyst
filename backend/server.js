// server.js — main entry point for the Audio Practice Analyst backend.
// Responsibilities:
//   1. Serve the REST API (POST /analyze, GET /history/:userId)
//   2. Accept audio file uploads via multipart form data
//   3. Call the Python ML script to analyze each upload
//   4. Save results to PostgreSQL
//   5. Push results to the frontend in real time over WebSocket

// ─── Imports ────────────────────────────────────────────────────────────────

import express   from 'express';           // web framework — handles HTTP routing
import cors      from 'cors';              // lets the React frontend (port 3000) call this server (port 4000)
import multer    from 'multer';            // middleware that parses file uploads from multipart/form-data
import { exec }  from 'child_process';    // runs the Python script as a subprocess
import { WebSocketServer } from 'ws';     // WebSocket server for real-time push to frontend
import http      from 'http';             // Node's built-in HTTP module — needed to attach WebSocket to Express
import fs        from 'fs';               // file system — used to create the uploads folder if missing
import path      from 'path';             // safely join file path strings across OSes
import dotenv      from 'dotenv';           // loads .env variables into process.env
import ffmpeg      from 'fluent-ffmpeg';   // Node.js wrapper around the FFmpeg binary
import ffmpegPath  from 'ffmpeg-static';   // path to the bundled FFmpeg binary (no system install needed)
import pool, { createTables } from './db.js'; // our PostgreSQL pool + table setup helper

// Tell fluent-ffmpeg where to find the FFmpeg binary that came with ffmpeg-static
ffmpeg.setFfmpegPath(ffmpegPath);

// ─── Config ─────────────────────────────────────────────────────────────────

dotenv.config(); // must run before reading any process.env values

const PORT        = process.env.PORT        || 4000;
const PYTHON_PATH = process.env.PYTHON_PATH || '../.venv/Scripts/python.exe';
const ML_SCRIPT   = process.env.ML_SCRIPT_PATH || '../ML/analyze.py';
const UPLOAD_DIR  = process.env.UPLOAD_DIR  || './uploads';

// Create the uploads folder if it doesn't exist yet.
// { recursive: true } means it won't throw if the folder is already there.
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// ─── Express Setup ───────────────────────────────────────────────────────────

const app = express();

// cors() adds the Access-Control-Allow-Origin header so the browser lets
// the React frontend (a different origin/port) talk to this server.
app.use(cors());

// express.json() parses incoming request bodies that have Content-Type: application/json
// and puts the result on req.body — used by any JSON-only endpoints.
app.use(express.json());

// ─── Multer (File Upload) Setup ───────────────────────────────────────────────

// diskStorage controls where uploaded files land and what they're named.
const storage = multer.diskStorage({

  // destination: the folder where uploaded files are saved
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR); // cb(error, folderPath) — null means no error
  },

  // filename: give each file a unique name using the current timestamp.
  // This prevents two uploads with the same original name from overwriting each other.
  filename: (req, file, cb) => {
    const unique = `${Date.now()}-${file.originalname}`;
    cb(null, unique);
  },
});

// fileFilter: accept common audio formats.
// Browsers record as WebM by default — WAV, OGG, and MP3 also accepted.
// librosa can read all of these natively in Python.
const ACCEPTED_TYPES = ['audio/wav', 'audio/webm', 'audio/ogg', 'audio/mpeg'];
const ACCEPTED_EXT   = ['.wav', '.webm', '.ogg', '.mp3'];

const fileFilter = (req, file, cb) => {
  const okType = ACCEPTED_TYPES.includes(file.mimetype);
  const okExt  = ACCEPTED_EXT.some(ext => file.originalname.endsWith(ext));
  if (okType || okExt) {
    cb(null, true);  // true = accept the file
  } else {
    cb(new Error('Unsupported audio format. Use WAV, WebM, OGG, or MP3.'), false);
  }
};

// Create the multer middleware instance with our storage config and filter.
// .single('audio') means we expect one file per request, in a field named "audio".
const upload = multer({ storage, fileFilter }).single('audio');

// ─── HTTP + WebSocket Server ─────────────────────────────────────────────────

// We create a plain Node HTTP server that wraps the Express app.
// This lets us attach the WebSocket server to the same port — one server, two protocols.
const server = http.createServer(app);

// WebSocketServer listens on the same HTTP server.
// The frontend connects with: new WebSocket('ws://localhost:4000')
const wss = new WebSocketServer({ server });

// clients: a Set of all currently connected WebSocket clients.
// We use a Set so adding/removing is O(1) and there are no duplicates.
const clients = new Map(); // Map<userId, WebSocket> — key by userId for targeted pushes

// When a new WebSocket connection comes in from the frontend...
wss.on('connection', (ws) => {
  console.log('🔌  WebSocket client connected');

  // The frontend should send a JSON message immediately after connecting
  // to register itself: { type: 'register', userId: '...' }
  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw); // parse the incoming JSON string

      // If the frontend sends a register message, store this socket under the userId
      if (msg.type === 'register' && msg.userId) {
        clients.set(msg.userId, ws);
        console.log(`🔌  Registered WebSocket for user: ${msg.userId}`);
      }
    } catch {
      // If the message isn't valid JSON, ignore it silently
    }
  });

  // When this client disconnects, remove it from our map so we don't
  // try to send messages to a closed socket later.
  ws.on('close', () => {
    for (const [userId, socket] of clients.entries()) {
      if (socket === ws) {
        clients.delete(userId);
        console.log(`🔌  WebSocket disconnected for user: ${userId}`);
      }
    }
  });
});

// convertToWav: converts any audio file to a .wav that librosa can read on Windows.
// Returns a Promise that resolves to the new .wav file path.
// We use ffmpeg-static so no FFmpeg system install is needed.
function convertToWav(inputPath) {
  const outputPath = inputPath.replace(/\.[^.]+$/, '.wav'); // swap extension to .wav
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .toFormat('wav')              // target format
      .on('end',   () => resolve(outputPath)) // resolve with the new path when done
      .on('error', (err) => reject(err))      // reject on any ffmpeg error
      .save(outputPath);            // write the output file
  });
}

// pushToUser: helper that sends a JSON payload to a specific user's WebSocket.
// Called after analysis completes so the frontend gets the result immediately.
function pushToUser(userId, payload) {
  const ws = clients.get(userId); // look up this user's socket

  // ws.OPEN (value 1) means the connection is alive and ready to receive
  if (ws && ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(payload)); // WebSocket only sends strings, so stringify first
  }
}

// ─── Route: POST /analyze ────────────────────────────────────────────────────
// Accepts a multipart form with:
//   - file field "audio"    : the .wav recording
//   - body field "userId"   : who is submitting (string)
//
// Flow: save file → run Python → parse result → save to DB → push via WS → respond

app.post('/analyze', (req, res) => {

  // Run multer first to handle the file upload.
  // multer attaches the saved file info to req.file and text fields to req.body.
  upload(req, res, async (uploadErr) => {

    // If multer rejected the file (wrong type, etc.) return a 400 Bad Request
    if (uploadErr) {
      return res.status(400).json({ error: uploadErr.message });
    }

    // If no file was included in the request at all, tell the client
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file provided' });
    }

    // userId comes from the form body — default to "anonymous" if not provided
    const userId   = req.body.userId || 'anonymous';

    // req.file.path is the full path to the saved file on disk (set by multer diskStorage)
    const filePath = req.file.path;

    // Convert the uploaded file to WAV before passing to Python.
    // librosa cannot read WebM on Windows without FFmpeg — this step fixes that.
    let wavPath;
    try {
      wavPath = await convertToWav(filePath);
      console.log(`🎵  Converted to WAV: ${wavPath}`);
    } catch (convErr) {
      console.error('FFmpeg conversion error:', convErr.message);
      fs.unlink(filePath, () => {}); // clean up the original upload
      return res.status(500).json({ error: 'Audio conversion failed', detail: convErr.message });
    }

    // Build the shell command using the converted WAV path.
    // Wrap paths in quotes to handle spaces in folder names on Windows.
    const command = `"${PYTHON_PATH}" "${ML_SCRIPT}" "${wavPath}"`;

    console.log(`🐍  Running: ${command}`);

    // exec() spawns a child process, runs the command, and buffers its output.
    // The callback fires when the process exits.
    exec(command, async (execErr, stdout, stderr) => {

      // If the Python process exited with a non-zero code, something went wrong.
      if (execErr) {
        console.error('Python error:', stderr);
        return res.status(500).json({ error: 'ML analysis failed', detail: stderr });
      }

      // Parse the JSON that analyze.py printed to stdout.
      // analyze.py must print exactly one JSON object and nothing else.
      let mlResult;
      try {
        mlResult = JSON.parse(stdout.trim()); // trim() removes trailing newlines
      } catch {
        return res.status(500).json({ error: 'Could not parse ML output', raw: stdout });
      }

      // Save the result to PostgreSQL so it appears in /history later.
      // Column names match the Neon schema: prediction, confidence (JSONB), audio_file.
      // $1, $2 … are parameterized — pg substitutes values safely to prevent SQL injection.
      try {
        await pool.query(
          `INSERT INTO sessions (user_id, prediction, confidence, audio_file)
           VALUES ($1, $2, $3, $4)`,
          [
            userId,
            mlResult.prediction,    // ML prediction label from Python ("correct", "flat", etc.)
            mlResult.confidence,    // confidence object — pg serializes to JSONB automatically
            req.file.originalname,  // original file name the user uploaded
          ]
        );
      } catch (dbErr) {
        // A DB error shouldn't block the response — log it but continue
        console.error('DB insert error:', dbErr.message);
      }

      // Delete both the original upload and the converted WAV now that analysis is done.
      fs.unlink(filePath, (e) => { if (e) console.warn('Could not delete upload:', filePath); });
      fs.unlink(wavPath,  (e) => { if (e) console.warn('Could not delete wav:', wavPath); });

      // Push the result to the frontend via WebSocket so the UI updates instantly
      // without the frontend needing to poll.
      pushToUser(userId, { type: 'analysis_complete', data: mlResult });

      // Also return the result as a normal HTTP response for the fetch() caller
      res.json({ success: true, data: mlResult });
    });
  });
});

// ─── Route: GET /history/:userId ─────────────────────────────────────────────
// Returns all past analysis sessions for a given user, newest first.
// Example: GET /history/user_123

app.get('/history/:userId', async (req, res) => {

  // req.params.userId is the dynamic segment from the URL path
  const { userId } = req.params;

  try {
    const { rows } = await pool.query(
      // ORDER BY created_at DESC puts the most recent session at the top
      `SELECT id, user_id, prediction, confidence, audio_file, created_at
       FROM sessions
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userId] // parameterized — prevents SQL injection
    );

    // rows is an array of plain objects matching the table columns.
    // Return them directly as JSON.
    res.json({ success: true, sessions: rows });

  } catch (dbErr) {
    console.error('DB query error:', dbErr.message);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

// ─── Start ───────────────────────────────────────────────────────────────────

// createTables() runs once at startup to make sure the DB schema exists.
// We await it before listening so the server is fully ready when it opens.
await createTables();

// server.listen starts both the HTTP (Express) and WebSocket server on the same port.
server.listen(PORT, () => {
  console.log(`🚀  Server running on http://localhost:${PORT}`);
  console.log(`🔌  WebSocket ready on ws://localhost:${PORT}`);
});
