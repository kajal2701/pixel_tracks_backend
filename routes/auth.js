import { Router } from 'express';
import db from '../db.js';

const router = Router();

// ── POST /api/auth/login ────────────────────────────────────────
// Body: { customer_number, password }
router.post('/login', async (req, res) => {
  const { customer_number, password } = req.body;

  if (!customer_number || !password) {
    return res.status(400).json({ message: 'customer_number and password are required.' });
  }

  try {
    const [results] = await db.query(
      'SELECT * FROM prixel_customers WHERE customer_number = ?',
      [customer_number],
    );

    if (results.length === 0) {
      return res.status(401).json({ message: 'Invalid customer number or password.' });
    }

    const customer = results[0];

    if (customer.status === 'inactive') {
      return res.status(403).json({ message: 'Account is inactive. Please contact support.' });
    }

    if (!customer.password) {
      return res.status(401).json({ message: 'No password set for this account. Please contact support.' });
    }

    // Compare Base64 encoded password
    const encodedInput = Buffer.from(password).toString('base64');
    const isMatch = customer.password === encodedInput;

    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid customer number or password.' });
    }

    // Return customer info without the password and access_code
    const { password: _hidden, access_code: _ac, ...customerData } = customer;

    res.json({ message: 'Login successful', customer: customerData });
  } catch (err) {
    res.status(500).json({ message: 'Database error', error: err.message });
  }
});

// ── POST /api/auth/set-password ─────────────────────────────────
// Body: { customer_number, password }
router.post('/set-password', async (req, res) => {
  const { customer_number, password } = req.body;

  if (!customer_number || !password) {
    return res.status(400).json({ message: 'customer_number and password are required.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ message: 'Password must be at least 6 characters.' });
  }

  try {
    const encoded = Buffer.from(password).toString('base64');
    const [result] = await db.query(
      'UPDATE prixel_customers SET password = ? WHERE customer_number = ?',
      [encoded, customer_number],
    );
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Customer not found.' });
    res.json({ message: 'Password updated successfully.' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to update password', error: err.message });
  }
});

export default router;
