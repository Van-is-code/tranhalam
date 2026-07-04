import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { ZodError } from 'zod';
import { config } from './config.js';
import authRoutes from './routes/auth.js';
import publicRoutes from './routes/public.js';
import webhookRoutes from './routes/webhooks.js';
import adminRoutes from './routes/admin.js';
import userRoutes from './routes/users.js';
import orderRoutes from './routes/orders.js';
import { requireAuth } from './middleware/auth.js';
import { sseHandler } from './services/realtime.js';
import { importSeedData } from './services/seed-import.js';
import path from 'path';

const app = express();

const allowedOrigins = new Set([
  config.frontendUrl,
  'http://localhost:5173',
  'http://localhost:2245',
  'http://localhost:2246',
  'http://localhost:2247',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:2245',
  'http://127.0.0.1:2246',
  'http://127.0.0.1:2247'
]);

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) {
      callback(null, true);
      return;
    }

    callback(null, false);
  },
  credentials: true
}));
// Cho phép ảnh do backend phục vụ (menu_image) hiển thị trên origin khác của frontend
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(express.json({ limit: '1mb' }));
app.use(morgan('dev'));

app.get('/health', (req, res) => res.json({ ok: true, name: config.storeName }));
app.get('/api/events', sseHandler);
// Serve uploaded public assets (menu images, etc.)
app.use('/public', express.static(path.join(process.cwd(), 'public')));
app.use('/api/auth', authRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/admin', requireAuth, adminRoutes);
app.use('/api/admin/users', requireAuth, userRoutes);
app.use('/api/orders', requireAuth, orderRoutes);

app.use((error, req, res, next) => {
  if (error instanceof ZodError) {
    return res.status(400).json({ message: 'Dữ liệu không hợp lệ', issues: error.issues });
  }

  console.error(error);
  return res.status(500).json({ message: error.message || 'Server error' });
});

// Import dữ liệu khởi tạo (account + menu) từ data/seed-data.json rồi mới nhận request.
// Lỗi import không làm sập server.
importSeedData()
  .catch((error) => console.error('[seed] Import khởi tạo lỗi:', error))
  .finally(() => {
    app.listen(config.port, () => {
      console.log(`VanMerchant API listening on http://localhost:${config.port}`);
    });
  });
