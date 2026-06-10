import { Router } from 'express';
import { z } from 'zod';
import QRCode from 'qrcode';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { requireRole } from '../middleware/auth.js';
import { broadcastDataChange } from '../services/realtime.js';
import multer from 'multer';
import fs from 'fs/promises';
import path from 'path';

const router = Router();

router.use(requireRole('OWNER', 'ADMIN'));

const MENU_IMAGE_DIR = path.join(process.cwd(), 'public', 'menu_image');

const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    try {
      await fs.mkdir(MENU_IMAGE_DIR, { recursive: true });
      cb(null, MENU_IMAGE_DIR);
    } catch (err) {
      cb(err);
    }
  },
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '-');
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2,8)}-${safe}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

function isLocalMenuImage(url) {
  if (!url) return false;
  try {
    return url.includes('/public/menu_image/') || url.includes('menu_image/');
  } catch { return false; }
}

async function unlinkIfLocal(url) {
  if (!isLocalMenuImage(url)) return;
  try {
    const filename = path.basename(url);
    const p = path.join(MENU_IMAGE_DIR, filename);
    await fs.unlink(p).catch(() => {});
  } catch (err) {
    // ignore
  }
}

// Upload a menu image. Expects multipart/form-data with field `image`.
router.post('/upload-menu-image', upload.single('image'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
    const imageUrl = `/public/menu_image/${req.file.filename}`;
    return res.status(201).json({ imageUrl, filename: req.file.filename });
  } catch (error) {
    return next(error);
  }
});

// Delete an uploaded menu image by filename or path
router.delete('/upload-menu-image/:filename', async (req, res, next) => {
  try {
    const filename = req.params.filename || '';
    if (!filename) return res.status(400).json({ message: 'Missing filename' });
    const p = path.join(MENU_IMAGE_DIR, path.basename(filename));
    await fs.unlink(p).catch(() => {});
    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
});

function tableOrderUrl(qrCode) {
  return `${config.frontendUrl}/table/${encodeURIComponent(qrCode)}`;
}

function generateQrCode(name) {
  const base = name
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  return `${base || 'BAN'}-${Date.now().toString().slice(-5)}`;
}

async function enrichTable(table) {
  const orderUrl = tableOrderUrl(table.qrCode);
  return {
    ...table,
    orderUrl,
    qrDataUrl: await QRCode.toDataURL(orderUrl, { width: 360, margin: 2 })
  };
}

router.get('/dashboard', async (req, res, next) => {
  try {
    const from = req.query.from ? new Date(String(req.query.from)) : new Date(new Date().setHours(0, 0, 0, 0));
    const to = req.query.to ? new Date(String(req.query.to)) : new Date();
    const orders = await prisma.order.findMany({
      where: {
        createdAt: { gte: from, lte: to },
        paymentStatus: 'PAID'
      },
      include: { items: true, table: true }
    });

    const revenue = orders.reduce((sum, order) => sum + order.subtotal, 0);
    const cost = orders.reduce((sum, order) => sum + order.costTotal, 0);
    const ingredients = await prisma.ingredient.findMany({ orderBy: { name: 'asc' } });
    const lowStock = ingredients.filter((ingredient) => ingredient.stock <= ingredient.minStock);

    return res.json({
      revenue,
      cost,
      profit: revenue - cost,
      orderCount: orders.length,
      lowStock,
      recentOrders: orders.slice(-10).reverse()
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/top-products', async (req, res, next) => {
  try {
    const period = req.query.period || 'day'; // day, week, month, year
    const now = new Date();
    let from = new Date(now.setHours(0, 0, 0, 0));
    
    if (period === 'week') {
      from = new Date(now);
      from.setDate(from.getDate() - 7);
    } else if (period === 'month') {
      from = new Date(now);
      from.setMonth(from.getMonth() - 1);
    } else if (period === 'year') {
      from = new Date(now);
      from.setFullYear(from.getFullYear() - 1);
    } else {
      from = new Date(now.setHours(0, 0, 0, 0));
    }
    
    const orders = await prisma.order.findMany({
      where: {
        createdAt: { gte: from },
        paymentStatus: 'PAID'
      },
      include: { items: true }
    });

    const productMap = {};
    orders.forEach((order) => {
      order.items.forEach((item) => {
        if (!productMap[item.menuItemId]) {
          productMap[item.menuItemId] = {
            id: item.menuItemId,
            name: item.name,
            totalRevenue: 0,
            totalQuantity: 0
          };
        }
        productMap[item.menuItemId].totalRevenue += item.price * item.quantity;
        productMap[item.menuItemId].totalQuantity += item.quantity;
      });
    });

    // Sort products by total quantity sold (units) so ranking reflects volume, not revenue
    const products = Object.values(productMap)
      .sort((a, b) => b.totalQuantity - a.totalQuantity);

    return res.json(products);
  } catch (error) {
    return next(error);
  }
});

router.get('/revenue-series', async (req, res, next) => {
  try {
    const period = req.query.period || 'day'; // day, month, year
    const now = new Date();
    const monthNames = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10', 'T11', 'T12'];
    const toDateKey = (date) => {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };
    const toMonthKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    const toDayLabel = (date) => `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}`;
    const toMonthLabel = (date) => `${monthNames[date.getMonth()]}/${date.getFullYear()}`;
    const toYearLabel = (year) => String(year);

    let from = new Date(now);
    if (period === 'day') {
      // Last 10 days including today
      from = new Date(now);
      from.setDate(from.getDate() - 9);
      from.setHours(0, 0, 0, 0);
    } else if (period === 'month') {
      // Last 10 months including current month
      from = new Date(now.getFullYear(), now.getMonth() - 9, 1);
    } else if (period === 'year') {
      // Last 10 years including current year
      from = new Date(now.getFullYear() - 9, 0, 1);
    }

    const where = { paymentStatus: 'PAID' };
    where.createdAt = { gte: from };

    const orders = await prisma.order.findMany({
      where,
      include: { items: true }
    });

    const seriesMap = {};

    orders.forEach((order) => {
      const orderDate = new Date(order.createdAt);
      let key;

      if (period === 'day') {
        key = toDateKey(orderDate);
      } else if (period === 'month') {
        key = toMonthKey(orderDate);
      } else if (period === 'year') {
        key = String(orderDate.getFullYear());
      }

      if (!seriesMap[key]) {
        const label = period === 'day'
          ? toDayLabel(orderDate)
          : period === 'month'
            ? toMonthLabel(orderDate)
            : toYearLabel(orderDate.getFullYear());
        seriesMap[key] = { label, revenue: 0, orders: 0 };
      }

      seriesMap[key].revenue += order.subtotal;
      seriesMap[key].orders += 1;
    });

    const allLabels = [];
    if (period === 'day') {
      for (let i = 0; i < 10; i++) {
        const date = new Date(from);
        date.setDate(from.getDate() + i);
        allLabels.push({ key: toDateKey(date), label: toDayLabel(date) });
      }
    } else if (period === 'month') {
      for (let i = 0; i < 10; i++) {
        const date = new Date(now.getFullYear(), now.getMonth() - (9 - i), 1);
        allLabels.push({ key: toMonthKey(date), label: toMonthLabel(date) });
      }
    } else if (period === 'year') {
      for (let i = 0; i < 10; i++) {
        const year = now.getFullYear() - (9 - i);
        allLabels.push({ key: String(year), label: String(year) });
      }
    }

    const series = allLabels.map((entry) => seriesMap[entry.key] || { label: entry.label, revenue: 0, orders: 0 });

    return res.json(series);
  } catch (error) {
    return next(error);
  }
});

router.get('/categories', async (req, res, next) => {
  try {
    const categories = await prisma.category.findMany({ orderBy: { sortOrder: 'asc' } });
    return res.json(categories);
  } catch (error) {
    return next(error);
  }
});

router.post('/categories', async (req, res, next) => {
  try {
    const data = z.object({
      name: z.string().min(1),
      sortOrder: z.number().int().default(0)
    }).parse(req.body);

    const category = await prisma.category.create({ data });
    broadcastDataChange('menu', { action: 'created', categoryId: category.id });
    return res.status(201).json(category);
  } catch (error) {
    return next(error);
  }
});

router.put('/categories/:id', async (req, res, next) => {
  try {
    const data = z.object({
      name: z.string().min(1),
      sortOrder: z.number().int().default(0)
    }).parse(req.body);

    const category = await prisma.category.update({
      where: { id: req.params.id },
      data
    });

    broadcastDataChange('menu', { action: 'updated', categoryId: category.id });
    return res.json(category);
  } catch (error) {
    return next(error);
  }
});

router.delete('/categories/:id', async (req, res, next) => {
  try {
    const category = await prisma.category.findUnique({ where: { id: req.params.id } });
    if (!category) return res.status(404).json({ message: 'Không tìm thấy phân loại' });

    await prisma.$transaction([
      prisma.menuItem.updateMany({ where: { categoryId: req.params.id }, data: { categoryId: null } }),
      prisma.category.delete({ where: { id: req.params.id } })
    ]);

    broadcastDataChange('menu', { action: 'deleted', categoryId: req.params.id });
    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
});

router.get('/menu-items', async (req, res, next) => {
  try {
    const items = await prisma.menuItem.findMany({
      include: { category: true, recipes: { include: { ingredient: true } } },
      orderBy: { name: 'asc' }
    });
    return res.json(items);
  } catch (error) {
    return next(error);
  }
});

router.post('/menu-items', async (req, res, next) => {
  try {
    const data = z
      .object({
        name: z.string().min(1),
        description: z.string().optional(),
        price: z.number().int().min(0),
        imageUrl: z.string().optional(),
        active: z.boolean().default(true),
        categoryId: z.string().optional().nullable()
      })
      .parse(req.body);
    const item = await prisma.menuItem.create({ data });
    broadcastDataChange('menu', { action: 'created', id: item.id });
    broadcastDataChange('dashboard', { action: 'updated', source: 'menu' });
    return res.status(201).json(item);
  } catch (error) {
    return next(error);
  }
});

router.put('/menu-items/:id', async (req, res, next) => {
  try {
    const existing = await prisma.menuItem.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ message: 'Không tìm thấy món' });

    // If imageUrl changed and the old image was a local upload, delete the old file
    const newImage = req.body?.imageUrl;
    if (newImage && existing.imageUrl && existing.imageUrl !== newImage) {
      await unlinkIfLocal(existing.imageUrl);
    }

    const item = await prisma.menuItem.update({ where: { id: req.params.id }, data: req.body });
    broadcastDataChange('menu', { action: 'updated', id: item.id });
    broadcastDataChange('dashboard', { action: 'updated', source: 'menu' });
    return res.json(item);
  } catch (error) {
    return next(error);
  }
});

router.put('/menu-items/:id/toggle-hidden', async (req, res, next) => {
  try {
    const item = await prisma.menuItem.findUnique({ where: { id: req.params.id } });
    if (!item) return res.status(404).json({ message: 'Không tìm thấy món' });
    const updated = await prisma.menuItem.update({
      where: { id: req.params.id },
      data: { hidden: !item.hidden }
    });
    broadcastDataChange('menu', { action: 'updated', id: updated.id });
    return res.json(updated);
  } catch (error) {
    return next(error);
  }
});

router.delete('/menu-items/:id', async (req, res, next) => {
  try {
    const existing = await prisma.menuItem.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ message: 'Không tìm thấy món' });

    // delete associated local image if present
    if (existing.imageUrl) {
      await unlinkIfLocal(existing.imageUrl);
    }

    await prisma.menuItem.delete({ where: { id: req.params.id } });
    broadcastDataChange('menu', { action: 'deleted', id: req.params.id });
    broadcastDataChange('dashboard', { action: 'updated', source: 'menu' });
    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
});

router.get('/ingredients', async (req, res, next) => {
  try {
    const items = await prisma.ingredient.findMany({ orderBy: { name: 'asc' } });
    return res.json(items);
  } catch (error) {
    return next(error);
  }
});

router.post('/ingredients', async (req, res, next) => {
  try {
    const data = z
      .object({
        name: z.string().min(1),
        unit: z.string().min(1),
        stock: z.number().default(0),
        minStock: z.number().default(0),
        unitCost: z.number().int().default(0)
      })
      .parse(req.body);
    const item = await prisma.ingredient.create({ data });
    broadcastDataChange('ingredients', { action: 'created', id: item.id });
    broadcastDataChange('dashboard', { action: 'updated', source: 'ingredients' });
    return res.status(201).json(item);
  } catch (error) {
    return next(error);
  }
});

router.put('/ingredients/:id', async (req, res, next) => {
  try {
    const item = await prisma.ingredient.update({
      where: { id: req.params.id },
      data: req.body
    });
    broadcastDataChange('ingredients', { action: 'updated', id: item.id });
    broadcastDataChange('dashboard', { action: 'updated', source: 'ingredients' });
    return res.json(item);
  } catch (error) {
    return next(error);
  }
});

router.delete('/ingredients/:id', async (req, res, next) => {
  try {
    await prisma.ingredient.delete({
      where: { id: req.params.id }
    });
    broadcastDataChange('ingredients', { action: 'deleted', id: req.params.id });
    broadcastDataChange('dashboard', { action: 'updated', source: 'ingredients' });
    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
});

router.get('/tables', async (req, res, next) => {
  try {
    const tables = await prisma.diningTable.findMany({ orderBy: { name: 'asc' } });
    return res.json(await Promise.all(tables.map(enrichTable)));
  } catch (error) {
    return next(error);
  }
});

router.post('/tables', async (req, res, next) => {
  try {
    const data = z
      .object({
        name: z.string().min(1),
        qrCode: z.string().optional(),
        seats: z.number().int().default(4),
        active: z.boolean().default(true)
      })
      .parse(req.body);
    const table = await prisma.diningTable.create({
      data: {
        ...data,
        qrCode: data.qrCode?.trim() || generateQrCode(data.name)
      }
    });
    broadcastDataChange('tables', { action: 'created', id: table.id });
    broadcastDataChange('dashboard', { action: 'updated', source: 'tables' });
    return res.status(201).json(await enrichTable(table));
  } catch (error) {
    return next(error);
  }
});

router.put('/tables/:id', async (req, res, next) => {
  try {
    const table = await prisma.diningTable.update({
      where: { id: req.params.id },
      data: req.body
    });
    broadcastDataChange('tables', { action: 'updated', id: table.id });
    broadcastDataChange('dashboard', { action: 'updated', source: 'tables' });
    return res.json(table);
  } catch (error) {
    return next(error);
  }
});

router.delete('/tables/:id', async (req, res, next) => {
  try {
    await prisma.diningTable.delete({
      where: { id: req.params.id }
    });
    broadcastDataChange('tables', { action: 'deleted', id: req.params.id });
    broadcastDataChange('dashboard', { action: 'updated', source: 'tables' });
    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
});

// ── User Management (Admin only) ──────────────────────────
// Chỉ Admin có thể quản lý Owner và Staff

router.get('/users', async (req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      select: { id: true, name: true, phone: true, role: true, createdAt: true, updatedAt: true },
      orderBy: { createdAt: 'desc' }
    });
    return res.json(users);
  } catch (error) {
    return next(error);
  }
});

router.post('/users', requireRole('ADMIN'), async (req, res, next) => {
  try {
    const data = z.object({
      name: z.string().min(1),
      phone: z.string().min(8).unique(),
      role: z.enum(['OWNER', 'STAFF']).default('STAFF')
    }).parse(req.body);

    // Kiểm tra phone đã tồn tại
    const existing = await prisma.user.findUnique({ where: { phone: data.phone } });
    if (existing) {
      return res.status(400).json({ message: 'Số điện thoại đã được sử dụng' });
    }

    const user = await prisma.user.create({
      data: {
        name: data.name,
        phone: data.phone,
        role: data.role
      }
    });

    broadcastDataChange('users', { action: 'created', id: user.id });
    return res.status(201).json({
      id: user.id,
      name: user.name,
      phone: user.phone,
      role: user.role,
      createdAt: user.createdAt
    });
  } catch (error) {
    return next(error);
  }
});

router.put('/users/:id', requireRole('ADMIN'), async (req, res, next) => {
  try {
    const data = z.object({
      name: z.string().min(1).optional(),
      phone: z.string().min(8).optional(),
      role: z.enum(['OWNER', 'STAFF']).optional()
    }).parse(req.body);

    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) {
      return res.status(404).json({ message: 'Không tìm thấy tài khoản' });
    }

    // Kiểm tra phone đã tồn tại (ngoại trừ user hiện tại)
    if (data.phone && data.phone !== user.phone) {
      const existing = await prisma.user.findUnique({ where: { phone: data.phone } });
      if (existing) {
        return res.status(400).json({ message: 'Số điện thoại đã được sử dụng' });
      }
    }

    const updated = await prisma.user.update({
      where: { id: req.params.id },
      data
    });

    broadcastDataChange('users', { action: 'updated', id: updated.id });
    return res.json({
      id: updated.id,
      name: updated.name,
      phone: updated.phone,
      role: updated.role
    });
  } catch (error) {
    return next(error);
  }
});

router.delete('/users/:id', requireRole('ADMIN'), async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) {
      return res.status(404).json({ message: 'Không tìm thấy tài khoản' });
    }

    // Không cho xóa admin
    if (user.role === 'ADMIN') {
      return res.status(403).json({ message: 'Không thể xóa tài khoản Admin' });
    }

    await prisma.user.delete({ where: { id: req.params.id } });
    broadcastDataChange('users', { action: 'deleted', id: req.params.id });
    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
});

router.patch('/users/:id/reset-pin', requireRole('ADMIN'), async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) {
      return res.status(404).json({ message: 'Không tìm thấy tài khoản' });
    }

    // Reset PIN và xóa devices
    await prisma.userDevice.deleteMany({ where: { userId: user.id } });
    const updated = await prisma.user.update({
      where: { id: req.params.id },
      data: { pin: null }
    });

    broadcastDataChange('users', { action: 'updated', id: updated.id });
    return res.json({
      message: 'Đã reset PIN và xóa tất cả thiết bị của tài khoản',
      user: {
        id: updated.id,
        name: updated.name,
        phone: updated.phone,
        role: updated.role
      }
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
