import 'dotenv/config';
import mysql from 'mysql2/promise';

const pool = mysql.createPool({
  host:     process.env.DB_HOST,
  user:     process.env.DB_USER,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port:     process.env.DB_PORT,
});

pool
  .getConnection()
  .then((conn) => {
    console.log('✅ Database connected!');
    conn.release();
  })
  .catch((err) => console.error('❌ Connection error', err));

export default pool;
