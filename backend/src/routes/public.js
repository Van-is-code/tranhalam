import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { calculateCart, createOrderFromCart, createPaidOrderFromIntent, businessDate } from '../services/order-service.js';
import { createPayosLink, buildPayosIntentReferenceCode, getPayosPaymentInfo } from '../services/payos-service.js';
import { printKitchenTicket } from '../services/print-service.js';
import { broadcastDataChange } from '../services/realtime.js';

const router = Router();

router.get('/version', (req, res) => {
  try {
    // Try to read backend package.json version as base
    let base = '1.0';
    try {
      const pkgPath = path.join(process.cwd(), 'package.json');
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        if (pkg?.version) base = pkg.version;
      }
    } catch {}

    // Append git commit count if available to provide incremental number
    let gitCount = null;
    try {
      gitCount = execSync('git rev-list --count HEAD').toString().trim();
    } catch {}

    const version = gitCount ? `${base} - ${gitCount}` : base;
    return res.json({ version });
  } catch (err) {
    return res.json({ version: '1.0' });
  }
});

async function syncPaymentIntentFromPayos(intent) {
  if (!intent || intent.status !== 'PENDING' || !intent.payosOrderCode) {
    return { intent, order: intent?.order || null };
  }

  let paymentInfo;
  try {
    paymentInfo = await getPayosPaymentInfo(intent.payosOrderCode);
  } catch (error) {
    console.warn('Khong the doi soat PayOS:', error.message);
    return { intent, order: intent.order || null };
  }

  const payosStatus = String(paymentInfo?.status || '').toUpperCase();
  const paidByAmount = Number(paymentInfo?.amountRemaining) === 0 && Number(paymentInfo?.amountPaid) >= Number(intent.subtotal);
  const isPaid = payosStatus === 'PAID' || paidByAmount;

  if (!isPaid) {
    if (['CANCELLED', 'CANCELED'].includes(payosStatus)) {
      const cancelled = await prisma.paymentIntent.update({
        where: { id: intent.id },
        data: { status: 'CANCELLED' }
      });
      broadcastDataChange('payment-intents', { action: 'failed', intentId: intent.id, referenceCode: intent.referenceCode });
      return { intent: cancelled, order: null };
    }

    return { intent, order: intent.order || null };
  }

  const transaction = Array.isArray(paymentInfo?.transactions) ? paymentInfo.transactions.at(-1) : null;
  const transactionId = String(transaction?.reference || paymentInfo?.id || intent.payosOrderCode || '').trim();

  const wasLinked = Boolean(intent.orderId);
  const paid = await prisma.$transaction(async (tx) => {
    const freshIntent = await tx.paymentIntent.findUnique({ where: { id: intent.id } });
    if (!freshIntent) throw new Error('Khong tim thay payment intent');

    const order = freshIntent.orderId
      ? await tx.order.findUnique({ where: { id: freshIntent.orderId }, include: { table: true, customer: true, items: true } })
      : await createPaidOrderFromIntent(tx, freshIntent);

    const updatedIntent = await tx.paymentIntent.update({
      where: { id: freshIntent.id },
      data: {
        status: 'PAID',
        payosTransactionId: freshIntent.payosTransactionId || transactionId || null,
        orderId: order.id
      }
    });

    return { intent: updatedIntent, order };
  });

  try {
    await printKitchenTicket(paid.order);
  } catch (error) {
    console.warn('Khong the in bill sau khi doi soat PayOS:', error.message);
  }
  broadcastDataChange('payment-intents', {
    action: 'paid',
    intentId: paid.intent.id,
    orderId: paid.order.id,
    referenceCode: paid.intent.referenceCode
  });
  // If this sync created the order, also broadcast a 'created' event so clients show new-order notification
  try {
    if (!wasLinked) {
      const itemCount = (paid.order.items || []).reduce((s, it) => s + (it.quantity || 0), 0);
      broadcastDataChange('orders', { action: 'created', orderId: paid.order.id, dailySequence: paid.order.dailySequence, tableName: paid.order.table?.name || '', subtotal: paid.order.subtotal, itemCount });
    }
  } catch {}
  // Still broadcast paid event for listeners interested in payment updates
  broadcastDataChange('orders', { action: 'paid', orderId: paid.order.id });
  broadcastDataChange('dashboard', { action: 'updated', source: 'payos-sync' });

  return paid;
}

router.get('/tables/:qrCode', async (req, res, next) => {
  try {
    const table = await prisma.diningTable.findUnique({
      where: { qrCode: req.params.qrCode }
    });
    if (!table || !table.active) {
      return res.status(404).json({ message: 'Bàn không tồn tại hoặc đã tắt' });
    }

    const categories = await prisma.category.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        items: {
          where: { active: true },
          // Món nổi bật hiện lên đầu trong danh mục
          orderBy: [{ featured: 'desc' }, { name: 'asc' }]
        }
      }
    });

    // Danh mục nổi bật (được đánh dấu featured, hoặc chứa món nổi bật) hiện lên đầu giao diện order
    const sorted = categories
      .map((cat) => ({ ...cat, isFeatured: cat.featured || cat.items.some((it) => it.featured) }))
      .sort((a, b) => {
        if (a.isFeatured !== b.isFeatured) return a.isFeatured ? -1 : 1;
        if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
        return a.name.localeCompare(b.name);
      });

    return res.json({ table, categories: sorted });
  } catch (error) {
    return next(error);
  }
});

router.post('/customers', async (req, res, next) => {
  try {
    const data = z.object({ phone: z.string().min(8), name: z.string().optional() }).parse(req.body);
    const customer = await prisma.customer.upsert({
      where: { phone: data.phone },
      update: { name: data.name },
      create: data
    });
    broadcastDataChange('customers', { action: 'upserted', id: customer.id });
    return res.json(customer);
  } catch (error) {
    return next(error);
  }
});

router.get('/customers/:phone/orders', async (req, res, next) => {
  try {
    const orders = await prisma.order.findMany({
      where: { customer: { phone: req.params.phone } },
      include: { table: true, items: true },
      orderBy: { createdAt: 'desc' },
      take: 30
    });
    return res.json(orders);
  } catch (error) {
    return next(error);
  }
});

router.post('/orders', async (req, res, next) => {
  try {
    const data = z
      .object({
        qrCode: z.string(),
        phone: z.string().min(8),
        paymentMethod: z.literal('CASH'),
        note: z.string().optional(),
        items: z.array(z.object({ menuItemId: z.string(), quantity: z.number().int().min(1) })).min(1)
      })
      .parse(req.body);

    const [table, customer, cart] = await Promise.all([
      prisma.diningTable.findUnique({ where: { qrCode: data.qrCode } }),
      prisma.customer.upsert({
        where: { phone: data.phone },
        update: {},
        create: { phone: data.phone }
      }),
      calculateCart(data.items)
    ]);

    if (!table || !table.active) {
      return res.status(404).json({ message: 'Không tìm thấy bàn' });
    }

    const subtotal = cart.reduce((sum, item) => sum + item.lineTotal, 0);
    const costTotal = cart.reduce((sum, item) => sum + item.lineCost, 0);
    const date = businessDate();

    const order = await prisma.$transaction(async (tx) => {
      return createOrderFromCart(tx, {
        date,
        tableId: table.id,
        customerId: customer.id,
        paymentMethod: 'CASH',
        paymentStatus: 'PENDING_PAYMENT',
        status: 'NEW',
        subtotal,
        costTotal,
        note: data.note,
        items: cart
      });
    });

    broadcastDataChange('orders', {
      action: 'created',
      orderId: order.id,
      dailySequence: order.dailySequence,
      tableName: table.name,
      subtotal,
      itemCount: cart.reduce((sum, item) => sum + item.quantity, 0)
    });
    broadcastDataChange('dashboard', { action: 'updated', source: 'orders' });

    return res.status(201).json(order);
  } catch (error) {
    return next(error);
  }
});

router.post('/payment-intents', async (req, res, next) => {
  try {
    const data = z
      .object({
        qrCode: z.string(),
        phone: z.string().min(8),
        note: z.string().optional(),
        items: z.array(z.object({ menuItemId: z.string(), quantity: z.number().int().min(1) })).min(1)
      })
      .parse(req.body);

    const [table, customer, cart] = await Promise.all([
      prisma.diningTable.findUnique({ where: { qrCode: data.qrCode } }),
      prisma.customer.upsert({
        where: { phone: data.phone },
        update: {},
        create: { phone: data.phone }
      }),
      calculateCart(data.items)
    ]);

    if (!table || !table.active) {
      return res.status(404).json({ message: 'Không tìm thấy bàn' });
    }

    const subtotal = cart.reduce((sum, item) => sum + item.lineTotal, 0);
    const costTotal = cart.reduce((sum, item) => sum + item.lineCost, 0);
    const date = businessDate();
    const referenceCode = buildPayosIntentReferenceCode(date);
    const payosItems = cart.map((item) => ({
      name: String(item.name || 'Mon').slice(0, 25),
      quantity: item.quantity,
      price: item.price
    }));
    let payment;

    try {
      payment = await createPayosLink({ amount: subtotal, referenceCode, items: payosItems });
    } catch (error) {
      if (typeof error?.message === 'string' && (
        error.message.includes('Thiếu cấu hình PayOS') ||
        error.message.includes('SDK PayOS khong ho tro tao payment link') ||
        error.message.includes('PayOS tra ve du lieu khong hop le')
      )) {
        return res.status(400).json({ message: error.message });
      }

      throw error;
    }

    const intent = await prisma.paymentIntent.create({
      data: {
        referenceCode,
        qrCode: data.qrCode,
        phone: data.phone,
        tableId: table.id,
        customerId: customer.id,
        businessDate: date,
        paymentMethod: 'BANK_TRANSFER',
        status: 'PENDING',
        subtotal,
        costTotal,
        note: data.note,
        items: cart,
        payosOrderCode: payment.orderCode,
        payosCheckoutUrl: payment.checkoutUrl,
        payosQrCode: payment.qrDataUrl
      }
    });

    return res.status(201).json({
      intent: {
        ...intent,
        qrDataUrl: payment.qrDataUrl
      },
      checkoutUrl: payment.checkoutUrl,
      qrDataUrl: payment.qrDataUrl
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/payment-intents/:id', async (req, res, next) => {
  try {
    let intent = await prisma.paymentIntent.findUnique({
      where: { id: req.params.id },
      include: { order: { include: { table: true, customer: true, items: true } } }
    });

    if (!intent) {
      return res.status(404).json({ message: 'Không tìm thấy yêu cầu thanh toán' });
    }

    const synced = await syncPaymentIntentFromPayos(intent);
    intent = synced.intent;

    const order = synced.order || intent.order || (intent.orderId
      ? await prisma.order.findUnique({
          where: { id: intent.orderId },
          include: { table: true, customer: true, items: true }
        })
      : null);

    return res.json({
      intent: {
        ...intent,
        qrDataUrl: intent.payosQrCode
      },
      order,
      orderId: intent.orderId,
      qrDataUrl: intent.payosQrCode,
      checkoutUrl: intent.payosCheckoutUrl
    });
  } catch (error) {
    return next(error);
  }
});

router.delete('/payment-intents/:id', async (req, res, next) => {
  try {
    const data = z.object({ phone: z.string().min(8) }).parse(req.body);
    const intent = await prisma.paymentIntent.findUnique({ where: { id: req.params.id } });

    if (!intent || intent.phone !== data.phone) {
      return res.status(404).json({ message: 'Không tìm thấy yêu cầu thanh toán' });
    }

    if (intent.status === 'PAID' || intent.orderId) {
      return res.status(400).json({ message: 'Đơn đã được thanh toán, không thể hủy' });
    }

    const cancelled = await prisma.paymentIntent.update({
      where: { id: intent.id },
      data: { status: 'CANCELLED' }
    });

    return res.json({ success: true, intent: cancelled });
  } catch (error) {
    return next(error);
  }
});

router.patch('/orders/:id/cancel', async (req, res, next) => {
  try {
    const data = z.object({ phone: z.string().min(8) }).parse(req.body);
    const order = await prisma.order.findUnique({
      where: { id: req.params.id },
      include: { customer: true, table: true, items: true }
    });

    if (!order || order.customer.phone !== data.phone) {
      return res.status(404).json({ message: 'Không tìm thấy đơn của số điện thoại này' });
    }

    if (order.status !== 'NEW') {
      return res.status(400).json({ message: 'Chỉ hủy được đơn đang chờ xác nhận' });
    }

    const cancelled = await prisma.order.update({
      where: { id: order.id },
      data: { status: 'CANCELLED', paymentStatus: order.paymentStatus === 'PAID' ? 'PAID' : 'CANCELLED' },
      include: { table: true, customer: true, items: true }
    });

    broadcastDataChange('orders', { action: 'cancelled', orderId: cancelled.id });
    broadcastDataChange('dashboard', { action: 'updated', source: 'orders' });

    return res.json(cancelled);
  } catch (error) {
    return next(error);
  }
});

export default router;
