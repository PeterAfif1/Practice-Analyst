# Audio Practice Analyst

A full-stack ML-powered audio classifier that detects pitch and rhythm
errors in real-time using a trained machine learning model.

## Tech Stack
- React, Node.js
- Python, Librosa, Scikit-learn
- PostgreSQL

## How it Works
1. Captures live microphone audio in the browser
2. Sends audio to the Node.js backend
3. Python pipeline extracts audio features (MFCCs, tempo, spectral centroid, ZCR)
4. Random Forest model classifies audio into: correct, flat, sharp, off-rhythm
5. Returns prediction with confidence scores

## Running the Project

**Backend**
```
cd backend
npm install
npm start
```

**ML Pipeline**
```
cd ml
pip install -r requirements.txt
python analyze.py
```

**Frontend**
```
npm install
npm start
```

> Requires a `.env` file with `DATABASE_URL` in the backend folder.
