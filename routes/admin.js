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

    // Block inactive accounts
    if (admin.status === 'inactive') {
      return res.status(403).json({ message: 'Account is inactive. Contact a superadmin.' });
    }

    const hash = normalizeWpHash(admin.password);
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
      "SELECT id, username, email, role, quick_access, status, created_at, updated_at FROM prixel_admin_users WHERE status = 'active' ORDER BY created_at DESC",
    );
    res.json({ data: results, total: results.length });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch users', error: err.message });
  }
});

// ── GET /api/admin/users/role/production-tech ──────────────────
// Get only active production tech users
router.get('/users/role/production-tech', async (req, res) => {
  try {
    const [results] = await db.query(
      "SELECT id, username, email, role, status FROM prixel_admin_users WHERE role = 'production tech' AND status = 'active' ORDER BY username ASC",
    );
    res.json({ data: results });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch production tech users', error: err.message });
  }
});

// ── GET /api/admin/users/:id ────────────────────────────────────
router.get('/users/:id', async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id, username, email, role, quick_access, status, created_at, updated_at FROM prixel_admin_users WHERE id = ?',
      [req.params.id],
    );
    if (rows.length === 0) return res.status(404).json({ message: 'User not found.' });
    res.json({ data: rows[0] });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch user', error: err.message });
  }
});

// ── POST /api/admin/users ───────────────────────────────────────
// Create a new admin user
// Body: { username, password, email, role, quick_access, status }
router.post('/users', async (req, res) => {
  const { username, password, email, role, quick_access, status } = req.body;

  if (!username || !password || !email) {
    return res.status(400).json({ message: 'username, password, and email are required.' });
  }

  try {
    const hashed = await bcrypt.hash(password, 10);

    const [result] = await db.query(
      'INSERT INTO prixel_admin_users (username, password, email, role, quick_access, status) VALUES (?, ?, ?, ?, ?, ?)',
      [username, hashed, email, role, quick_access ?? 'yes', status ?? 'active'],
    );

    const [rows] = await db.query(
      'SELECT id, username, email, role, quick_access, status, created_at, updated_at FROM prixel_admin_users WHERE id = ?',
      [result.insertId],
    );

    res.status(201).json({ message: 'User created successfully', data: rows[0] });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'Username already exists.' });
    }
    res.status(500).json({ message: 'Failed to create user', error: err.message });
  }
});

// ── PUT /api/admin/users/:id ────────────────────────────────────
// Update admin user (partial update). Password is re-hashed if provided.
router.put('/users/:id', async (req, res) => {
  const { username, password, email, role, quick_access, status } = req.body;

  const fields = [];
  const values = [];

  if (username !== undefined) { fields.push('username = ?'); values.push(username); }
  if (email !== undefined) { fields.push('email = ?'); values.push(email); }
  if (role !== undefined) { fields.push('role = ?'); values.push(role); }
  if (quick_access !== undefined) { fields.push('quick_access = ?'); values.push(quick_access); }
  if (status !== undefined) { fields.push('status = ?'); values.push(status); }
  if (password !== undefined) {
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
    if (result.affectedRows === 0) return res.status(404).json({ message: 'User not found.' });

    const [rows] = await db.query(
      'SELECT id, username, email, role, quick_access, status, created_at, updated_at FROM prixel_admin_users WHERE id = ?',
      [req.params.id],
    );
    res.json({ message: 'User updated successfully', data: rows[0] });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'Username already exists.' });
    }
    res.status(500).json({ message: 'Failed to update user', error: err.message });
  }
});

// ── DELETE /api/admin/users/:id ─────────────────────────────────
router.delete('/users/:id', async (req, res) => {
  try {
    // Prevent self-deletion
    const currentUserId = req.query.current_user_id;
    if (currentUserId && parseInt(req.params.id) === parseInt(currentUserId)) {
      return res.status(400).json({ message: 'Cannot delete your own account.' });
    }

    // Soft delete: set status to 'inactive' instead of actual deletion
    const [result] = await db.query(
      'UPDATE prixel_admin_users SET status = "inactive" WHERE id = ?',
      [req.params.id]
    );

    if (result.affectedRows === 0) return res.status(404).json({ message: 'User not found.' });
    res.json({ message: 'User deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to delete user', error: err.message });
  }
});

export default router;
