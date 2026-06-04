import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import db from '../db.js';
import { sendInvoiceSentEmail, sendInvoiceSentSalesEmail, sendPaymentSubmittedSalesEmail } from '../services/emailService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Multer config for payment screenshots ──────────────────────
const uploadsDir = path.join(__dirname, '..', 'uploads', 'payments');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `payment-${req.params.id}-${Date.now()}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB max
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp/;
    const extOk = allowed.test(path.extname(file.originalname).toLowerCase());
    const mimeOk = allowed.test(file.mimetype.split('/')[1]);
    cb(null, extOk && mimeOk);
  },
});

const router = Router();

// ── Helper: recalculate invoice totals ──────────────────────────
const calcTotals = ({ order_subtotal, extraWorkTotal, discount_pct, gst_pct }) => {
  const subtotal = parseFloat(order_subtotal || 0) + parseFloat(extraWorkTotal || 0);
  const discountPct = Math.min(Math.max(parseFloat(discount_pct) || 0, 0), 100);
  const discountAmount = subtotal * (discountPct / 100);
  const parsedGst = parseFloat(gst_pct);
  const gstPct = Math.min(Math.max(isNaN(parsedGst) ? 5 : parsedGst, 0), 100);
  const gstAmount = (subtotal - discountAmount) * (gstPct / 100);
  const totalAmount = subtotal - discountAmount + gstAmount;
  return { discountAmount, gstAmount, totalAmount };
};

// ── Helper: resolve unit price from customer channel_pricing ─────
// Supports both new nested format:
//   { commercial: { "10h": { price: 10, enabled: true } }, residential: { ... } }
// and legacy flat format:
//   { "10h": 10, "9h": 20, "8h": 30 }
const resolveUnitPrice = (channelPricing, holeDistance, channelLength, channelType) => {
  if (!channelPricing) return 0;
  const pricing = typeof channelPricing === 'string' ? JSON.parse(channelPricing) : channelPricing;
  const hd = String(holeDistance || '').trim();

  // ── Detect new nested format (has 'commercial' or 'residential' key) ──
  if (pricing.commercial || pricing.residential) {
    // Normalize channel_type: "Commercial" → "commercial", "Residential" → "residential"
    const typeKey = (channelType || 'residential').toLowerCase();
    const typePricing = pricing[typeKey];
    if (!typePricing) return 0;

    // Resolve hole key
    const holeKey = resolveHoleKey(hd, channelLength);
    if (holeKey && typePricing[holeKey]) {
      const entry = typePricing[holeKey];
      // entry can be { price: X, enabled: Y } or just a number (legacy)
      return parseFloat(typeof entry === 'object' ? entry.price : entry) || 0;
    }

    // Fallback: first available key in this type
    const keys = Object.keys(typePricing);
    if (keys.length > 0) {
      const entry = typePricing[keys[0]];
      return parseFloat(typeof entry === 'object' ? entry.price : entry) || 0;
    }
    return 0;
  }

  // ── Legacy flat format fallback ──
  const holeKey = resolveHoleKey(hd, channelLength);
  if (holeKey && pricing[holeKey] !== undefined) return parseFloat(pricing[holeKey]) || 0;

  // Last resort: use any available pricing key
  const keys = Object.keys(pricing);
  if (keys.length > 0) return parseFloat(pricing[keys[0]]) || 0;

  return 0;
};

// ── Helper: resolve hole distance to a pricing key like "10h" ─────
const resolveHoleKey = (hd, channelLength) => {
  // 1. Direct match: e.g. "9h"
  if (['10h', '9h', '8h'].includes(hd)) return hd;
  // 2. Add 'h' suffix: e.g. "9" → "9h"
  if (['8', '9', '10'].includes(hd)) return hd + 'h';
  // 3. Integer hole count
  const holeInt = parseInt(hd, 10);
  if ([8, 9, 10].includes(holeInt)) return holeInt + 'h';
  // 4. Feet → holes conversion
  const feet = parseFloat(hd) || parseFloat(channelLength || 0);
  if (Math.abs(feet - 6.67) < 0.1) return '10h';
  if (Math.abs(feet - 6.00) < 0.1) return '9h';
  if (Math.abs(feet - 5.33) < 0.1) return '8h';
  return null;
};


// ═══════════════════════════════════════════════════════════════════
// GET /api/invoices — List all invoices with customer info
// ═══════════════════════════════════════════════════════════════════
router.get('/', async (req, res) => {
  const { status } = req.query;
  let sql = `
    SELECT i.*, c.company_name, c.contact_name, c.email
    FROM prixel_invoices i
    LEFT JOIN prixel_customers c ON c.id = i.customer_id
    WHERE 1=1
  `;
  const params = [];
  if (status) { sql += ' AND i.status = ?'; params.push(status); }
  sql += ' ORDER BY i.created_at DESC';

  try {
    const [rows] = await db.query(sql, params);
    res.json({ data: rows });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch invoices', error: err.message });
  }
});


// ═══════════════════════════════════════════════════════════════════
// GET /api/invoices/:id — Get single invoice by id with full details
// ═══════════════════════════════════════════════════════════════════
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT i.*, c.company_name, c.contact_name, c.email, c.phone, c.channel_pricing
       FROM prixel_invoices i
       LEFT JOIN prixel_customers c ON c.id = i.customer_id
       WHERE i.id = ?`,
      [req.params.id],
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Invoice not found' });

    const invoice = rows[0];

    // Fetch the linked orders for extra details
    const orderIds = invoice.order_ids
      ? (typeof invoice.order_ids === 'string' ? JSON.parse(invoice.order_ids) : invoice.order_ids)
      : [];

    let orders = [];
    if (orderIds.length > 0) {
      const [orderRows] = await db.query(
        `SELECT id, order_id, color, channel_type, hole_distance, channel_length,
                total_length, total_pieces, final_length,
                delivery_method, pickup_location, delivery_address,
                customer_notes, additional_notes, created_at
         FROM prixel_orders WHERE id IN (?)`,
        [orderIds]
      );
      orders = orderRows;
    }

    res.json({ data: { ...invoice, orders } });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch invoice', error: err.message });
  }
});



// ═══════════════════════════════════════════════════════════════════
// POST /api/invoices/generate — Generate invoice from completed orders
// Body: { order_ids: [1, 5, 12] }
// ═══════════════════════════════════════════════════════════════════
router.post('/generate', async (req, res) => {
  const { order_ids } = req.body;

  if (!Array.isArray(order_ids) || order_ids.length === 0) {
    return res.status(400).json({ message: 'order_ids array is required and must not be empty.' });
  }

  try {
    // 1. Fetch orders with customer pricing
    const [orders] = await db.query(
      `SELECT o.*, DATE_FORMAT(o.pickup_date, '%Y-%m-%d') as pickup_date, c.channel_pricing, c.id AS cust_id
       FROM prixel_orders o
       LEFT JOIN prixel_customers c ON c.id = o.customer_id
       WHERE o.id IN (?)`,
      [order_ids]
    );

    if (orders.length !== order_ids.length) {
      return res.status(400).json({ message: 'Some selected orders do not exist.' });
    }

    // 2. Validate all orders are Completed and belong to the same customer
    const customerId = orders[0].cust_id;
    for (const ord of orders) {
      if (ord.order_status !== 'Completed') {
        return res.status(400).json({ message: `Order ${ord.order_id} is not in Completed status.` });
      }
      if (ord.cust_id !== customerId) {
        return res.status(400).json({ message: 'All selected orders must belong to the same customer.' });
      }
    }

    // 3. Check none of these orders already have an invoice
    const alreadyInvoiced = orders.filter(o => o.invoice_id !== null && o.invoice_id !== undefined);
    if (alreadyInvoiced.length > 0) {
      return res.status(400).json({
        message: `Order ${alreadyInvoiced[0].order_id} already has an invoice (invoice #${alreadyInvoiced[0].invoice_id}).`
      });
    }

    // 4. Build order_details snapshot (per-order billing)
    const orderDetails = orders.map((ord) => {
      const unitPrice = resolveUnitPrice(ord.channel_pricing, ord.hole_distance, ord.channel_length, ord.channel_type);
      const finalLength = parseFloat(ord.final_length || 0);
      const subtotal = unitPrice * finalLength;
      return {
        order_id: ord.id,
        order_number: ord.order_id,
        unit_price: unitPrice,
        final_length: finalLength,
        subtotal: parseFloat(subtotal.toFixed(2)),
      };
    });

    const orderSubtotal = orderDetails.reduce((s, d) => s + d.subtotal, 0);

    // 5. Default billing
    const discountPct = 0;
    const gstPct = 5;
    const calc = calcTotals({
      order_subtotal: orderSubtotal,
      extraWorkTotal: 0,
      discount_pct: discountPct,
      gst_pct: gstPct,
    });

    // 6. Generate invoice number
    const invoiceNumber = `INV-${Math.floor(Date.now() / 1000)}-${customerId}`;

    // 7. Insert invoice
    const [result] = await db.query(
      `INSERT INTO prixel_invoices
        (invoice_number, customer_id, order_ids, order_details,
         extra_work, extra_work_total,
         discount_pct, discount_amount,
         gst_pct, gst_amount, total_amount,
         status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Draft')`,
      [
        invoiceNumber,
        customerId,
        JSON.stringify(order_ids),
        JSON.stringify(orderDetails),
        JSON.stringify([]),  // no extra work initially
        0,
        discountPct, calc.discountAmount,
        gstPct, calc.gstAmount, calc.totalAmount,
      ]
    );

    const invoiceId = result.insertId;

    // 8. Set invoice_id on each order for quick lookup
    await db.query(
      'UPDATE prixel_orders SET invoice_id = ? WHERE id IN (?)',
      [invoiceId, order_ids]
    );

    const newInvoice = (await db.query('SELECT * FROM prixel_invoices WHERE id = ?', [invoiceId]))[0][0];

    res.status(201).json({
      message: 'Invoice generated successfully',
      data: newInvoice,
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to generate invoice', error: err.message });
  }
});


// ═══════════════════════════════════════════════════════════════════
// PATCH /api/invoices/:id — Update billing fields
// (extra_work stored on invoice, not on orders)
// ═══════════════════════════════════════════════════════════════════
router.patch('/:id', async (req, res) => {
  const {
    extra_work, extra_work_total,
    discount_pct, discount_amount, gst_pct, gst_amount, total_amount,
  } = req.body;

  try {
    const [existing] = await db.query(
      'SELECT * FROM prixel_invoices WHERE id = ?', [req.params.id]
    );
    if (existing.length === 0) return res.status(404).json({ message: 'Invoice not found' });

    const inv = existing[0];

    const newExtraWork = extra_work !== undefined ? extra_work : (inv.extra_work || []);
    const newDiscountPct = discount_pct !== undefined ? discount_pct : inv.discount_pct;
    const newGstPct = gst_pct !== undefined ? gst_pct : inv.gst_pct;

    const finalExtraWorkTotal = extra_work_total !== undefined
      ? parseFloat(extra_work_total) || 0
      : (Array.isArray(newExtraWork) ? newExtraWork : []).reduce(
        (s, r) => s + parseFloat(r.qty || 0) * parseFloat(r.unit_price || 0), 0,
      );

    let finalDiscountAmount, finalGstAmount, finalTotalAmount;
    if (discount_amount !== undefined && gst_amount !== undefined && total_amount !== undefined) {
      finalDiscountAmount = parseFloat(discount_amount) || 0;
      finalGstAmount = parseFloat(gst_amount) || 0;
      finalTotalAmount = parseFloat(total_amount) || 0;
    } else {
      // Compute order subtotal from order_details
      const orderDetails = inv.order_details
        ? (typeof inv.order_details === 'string' ? JSON.parse(inv.order_details) : inv.order_details)
        : [];
      const orderSubtotal = orderDetails.reduce((s, d) => s + parseFloat(d.subtotal || 0), 0);

      const calc = calcTotals({
        order_subtotal: orderSubtotal,
        extraWorkTotal: finalExtraWorkTotal,
        discount_pct: newDiscountPct,
        gst_pct: newGstPct,
      });
      finalDiscountAmount = calc.discountAmount;
      finalGstAmount = calc.gstAmount;
      finalTotalAmount = calc.totalAmount;
    }

    // Update invoice billing amounts + extra_work on the invoice itself
    await db.query(
      `UPDATE prixel_invoices
       SET extra_work = ?, extra_work_total = ?,
           discount_pct = ?, discount_amount = ?,
           gst_pct = ?, gst_amount = ?,
           total_amount = ?
       WHERE id = ?`,
      [
        JSON.stringify(newExtraWork),
        finalExtraWorkTotal,
        newDiscountPct, finalDiscountAmount,
        newGstPct, finalGstAmount,
        finalTotalAmount,
        req.params.id,
      ],
    );

    const updatedInv = (await db.query('SELECT * FROM prixel_invoices WHERE id = ?', [req.params.id]))[0][0];
    res.json({ message: 'Invoice updated', data: updatedInv });
  } catch (err) {
    res.status(500).json({ message: 'Failed to update invoice', error: err.message });
  }
});


// ═══════════════════════════════════════════════════════════════════
// PATCH /api/invoices/:id/status — Update invoice status
// (Draft → Sent → Paid / Cancelled)
// ═══════════════════════════════════════════════════════════════════
router.patch('/:id/status', async (req, res) => {
  const { status } = req.body;
  if (!status) {
    return res.status(400).json({ message: 'Status is required' });
  }

  try {
    const [existing] = await db.query('SELECT * FROM prixel_invoices WHERE id = ?', [req.params.id]);
    if (existing.length === 0) {
      return res.status(404).json({ message: 'Invoice not found' });
    }

    let query = 'UPDATE prixel_invoices SET status = ?';
    const params = [status];

    if (status === 'Sent') {
      query += ', sent_at = NOW()';
    } else if (status === 'Draft') {
      query += ', sent_at = NULL';
    }

    query += ' WHERE id = ?';
    params.push(req.params.id);

    await db.query(query, params);

    const [updated] = await db.query('SELECT * FROM prixel_invoices WHERE id = ?', [req.params.id]);

    // Send invoice email when status is changed to 'Sent'
    if (status === 'Sent' && updated.length > 0) {
      const invoice = updated[0];
      const [customerRows] = await db.query(
        'SELECT company_name, contact_name, email FROM prixel_customers WHERE id = ?',
        [invoice.customer_id]
      );
      if (customerRows.length > 0 && customerRows[0].email) {
        sendInvoiceSentEmail(invoice, customerRows[0]).catch((err) =>
          console.error(`[MAIL] Failed to send invoice email for ${invoice.invoice_number}:`, err.message)
        );

        // Fire-and-forget: send invoice email to sales team
        sendInvoiceSentSalesEmail(invoice, customerRows[0]).catch((err) =>
          console.error(`[MAIL] Failed to send invoice sales email for ${invoice.invoice_number}:`, err.message)
        );
      }
    }

    res.json({ message: `Invoice status updated to ${status}`, data: updated[0] });
  } catch (err) {
    res.status(500).json({ message: 'Failed to update invoice status', error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// POST /api/invoices/:id/payment —  uploads payment screenshot
// ═══════════════════════════════════════════════════════════════════
router.post('/:id/payment', upload.single('screenshot'), async (req, res) => {
  try {
    const [existing] = await db.query('SELECT * FROM prixel_invoices WHERE id = ?', [req.params.id]);
    if (existing.length === 0) return res.status(404).json({ message: 'Invoice not found' });

    const inv = existing[0];
    if (inv.status !== 'Sent') {
      return res.status(400).json({ message: `Cannot submit payment for invoice with status '${inv.status}'. Invoice must be in 'Sent' status.` });
    }

    if (!req.file) {
      return res.status(400).json({ message: 'Screenshot file is required.' });
    }

    await db.query(
      `UPDATE prixel_invoices
       SET status = 'Payment Submitted',
           payment_screenshot = ?,
           payment_submitted_at = NOW()
       WHERE id = ?`,
      [req.file.filename, req.params.id]
    );

    const [updated] = await db.query('SELECT * FROM prixel_invoices WHERE id = ?', [req.params.id]);
    res.json({ message: 'Payment submitted successfully', data: updated[0] });

    // Fire-and-forget: notify sales team about payment submission
    sendPaymentSubmittedSalesEmail(updated[0]).catch((err) =>
      console.error(`[MAIL] Failed to send payment submitted sales email for invoice ${updated[0]?.invoice_number}:`, err.message)
    );
  } catch (err) {
    res.status(500).json({ message: 'Failed to submit payment', error: err.message });
  }
});


// ═══════════════════════════════════════════════════════════════════
// PATCH /api/invoices/:id/payment/confirm — Admin confirms payment
// ═══════════════════════════════════════════════════════════════════
router.patch('/:id/payment/confirm', async (req, res) => {
  try {
    const [existing] = await db.query('SELECT * FROM prixel_invoices WHERE id = ?', [req.params.id]);
    if (existing.length === 0) return res.status(404).json({ message: 'Invoice not found' });

    const inv = existing[0];
    if (inv.status !== 'Payment Submitted') {
      return res.status(400).json({ message: `Cannot confirm payment for invoice with status '${inv.status}'. Invoice must be in 'Payment Submitted' status.` });
    }

    await db.query(
      `UPDATE prixel_invoices
       SET status = 'Paid',
           payment_confirmed_at = NOW()
       WHERE id = ?`,
      [req.params.id]
    );

    const [updated] = await db.query('SELECT * FROM prixel_invoices WHERE id = ?', [req.params.id]);
    res.json({ message: 'Payment confirmed successfully', data: updated[0] });
  } catch (err) {
    res.status(500).json({ message: 'Failed to confirm payment', error: err.message });
  }
});


// ═══════════════════════════════════════════════════════════════════
// POST /api/invoices/:id/resend — Resend invoice email to customer
// ═══════════════════════════════════════════════════════════════════
router.post('/:id/resend', async (req, res) => {
  try {
    const [existing] = await db.query('SELECT * FROM prixel_invoices WHERE id = ?', [req.params.id]);
    if (existing.length === 0) return res.status(404).json({ message: 'Invoice not found' });

    const invoice = existing[0];
    if (invoice.status === 'Draft') {
      return res.status(400).json({ message: 'Cannot resend a draft invoice. Please send it first.' });
    }

    const [customerRows] = await db.query(
      'SELECT company_name, contact_name, email FROM prixel_customers WHERE id = ?',
      [invoice.customer_id]
    );
    if (customerRows.length === 0 || !customerRows[0].email) {
      return res.status(400).json({ message: 'Customer email not found.' });
    }

    // Send invoice email to customer
    await sendInvoiceSentEmail(invoice, customerRows[0]);

    // Fire-and-forget: send copy to sales team
    sendInvoiceSentSalesEmail(invoice, customerRows[0]).catch((err) =>
      console.error(`[MAIL] Failed to resend invoice sales email for ${invoice.invoice_number}:`, err.message)
    );

    res.json({ message: `Invoice ${invoice.invoice_number} resent successfully to ${customerRows[0].email}` });
  } catch (err) {
    res.status(500).json({ message: 'Failed to resend invoice', error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// GET /api/invoices/:id/payment/screenshot — Serve screenshot image
// ═══════════════════════════════════════════════════════════════════
router.get('/:id/payment/screenshot', async (req, res) => {
  try {
    const [existing] = await db.query('SELECT payment_screenshot FROM prixel_invoices WHERE id = ?', [req.params.id]);
    if (existing.length === 0) return res.status(404).json({ message: 'Invoice not found' });

    const filename = existing[0].payment_screenshot;
    if (!filename) return res.status(404).json({ message: 'No payment screenshot found' });

    const filePath = path.join(uploadsDir, filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ message: 'Screenshot file not found on server' });

    res.sendFile(filePath);
  } catch (err) {
    res.status(500).json({ message: 'Failed to serve screenshot', error: err.message });
  }
});


export default router;
