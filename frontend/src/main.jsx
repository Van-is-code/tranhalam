import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  BarChart3,
  Check,
  Banknote,
  ChefHat,
  ClipboardList,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  History,
  ImagePlus,
  LogOut,
  Menu,
  Minus,
  Package,
  Plus,
  Bell,
  BellOff,
  QrCode,
  ReceiptText,
  RefreshCw,
  ShoppingBag,
  Store,
  Users,
  Trash2,
  Utensils,
  Search,
  ChevronLeft,
  ChevronRight,
  Info,
  Phone,
  ShoppingCart,
  Calendar,
  TrendingUp,
  ShoppingBasket,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
  Sector,
} from 'recharts';
import { API_BASE, api, getUser, logout, money, setSession, updateStoredUser } from './api.js';
import './styles.css';

// ── Router ────────────────────────────────────────────────
function App() {
  const path = window.location.pathname;
  if (path.startsWith('/table/')) return <CustomerOrder qrCode={path.split('/').pop()} />;
  if (path.startsWith('/payment/result')) return <PaymentResult />;
  return <BackOffice />;
}

// ── SSE hook ──────────────────────────────────────────────
function useRealtimeUpdates(resources, onChange) {
  const callbackRef = useRef(onChange);
  const resourceKey = useMemo(() => [...resources].sort().join('|'), [resources]);
  useEffect(() => { callbackRef.current = onChange; }, [onChange]);
  useEffect(() => {
    const source = new EventSource(`${API_BASE}/api/events`);
    const handle = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.resource !== 'all' && !resources.includes(payload.resource)) return;
        callbackRef.current?.(payload);
      } catch { /* ignore */ }
    };
    source.addEventListener('data-change', handle);
    return () => source.close();
  }, [resourceKey]);
}

// ══════════════════════════════════════════════════════════
// CUSTOMER PAGE
// ══════════════════════════════════════════════════════════
const HISTORY_PER_PAGE = 5;

function CustomerOrder({ qrCode }) {
  const [phone, setPhone]               = useState(localStorage.getItem('vanmerchant_phone') || '');
  const [authorized, setAuthorized]     = useState(Boolean(phone));
  const [table, setTable]               = useState(null);
  const [categories, setCategories]     = useState([]);
  const [menuSearch, setMenuSearch]     = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [cart, setCart]                 = useState({});
  const [note, setNote]                 = useState('');
  const [history, setHistory]           = useState([]);
  const [message, setMessage]           = useState('');
  const [activeTab, setActiveTab]       = useState('menu');
  const [historyPage, setHistoryPage]   = useState(1);
  const [paymentChoiceOpen, setPaymentChoiceOpen] = useState(false);
  const [draftOrder, setDraftOrder]     = useState(null);
  const [successPopup, setSuccessPopup] = useState(null);
  const [infoPopup, setInfoPopup]       = useState(null);

  const loadCatalog = () =>
    api(`/api/public/tables/${qrCode}`)
      .then((data) => { setTable(data.table); setCategories(data.categories); })
      .catch((err) => setMessage(err.message));

  useEffect(() => { loadCatalog(); }, [qrCode]);

  useRealtimeUpdates(['menu', 'tables', 'orders'], (payload) => {
    if (cartLines.length === 0) loadCatalog();
    if (authorized && phone.length >= 8) loadHistory();
  });

  const loadHistory = () => {
    if (authorized && phone.length >= 8) {
      return api(`/api/public/customers/${phone}/orders`)
        .then((orders) => { setHistory(orders); return orders; })
        .catch(() => []);
    }
    return Promise.resolve([]);
  };

  useEffect(() => { loadHistory(); }, [authorized, phone]);

  const items = categories.flatMap((c) => c.items);
  const filteredCategories = useMemo(() => {
    const query = menuSearch.trim().toLowerCase();
    return categories
      .map((category) => ({
        ...category,
        items: category.items.filter((item) => {
          const matchCategory = categoryFilter === 'all' || item.categoryId === categoryFilter;
          const haystack = [item.name, item.description || ''].join(' ').toLowerCase();
          const matchSearch = !query || haystack.includes(query);
          return matchCategory && matchSearch;
        })
      }))
      .filter((category) => category.items.length > 0);
  }, [categories, menuSearch, categoryFilter]);
  const cartLines = Object.entries(cart)
    .map(([id, qty]) => ({ item: items.find((i) => i.id === id), quantity: qty }))
    .filter((l) => l.item);
  const cartCount = cartLines.reduce((s, l) => s + l.quantity, 0);
  const total = cartLines.reduce((s, l) => s + l.item.price * l.quantity, 0);

  const totalPages = Math.max(1, Math.ceil(history.length / HISTORY_PER_PAGE));
  const historySlice = history.slice((historyPage - 1) * HISTORY_PER_PAGE, historyPage * HISTORY_PER_PAGE);

  function changeQty(id, delta) {
    setCart((c) => {
      const next = Math.max((c[id] || 0) + delta, 0);
      const copy = { ...c };
      if (next === 0) delete copy[id]; else copy[id] = next;
      return copy;
    });
  }

  async function enterPhone(e) {
    e.preventDefault();
    await api('/api/public/customers', { method: 'POST', body: JSON.stringify({ phone }) });
    localStorage.setItem('vanmerchant_phone', phone);
    setAuthorized(true);
  }

  async function submitOrder() {
    setMessage('');
    if (!cartLines.length) return;
    setDraftOrder({ qrCode, phone, note, items: cartLines.map((l) => ({ menuItemId: l.item.id, quantity: l.quantity })) });
    setPaymentChoiceOpen(true);
  }

  async function confirmOrder() {
    if (!draftOrder) return;
    try {
      const order = await api('/api/public/orders', { method: 'POST', body: JSON.stringify({ ...draftOrder, paymentMethod: 'CASH' }) });
      setPaymentChoiceOpen(false);
      setDraftOrder(null);
      setCart({});
      setNote('');
      await loadHistory();
      setSuccessPopup({ order });
    } catch (err) {
      setMessage(err.message || 'Không thể gửi yêu cầu gọi món');
    }
  }

  async function cancelOrder(orderId) {
    await api(`/api/public/orders/${orderId}/cancel`, { method: 'PATCH', body: JSON.stringify({ phone }) });
    await loadHistory();
    setMessage('Đã hủy đơn đang chờ.');
  }

  if (!authorized) {
    return (
      <div className="customer-login">
        <div className="login-phone-card">
          <div className="brand-area">
            <Store size={36} />
            <h1>Trà Nhà Lâm</h1>
          </div>
          <p className="desc">{table ? `${table.name} — nhập số điện thoại để gọi món` : 'Nhập số điện thoại để bắt đầu gọi món'}</p>
          <form className="input-row" onSubmit={enterPhone}>
            <div style={{ position: 'relative' }}>
              <Phone size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-3)' }} />
              <input className="field" style={{ paddingLeft: 36 }} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Số điện thoại" type="tel" inputMode="numeric" />
            </div>
            <button className="btn btn-primary btn-lg btn-full" type="submit">Tiếp tục →</button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="customer-shell">
      <header className="customer-topbar">
        <Store size={20} style={{ opacity: .85 }} />
        <span className="table-name">{table?.name || 'Gọi món'}</span>
        <span className="phone-chip">📱 {phone}</span>
      </header>
      <div className="tab-bar">
        <button className={`tab-btn ${activeTab === 'menu' ? 'active' : ''}`} onClick={() => setActiveTab('menu')}><Utensils size={16} /> Thực đơn</button>
        <button className={`tab-btn ${activeTab === 'cart' ? 'active' : ''}`} onClick={() => setActiveTab('cart')}>
          <ShoppingCart size={16} /> Giỏ hàng{cartCount > 0 && <span className="tab-badge">{cartCount}</span>}
        </button>
        <button className={`tab-btn ${activeTab === 'history' ? 'active' : ''}`} onClick={() => setActiveTab('history')}>
          <History size={16} /> Đơn của tôi
          {history.filter((o) => o.status === 'NEW').length > 0 && <span className="tab-badge">{history.filter((o) => o.status === 'NEW').length}</span>}
        </button>
      </div>
      {message && <div className="notice" style={{ margin: '10px 16px 0' }}>{message}</div>}

      {activeTab === 'menu' && (
        <>
          {cartCount > 0 && (
            <div className="cart-footer">
              <div className="cart-footer-row">
                <span className="cart-summary-text"><b>{cartCount}</b> món đã chọn</span>
                <span className="cart-total-row">Tổng: <span className="total-amt">{money(total)}</span></span>
              </div>
              <button className="btn btn-primary btn-full btn-lg" onClick={() => setActiveTab('cart')}>Xem giỏ hàng & đặt →</button>
            </div>
          )}
          <div className="customer-menu-tab">
            <div className="menu-filter-panel">
              <div className="menu-search-box field-group">
                <Search size={16} />
                <input
                  className="field"
                  value={menuSearch}
                  onChange={(e) => setMenuSearch(e.target.value)}
                  placeholder="Tìm món trong thực đơn"
                  type="search"
                />
              </div>
              <div className="menu-filter-chips">
                <button
                  type="button"
                  className={`filter-chip ${categoryFilter === 'all' ? 'active' : ''}`}
                  onClick={() => setCategoryFilter('all')}
                >
                  Tất cả
                </button>
                {categories.map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    className={`filter-chip ${categoryFilter === cat.id ? 'active' : ''}`}
                    onClick={() => setCategoryFilter(cat.id)}
                  >
                    {cat.name}
                  </button>
                ))}
              </div>
            </div>

            {filteredCategories.length === 0 ? (
              <div className="empty-state cute-empty">
                <Utensils size={40} />
                <p>Không tìm thấy món nào phù hợp.</p>
              </div>
            ) : (
              filteredCategories.map((cat) => (
                <div className="category-section" key={cat.id}>
                  <h2>{cat.name}</h2>
                  {cat.items.map((item) => (
                    <div className={`menu-item-row ${item.hidden ? 'sold-out' : ''}`} key={item.id} style={{ marginBottom: 8 }}>
                      <img src={item.imageUrl || 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=200&q=60'} alt={item.name} />
                      <div className="item-body">
                        <div className="item-name">{item.name}</div>
                        {item.description && <div className="item-desc">{item.description}</div>}
                        <div className="item-price">{money(item.price)}</div>
                      </div>
                      {item.hidden ? (
                        <div className="sold-out-label">Hết món</div>
                      ) : (
                        <div className="stepper">
                          <button className="stepper-btn" onClick={() => changeQty(item.id, -1)} disabled={!cart[item.id]}><Minus size={14} /></button>
                          <span className="stepper-count">{cart[item.id] || 0}</span>
                          <button className="stepper-btn add" onClick={() => changeQty(item.id, 1)}><Plus size={14} /></button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>
        </>
      )}

      {activeTab === 'cart' && (
        <div className="cart-tab">
          {cartLines.length === 0 ? (
            <div className="cart-empty"><ShoppingBag size={48} /><p>Giỏ hàng trống.<br />Quay lại Thực đơn để chọn món.</p><button className="btn btn-ghost mt-2" onClick={() => setActiveTab('menu')}>← Xem thực đơn</button></div>
          ) : (
            <>
              <div className="cart-lines">
                {cartLines.map((line) => (
                  <div className="cart-line" key={line.item.id}>
                    <div className="stepper">
                      <button className="stepper-btn" onClick={() => changeQty(line.item.id, -1)}><Minus size={13} /></button>
                      <span className="stepper-count">{line.quantity}</span>
                      <button className="stepper-btn add" onClick={() => changeQty(line.item.id, 1)}><Plus size={13} /></button>
                    </div>
                    <span className="name">{line.item.name}</span>
                    <span className="subtotal">{money(line.item.price * line.quantity)}</span>
                  </div>
                ))}
              </div>
              <div className="cart-note">
                <label>Ghi chú cho quán</label>
                <textarea className="field" value={note} onChange={(e) => setNote(e.target.value)} placeholder="VD: ít cay, không hành..." />
              </div>
              <div className="cart-summary-card">
                {cartLines.map((line) => (
                  <div className="row" key={line.item.id}><span>{line.item.name} × {line.quantity}</span><span>{money(line.item.price * line.quantity)}</span></div>
                ))}
                <div className="row total-row"><span>Tổng cộng</span><span className="total-amt">{money(total)}</span></div>
              </div>
              <button className="btn btn-primary btn-full btn-lg" onClick={submitOrder}>Gọi món ngay</button>
            </>
          )}
        </div>
      )}

      {activeTab === 'history' && (
        <div className="history-tab">
          {history.length === 0 ? (
            <div className="cart-empty"><History size={48} /><p>Chưa có đơn nào.<br />Hãy đặt món đầu tiên của bạn!</p></div>
          ) : (
            <>
              {historySlice.map((order) => (
                <div className="history-card" key={order.id}>
                  <div className="history-card-head">
                    <div className="order-meta"><b>#{order.dailySequence} — {order.table?.name}</b><div className="time">{order.createdAt ? new Date(order.createdAt).toLocaleString('vi-VN') : ''}</div></div>
                    <div className="price-col"><div className="amt">{money(order.subtotal)}</div></div>
                  </div>
                  <div className="history-badges"><StatusBadge text={order.status} /><StatusBadge text={order.paymentStatus} /></div>
                  <div className="history-items">{order.items.map((item) => (<span key={item.id}>{item.quantity}× {item.name}</span>))}</div>
                  {order.status === 'NEW' && (<button className="btn btn-danger btn-full mt-2" style={{ marginTop: 10 }} onClick={() => cancelOrder(order.id)}><Trash2 size={14} /> Hủy đơn đang chờ</button>)}
                </div>
              ))}
              {totalPages > 1 && <Pagination page={historyPage} total={totalPages} onChange={setHistoryPage} />}
            </>
          )}
        </div>
      )}

      {paymentChoiceOpen && draftOrder && (
        <div className="modal-backdrop">
          <div className="modal">
            <button className="modal-close-btn" type="button" aria-label="Đóng" onClick={() => { setPaymentChoiceOpen(false); setDraftOrder(null); }}>✕</button>
            <div className="modal-icon info"><Utensils size={24} /></div>
            <h2>Xác nhận gọi món</h2>
            <p>Đơn hàng của bạn sẽ được chuyển đến nhà bếp để chế biến. Bạn đồng ý gửi yêu cầu chứ?</p>
            <div className="modal-actions">
              <button className="btn btn-primary btn-full btn-lg" onClick={confirmOrder}>Gọi món ngay</button>
              {/* Tạm ẩn hình thức chuyển khoản trực tuyến
              <button className="btn btn-ghost btn-full btn-lg" disabled>🏦 Chuyển khoản (Tạm tắt)</button>
              */}
              <button className="btn btn-ghost btn-full btn-lg" onClick={() => { setPaymentChoiceOpen(false); setDraftOrder(null); }}>Hủy</button>
            </div>
          </div>
        </div>
      )}

      {successPopup && (
        <div className="modal-backdrop">
          <div className="modal">
            <div className="modal-icon success"><Check size={24} /></div>
            <h2>Gọi món thành công!</h2>
            <p>Đơn #{successPopup.order?.dailySequence || ''} đã được gửi đến nhà bếp. Quý khách vui lòng thanh toán tại quầy sau khi dùng bữa.</p>
            <div className="modal-actions">
              <button className="btn btn-primary btn-full btn-lg" onClick={() => { setSuccessPopup(null); setActiveTab('history'); }}>Xem đơn của tôi</button>
              <button className="btn btn-ghost btn-full" onClick={() => setSuccessPopup(null)}>Tiếp tục gọi món</button>
            </div>
          </div>
        </div>
      )}

      {infoPopup && (
        <div className="modal-backdrop">
          <div className="modal">
            <div className="modal-icon warning"><Info size={24} /></div>
            <h2>{infoPopup.title}</h2>
            <p>{infoPopup.body}</p>
            <div className="modal-actions"><button className="btn btn-primary btn-full btn-lg" onClick={() => setInfoPopup(null)}>Đóng</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

function Pagination({ page, total, onChange }) {
  return (
    <div className="pagination">
      <button className="page-btn" onClick={() => onChange(page - 1)} disabled={page === 1}><ChevronLeft size={14} /></button>
      {Array.from({ length: total }, (_, i) => i + 1).map((p) => (
        <button key={p} className={`page-btn ${p === page ? 'active' : ''}`} onClick={() => onChange(p)}>{p}</button>
      ))}
      <button className="page-btn" onClick={() => onChange(page + 1)} disabled={page === total}><ChevronRight size={14} /></button>
    </div>
  );
}

const STATUS_MAP = {
  NEW: 'Mới', PREPARING: 'Đang làm', DELIVERING: 'Đang giao',
  DELIVERED: 'Đã giao', CANCELLED: 'Đã hủy',
  PAID: 'Đã thanh toán', UNPAID: 'Chưa thanh toán', PENDING_PAYMENT: 'Chưa thanh toán',
};
function StatusBadge({ text }) {
  const key = String(text).toLowerCase();
  if (String(text) === 'NEW') {
    return <span className="badge badge-new-order">{STATUS_MAP[text] || text}</span>;
  }
  return <span className={`badge badge-${key}`}>{STATUS_MAP[text] || text}</span>;
}

function PaymentResult() {
  return (
    <div className="result-page">
      <ReceiptText size={52} />
      <h1>Đã quay lại từ cổng thanh toán</h1>
      <p>Quán sẽ nhận trạng thái chính thức từ webhook PayOS. Nếu ngân hàng đã báo thành công, đơn sẽ tự chuyển sang đang làm.</p>
      <a href="/">← Về trang chính</a>
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// BACK-OFFICE
// ══════════════════════════════════════════════════════════
function BackOffice() {
  const [user, setUser] = useState(getUser());
  if (!user) return <Login onLogin={setUser} />;
  return <DashboardShell user={user} onLogout={() => { logout(); setUser(null); }} onUserChange={setUser} />;
}

function Login({ onLogin }) {
  const [phone, setPhone]           = useState('');
  const [pin, setPin]               = useState('');
  const [error, setError]           = useState('');
  const [requiresPin, setRequiresPin] = useState(false);
  const [loading, setLoading]       = useState(false);
  const [displayPhone, setDisplayPhone] = useState('');

  function getOrCreateDeviceId() {
    let deviceId = localStorage.getItem('vanmerchant_device_id');
    if (!deviceId) {
      deviceId = 'dev_' + Math.random().toString(36).substr(2, 16);
      localStorage.setItem('vanmerchant_device_id', deviceId);
    }
    return deviceId;
  }

  async function submit(e) {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      const deviceId = getOrCreateDeviceId();
      const response = await api('/api/auth/login-phone', { method: 'POST', body: JSON.stringify({ phone, deviceId }) });
      if (response.requiresPin) { setDisplayPhone(response.phone); setRequiresPin(true); setPin(''); }
      else { setSession(response); onLogin(response.user); }
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }

  async function submitPin(e) {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      const deviceId = getOrCreateDeviceId();
      const response = await api('/api/auth/verify-pin', { method: 'POST', body: JSON.stringify({ phone, deviceId, pin }) });
      setSession(response); onLogin(response.user);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }

  if (requiresPin) {
    return (
      <div className="login-page">
        <form className="login-card" onSubmit={submitPin}>
          <div className="logo-area"><ChefHat size={36} /><h1>Nhập Mã PIN</h1></div>
          <p className="sub">Nhập mã PIN 6 chữ số (****{displayPhone})</p>
          <input className="field" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" maxLength="6" autoFocus disabled={loading} type="password" />
          {error && <p className="notice notice-err">{error}</p>}
          <button className="btn btn-primary btn-lg btn-full" type="submit" disabled={loading || pin.length !== 6}>{loading ? 'Đang xác minh...' : 'Xác minh'}</button>
          <button className="btn btn-ghost btn-lg btn-full" type="button" onClick={() => { setRequiresPin(false); setPin(''); setError(''); }} disabled={loading}>Quay lại</button>
        </form>
      </div>
    );
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit}>
        <div className="logo-area"><ChefHat size={36} /><h1>Trà Nhà Lâm POS</h1></div>
        <p className="sub">Quản lý quán, đơn hàng & nhân sự</p>
        <div className="field-group">
          <Phone size={18} />
          <input className="field" value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))} placeholder="Số điện thoại" type="tel" autoFocus disabled={loading} />
        </div>
        {error && <p className="notice notice-err">{error}</p>}
        <button className="btn btn-primary btn-lg btn-full" type="submit" disabled={loading || phone.length < 8}>{loading ? 'Đang xử lý...' : 'Đăng nhập'}</button>
      </form>
    </div>
  );
}

function DashboardShell({ user, onLogout, onUserChange }) {
  const canManage = ['OWNER', 'ADMIN'].includes(user.role);
  const isAdmin = user.role === 'ADMIN';
  const [tab, setTab]           = useState(canManage ? 'overview' : 'orders');
  const [refreshToken, setRefresh] = useState(0);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  // Notification state for new orders
  const [notice, setNotice] = useState(null);
  const [bellEnabled, setBellEnabled] = useState(() => localStorage.getItem('vanmerchant_bell_enabled') !== 'off');
  const [appVersion, setAppVersion] = useState('');
  const [newOrderCount, setNewOrderCount] = useState(0);
  const noticeTimerRef = useRef(null);
  const bellAudioRef = useRef(null);

  // Play ringtone from the bundled WAV file, with Web Audio fallback
  function playBell() {
    try {
      if (!bellAudioRef.current) {
        bellAudioRef.current = new Audio('/mixkit-bell-notification-933.wav');
        bellAudioRef.current.preload = 'auto';
      }

      const audio = bellAudioRef.current;
      audio.currentTime = 0;
      audio.volume = 0.9;
      const playPromise = audio.play();
      if (playPromise?.catch) {
        playPromise.catch(() => {
          const ctx = new (window.AudioContext || window.webkitAudioContext)();
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          o.type = 'sine';
          o.frequency.value = 880;
          g.gain.value = 0.0001;
          o.connect(g);
          g.connect(ctx.destination);
          const now = ctx.currentTime;
          g.gain.setValueAtTime(0.0001, now);
          g.gain.exponentialRampToValueAtTime(0.2, now + 0.01);
          o.start(now);
          g.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);
          o.stop(now + 0.7);
        });
      }
    } catch (e) {
      // ignore audio errors
    }
  }

  // Show a mobile-friendly toast notification
  function showNotice(title, body) {
    setNotice({ title, body });
    if (bellEnabled) playBell();
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => setNotice(null), 6000);
  }

  useEffect(() => {
    localStorage.setItem('vanmerchant_bell_enabled', bellEnabled ? 'on' : 'off');
  }, [bellEnabled]);

  useEffect(() => {
    fetch(`${API_BASE}/api/public/version`).then((r) => r.json()).then((d) => setAppVersion(d.version)).catch(() => {});
  }, []);

  useEffect(() => {
    if (tab === 'orders') setNewOrderCount(0);
  }, [tab]);

  const navItems = [
    { id: 'overview',     label: 'Doanh thu',   hint: 'Xem doanh thu hôm nay', icon: <BarChart3 size={18} />,        visible: isAdmin },
    { id: 'orders',       label: 'Đang làm',    hint: 'Đơn mới và đang nấu', icon: <ClipboardList size={18} />,     visible: true },
    { id: 'delivery',     label: 'Chờ giao',    hint: 'Đơn chuẩn bị giao', icon: <ReceiptText size={18} />,         visible: true },
    { id: 'unpaid',       label: 'Đơn chưa TT', hint: 'Các đơn chưa thanh toán', icon: <Banknote size={18} />,       visible: true },
    { id: 'history',      label: 'Lịch sử',     hint: 'Các đơn đã xử lý', icon: <History size={18} />,             visible: true },
    { id: 'menu',         label: 'Menu',        hint: 'Món ăn và giá bán', icon: <Utensils size={18} />,             visible: canManage },
    { id: 'tables',       label: 'Bàn & QR',    hint: 'Mã bàn và in QR', icon: <QrCode size={18} />,                 visible: canManage },
    { id: 'accounts',     label: 'Tài khoản',   hint: 'Quản lý nhân sự', icon: <Users size={18} />,                  visible: canManage },
  ].filter((n) => n.visible);

  useRealtimeUpdates(['orders'], (payload) => {
    if (payload.resource !== 'orders' || payload.action !== 'created') return;

    if (tab !== 'orders') {
      setNewOrderCount((current) => current + 1);
    }

    const title = payload.dailySequence ? `Đơn mới #${payload.dailySequence}` : 'Đơn mới';
    const count = Number(payload.itemCount || 0);
    const tableName = payload.tableName || 'Có đơn mới';
    const total = Number.isFinite(payload.subtotal) ? money(payload.subtotal) : '';
    const body = [tableName, count ? `${count} món` : '', total].filter(Boolean).join(' • ');
    showNotice(title, body || 'Có đơn hàng mới.');
  });

 

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand"><Store size={22} /><span>Trà Nhà Lâm</span></div>
        <nav className="sidebar-nav">
          {navItems.map((n) => (
            <button key={n.id} className={`nav-item ${tab === n.id ? 'active' : ''}`} onClick={() => { setTab(n.id); setMobileNavOpen(false); }}>
              {n.icon}<span className="nav-label nav-label-desktop">{n.label}</span>
              {n.id === 'orders' && newOrderCount > 0 && <span className="nav-badge">{newOrderCount > 99 ? '99+' : newOrderCount}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button className="nav-item" onClick={onLogout} style={{ width: '100%' }}><LogOut size={18} /><span className="nav-label nav-label-desktop">Đăng xuất</span></button>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.8)', paddingLeft: 8 }} id="app-version">{appVersion ? `v${appVersion}` : ''}</div>
              </div>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div className="topbar-user"><p>{user.role}</p><h1>{user.name}</h1></div>
          <div className="topbar-actions">
            <button className="btn btn-ghost topbar-menu-btn" onClick={() => setMobileNavOpen(true)}><Menu size={15} /> Menu</button>
            <button
              className="btn btn-ghost"
              type="button"
              onClick={() => setBellEnabled((current) => !current)}
              title={bellEnabled ? 'Tắt chuông thông báo' : 'Bật chuông thông báo'}
            >
              {bellEnabled ? <Bell size={15} /> : <BellOff size={15} />}
              {bellEnabled ? 'Chuông' : 'Tắt chuông'}
            </button>
            <button className="btn btn-ghost" onClick={() => setRefresh((v) => v + 1)}><RefreshCw size={15} /> Làm mới</button>
          </div>
        </header>
        <div className="workspace-body">
          {tab === 'overview'    && <Overview refreshToken={refreshToken} />}
          {tab === 'orders'      && <Orders title="Bill đang làm" statuses={['NEW', 'PREPARING']} user={user} refreshToken={refreshToken} />}
          {tab === 'delivery'    && <Orders title="Bill chờ giao" statuses={['DELIVERING']} user={user} emptyText="Chưa có bill nào chờ giao." refreshToken={refreshToken} />}
          {tab === 'unpaid'      && <UnpaidOrders refreshToken={refreshToken} user={user} />}
          {tab === 'history'     && <OrderHistory user={user} refreshToken={refreshToken} />}
          {tab === 'menu'        && <MenuManager refreshToken={refreshToken} />}
          {tab === 'tables'      && <TableManager refreshToken={refreshToken} />}
          {tab === 'accounts'    && <AccountManager currentUser={user} onCurrentUserChange={onUserChange} refreshToken={refreshToken} onLogout={onLogout} />}
        </div>
      </div>
      {notice && (
        <div className="notification-toast" role="status" aria-live="polite" onClick={() => setNotice(null)}>
          <div className="notification-title">{notice.title}</div>
          <div className="notification-body">{notice.body}</div>
        </div>
      )}

      <div className={`mobile-nav-drawer ${mobileNavOpen ? 'open' : ''}`} aria-hidden={!mobileNavOpen}>
        <button className="mobile-nav-backdrop" type="button" onClick={() => setMobileNavOpen(false)} aria-label="Đóng menu" />
        <div className="mobile-nav-panel" role="dialog" aria-label="Điều hướng quản trị">
          <div className="mobile-nav-head">
            <div><p>Điều hướng</p><h2>Chọn chức năng</h2></div>
            <button className="btn btn-ghost" type="button" onClick={() => setMobileNavOpen(false)}>Đóng</button>
          </div>
          <nav className="mobile-nav-list">
            {navItems.map((n) => (
              <button key={n.id} className={`mobile-nav-item ${tab === n.id ? 'active' : ''}`} onClick={() => { setTab(n.id); setMobileNavOpen(false); }}>
                <span className="mobile-nav-icon">{n.icon}</span>
                <span className="mobile-nav-text"><b>{n.label}</b><small>{n.hint}</small></span>
                {n.id === 'orders' && newOrderCount > 0 && <span className="nav-badge mobile">{newOrderCount > 99 ? '99+' : newOrderCount}</span>}
                <ChevronRight size={16} />
              </button>
            ))}
          </nav>
          <button className="mobile-nav-logout" type="button" onClick={onLogout}><LogOut size={18} /> Đăng xuất</button>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// OVERVIEW — Redesigned per wireframe
// ══════════════════════════════════════════════════════════

const PIE_COLORS = ['#ef4444','#22c55e','#f97316','#06b6d4','#a855f7','#3b82f6','#eab308'];

// Custom active pie slice
function renderActiveShape(props) {
  const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill, payload, percent, value } = props;
  return (
    <g>
      <text x={cx} y={cy - 14} textAnchor="middle" fill="var(--ink)" style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15 }}>{payload.name}</text>
      <text x={cx} y={cy + 10} textAnchor="middle" fill="var(--ink-2)" style={{ fontSize: 13 }}>{value} đơn vị</text>
      <text x={cx} y={cy + 28} textAnchor="middle" fill="var(--ink-3)" style={{ fontSize: 12 }}>{(percent * 100).toFixed(1)}%</text>
      <Sector cx={cx} cy={cy} innerRadius={innerRadius} outerRadius={outerRadius + 8} startAngle={startAngle} endAngle={endAngle} fill={fill} />
      <Sector cx={cx} cy={cy} innerRadius={innerRadius - 4} outerRadius={innerRadius - 2} startAngle={startAngle} endAngle={endAngle} fill={fill} />
    </g>
  );
}

// Custom tooltip for bar chart
function CustomBarTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: 'rgba(255,255,255,0.95)', border: '1px solid var(--border)', borderRadius: 12, padding: '10px 14px', boxShadow: '0 8px 24px rgba(0,0,0,0.12)' }}>
      <div style={{ fontWeight: 700, marginBottom: 4, fontSize: 13 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ fontSize: 13, color: p.fill }}>{p.name}: <b>{typeof p.value === 'number' && p.name === 'Doanh thu' ? money(p.value) : p.value}</b></div>
      ))}
    </div>
  );
}

function Overview({ refreshToken }) {
  const [data, setData]             = useState(null);
  const [period, setPeriod]         = useState('day');
  const [topProducts, setTopProducts] = useState([]);
  const [barData, setBarData]       = useState([]);
  const [activePieIndex, setActivePieIndex] = useState(0);
  const chartScrollRef = useRef(null);
  const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' ? window.innerWidth <= 700 : false);

  const load = () => api('/api/admin/dashboard').then(setData);
  useEffect(() => { load(); }, [refreshToken]);
  useRealtimeUpdates(['dashboard', 'orders'], load);

  useEffect(() => {
    api(`/api/admin/top-products?period=${period}`)
      .then(setTopProducts)
      .catch(() => setTopProducts([]));
  }, [period]);

  useEffect(() => {
    function onResize() {
      setIsMobile(window.innerWidth <= 700);
    }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Build bar chart data from top-products or historical endpoint
  useEffect(() => {
    // Try to fetch time-series data; fall back to simple single-bar
    api(`/api/admin/revenue-series?period=${period}`)
      .then((series) => {
        setBarData(series);
      })
      .catch(() => {
        // Fallback: single aggregated bar
        if (data) {
          const labelMap = { day: 'Theo ngày', month: 'Theo tháng', year: 'Theo năm' };
          setBarData([{ label: labelMap[period], revenue: data.revenue, orders: data.orderCount }]);
        }
      });
  }, [period, data]);

  // Auto-scroll to the beginning on data change
  if (!data) return (
    <div className="ov-loading">
      <div className="ov-spinner" />
      <span>Đang tải dữ liệu…</span>
    </div>
  );

  const periodLabels = { day: 'Theo ngày', month: 'Theo tháng', year: 'Theo năm' };
  const chartLabels = { day: '10 ngày gần nhất', month: '10 tháng gần nhất', year: '10 năm gần nhất' };

  const displayCount = isMobile ? 5 : 10;
  const displayedBarData = barData && barData.length ? barData.slice(Math.max(0, barData.length - displayCount)) : barData;

  // Pie data: top 6 + "Khác"
  const top6 = topProducts.slice(0, 6);
  const othersCount = topProducts.slice(6).reduce((s, p) => s + (p.totalQuantity || 0), 0);
  const pieData = [
    ...top6.map((p) => ({ name: p.name, value: p.totalQuantity || 0, revenue: p.totalRevenue || 0 })),
    ...(othersCount > 0 ? [{ name: 'Khác', value: othersCount, revenue: 0 }] : []),
  ];
  const totalPieCount = pieData.reduce((s, p) => s + p.value, 0);

  return (
    <div className="ov-root">
      {/* ── HEADER ── */}
      <div className="ov-header">
        <div>
          <h2 className="ov-title">Doanh thu</h2>
          <p className="ov-subtitle">Thống kê {periodLabels[period].toLowerCase()}</p>
        </div>
        <div className="ov-period-tabs">
          {Object.entries(periodLabels).map(([key, label]) => (
            <button key={key} className={`ov-period-btn ${period === key ? 'active' : ''}`} onClick={() => setPeriod(key)}>{label}</button>
          ))}
        </div>
      </div>

      {/* ── ROW 1: Metrics (left) + Bar Chart (right) ── */}
      <div className="ov-row1">
        {/* Metrics stack */}
        <div className="ov-metrics-col">
          <div className="ov-metric-card ov-metric-revenue">
            <div className="ov-metric-icon"><TrendingUp size={20} /></div>
            <div className="ov-metric-body">
              <div className="ov-metric-label">Tổng doanh thu ({periodLabels[period].toLowerCase()})</div>
              <div className="ov-metric-value">{money(data.revenue)}</div>
            </div>
          </div>
          <div className="ov-metric-card ov-metric-orders">
            <div className="ov-metric-icon"><ShoppingBasket size={20} /></div>
            <div className="ov-metric-body">
              <div className="ov-metric-label">Số đơn ({periodLabels[period].toLowerCase()})</div>
              <div className="ov-metric-value">{data.orderCount} <span className="ov-metric-unit">đơn</span></div>
            </div>
          </div>
        </div>

        {/* Bar chart */}
        <div className="ov-chart-card">
          <div className="ov-chart-title">Doanh thu {chartLabels[period].toLowerCase()}</div>
          {barData.length === 0 ? (
            <div className="ov-empty-chart">Không có dữ liệu</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={displayedBarData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }} barCategoryGap="25%">
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 12, fill: 'var(--ink-3)', angle: isMobile ? -35 : 0, textAnchor: isMobile ? 'end' : 'middle' }} axisLine={false} tickLine={false} interval={0} />
                <YAxis tickFormatter={(v) => v >= 1000000 ? `${(v / 1000000).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(0)}K` : v} tick={{ fontSize: 11, fill: 'var(--ink-3)' }} axisLine={false} tickLine={false} width={52} />
                <Tooltip content={<CustomBarTooltip />} cursor={{ fill: 'rgba(37,99,235,0.06)', radius: 8 }} />
                <Bar dataKey="revenue" name="Doanh thu" fill="url(#barGrad)" radius={[6, 6, 0, 0]} />
                <defs>
                  <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3b82f6" stopOpacity={1} />
                    <stop offset="100%" stopColor="#1d4ed8" stopOpacity={0.85} />
                  </linearGradient>
                </defs>
              </BarChart>
            </ResponsiveContainer>
          )}
          <div className="ov-bar-xaxis-label">
            {period === 'day' && '10 ngày gần nhất'}
            {period === 'month' && '10 tháng gần nhất'}
            {period === 'year' && '10 năm gần nhất'}
          </div>
        </div>
      </div>

      {/* ── ROW 2: Ranking (left) + Pie Chart (right) ── */}
      <div className="ov-row2">
        {/* Ranking table */}
        <div className="ov-ranking-card">
          <div className="ov-ranking-header">
            <BarChart3 size={16} />
            <span>Bảng xếp hạng</span>
          </div>
          {topProducts.length === 0 ? (
            <div className="ov-empty-chart" style={{ padding: '32px 16px' }}>Không có dữ liệu</div>
          ) : (
            <div className="ov-ranking-list">
              {topProducts.slice(0, isMobile ? 5 : 10).map((product, idx) => (
                <div key={product.id} className={`ov-ranking-row ${idx < 3 ? 'top3' : ''}`}>
                  <div className="ov-rank-badge" style={{ background: PIE_COLORS[idx % PIE_COLORS.length] }}>
                    {idx + 1}
                  </div>
                  <div className="ov-rank-info">
                    <div className="ov-rank-name">{product.name}</div>
                    <div className="ov-rank-qty">{product.totalQuantity} đơn vị bán</div>
                  </div>
                  <div className="ov-rank-revenue">{money(product.totalRevenue)}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Pie chart */}
        <div className="ov-pie-card">
          <div className="ov-ranking-header">
            <ShoppingBasket size={16} />
            <span>Số lượng bán hàng</span>
          </div>
          {pieData.length === 0 ? (
            <div className="ov-empty-chart" style={{ padding: '32px 16px' }}>Không có dữ liệu</div>
          ) : (
            <div className="ov-pie-layout">
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie
                    activeIndex={activePieIndex}
                    activeShape={renderActiveShape}
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={68}
                    outerRadius={100}
                    dataKey="value"
                    onMouseEnter={(_, index) => setActivePieIndex(index)}
                    stroke="none"
                  >
                    {pieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              {/* Legend */}
              <div className="ov-pie-legend">
                {pieData.map((entry, index) => {
                  const pct = totalPieCount > 0 ? ((entry.value / totalPieCount) * 100).toFixed(1) : 0;
                  return (
                    <div
                      key={index}
                      className={`ov-legend-item ${activePieIndex === index ? 'active' : ''}`}
                      onMouseEnter={() => setActivePieIndex(index)}
                    >
                      <div className="ov-legend-dot" style={{ background: PIE_COLORS[index % PIE_COLORS.length] }} />
                      <div className="ov-legend-label">
                        <span className="ov-legend-name">Top {index + 1}{index >= 6 ? '' : ''}{entry.name === 'Khác' ? ' (khác)' : ''}</span>
                        <span className="ov-legend-pct">{entry.value} đơn • {pct}%</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Orders (kanban-style) ──────────────────────────────────
const ORDERS_PER_PAGE = 12;

function Orders({ title, statuses, emptyText = 'Chưa có bill.', user, refreshToken }) {
  const [orders, setOrders] = useState([]);
  const [page, setPage]     = useState(1);
  const [selectedOrderId, setSelectedOrderId] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const statusQuery = statuses?.length ? `?status=${statuses.join(',')}` : '';
  const load = () => api(`/api/orders${statusQuery}`).then(setOrders);
  useEffect(() => { load(); setPage(1); }, [statusQuery, refreshToken]);
  useRealtimeUpdates(['orders', 'dashboard'], load);

  async function update(id, patch) {
    await api(`/api/orders/${id}/status`, { method: 'PATCH', body: JSON.stringify(patch) });
    load();
  }

  const normalizedSearch = searchTerm.trim().toLowerCase();
  const availableTypes = Array.from(new Set(orders.map((order) => order.status))).sort();
  const filteredOrders = orders.filter((order) => {
    const matchType = typeFilter === 'all' || order.status === typeFilter;
    if (!matchType) return false;
    if (!normalizedSearch) return true;
    const haystack = [
      order.dailySequence,
      order.table?.name || '',
      order.customer?.phone || '',
      order.items?.map((item) => item.name).join(' ') || ''
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(normalizedSearch);
  });
  const totalPages = Math.max(1, Math.ceil(filteredOrders.length / ORDERS_PER_PAGE));
  const slice = filteredOrders.slice((page - 1) * ORDERS_PER_PAGE, page * ORDERS_PER_PAGE);
  const selectedOrder = orders.find((o) => o.id === selectedOrderId);

  useEffect(() => {
    if (typeFilter !== 'all' && !availableTypes.includes(typeFilter)) {
      setTypeFilter('all');
    }
  }, [availableTypes, typeFilter]);

  return (
    <div>
      <div className="section-head"><h2>{title}</h2><span className="count">{filteredOrders.length} đơn</span></div>
      <div className="orders-toolbar">
        <div className="menu-search-box field-group orders-search-box">
          <Search size={16} />
          <input
            className="field"
            value={searchTerm}
            onChange={(e) => { setSearchTerm(e.target.value); setPage(1); }}
            placeholder="Tìm theo bàn, SĐT, món hoặc mã bill"
            type="search"
          />
        </div>
        <div className="menu-filter-chips">
          <button
            type="button"
            className={`filter-chip ${typeFilter === 'all' ? 'active' : ''}`}
            onClick={() => { setTypeFilter('all'); setPage(1); }}
          >
            Tất cả
          </button>
          {availableTypes.map((status) => (
            <button
              key={status}
              type="button"
              className={`filter-chip ${typeFilter === status ? 'active' : ''}`}
              onClick={() => { setTypeFilter(status); setPage(1); }}
            >
              {STATUS_MAP[status] || status}
            </button>
          ))}
        </div>
      </div>
      {filteredOrders.length === 0 && <div className="empty-state"><ClipboardList size={40} /><p>{emptyText}</p></div>}
      <div className="orders-grid">
        {slice.map((order) => (
          <div className="order-card" key={order.id}>
            <div className="order-card-header">
              <div>
                <h3>#{order.dailySequence} — {order.table?.name}</h3>
                {order.createdAt && <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{new Date(order.createdAt).toLocaleTimeString('vi-VN')} • {order.customer?.phone?.slice(-6)}</div>}
              </div>
              <span className="price">{money(order.subtotal)}</span>
            </div>
            <div className="order-badges"><StatusBadge text={order.status} /><StatusBadge text={order.paymentStatus} /></div>
            <div className="order-items-list">
              {order.items.map((item) => (
                <div className="order-item-row" key={item.id}><span>{item.quantity}× {item.name}</span><span>{money(item.price * item.quantity)}</span></div>
              ))}
            </div>
            <div className="order-actions">
              <button className="btn btn-ghost" onClick={() => setSelectedOrderId(order.id)}><Eye size={14} /> Chi tiết</button>
              <button className="btn btn-ghost" onClick={() => update(order.id, { status: 'PREPARING' })}><ChefHat size={14} /> Làm</button>
              <button className="btn btn-ghost" onClick={() => update(order.id, { status: 'DELIVERING' })}><ReceiptText size={14} /> Giao</button>
              <button className="btn btn-ghost" onClick={() => update(order.id, { status: 'DELIVERED' })}><Check size={14} /> Xong</button>
              {order.paymentStatus !== 'PAID' && <button className="btn btn-ghost" onClick={() => update(order.id, { paymentStatus: 'PAID' })}>💵 Đã TT</button>}
              {['OWNER', 'ADMIN'].includes(user?.role) && order.status !== 'CANCELLED' && (
                <button className="btn btn-danger" onClick={() => update(order.id, { status: 'CANCELLED' })}><Trash2 size={14} /> Hủy</button>
              )}
            </div>
          </div>
        ))}
      </div>
      {totalPages > 1 && <Pagination page={page} total={totalPages} onChange={setPage} />}
      {selectedOrder && (
        <div className="modal-overlay" onClick={() => setSelectedOrderId(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header"><h2>Chi tiết Bill #{selectedOrder.dailySequence}</h2><button className="btn btn-ghost" onClick={() => setSelectedOrderId(null)}>✕</button></div>
            <div className="modal-body">
              <div className="bill-section">
                <div className="bill-row"><span>Bàn:</span><b>{selectedOrder.table?.name}</b></div>
                <div className="bill-row"><span>Khách:</span><b>{selectedOrder.customer?.phone}</b></div>
                <div className="bill-row"><span>Ngày đặt:</span><b>{new Date(selectedOrder.createdAt).toLocaleString('vi-VN')}</b></div>
              </div>
              <div className="bill-section">
                <h3>Danh sách món</h3>
                {selectedOrder.items.map((item) => (<div className="bill-row" key={item.id}><span>{item.quantity}× {item.name}</span><b>{money(item.price * item.quantity)}</b></div>))}
              </div>
              <div className="bill-section" style={{ borderTop: '2px solid var(--border)', paddingTop: 12 }}>
                <div className="bill-row" style={{ fontSize: 14, fontWeight: 700 }}><span>Tổng cộng:</span><b>{money(selectedOrder.subtotal)}</b></div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ActivityHistoryModal({ order, onClose }) {
  if (!order) return null;
  const events = [
    { status: 'created', label: 'Đặt hàng', time: order.createdAt, details: `${order.customer?.name || 'Khách'} - ${order.customer?.phone}` },
    ...(order.status === 'PREPARING' || order.completedAt || order.status === 'DELIVERING' || order.deliveredAt || order.status === 'DELIVERED' || order.status === 'CANCELLED'
      ? [{ status: 'preparing', label: 'Đang làm', time: order.preparingAt || order.createdAt, details: `${order.preparingBy || 'Nhân viên'} - ${order.preparingPhone || ''}`.trim() }] : []),
    ...(order.status === 'DELIVERING' || order.deliveredAt || order.status === 'DELIVERED' || order.status === 'CANCELLED'
      ? [{ status: 'delivering', label: 'Đang giao', time: order.deliveringAt || order.createdAt, details: 'Đang gửi đến khách' }] : []),
    ...(order.deliveredAt ? [{ status: 'delivered', label: 'Đã giao', time: order.deliveredAt, details: `${order.deliveredBy || 'Nhân viên'} - ${order.deliveredPhone || ''}`.trim() }] : []),
    ...(order.status === 'CANCELLED' ? [{ status: 'cancelled', label: 'Đã hủy', time: order.cancelledAt || order.updatedAt, details: order.cancelledBy ? `${order.cancelledBy} - ${order.cancelledPhone || ''}` : 'Khách hàng đã hủy đơn' }] : []),
    ...(order.paidAt ? [{ status: 'paid', label: 'Đã thanh toán', time: order.paidAt, details: `${order.paidByUser || 'Nhân viên'} - ${order.paidByPhone || ''}`.trim() }] : [])
  ];
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header"><h2>Lịch sử hoạt động #{order.dailySequence}</h2><button className="btn btn-ghost" onClick={onClose}>✕</button></div>
        <div className="modal-body">
          <div className="timeline">
            {events.map((event, idx) => (
              <div key={idx} className="timeline-item">
                <div className="timeline-marker" style={{ background: 'var(--green)' }}></div>
                <div className="timeline-content">
                  <div className="timeline-label">{event.label}</div>
                  <div className="timeline-time">{new Date(event.time).toLocaleString('vi-VN')}</div>
                  <div className="timeline-details">{event.details}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function BillDetailModal({ order, onClose }) {
  const [showActivityHistory, setShowActivityHistory] = useState(false);
  if (!order) return null;
  return (
    <>
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-content" onClick={(e) => e.stopPropagation()}>
          <div className="modal-header"><h2>Chi tiết Bill #{order.dailySequence}</h2><button className="btn btn-ghost" onClick={onClose}>✕</button></div>
          <div className="modal-body">
            <div className="bill-section">
              <div className="bill-row"><span>Bàn:</span><b>{order.table?.name}</b></div>
              <div className="bill-row"><span>Khách:</span><b>{order.customer?.phone}</b></div>
              <div className="bill-row"><span>Ngày đặt:</span><b>{new Date(order.createdAt).toLocaleString('vi-VN')}</b></div>
              {order.completedAt && <div className="bill-row"><span>Hoàn thành:</span><b>{new Date(order.completedAt).toLocaleString('vi-VN')}</b></div>}
              {order.deliveredAt && <div className="bill-row"><span>Đã giao:</span><b>{new Date(order.deliveredAt).toLocaleString('vi-VN')}</b></div>}
              {order.paidAt && <div className="bill-row"><span>Thanh toán:</span><b>{new Date(order.paidAt).toLocaleString('vi-VN')}</b></div>}
            </div>
            <div className="bill-section">
              <h3>Danh sách món</h3>
              {order.items.map((item) => (<div className="bill-row" key={item.id}><span>{item.quantity}× {item.name}</span><b>{money(item.price * item.quantity)}</b></div>))}
            </div>
            <div className="bill-section" style={{ borderTop: '2px solid var(--border)', paddingTop: 12 }}>
              <div className="bill-row" style={{ fontSize: 14, fontWeight: 700 }}><span>Tổng cộng:</span><b>{money(order.subtotal)}</b></div>
            </div>
            <div className="bill-section" style={{ paddingTop: 12 }}>
              <button className="btn btn-primary" style={{ width: '100%' }} onClick={() => setShowActivityHistory(true)}><History size={14} /> Xem lịch sử hoạt động</button>
            </div>
          </div>
        </div>
      </div>
      {showActivityHistory && <ActivityHistoryModal order={order} onClose={() => setShowActivityHistory(false)} />}
    </>
  );
}

const HISTORY_PAGE_SIZE = 20;
function OrderHistory({ user, refreshToken }) {
  const [orders, setOrders] = useState([]);
  const [page, setPage]     = useState(1);
  const [selectedOrderId, setSelectedOrderId] = useState(null);
  const [searchPhone, setSearchPhone] = useState('');
  const [searchDate, setSearchDate] = useState('');
  const load = () => api('/api/orders').then(setOrders);
  useEffect(() => { load(); setPage(1); }, [refreshToken]);
  useRealtimeUpdates(['orders'], load);

  const filteredOrders = orders.filter(order => {
    const phoneMatch = !searchPhone || order.customer?.phone?.includes(searchPhone);
    let dateMatch = true;
    if (searchDate) {
      const orderDate = new Date(order.createdAt).toLocaleDateString('vi-VN');
      const searchDateFormatted = new Date(searchDate).toLocaleDateString('vi-VN');
      dateMatch = orderDate === searchDateFormatted;
    }
    return phoneMatch && dateMatch;
  });

  const totalPages = Math.max(1, Math.ceil(filteredOrders.length / HISTORY_PAGE_SIZE));
  const slice = filteredOrders.slice((page - 1) * HISTORY_PAGE_SIZE, page * HISTORY_PAGE_SIZE);
  const selectedOrder = orders.find((o) => o.id === selectedOrderId);

  return (
    <div>
      <div className="section-head"><h2>Lịch sử đơn hàng</h2><span className="count">{filteredOrders.length} đơn</span></div>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 16, marginBottom: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        <div className="field-group" style={{ margin: 0 }}><Phone size={16} /><input className="field" type="tel" placeholder="Tìm theo SĐT" value={searchPhone} onChange={(e) => { setSearchPhone(e.target.value); setPage(1); }} /></div>
        <div className="field-group" style={{ margin: 0 }}><Calendar size={16} /><input className="field" type="date" value={searchDate} onChange={(e) => { setSearchDate(e.target.value); setPage(1); }} /></div>
        {(searchPhone || searchDate) && <button className="btn btn-ghost" onClick={() => { setSearchPhone(''); setSearchDate(''); setPage(1); }} style={{ alignSelf: 'flex-end' }}>Xóa bộ lọc</button>}
      </div>
      {filteredOrders.length === 0 && <div className="empty-state"><History size={40} /><p>Chưa có lịch sử đơn.</p></div>}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-s)', overflow: 'hidden' }}>
        {slice.map((order, i) => (
          <div key={order.id} style={{ padding: '12px 16px', borderBottom: i < slice.length - 1 ? '1px solid var(--border)' : 'none', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, cursor: 'pointer' }} onClick={() => setSelectedOrderId(order.id)}>
            <b style={{ fontFamily: 'var(--font-display)', minWidth: 60 }}>#{order.dailySequence}</b>
            <span style={{ flex: 1, fontSize: 14, color: 'var(--ink-2)' }}>{order.table?.name}</span>
            <span style={{ fontWeight: 700, color: 'var(--green)', whiteSpace: 'nowrap' }}>{money(order.subtotal)}</span>
            <StatusBadge text={order.status} /><StatusBadge text={order.paymentStatus} />
            {order.createdAt && <span className="muted" style={{ width: '100%', fontSize: 12 }}>{new Date(order.createdAt).toLocaleString('vi-VN')} • {order.customer?.phone} — {order.items.map((i) => `${i.quantity}× ${i.name}`).join(', ')}</span>}
          </div>
        ))}
      </div>
      {totalPages > 1 && <Pagination page={page} total={totalPages} onChange={setPage} />}
      {selectedOrder && <BillDetailModal order={selectedOrder} onClose={() => setSelectedOrderId(null)} />}
    </div>
  );
}

function MenuManager({ refreshToken }) {
  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [menuSearch, setMenuSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [showCategoryFilters, setShowCategoryFilters] = useState(false);
  const [showCategoryPanel, setShowCategoryPanel] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm]   = useState({ name: '', price: 0, description: '', imageUrl: '', categoryId: '' });
  const [editingId, setEditingId] = useState(null);
  const [editingForm, setEditingForm] = useState(null);
  const [editUploadFilename, setEditUploadFilename] = useState(null);
  const [showCategoryForm, setShowCategoryForm] = useState(false);
  const [categoryForm, setCategoryForm] = useState({ name: '', sortOrder: 0 });
  const [editingCategoryId, setEditingCategoryId] = useState(null);
  const [editingCategoryForm, setEditingCategoryForm] = useState(null);

  const loadItems = () => api('/api/admin/menu-items').then(setItems);
  const loadCategories = () => api('/api/admin/categories').then(setCategories);
  const loadMenu = () => Promise.all([loadItems(), loadCategories()]);

  useEffect(() => { loadMenu(); }, [refreshToken]);
  useRealtimeUpdates(['menu'], loadMenu);

  const [uploadFilename, setUploadFilename] = useState(null);

  async function chooseImage(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    // If there's a previous temp upload, delete it first
    try {
      if (uploadFilename) {
        const token = localStorage.getItem('vanmerchant_token');
        await fetch(`${API_BASE}/api/admin/upload-menu-image/${uploadFilename}`, { method: 'DELETE', headers: { Authorization: token ? `Bearer ${token}` : '' } });
        setUploadFilename(null);
      }
    } catch { /* ignore */ }

    const formData = new FormData();
    formData.append('image', file);
    const token = localStorage.getItem('vanmerchant_token');
    const res = await fetch(`${API_BASE}/api/admin/upload-menu-image`, { method: 'POST', body: formData, headers: { Authorization: token ? `Bearer ${token}` : '' } });
    if (!res.ok) {
      const txt = await res.text();
      alert('Upload thất bại: ' + txt);
      return;
    }
    const data = await res.json();
    setForm((c) => ({ ...c, imageUrl: data.imageUrl }));
    setUploadFilename(data.filename || null);
  }

  async function submit(e) {
    e.preventDefault();
    await api('/api/admin/menu-items', { method: 'POST', body: JSON.stringify({ ...form, price: Number(form.price), categoryId: form.categoryId || null }) });
    setForm({ name: '', price: 0, description: '', imageUrl: '', categoryId: '' });
    // clear temp upload marker (server persists file since DB references it)
    setUploadFilename(null);
    setShowAddForm(false);
    loadItems();
  }

  // If the user cancels the add form after uploading, remove the temp file
  async function handleToggleAddForm() {
    if (showAddForm && uploadFilename) {
      try {
        const token = localStorage.getItem('vanmerchant_token');
        await fetch(`${API_BASE}/api/admin/upload-menu-image/${uploadFilename}`, { method: 'DELETE', headers: { Authorization: token ? `Bearer ${token}` : '' } });
      } catch { /* ignore */ }
      setUploadFilename(null);
      setForm({ name: '', price: 0, description: '', imageUrl: '', categoryId: '' });
    }
    setShowAddForm((s) => !s);
  }

  function startEdit(item) {
    setEditingId(item.id);
    setEditingForm({ name: item.name, price: item.price, description: item.description || '', imageUrl: item.imageUrl || '', active: item.active !== false, categoryId: item.categoryId || '' });
    setEditUploadFilename(null);
  }

  async function chooseEditImage(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      if (editUploadFilename) {
        const token = localStorage.getItem('vanmerchant_token');
        await fetch(`${API_BASE}/api/admin/upload-menu-image/${editUploadFilename}`, { method: 'DELETE', headers: { Authorization: token ? `Bearer ${token}` : '' } });
        setEditUploadFilename(null);
      }
    } catch {}

    const formData = new FormData();
    formData.append('image', file);
    const token = localStorage.getItem('vanmerchant_token');
    const res = await fetch(`${API_BASE}/api/admin/upload-menu-image`, { method: 'POST', body: formData, headers: { Authorization: token ? `Bearer ${token}` : '' } });
    if (!res.ok) { alert('Upload thất bại'); return; }
    const data = await res.json();
    setEditingForm((c) => ({ ...c, imageUrl: data.imageUrl }));
    setEditUploadFilename(data.filename || null);
  }

  async function saveEdit(itemId) {
    await api(`/api/admin/menu-items/${itemId}`, { method: 'PUT', body: JSON.stringify({ ...editingForm, price: Number(editingForm.price), categoryId: editingForm.categoryId || null }) });
    // clear temp upload marker for edit
    setEditUploadFilename(null);
    setEditingId(null); setEditingForm(null); loadItems();
  }

  async function removeItem(itemId) {
    if (!window.confirm('Xóa vĩnh viễn món này?')) return;
    await api(`/api/admin/menu-items/${itemId}`, { method: 'DELETE' });
    if (editingId === itemId) { setEditingId(null); setEditingForm(null); }
    loadItems();
  }

  async function toggleOutOfStock(itemId) {
    await api(`/api/admin/menu-items/${itemId}/toggle-hidden`, { method: 'PUT' });
    loadItems();
  }

  function startEditCategory(category) {
    setEditingCategoryId(category.id);
    setEditingCategoryForm({ name: category.name, sortOrder: category.sortOrder ?? 0 });
    setShowCategoryForm(false);
  }

  async function submitCategory(e) {
    e.preventDefault();
    await api('/api/admin/categories', {
      method: 'POST',
      body: JSON.stringify({ name: categoryForm.name.trim(), sortOrder: Number(categoryForm.sortOrder) || 0 })
    });
    setCategoryForm({ name: '', sortOrder: 0 });
    setShowCategoryForm(false);
    loadCategories();
  }

  async function saveCategory(categoryId) {
    await api(`/api/admin/categories/${categoryId}`, {
      method: 'PUT',
      body: JSON.stringify({ name: editingCategoryForm.name.trim(), sortOrder: Number(editingCategoryForm.sortOrder) || 0 })
    });
    setEditingCategoryId(null);
    setEditingCategoryForm(null);
    loadCategories();
  }

  useEffect(() => {
    if (categoryFilter !== 'all' && !categories.some((category) => category.id === categoryFilter)) {
      setCategoryFilter('all');
    }
  }, [categories, categoryFilter]);

  const normalizedMenuSearch = menuSearch.trim().toLowerCase();
  const filteredItems = items.filter((item) => {
    const matchCategory = categoryFilter === 'all' || item.categoryId === categoryFilter;
    if (!matchCategory) return false;
    if (!normalizedMenuSearch) return true;
    const haystack = [item.name, item.description || '', item.category?.name || ''].join(' ').toLowerCase();
    return haystack.includes(normalizedMenuSearch);
  });

  async function removeCategory(categoryId, categoryName) {
    if (!window.confirm(`Xóa phân loại "${categoryName}"? Các món thuộc loại này sẽ được chuyển về chưa phân loại.`)) return;
    await api(`/api/admin/categories/${categoryId}`, { method: 'DELETE' });
    if (editingCategoryId === categoryId) {
      setEditingCategoryId(null);
      setEditingCategoryForm(null);
    }
    loadCategories();
    loadItems();
  }

  return (
    <div>
      <div className="section-head"><h2>Menu</h2><span className="count">{filteredItems.length} món</span></div>
      <button
        className={`menu-category-toggle ${showCategoryPanel ? 'active' : ''}`}
        type="button"
        onClick={() => setShowCategoryPanel((v) => !v)}
      >
        <span className="menu-category-toggle-left">
          {showCategoryPanel ? <EyeOff size={16} /> : <Eye size={16} />}
          <span>{showCategoryPanel ? 'Ẩn card phân loại' : 'Hiện card phân loại'}</span>
        </span>
        <span className="menu-category-toggle-count">{categories.length} loại</span>
      </button>
      {showCategoryPanel && (
        <div className="menu-category-panel">
          <div className="section-head" style={{ marginBottom: 12 }}>
            <h2>Phân loại</h2>
            <span className="count">{categories.length} loại</span>
          </div>
          <button className="btn btn-ghost" onClick={() => setShowCategoryForm((v) => !v)} style={{ marginBottom: 12 }}>
            <Plus size={16} /> {showCategoryForm ? 'Ẩn form' : 'Thêm phân loại'}
          </button>
          {showCategoryForm && (
            <form className="inline-form menu-category-form" onSubmit={submitCategory}>
              <input className="field" value={categoryForm.name} onChange={(e) => setCategoryForm({ ...categoryForm, name: e.target.value })} placeholder="Tên phân loại" required />
              <input className="field" type="number" value={categoryForm.sortOrder} onChange={(e) => setCategoryForm({ ...categoryForm, sortOrder: e.target.value })} placeholder="Thứ tự" />
              <button className="btn btn-primary" type="submit"><Plus size={16} /> Lưu phân loại</button>
            </form>
          )}
          <div className="category-grid">
            {categories.map((category) => {
              const count = items.filter((item) => item.categoryId === category.id).length;
              const isEditing = editingCategoryId === category.id && editingCategoryForm;
              return (
                <div key={category.id} className="category-admin-card">
                  {isEditing ? (
                    <div className="category-admin-edit">
                      <input className="field" value={editingCategoryForm.name} onChange={(e) => setEditingCategoryForm({ ...editingCategoryForm, name: e.target.value })} placeholder="Tên phân loại" />
                      <input className="field" type="number" value={editingCategoryForm.sortOrder} onChange={(e) => setEditingCategoryForm({ ...editingCategoryForm, sortOrder: e.target.value })} placeholder="Thứ tự" />
                      <div className="admin-card-actions">
                        <button className="btn btn-primary" type="button" onClick={() => saveCategory(category.id)}><Check size={14} /> Lưu</button>
                        <button className="btn btn-ghost" type="button" onClick={() => { setEditingCategoryId(null); setEditingCategoryForm(null); }}>Hủy</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="category-admin-head">
                        <div>
                          <b>{category.name}</b>
                          <p className="muted">{count} món</p>
                        </div>
                        <span className="category-order">#{category.sortOrder ?? 0}</span>
                      </div>
                      <div className="admin-card-actions">
                        <button className="btn btn-ghost" type="button" onClick={() => startEditCategory(category)}><Utensils size={14} /> Sửa</button>
                        <button className="btn btn-danger" type="button" onClick={() => removeCategory(category.id, category.name)}><Trash2 size={14} /> Xóa</button>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
      <div className="orders-toolbar">
        <div className="menu-search-box field-group orders-search-box">
          <Search size={16} />
          <input
            className="field"
            value={menuSearch}
            onChange={(e) => setMenuSearch(e.target.value)}
            placeholder="Tìm món theo tên hoặc mô tả"
            type="search"
          />
        </div>
        <div className="orders-filter-toggle-row">
          <button className="btn btn-ghost" type="button" onClick={() => setShowCategoryFilters((v) => !v)}>
            {showCategoryFilters ? 'Ẩn phân loại' : 'Hiện phân loại'}
          </button>
          {categoryFilter !== 'all' && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setCategoryFilter('all')}
            >
              Bỏ lọc: {categories.find((category) => category.id === categoryFilter)?.name || 'Đã chọn'}
            </button>
          )}
        </div>
        {showCategoryFilters && (
          <div className="menu-filter-chips">
            <button
              type="button"
              className={`filter-chip ${categoryFilter === 'all' ? 'active' : ''}`}
              onClick={() => setCategoryFilter('all')}
            >
              Tất cả
            </button>
            {categories.map((category) => (
              <button
                key={category.id}
                type="button"
                className={`filter-chip ${categoryFilter === category.id ? 'active' : ''}`}
                onClick={() => setCategoryFilter(category.id)}
              >
                {category.name}
              </button>
            ))}
          </div>
        )}
      </div>
      <button className="btn btn-primary" onClick={handleToggleAddForm} style={{ marginBottom: 16 }}><Plus size={16} /> {showAddForm ? 'Ẩn' : 'Thêm mới'}</button>
      {showAddForm && (
        <form className="menu-add-form" onSubmit={submit}>
          <label className="image-picker">
            {form.imageUrl ? <img src={form.imageUrl} alt="" /> : <><ImagePlus size={28} /><span>Thêm ảnh</span></>}
            <input type="file" accept="image/*" onChange={chooseImage} />
          </label>
          <div className="form-fields">
            <input className="field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Tên món" required />
            <input className="field" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="Giá bán (VND)" type="number" required />
            <textarea className="field" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Mô tả món" />
            <select className="field" value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
              <option value="">Chọn phân loại</option>
              {categories.map((cat) => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
            </select>
            <button className="btn btn-primary" type="submit"><Plus size={16} /> Thêm món</button>
          </div>
        </form>
      )}
      <div className="menu-grid">
        {filteredItems.map((item) => {
          const category = categories.find((c) => c.id === item.categoryId);
          return (
            <div className={`menu-admin-card ${item.hidden ? 'is-muted' : ''}`} key={item.id}>
              <img src={item.imageUrl || 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=300&q=60'} alt={item.name} />
              {editingId === item.id && editingForm ? (
                <div className="card-edit-panel">
                  <input className="field" value={editingForm.name} onChange={(e) => setEditingForm({ ...editingForm, name: e.target.value })} placeholder="Tên món" />
                  <input className="field" value={editingForm.price} onChange={(e) => setEditingForm({ ...editingForm, price: e.target.value })} placeholder="Giá bán" type="number" />
                  <textarea className="field" value={editingForm.description} onChange={(e) => setEditingForm({ ...editingForm, description: e.target.value })} placeholder="Mô tả" />
                  <input className="field" value={editingForm.imageUrl} onChange={(e) => setEditingForm({ ...editingForm, imageUrl: e.target.value })} placeholder="URL ảnh" />
                  <input type="file" accept="image/*" onChange={chooseEditImage} />
                  <select className="field" value={editingForm.categoryId} onChange={(e) => setEditingForm({ ...editingForm, categoryId: e.target.value })}>
                    <option value="">Chọn phân loại</option>
                    {categories.map((cat) => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
                  </select>
                  <div className="admin-card-actions">
                    <button className="btn btn-primary" type="button" onClick={() => saveEdit(item.id)}><Check size={14} /> Lưu</button>
                    <button className="btn btn-ghost" type="button" onClick={async () => { 
                      // if a temp edit upload exists, delete it
                      if (editUploadFilename) {
                        try { const token = localStorage.getItem('vanmerchant_token'); await fetch(`${API_BASE}/api/admin/upload-menu-image/${editUploadFilename}`, { method: 'DELETE', headers: { Authorization: token ? `Bearer ${token}` : '' } }); } catch {}
                        setEditUploadFilename(null);
                      }
                      setEditingId(null); setEditingForm(null); 
                    }}>Hủy</button>
                  </div>
                </div>
              ) : (
                <div className="menu-admin-body">
                  {category && <span className="category-badge" style={{ display: 'inline-block', fontSize: 11, backgroundColor: '#e8f2fc', color: '#1a5f9e', padding: '3px 8px', borderRadius: '4px', marginBottom: '6px' }}>{category.name}</span>}
                  <div className="info"><b>{item.name}</b><span className="price">{money(item.price)}</span></div>
                  <p className="muted menu-admin-desc">{item.description || 'Không có mô tả'}</p>
                  <div className="admin-card-actions">
                    <button className="btn btn-ghost" type="button" onClick={() => startEdit(item)}><Utensils size={14} /> Sửa</button>
                    <button className={`btn ${item.hidden ? 'btn-primary' : 'btn-ghost'}`} type="button" onClick={() => toggleOutOfStock(item.id)}>{item.hidden ? '⭕ Hết' : '● Còn'}</button>
                    <button className="btn btn-danger" type="button" onClick={() => removeItem(item.id)}><Trash2 size={14} /> Xóa</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function UnpaidOrders({ refreshToken, user }) {
  const [orders, setOrders] = useState([]);
  const [selectedOrderId, setSelectedOrderId] = useState(null);
  const [clickedButtons, setClickedButtons] = useState({});
  const load = () => api('/api/orders').then((allOrders) => { setOrders(allOrders.filter((o) => o.paymentStatus !== 'PAID')); });
  useEffect(() => { load(); }, [refreshToken]);
  useRealtimeUpdates(['orders'], load);

  async function markAsPaid(orderId) {
    if (clickedButtons[orderId]) return;
    setClickedButtons((prev) => ({ ...prev, [orderId]: true }));
    try {
      await api(`/api/orders/${orderId}/status`, { method: 'PATCH', body: JSON.stringify({ paymentStatus: 'PAID' }) });
      load();
    } catch (err) { setClickedButtons((prev) => ({ ...prev, [orderId]: false })); }
  }

  const selectedOrder = orders.find((o) => o.id === selectedOrderId);

  return (
    <div>
      <div className="section-head"><h2>Đơn chưa thanh toán</h2><span className="count">{orders.length} đơn</span></div>
      {orders.length === 0 && <div className="empty-state"><Banknote size={40} /><p>Tất cả đơn hàng đã được thanh toán.</p></div>}
      <div className="orders-grid">
        {orders.map((order) => (
          <div className="order-card" key={order.id}>
            <div className="order-card-header">
              <div>
                <h3>#{order.dailySequence} — {order.table?.name}</h3>
                {order.createdAt && <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{new Date(order.createdAt).toLocaleTimeString('vi-VN')} • {order.customer?.phone?.slice(-6)}</div>}
              </div>
              <span className="price">{money(order.subtotal)}</span>
            </div>
            <div className="order-badges"><StatusBadge text={order.status} /><StatusBadge text={order.paymentStatus} /></div>
            <div className="order-items-list">
              {order.items.map((item) => (<div className="order-item-row" key={item.id}><span>{item.quantity}× {item.name}</span><span>{money(item.price * item.quantity)}</span></div>))}
            </div>
            <div className="order-actions">
              <button className="btn btn-ghost" onClick={() => setSelectedOrderId(order.id)}><Eye size={14} /> Chi tiết</button>
              <button className="btn btn-primary" onClick={() => markAsPaid(order.id)} disabled={clickedButtons[order.id]} style={{ opacity: clickedButtons[order.id] ? 0.5 : 1 }}>
                <Banknote size={14} /> {clickedButtons[order.id] ? 'Đã TT' : 'Thanh toán'}
              </button>
            </div>
          </div>
        ))}
      </div>
      {selectedOrder && <BillDetailModal order={selectedOrder} onClose={() => setSelectedOrderId(null)} />}
    </div>
  );
}

function TableManager({ refreshToken }) {
  const [items, setItems] = useState([]);
  const [form, setForm]   = useState({ name: '', qrCode: '', seats: 4 });
  const [editingId, setEditingId] = useState(null);
  const [editingForm, setEditingForm] = useState(null);
  const load = () => api('/api/admin/tables').then(setItems);
  useEffect(() => { load(); }, [refreshToken]);
  useRealtimeUpdates(['tables'], load);

  async function submit(e) {
    e.preventDefault();
    await api('/api/admin/tables', { method: 'POST', body: JSON.stringify({ ...form, qrCode: form.qrCode.trim() || undefined, seats: Number(form.seats) }) });
    setForm({ name: '', qrCode: '', seats: 4 }); load();
  }

  function startEdit(item) {
    setEditingId(item.id);
    setEditingForm({ name: item.name, qrCode: item.qrCode, seats: item.seats, active: item.active !== false });
  }

  async function saveEdit(itemId) {
    await api(`/api/admin/tables/${itemId}`, { method: 'PUT', body: JSON.stringify({ ...editingForm, seats: Number(editingForm.seats) }) });
    setEditingId(null); setEditingForm(null); load();
  }

  async function removeItem(itemId) {
    if (!window.confirm('Ẩn bàn này?')) return;
    await api(`/api/admin/tables/${itemId}`, { method: 'DELETE' });
    if (editingId === itemId) { setEditingId(null); setEditingForm(null); }
    load();
  }

  return (
    <div>
      <div className="section-head"><h2>Bàn & QR</h2><span className="count">{items.length} bàn</span></div>
      <form className="inline-form" onSubmit={submit}>
        <input className="field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Tên bàn" />
        <input className="field" value={form.qrCode} onChange={(e) => setForm({ ...form, qrCode: e.target.value })} placeholder="Mã QR (tự sinh nếu trống)" />
        <input className="field" value={form.seats} onChange={(e) => setForm({ ...form, seats: e.target.value })} placeholder="Số ghế" type="number" style={{ maxWidth: 100 }} />
        <button className="btn btn-primary" type="submit"><Plus size={15} /> Thêm</button>
      </form>
      <div className="qr-grid">
        {items.map((item) => (
          <div className={`qr-card ${item.active === false ? 'is-muted' : ''}`} key={item.id}>
            <img src={item.qrDataUrl} alt={`QR ${item.name}`} />
            <div className="qr-card-body">
              {editingId === item.id && editingForm ? (
                <>
                  <input className="field" value={editingForm.name} onChange={(e) => setEditingForm({ ...editingForm, name: e.target.value })} placeholder="Tên bàn" />
                  <input className="field" value={editingForm.qrCode} onChange={(e) => setEditingForm({ ...editingForm, qrCode: e.target.value })} placeholder="Mã QR" />
                  <input className="field" value={editingForm.seats} onChange={(e) => setEditingForm({ ...editingForm, seats: e.target.value })} placeholder="Số ghế" type="number" />
                  <div className="admin-card-actions">
                    <button className="btn btn-primary" type="button" onClick={() => saveEdit(item.id)}><Check size={14} /> Lưu</button>
                    <button className="btn btn-ghost" type="button" onClick={() => { setEditingId(null); setEditingForm(null); }}>Hủy</button>
                  </div>
                </>
              ) : (
                <>
                  <h3>{item.name}</h3>
                  <p className="code">{item.qrCode}</p>
                  <a className="url" href={item.orderUrl} target="_blank" rel="noreferrer">{item.orderUrl}</a>
                  <div className="actions">
                    <a className="btn btn-ghost" href={item.orderUrl} target="_blank" rel="noreferrer" style={{ fontSize: 13 }}><ExternalLink size={13} /> Mở</a>
                    <a className="btn btn-ghost" href={item.qrDataUrl} download={`${item.qrCode}.png`} style={{ fontSize: 13 }}><Download size={13} /> QR</a>
                    <button className="btn btn-ghost" type="button" style={{ fontSize: 13 }} onClick={() => startEdit(item)}><QrCode size={13} /> Sửa</button>
                    <button className="btn btn-danger" type="button" style={{ fontSize: 13 }} onClick={() => removeItem(item.id)}><Trash2 size={13} /> Xóa</button>
                  </div>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AccountManager({ currentUser, onCurrentUserChange, refreshToken, onLogout }) {
  const [users, setUsers]   = useState([]);
  const [error, setError]   = useState('');
  const [form, setForm]     = useState({ name: '', phone: '', role: currentUser.role === 'ADMIN' ? 'OWNER' : 'STAFF' });
  const isAdmin = currentUser.role === 'ADMIN';
  const isOwner = currentUser.role === 'OWNER';
  const roleOptions = isAdmin ? ['OWNER', 'STAFF'] : ['STAFF'];

  const load = () => { setError(''); return api('/api/admin/users').then(setUsers).catch((err) => setError(err.message)); };
  useEffect(() => { load(); }, [refreshToken]);
  useRealtimeUpdates(['users'], load);

  async function submit(e) {
    e.preventDefault();
    try {
      await api('/api/admin/users', { method: 'POST', body: JSON.stringify({ ...form }) });
      setForm({ name: '', phone: '', role: isAdmin ? 'OWNER' : 'STAFF' });
      await load();
    } catch (err) { setError(err.message); }
  }

  if (!isAdmin && !isOwner) return <div className="empty-state"><Users size={40} /><p>Không có quyền quản lý tài khoản</p></div>;

  return (
    <div>
      <div className="section-head">
        <div><h2>{isAdmin ? 'Quản lý tài khoản' : 'Quản lý nhân viên'}</h2><p className="muted" style={{ marginTop: 2 }}>{isAdmin ? 'Tạo, chỉnh sửa và xóa tài khoản Owner và Staff' : 'Tạo và quản lý nhân viên'}</p></div>
        <span className="count">{users.length} tài khoản</span>
      </div>
      <form className="account-create" onSubmit={submit}>
        <input className="field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Tên hiển thị" required />
        <input className="field" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value.replace(/\D/g, '') })} placeholder="Số điện thoại" type="tel" required />
        <select className="field" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>{roleOptions.map((r) => <option key={r} value={r}>{r}</option>)}</select>
        <button className="btn btn-primary" type="submit"><Plus size={15} /> {isAdmin ? 'Thêm tài khoản' : 'Thêm nhân viên'}</button>
      </form>
      {error && <p className="notice notice-err" style={{ marginBottom: 16 }}>{error}</p>}
      <div className="account-grid">
        {users.map((user) => (
          <UserCard key={user.id} user={user} currentUser={currentUser} isAdmin={isAdmin} isOwner={isOwner} roleOptions={roleOptions} onSaved={load} onDeleted={load} onCurrentUserChange={onCurrentUserChange} onLogout={onLogout} />
        ))}
      </div>
    </div>
  );
}

function UserCard({ user, currentUser, isAdmin, isOwner, roleOptions, onSaved, onDeleted, onCurrentUserChange, onLogout }) {
  const canEdit = isAdmin || (isOwner && user.role === 'STAFF');
  const canDelete = canEdit;
  const canResetPin = isAdmin;
  const [form, setForm] = useState({ name: user.name, phone: user.phone, role: user.role });
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    try { await api(`/api/admin/users/${user.id}`, { method: 'PUT', body: JSON.stringify(form) }); setError(''); await onSaved(); }
    catch (err) { setError(err.message); }
  }

  async function remove() {
    if (!window.confirm(`Xóa tài khoản ${user.name}?`)) return;
    try { await api(`/api/admin/users/${user.id}`, { method: 'DELETE' }); await onDeleted(); }
    catch (err) { setError(err.message); }
  }

  async function resetPin() {
    if (!window.confirm(`Reset PIN cho ${user.name}?`)) return;
    try { await api(`/api/admin/users/${user.id}/reset-pin`, { method: 'PATCH' }); setError(''); await onSaved(); }
    catch (err) { setError(err.message); }
  }

  return (
    <div className="user-card">
      <div className="user-card-head"><div><b>{user.name}</b><p>{user.phone}</p></div><StatusBadge text={user.role} /></div>
      <form className="user-card-form" onSubmit={submit}>
        <input className="field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} disabled={!canEdit} placeholder="Tên" />
        <input className="field" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value.replace(/\D/g, '') })} disabled={!canEdit} placeholder="Số điện thoại" type="tel" />
        <select className="field" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} disabled={!canEdit}>{roleOptions.map((r) => <option key={r} value={r}>{r}</option>)}</select>
        <div className="order-actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-primary" type="submit" disabled={!canEdit}><Check size={14} /> Lưu</button>
          {canResetPin && <button className="btn btn-ghost" type="button" onClick={resetPin}><RefreshCw size={14} /> Reset PIN</button>}
          {canDelete && <button className="btn btn-danger" type="button" onClick={remove} disabled={user.id === currentUser.id}><Trash2 size={14} /> Xóa</button>}
        </div>
      </form>
      {!canEdit && <p className="muted" style={{ marginTop: 8 }}>Bạn không có quyền chỉnh sửa tài khoản này.</p>}
      {error && <p className="notice notice-err" style={{ marginTop: 8 }}>{error}</p>}
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
