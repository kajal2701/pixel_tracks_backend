import express, { json } from 'express';
import cors from 'cors';
import 'dotenv/config';
import db from './db.js';
import customerRoutes from './routes/customers.js';
import authRoutes from './routes/auth.js';
import orderRoutes from './routes/orders.js';
import adminRoutes from './routes/admin.js';
import inventoryRoutes from './routes/inventory.js';
import productRoutes from './routes/products.js';

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(json());

// Routes
app.get('/', (req, res) => {
  res.json({ message: 'Backend server is running!' });
});


app.use('/api/customers', customerRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/products', productRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: 'Something went wrong!' });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
