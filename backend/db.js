// db.js — sets up and exports the PostgreSQL connection pool.
// A pool keeps multiple connections open so the server doesn't have
// to open a new one for every request, which is much faster.

import pg       from 'pg';      // PostgreSQL client library
import dotenv   from 'dotenv';  // loads .env file into process.env

dotenv.config(); // reads .env and attaches every variable to process.env

const { Pool } = pg;

// Create the pool using the Neon connection string from DATABASE_URL.
// ssl: rejectUnauthorized: false is required for Neon cloud connections.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Test the connection when the server starts.
// pool.connect() borrows one connection, runs a quick test, then releases it.
pool.connect((err, client, release) => {
  if (err) {
    console.error('❌  Database connection failed:', err.message);
    return;
  }
  console.log('✅  Connected to Neon PostgreSQL');
  release(); // return the connection to the pool — important to avoid leaks
});

// createTables runs once at startup to ensure the sessions table exists.
// "IF NOT EXISTS" is safe to call every time — it does nothing if the table
// is already there, so no data is ever lost on restart.
export async function createTables() {
  const sql = `
    CREATE TABLE IF NOT EXISTS sessions (
      id          SERIAL PRIMARY KEY,          -- auto-incrementing unique row id
      user_id     VARCHAR(255) NOT NULL,       -- who submitted the recording
      prediction  VARCHAR(50)  NOT NULL,       -- ML prediction label (e.g. "correct", "flat")
      confidence  JSONB        NOT NULL,       -- confidence scores for each class
      audio_file  VARCHAR(255),               -- original name of the uploaded file
      created_at  TIMESTAMP DEFAULT NOW()     -- when the row was inserted
    );
  `;

  await pool.query(sql);
  console.log('✅  Table "sessions" ready');
}

// Export the pool so server.js can run queries with it.
export default pool;
