import { Router } from 'express';
import bcrypt from 'bcryptjs';
import db from '../db.js';

const router = Router();

// WordPress bcrypt hashes are prefixed with "$wp$" and use "$2y$" instead of "$2b$".
// Strip "$wp$" and replace "$2y$" → "$2b$" for bcryptjs compatibility.
const normalizeWpHash = (hash) => {
  if (hash.startsWith('$wp$')) hash = hash.slice(4);
  if (hash.startsWith('$2y$')) hash = '$2b$' + hash.slice(4);
  return hash;
};

// ── POST /api/admin/login ───────────────────────────────────────
// Body: { username, password }
router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ message: 'username and password are required.' });
  }

  try {
    const [results] = await db.query(
      'SELECT * FROM prixel_admin_users WHERE username = ?',
      [username],
    );

    if (results.length === 0) {
      return res.status(401).json({ message: 'Invalid username or password.' });
    }

    const admin = results[0];

    const hash    = normalizeWpHash(admin.password);
    const isMatch = await bcrypt.compare(password, hash);

    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid username or password.' });
    }

    // Return admin info without the password
    const { password: _hidden, ...adminData } = admin;

    res.json({ message: 'Login successful', admin: adminData });
  } catch (err) {
    res.status(500).json({ message: 'Database error', error: err.message });
  }
});

// ── GET /api/admin/users ────────────────────────────────────────
// Get all admin users (password excluded)
router.get('/users', async (req, res) => {
  try {
    const [results] = await db.query(
      'SELECT id, username, email, role, quick_access, created_at, updated_at FROM prixel_admin_users ORDER BY created_at DESC',
    );
    res.json({ data: results, total: results.length });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch admin users', error: err.message });
  }
});

// ── POST /api/admin/users ───────────────────────────────────────
// Create a new admin user
// Body: { username, password, email, role, quick_access }
router.post('/users', async (req, res) => {
  const { username, password, email, role, quick_access } = req.body;

  if (!username || !password || !email) {
    return res.status(400).json({ message: 'username, password, and email are required.' });
  }

  try {
    const hashed = await bcrypt.hash(password, 10);

    const [result] = await db.query(
      'INSERT INTO prixel_admin_users (username, password, email, role, quick_access) VALUES (?, ?, ?, ?, ?)',
      [username, hashed, email, role ?? 'admin', quick_access ?? 'yes'],
    );

    const [rows] = await db.query(
      'SELECT id, username, email, role, quick_access, created_at, updated_at FROM prixel_admin_users WHERE id = ?',
      [result.insertId],
    );

    res.status(201).json({ message: 'Admin user created successfully', data: rows[0] });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'Username already exists.' });
    }
    res.status(500).json({ message: 'Failed to create admin user', error: err.message });
  }
});

// ── PUT /api/admin/users/:id ────────────────────────────────────
// Update admin user (partial update). Password is re-hashed if provided.
router.put('/users/:id', async (req, res) => {
  const { username, password, email, role, quick_access } = req.body;

  const fields = [];
  const values = [];

  if (username    !== undefined) { fields.push('username = ?');    values.push(username); }
  if (email       !== undefined) { fields.push('email = ?');       values.push(email); }
  if (role        !== undefined) { fields.push('role = ?');        values.push(role); }
  if (quick_access !== undefined) { fields.push('quick_access = ?'); values.push(quick_access); }
  if (password    !== undefined) {
    const hashed = await bcrypt.hash(password, 10);
    fields.push('password = ?');
    values.push(hashed);
  }

  if (fields.length === 0) {
    return res.status(400).json({ message: 'No fields provided to update.' });
  }

  values.push(req.params.id);

  try {
    const [result] = await db.query(
      `UPDATE prixel_admin_users SET ${fields.join(', ')} WHERE id = ?`,
      values,
    );
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Admin user not found.' });

    const [rows] = await db.query(
      'SELECT id, username, email, role, quick_access, created_at, updated_at FROM prixel_admin_users WHERE id = ?',
      [req.params.id],
    );
    res.json({ message: 'Admin user updated successfully', data: rows[0] });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'Username already exists.' });
    }
    res.status(500).json({ message: 'Failed to update admin user', error: err.message });
  }
});

// ── DELETE /api/admin/users/:id ─────────────────────────────────
router.delete('/users/:id', async (req, res) => {
  try {
    const [result] = await db.query('DELETE FROM prixel_admin_users WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Admin user not found.' });
    res.json({ message: 'Admin user deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to delete admin user', error: err.message });
  }
});

export default router;
