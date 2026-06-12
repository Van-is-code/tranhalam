import { prisma } from '../db.js';

export function businessDate(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export async function nextDailySequence(tx, date = businessDate()) {
  const latest = await tx.order.findFirst({
    where: { businessDate: date },
    orderBy: { dailySequence: 'desc' },
    select: { dailySequence: true }
  });

  return (latest?.dailySequence || 0) + 1;
}

export async function calculateCart(items) {
  const ids = items.map((item) => item.menuItemId);
  const menuItems = await prisma.menuItem.findMany({
    where: { id: { in: ids }, active: true, hidden: false },
    include: { recipes: { include: { ingredient: true } } }
  });

  const menuMap = new Map(menuItems.map((item) => [item.id, item]));

  return items.map((cartItem) => {
    const menuItem = menuMap.get(cartItem.menuItemId);
    if (!menuItem) {
      throw new Error('Một món trong giỏ không tồn tại hoặc đã tắt bán');
    }

    const unitCost = menuItem.recipes.reduce(
      (sum, recipe) => sum + Math.round(recipe.quantity * recipe.ingredient.unitCost),
      0
    );

    return {
      menuItemId: menuItem.id,
      name: menuItem.name,
      quantity: cartItem.quantity,
      price: menuItem.price,
      cost: unitCost,
      lineTotal: menuItem.price * cartItem.quantity,
      lineCost: unitCost * cartItem.quantity
    };
  });
}

export async function consumeIngredients(tx, order) {
  const orderWithRecipes = await tx.order.findUnique({
    where: { id: order.id },
    include: {
      items: {
        include: {
          menuItem: {
            include: { recipes: true }
          }
        }
      }
    }
  });

  for (const item of orderWithRecipes.items) {
    for (const recipe of item.menuItem.recipes) {
      const quantity = recipe.quantity * item.quantity;
      await tx.ingredient.update({
        where: { id: recipe.ingredientId },
        data: { stock: { decrement: quantity } }
      });
      await tx.stockMove.create({
        data: {
          ingredientId: recipe.ingredientId,
          quantity: -quantity,
          reason: `ORDER_${order.dailySequence}`,
          orderId: order.id
        }
      });
    }
  }
}

export async function createOrderFromCart(tx, {
  date = businessDate(),
  tableId,
  customerId,
  paymentMethod,
  paymentStatus = 'PENDING_PAYMENT',
  status = 'NEW',
  subtotal,
  costTotal,
  note,
  items
}) {
  const dailySequence = await nextDailySequence(tx, date);

  return tx.order.create({
    data: {
      businessDate: date,
      dailySequence,
      tableId,
      customerId,
      paymentMethod,
      paymentStatus,
      status,
      subtotal,
      costTotal,
      note,
      items: {
        create: items.map((item) => ({
          menuItemId: item.menuItemId,
          name: item.name,
          quantity: item.quantity,
          price: item.price,
          cost: item.cost
        }))
      }
    },
    include: { table: true, customer: true, items: true }
  });
}

export async function createPaidOrderFromIntent(tx, intent) {
  const order = await createOrderFromCart(tx, {
    date: intent.businessDate,
    tableId: intent.tableId,
    customerId: intent.customerId,
    paymentMethod: intent.paymentMethod,
    paymentStatus: 'PAID',
    // keep status as NEW so UI shows new-order tag and notifications
    status: 'NEW',
    subtotal: intent.subtotal,
    costTotal: intent.costTotal,
    note: intent.note,
    items: intent.items
  });

  await consumeIngredients(tx, order);
  return order;
}

export async function markOrderPaid(orderId, paymentMethod) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order) {
      throw new Error('Order not found');
    }

    const alreadyPaid = order.paymentStatus === 'PAID';
    const dataToUpdate = {
      paymentStatus: 'PAID',
      paidAt: order.paidAt || new Date()
    };
    if (paymentMethod) {
      dataToUpdate.paymentMethod = paymentMethod;
    }

    const updated = await tx.order.update({
      where: { id: orderId },
      data: dataToUpdate,
      include: { table: true, customer: true, items: true }
    });

    if (!alreadyPaid) {
      await consumeIngredients(tx, updated);
    }

    return updated;
  });
}
