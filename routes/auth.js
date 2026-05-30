import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import db from '../db.js';
import { sendMail } from '../services/mailer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMPLATES_DIR = path.join(__dirname, '..', 'emailTemplates');

/** Read an HTML template and replace {{placeholders}} */
function renderTemplate(templateName, vars) {
  const filePath = path.join(TEMPLATES_DIR, `${templateName}.html`);
  let html = fs.readFileSync(filePath, 'utf8');
  for (const [key, value] of Object.entries(vars)) {
    html = html.replaceAll(`{{${key}}}`, value ?? '');
  }
  return html;
}

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

    // Compare using bcrypt
    const isMatch = await bcrypt.compare(password, customer.password);

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
    const encoded = await bcrypt.hash(password, 10);
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

// ── POST /api/auth/forgot-password ──────────────────────────────
// Body: { email }
// Sends a 6-digit OTP to the customer's email (valid for 10 minutes)
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ message: 'Email is required.' });
  }

  try {
    // Look up customer by email
    const [customers] = await db.query(
      'SELECT id, contact_name, company_name, email FROM prixel_customers WHERE email = ?',
      [email],
    );

    // Always respond with the same message — don't reveal if email exists
    if (customers.length === 0) {
      return res.json({ message: 'If this email is registered, an OTP has been sent.' });
    }

    const customer = customers[0];

    // Generate a random 6-digit OTP
    const otp = crypto.randomInt(100000, 999999).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes from now

    // Delete any existing OTPs for this customer (fresh start)
    await db.query('DELETE FROM prixel_password_resets WHERE customer_id = ?', [customer.id]);

    // Save the new OTP
    await db.query(
      'INSERT INTO prixel_password_resets (customer_id, otp, expires_at) VALUES (?, ?, ?)',
      [customer.id, otp, expiresAt],
    );

    // Send OTP email
    const backendUrl = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 8000}`;
    const html = renderTemplate('otpReset', {
      logoUrl: `${backendUrl}/uploads/email/light_logo.png`,
      contactName: customer.contact_name || customer.company_name,
      otp,
      year: new Date().getFullYear().toString(),
    });

    await sendMail({
      to: customer.email,
      subject: 'Password Reset OTP — Pixel Tracks',
      html,
    });

    console.log(`[AUTH] OTP sent to ${customer.email} for customer ID ${customer.id}`);
    res.json({ message: 'If this email is registered, an OTP has been sent.' });
  } catch (err) {
    console.error('[AUTH] forgot-password error:', err.message);
    res.status(500).json({ message: 'Failed to process request.', error: err.message });
  }
});

// ── POST /api/auth/verify-otp ───────────────────────────────────
// Body: { email, otp }
// Verifies the OTP is correct and not expired
router.post('/verify-otp', async (req, res) => {
  const { email, otp } = req.body;

  if (!email || !otp) {
    return res.status(400).json({ message: 'Email and OTP are required.' });
  }

  try {
    // Get customer by email
    const [customers] = await db.query(
      'SELECT id FROM prixel_customers WHERE email = ?',
      [email],
    );
    if (customers.length === 0) {
      return res.status(400).json({ message: 'Invalid email or OTP.' });
    }

    const customerId = customers[0].id;

    // Get the latest OTP for this customer
    const [otpRows] = await db.query(
      'SELECT * FROM prixel_password_resets WHERE customer_id = ? ORDER BY created_at DESC LIMIT 1',
      [customerId],
    );

    if (otpRows.length === 0) {
      return res.status(400).json({ message: 'No OTP found. Please request a new one.' });
    }

    const otpRecord = otpRows[0];

    // Check max attempts (5)
    if (otpRecord.attempts >= 5) {
      return res.status(429).json({ message: 'Too many wrong attempts. Please request a new OTP.' });
    }

    // Check expiry
    if (new Date() > new Date(otpRecord.expires_at)) {
      return res.status(400).json({ message: 'OTP has expired. Please request a new one.' });
    }

    // Check if OTP matches
    if (otpRecord.otp !== otp) {
      // Increment attempts
      await db.query(
        'UPDATE prixel_password_resets SET attempts = attempts + 1 WHERE id = ?',
        [otpRecord.id],
      );
      const remaining = 5 - (otpRecord.attempts + 1);
      return res.status(400).json({
        message: `Invalid OTP. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.`,
      });
    }

    // OTP is valid
    res.json({ verified: true, message: 'OTP verified successfully.' });
  } catch (err) {
    console.error('[AUTH] verify-otp error:', err.message);
    res.status(500).json({ message: 'Failed to verify OTP.', error: err.message });
  }
});

// ── POST /api/auth/reset-password ───────────────────────────────
// Body: { email, otp, password }
// Re-verifies OTP and sets the new password (bcrypt hashed)
router.post('/reset-password', async (req, res) => {
  const { email, otp, password } = req.body;

  if (!email || !otp || !password) {
    return res.status(400).json({ message: 'Email, OTP, and new password are required.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ message: 'Password must be at least 6 characters.' });
  }

  try {
    // Get customer by email
    const [customers] = await db.query(
      'SELECT id FROM prixel_customers WHERE email = ?',
      [email],
    );
    if (customers.length === 0) {
      return res.status(400).json({ message: 'Invalid email or OTP.' });
    }

    const customerId = customers[0].id;

    // Re-verify OTP
    const [otpRows] = await db.query(
      'SELECT * FROM prixel_password_resets WHERE customer_id = ? ORDER BY created_at DESC LIMIT 1',
      [customerId],
    );

    if (otpRows.length === 0) {
      return res.status(400).json({ message: 'No OTP found. Please request a new one.' });
    }

    const otpRecord = otpRows[0];

    if (otpRecord.attempts >= 5) {
      return res.status(429).json({ message: 'Too many wrong attempts. Please request a new OTP.' });
    }
    if (new Date() > new Date(otpRecord.expires_at)) {
      return res.status(400).json({ message: 'OTP has expired. Please request a new one.' });
    }
    if (otpRecord.otp !== otp) {
      return res.status(400).json({ message: 'Invalid OTP.' });
    }

    // Hash new password with bcrypt
    const hashedPassword = await bcrypt.hash(password, 10);

    // Update customer password
    await db.query(
      'UPDATE prixel_customers SET password = ? WHERE id = ?',
      [hashedPassword, customerId],
    );

    // Delete the OTP record (cleanup — can't be reused)
    await db.query('DELETE FROM prixel_password_resets WHERE customer_id = ?', [customerId]);

    console.log(`[AUTH] Password reset successful for customer ID ${customerId}`);
    res.json({ message: 'Password reset successful. You can now log in with your new password.' });
  } catch (err) {
    console.error('[AUTH] reset-password error:', err.message);
    res.status(500).json({ message: 'Failed to reset password.', error: err.message });
  }
});

export default router;

