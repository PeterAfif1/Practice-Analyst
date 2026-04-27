# Audio Practice Analyst

Records microphone audio in the browser, sends it to a Python ML pipeline, and classifies it as `correct`, `flat`, `sharp`, or `off_rhythm`. Results are pushed back to the frontend over WebSocket.

## Tech Stack

- **Frontend:** React (Create React App, runs at project root)
- **Backend:** Node.js with ES modules, Express, FFmpeg
- **ML:** Python, Wav2Vec2 (HuggingFace transformers), librosa, scikit-learn

## How it Works

1. User records audio in the browser via microphone
2. Audio blob is POSTed to the Node.js backend
3. FFmpeg converts it to WAV
4. Python extracts features using Wav2Vec2 (`facebook/wav2vec2-base`)
5. A trained classifier labels the audio as `correct`, `flat`, `sharp`, or `off_rhythm`
6. Result is pushed to the frontend via WebSocket

> **First run:** Wav2Vec2 downloads ~95MB of model weights on first analysis. Subsequent runs are fast.

## Backend `.env`

Create `backend/.env` before starting the server. All fields have defaults but `PORT` and `PYTHON_PATH` should be set explicitly:

```
DATABASE_URL=your_neon_connection_string_here
PORT=4000
PYTHON_PATH=../.venv/Scripts/python.exe    # Windows
# PYTHON_PATH=../.venv/bin/python          # Mac/Linux
ML_SCRIPT_PATH=../ML/analyze.py
UPLOAD_DIR=./uploads
```

## Running the Project

### 1. ML Setup (one time only, from project root)

```bash
python -m venv .venv

# Windows
.venv\Scripts\activate
# Mac/Linux
source .venv/bin/activate

pip install -r ML/requirements.txt
```

### 2. Backend (from `backend/`)

```bash
cd backend
npm install
npm run dev
```

`npm run dev` uses Node's built-in `--watch` flag — no nodemon needed.
Use `npm start` for production.

### 3. Frontend (from project root, separate terminal)

```bash
npm install
npm start
```

Runs on `http://localhost:3000`. Backend must be running on port `4000`.
