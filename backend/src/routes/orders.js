import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { markOrderPaid } from '../services/order-service.js';
import { printKitchenTicket } from '../services/print-service.js';
import { broadcastDataChange } from '../services/realtime.js';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const status = req.query.status ? String(req.query.status).split(',') : undefined;
    const orders = await prisma.order.findMany({
      where: status ? { status: { in: status } } : {},
      include: { table: true, customer: true, items: true },
      orderBy: { createdAt: 'desc' },
      take: 100
    });
    return res.json(orders);
  } catch (error) {
    return next(error);
  }
});

router.patch('/:id/status', async (req, res, next) => {
  try {
    const data = z
      .object({
        status: z.enum(['NEW', 'PREPARING', 'DELIVERING', 'DELIVERED', 'CANCELLED']).optional(),
        paymentStatus: z.enum(['UNPAID', 'PENDING_PAYMENT', 'PAID', 'FAILED', 'CANCELLED']).optional(),
        paymentMethod: z.enum(['CASH', 'BANK_TRANSFER']).optional()
      })
      .parse(req.body);

    if (data.status === 'CANCELLED' && !['OWNER', 'ADMIN'].includes(req.user?.role)) {
      return res.status(403).json({ message: 'Chỉ chủ quán được hủy đơn từ trang quản trị' });
    }

    // Thêm timestamps khi status thay đổi
    const updateData = { ...data };
    if (data.status === 'PREPARING') {
      updateData.completedAt = new Date();
    } else if (data.status === 'DELIVERING') {
      updateData.completedAt = new Date();
    } else if (data.status === 'DELIVERED') {
      updateData.deliveredAt = new Date();
    } else if (data.status === 'CANCELLED' && data.paymentStatus === undefined) {
      // Hủy đơn: cũng cập nhật paymentStatus thành CANCELLED (trừ đơn đã thanh toán)
      // để đơn không còn xuất hiện ở mục "Đơn chưa thanh toán".
      const current = await prisma.order.findUnique({
        where: { id: req.params.id },
        select: { paymentStatus: true }
      });
      if (current && current.paymentStatus !== 'PAID') {
        updateData.paymentStatus = 'CANCELLED';
      }
    }

    let order;
    if (data.paymentStatus === 'PAID') {
      order = await markOrderPaid(req.params.id, data.paymentMethod);
    } else {
      order = await prisma.order.update({
        where: { id: req.params.id },
        data: updateData,
        include: { table: true, customer: true, items: true }
      });
    }

    if (order.status === 'PREPARING') {
      await printKitchenTicket(order);
    }

    broadcastDataChange('orders', { action: 'updated', orderId: order.id });
    broadcastDataChange('dashboard', { action: 'updated', orderId: order.id });

    return res.json(order);
  } catch (error) {
    return next(error);
  }
});

router.post('/merge', async (req, res, next) => {
  try {
    const data = z
      .object({
        orderIds: z.array(z.string()).min(2)
      })
      .parse(req.body);

    const merged = await prisma.$transaction(async (tx) => {
      const orders = await tx.order.findMany({
        where: { id: { in: data.orderIds }, paymentStatus: { not: 'PAID' } },
        include: { items: true }
      });

      if (orders.length < 2) {
        throw new Error('Cần chọn ít nhất 2 hóa đơn chưa thanh toán để gộp');
      }

      const tableId = orders[0].tableId;
      const sameTable = orders.every((o) => o.tableId === tableId);
      if (!sameTable) {
        throw new Error('Tất cả hóa đơn phải cùng một bàn');
      }

      // Sắp xếp các đơn theo dailySequence để lấy đơn cũ nhất làm đơn chính
      orders.sort((a, b) => a.dailySequence - b.dailySequence);
      const primaryOrder = orders[0];
      const otherIds = orders.slice(1).map((o) => o.id);

      // Gộp các món ăn
      const combinedItems = {};
      orders.forEach((order) => {
        order.items.forEach((item) => {
          if (!combinedItems[item.menuItemId]) {
            combinedItems[item.menuItemId] = {
              menuItemId: item.menuItemId,
              name: item.name,
              quantity: 0,
              price: item.price,
              cost: item.cost
            };
          }
          combinedItems[item.menuItemId].quantity += item.quantity;
        });
      });

      let newSubtotal = 0;
      let newCostTotal = 0;
      const itemCreates = Object.values(combinedItems).map((item) => {
        newSubtotal += item.price * item.quantity;
        newCostTotal += item.cost * item.quantity;
        return {
          menuItemId: item.menuItemId,
          name: item.name,
          quantity: item.quantity,
          price: item.price,
          cost: item.cost
        };
      });

      const notes = orders
        .map((o) => o.note?.trim())
        .filter(Boolean);
      const combinedNote = notes.length > 0 ? notes.join('; ') : null;

      // Xóa các món cũ của đơn chính
      await tx.orderItem.deleteMany({ where: { orderId: primaryOrder.id } });

      // Cập nhật đơn chính với các món ăn và tổng tiền mới
      const updatedOrder = await tx.order.update({
        where: { id: primaryOrder.id },
        data: {
          subtotal: newSubtotal,
          costTotal: newCostTotal,
          note: combinedNote,
          items: {
            create: itemCreates
          }
        },
        include: { table: true, customer: true, items: true }
      });

      // Cập nhật các intents liên quan để tránh lỗi khóa ngoại
      await tx.paymentIntent.updateMany({
        where: { orderId: { in: otherIds } },
        data: { orderId: null }
      });

      // Xóa các đơn phụ khác
      await tx.order.deleteMany({ where: { id: { in: otherIds } } });

      return updatedOrder;
    });

    broadcastDataChange('orders', { action: 'updated', orderId: merged.id });
    broadcastDataChange('dashboard', { action: 'updated' });

    return res.status(200).json(merged);
  } catch (error) {
    return next(error);
  }
});

export default router;
