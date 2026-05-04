import pg       from 'pg';
import dotenv   from 'dotenv';

dotenv.config();

const { Pool } = pg;

// ssl: rejectUnauthorized: false is required for Neon cloud connections.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

pool.connect((err, client, release) => {
  if (err) {
    console.error('❌  Database connection failed:', err.message);
    return;
  }
  console.log('✅  Connected to Neon PostgreSQL');
  release(); // return the connection to the pool — important to avoid leaks
});

export async function createTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id          SERIAL PRIMARY KEY,
      user_id     VARCHAR(255) NOT NULL,
      prediction  VARCHAR(50)  NOT NULL,
      confidence  JSONB        NOT NULL,
      audio_file  VARCHAR(255),
      created_at  TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    ALTER TABLE sessions
      ADD COLUMN IF NOT EXISTS duration_seconds FLOAT,
      ADD COLUMN IF NOT EXISTS bpm             FLOAT,
      ADD COLUMN IF NOT EXISTS rhythm_score    FLOAT,
      ADD COLUMN IF NOT EXISTS feedback        TEXT[];
  `);

  console.log('✅  Table "sessions" ready');
}

export default pool;
