export const API_BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '');

// Ảnh upload được lưu ở backend và trả về đường dẫn tương đối ("/public/menu_image/x.jpg").
// Frontend và backend thường khác origin, nên cần ghép với API_BASE để ảnh hiển thị được.
export function resolveImageUrl(url) {
  if (!url) return '';
  if (/^(https?:)?\/\//i.test(url) || url.startsWith('data:')) return url;
  const p = url.startsWith('/') ? url : `/${url}`;
  return `${API_BASE}${p}`;
}

export function getToken() {
  return localStorage.getItem('vanmerchant_token');
}

export function setSession(session) {
  localStorage.setItem('vanmerchant_token', session.token);
  localStorage.setItem('vanmerchant_user', JSON.stringify(session.user));
}

export function getUser() {
  const raw = localStorage.getItem('vanmerchant_user');
  return raw ? JSON.parse(raw) : null;
}

export function updateStoredUser(user) {
  localStorage.setItem('vanmerchant_user', JSON.stringify(user));
}

export function logout() {
  localStorage.removeItem('vanmerchant_token');
  localStorage.removeItem('vanmerchant_user');
}

export async function api(path, options = {}) {
  const token = getToken();
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers
    }
  });

  const text = await response.text();
  let data = null;

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text };
    }
  }

  if (!response.ok) {
    throw new Error(data?.message || 'Có lỗi xảy ra');
  }

  return data;
}

export const money = (value) =>
  Number(value || 0).toLocaleString('vi-VN', { style: 'currency', currency: 'VND' });
