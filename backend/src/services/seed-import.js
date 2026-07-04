import fs from 'fs/promises';
import path from 'path';
import bcrypt from 'bcryptjs';
import { prisma } from '../db.js';

// File JSON chứa dữ liệu khởi tạo (account + menu). Người dùng tự chỉnh sửa file này.
const SEED_FILE = path.join(process.cwd(), 'data', 'seed-data.json');

// Ảnh có thể được ghi dạng "/public/menu_image/xxx.jpg", "menu_image/xxx.jpg"
// hoặc chỉ "xxx.jpg". Chuẩn hoá về "/public/menu_image/xxx.jpg" để frontend hiển thị.
function normalizeImageUrl(image) {
  if (!image) return null;
  const value = String(image).trim();
  if (!value) return null;
  // URL tuyệt đối (http/https) hoặc data URI: giữ nguyên
  if (/^(https?:)?\/\//i.test(value) || value.startsWith('data:')) return value;
  if (value.startsWith('/public/')) return value;
  if (value.startsWith('public/')) return `/${value}`;
  if (value.startsWith('menu_image/')) return `/public/${value}`;
  if (value.startsWith('/')) return value;
  return `/public/menu_image/${value}`;
}

async function importAccounts(accounts = []) {
  let ok = 0;
  for (const acc of accounts) {
    try {
      const name = acc.name?.trim();
      const role = acc.role || 'STAFF';
      if (!name) {
        console.warn('[seed] Bỏ qua account thiếu "name":', JSON.stringify(acc));
        continue;
      }

      // Tài khoản đăng nhập bằng số điện thoại + PIN
      if (acc.phone) {
        const phone = String(acc.phone).trim();
        // PIN/pinHash chỉ set khi TẠO MỚI để không ghi đè PIN người dùng đã đổi trong app
        const pinHash = acc.pinHash || (acc.pin ? await bcrypt.hash(String(acc.pin), 10) : null);
        await prisma.user.upsert({
          where: { phone },
          update: { name, role },
          create: { name, phone, role, pin: pinHash }
        });
        ok += 1;
        continue;
      }

      // Tài khoản đăng nhập bằng email + mật khẩu (legacy)
      if (acc.email) {
        const email = String(acc.email).trim();
        const passwordHash =
          acc.passwordHash || (acc.password ? await bcrypt.hash(String(acc.password), 10) : null);
        await prisma.user.upsert({
          where: { email },
          update: { name, role },
          create: { name, email, role, passwordHash }
        });
        ok += 1;
        continue;
      }

      console.warn('[seed] Bỏ qua account thiếu "phone" hoặc "email":', name);
    } catch (err) {
      console.error('[seed] Lỗi import account', acc?.name || acc?.phone || acc?.email, '-', err.message);
    }
  }
  return ok;
}

async function importCategories(categories = []) {
  let ok = 0;
  for (const cat of categories) {
    try {
      if (!cat.id || !cat.name) {
        console.warn('[seed] Bỏ qua category thiếu "id" hoặc "name":', JSON.stringify(cat));
        continue;
      }
      const sortOrder = Number.isFinite(cat.sortOrder) ? cat.sortOrder : 0;
      const featured = cat.featured === true;
      await prisma.category.upsert({
        where: { id: cat.id },
        update: { name: cat.name, sortOrder, featured },
        create: { id: cat.id, name: cat.name, sortOrder, featured }
      });
      ok += 1;
    } catch (err) {
      console.error('[seed] Lỗi import category', cat?.id, '-', err.message);
    }
  }
  return ok;
}

async function importMenuItems(menuItems = []) {
  let ok = 0;
  // Lấy danh sách category hợp lệ để tránh lỗi khoá ngoại
  const existingCategories = new Set((await prisma.category.findMany({ select: { id: true } })).map((c) => c.id));

  for (const item of menuItems) {
    try {
      if (!item.id || !item.name) {
        console.warn('[seed] Bỏ qua món thiếu "id" hoặc "name":', JSON.stringify(item));
        continue;
      }
      const price = Number(item.price) || 0;
      const imageUrl = normalizeImageUrl(item.image ?? item.imageUrl);
      let categoryId = item.categoryId ?? null;
      if (categoryId && !existingCategories.has(categoryId)) {
        console.warn(`[seed] Món "${item.name}" tham chiếu categoryId "${categoryId}" không tồn tại → để trống.`);
        categoryId = null;
      }
      const active = item.active !== false;
      const hidden = item.hidden === true;
      const featured = item.featured === true;

      await prisma.menuItem.upsert({
        where: { id: item.id },
        update: { name: item.name, description: item.description ?? null, price, imageUrl, categoryId, active, hidden, featured },
        create: { id: item.id, name: item.name, description: item.description ?? null, price, imageUrl, categoryId, active, hidden, featured }
      });
      ok += 1;
    } catch (err) {
      console.error('[seed] Lỗi import món', item?.id, '-', err.message);
    }
  }
  return ok;
}

// Mở kết nối DB, thử lại vài lần vì lần query đầu lúc khởi động đôi khi chưa kết nối kịp.
async function connectWithRetry(retries = 5, delayMs = 1000) {
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      await prisma.$connect();
      return true;
    } catch (err) {
      if (attempt === retries) {
        console.error(`[seed] Không kết nối được DB sau ${retries} lần thử:`, err.message);
        return false;
      }
      console.warn(`[seed] Chưa kết nối được DB (lần ${attempt}/${retries}), thử lại sau ${delayMs}ms...`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return false;
}

// Đọc data/seed-data.json và import account + menu vào DB.
// Idempotent (dùng upsert) nên có thể chạy mỗi lần khởi động server mà không tạo trùng.
export async function importSeedData() {
  let raw;
  try {
    raw = await fs.readFile(SEED_FILE, 'utf8');
  } catch {
    console.log('[seed] Không tìm thấy data/seed-data.json — bỏ qua import khởi tạo.');
    return;
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    console.error('[seed] data/seed-data.json không phải JSON hợp lệ:', err.message);
    return;
  }

  const connected = await connectWithRetry();
  if (!connected) {
    console.error('[seed] Bỏ qua import vì không kết nối được DB.');
    return;
  }

  try {
    const accounts = await importAccounts(data.accounts || []);
    const categories = await importCategories(data.categories || []);
    const menuItems = await importMenuItems(data.menuItems || data.menu || []);
    console.log(`[seed] Import xong: ${accounts} account, ${categories} phân loại, ${menuItems} món.`);
  } catch (err) {
    console.error('[seed] Import thất bại:', err.message);
  }
}
