import express, { json } from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';
import db from './db.js';
import customerRoutes from './routes/customers.js';
import authRoutes from './routes/auth.js';
import orderRoutes from './routes/orders.js';
import adminRoutes from './routes/admin.js';
import inventoryRoutes from './routes/inventory.js';
import productRoutes from './routes/products.js';
import productionRoutes from './routes/production.js';
import invoiceRoutes from './routes/invoices.js';
import { sendMail, verifyMailer } from './services/mailer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Routes
app.get('/', (req, res) => {
  res.json({ message: 'Backend server is running!' });
});

app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

app.use('/api/customers', customerRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/products', productRoutes);
app.use('/api/production', productionRoutes);
app.use('/api/invoices', invoiceRoutes);

// GET /test-email?to=you@example.com  — sends a test email and confirms SMTP works
app.get('/test-email', async (req, res) => {
  const to = req.query.to;
  if (!to) return res.status(400).json({ success: false, message: 'Provide ?to=email' });
  try {
    await verifyMailer();
    const info = await sendMail({
      to,
      subject: 'Pixel Tracks — SMTP Test',
      html: '<p>If you receive this, SMTP is working correctly.</p>',
    });
    return res.json({ success: true, messageId: info.messageId });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: 'Something went wrong! ' });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  verifyMailer().catch((err) => console.error('[MAIL] SMTP connection FAILED:', err.message));
});
