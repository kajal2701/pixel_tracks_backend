import { Router } from 'express';
import db from '../db.js';

const router = Router();

// ── GET /api/customers ──────────────────────────────────────────
router.get('/', async (req, res) => {
  const { search } = req.query;

  let sql = 'SELECT * FROM prixel_customers';
  const params = [];

  if (search) {
    sql += ` WHERE company_name    LIKE ?
               OR customer_number  LIKE ?
               OR contact_name     LIKE ?
               OR email            LIKE ?
               OR phone            LIKE ?`;
    const like = `%${search}%`;
    params.push(like, like, like, like, like);
  }

  sql += ' ORDER BY created_at DESC';

  try {
    const [results] = await db.query(sql, params);
    res.json({ data: results, total: results.length });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch customers', error: err.message });
  }
});

// ── GET /api/customers/:id ──────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const [results] = await db.query('SELECT * FROM prixel_customers WHERE id = ?', [req.params.id]);
    if (results.length === 0) return res.status(404).json({ message: 'Customer not found' });
    res.json({ data: results[0] });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch customer', error: err.message });
  }
});

// ── POST /api/customers ─────────────────────────────────────────
router.post('/', async (req, res) => {
  const { customer_number, company_name, contact_name, email, phone, status, access_code } = req.body;

  if (!customer_number || !company_name || !contact_name || !email || !phone) {
    return res.status(400).json({ message: 'customer_number, company_name, contact_name, email, and phone are required.' });
  }

  const sql = `
    INSERT INTO prixel_customers
      (customer_number, company_name, contact_name, email, phone, status, access_code)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `;

  const values = [
    customer_number,
    company_name,
    contact_name,
    email,
    phone,
    status      ?? 'active',
    access_code ?? null,
  ];

  try {
    const [result] = await db.query(sql, values);
    const [rows] = await db.query('SELECT * FROM prixel_customers WHERE id = ?', [result.insertId]);
    res.status(201).json({ message: 'Customer created successfully', data: rows[0] });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'Customer number or email already exists.' });
    }
    res.status(500).json({ message: 'Failed to create customer', error: err.message });
  }
});

// ── PUT /api/customers/:id ──────────────────────────────────────
router.put('/:id', async (req, res) => {
  const { customer_number, company_name, contact_name, email, phone, status, access_code } = req.body;

  const fields = [];
  const values = [];

  if (customer_number !== undefined) { fields.push('customer_number = ?'); values.push(customer_number); }
  if (company_name    !== undefined) { fields.push('company_name = ?');    values.push(company_name); }
  if (contact_name    !== undefined) { fields.push('contact_name = ?');    values.push(contact_name); }
  if (email           !== undefined) { fields.push('email = ?');           values.push(email); }
  if (phone           !== undefined) { fields.push('phone = ?');           values.push(phone); }
  if (status          !== undefined) { fields.push('status = ?');          values.push(status); }
  if (access_code     !== undefined) { fields.push('access_code = ?');     values.push(access_code); }

  if (fields.length === 0) {
    return res.status(400).json({ message: 'No fields provided to update.' });
  }

  values.push(req.params.id);

  try {
    const [result] = await db.query(
      `UPDATE prixel_customers SET ${fields.join(', ')} WHERE id = ?`,
      values,
    );
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Customer not found' });

    const [rows] = await db.query('SELECT * FROM prixel_customers WHERE id = ?', [req.params.id]);
    res.json({ message: 'Customer updated successfully', data: rows[0] });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'Customer number or email already exists.' });
    }
    res.status(500).json({ message: 'Failed to update customer', error: err.message });
  }
});

// ── DELETE /api/customers/:id ───────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const [result] = await db.query('DELETE FROM prixel_customers WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Customer not found' });
    res.json({ message: 'Customer deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to delete customer', error: err.message });
  }
});

export default router;
