import { Router } from 'express';
import bcrypt from 'bcryptjs';
import db from '../db.js';

const router = Router();

// ── POST /api/auth/login ────────────────────────────────────────
// Body: { customer_number, access_code }
router.post('/login', async (req, res) => {
  const { customer_number, access_code } = req.body;

  if (!customer_number || !access_code) {
    return res.status(400).json({ message: 'customer_number and access_code are required.' });
  }

  try {
    const [results] = await db.query(
      'SELECT * FROM prixel_customers WHERE customer_number = ?',
      [customer_number],
    );

    if (results.length === 0) {
      return res.status(401).json({ message: 'Invalid customer number or access code.' });
    }

    const customer = results[0];

    if (customer.status === 'inactive') {
      return res.status(403).json({ message: 'Account is inactive. Please contact support.' });
    }

    if (!customer.access_code) {
      return res.status(401).json({ message: 'No access code set for this account. Please contact support.' });
    }

    // Compare plain-text or bcrypt hashed access code
    const isMatch = customer.access_code.startsWith('$2')
      ? await bcrypt.compare(access_code, customer.access_code)
      : customer.access_code === access_code;

    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid customer number or access code.' });
    }

    // Return customer info without the access_code
    const { access_code: _hidden, ...customerData } = customer;

    res.json({ message: 'Login successful', customer: customerData });
  } catch (err) {
    res.status(500).json({ message: 'Database error', error: err.message });
  }
});

// ── POST /api/auth/set-access-code ─────────────────────────────
// Body: { customer_number, access_code }
router.post('/set-access-code', async (req, res) => {
  const { customer_number, access_code } = req.body;

  if (!customer_number || !access_code) {
    return res.status(400).json({ message: 'customer_number and access_code are required.' });
  }
  if (access_code.length < 4) {
    return res.status(400).json({ message: 'access_code must be at least 4 characters.' });
  }

  try {
    const hashed = await bcrypt.hash(access_code, 10);
    const [result] = await db.query(
      'UPDATE prixel_customers SET access_code = ? WHERE customer_number = ?',
      [hashed, customer_number],
    );
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Customer not found.' });
    res.json({ message: 'Access code updated successfully.' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to update access code', error: err.message });
  }
});

export default router;
