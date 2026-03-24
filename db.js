import { createConnection } from 'mysql2';

const connection = createConnection({
  host: 'localhost',
  user: 'root',
  password: '', 
  database: 'pixel_tracks_testing'
});

connection.connect((err) => {
  if (err) {
    console.error('Error connecting to MySQL:', err.message);
    return;
  }
  console.log('Connected to the XAMPP MySQL database!');
});

// Export the connection so other files can use it
export default connection;