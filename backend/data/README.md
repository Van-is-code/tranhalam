# Dữ liệu khởi tạo (`seed-data.json`)

File `seed-data.json` chứa **account** và **menu** được **tự động import vào DB mỗi khi backend khởi động**.
Import dùng `upsert` nên chạy nhiều lần cũng không tạo dữ liệu trùng.

## Cấu trúc

```json
{
  "accounts":   [ ... ],
  "categories": [ ... ],
  "menuItems":  [ ... ]
}
```

### `accounts` — tài khoản đăng nhập

Đăng nhập bằng **số điện thoại + PIN** (khuyên dùng):

```json
{ "name": "Admin", "phone": "0862215231", "role": "ADMIN", "pin": "000000" }
```

Hoặc bằng **email + mật khẩu** (legacy):

```json
{ "name": "Chủ quán", "email": "owner@vanmerchant.local", "role": "OWNER", "password": "123456" }
```

- `role`: `ADMIN` | `OWNER` | `STAFF`.
- `pin` / `password` là chữ thường (plaintext) — hệ thống tự **hash bằng bcrypt** khi import.
- PIN/mật khẩu **chỉ được đặt khi tạo mới tài khoản**. Nếu tài khoản đã tồn tại, PIN người dùng
  tự đổi trong app sẽ được giữ nguyên (chỉ `name` và `role` được cập nhật theo file này).

### `categories` — phân loại

```json
{ "id": "cat-coffee", "name": "Cà phê", "sortOrder": 1 }
```

`id` là chuỗi tự đặt, dùng để món ăn tham chiếu tới.
Thêm `"featured": true` để **ghim danh mục lên đầu** giao diện order.

Món nào không thuộc nhóm rõ ràng thì cho vào danh mục **"Khác"** (`cat-khac`).

### `menuItems` — món ăn

```json
{
  "id": "menu-ca-phe-sua",
  "name": "Cà phê sữa",
  "description": "Cà phê phin với sữa đặc",
  "price": 30000,
  "categoryId": "cat-coffee",
  "image": "/public/menu_image/ca-phe-sua.jpg"
}
```

- `price` tính bằng **đồng** (VND), số nguyên.
- `categoryId` phải khớp một `id` trong `categories` (nếu không tồn tại sẽ để trống).
- `active` (mặc định `true`), `hidden` (mặc định `false`) là tuỳ chọn.
- `"featured": true` để đánh dấu **món nổi bật**: món hiện lên đầu trong danh mục, và
  danh mục chứa nó cũng được đẩy lên đầu giao diện order.

## Chức năng "nổi bật"

Ở giao diện order (khách quét QR gọi món), danh mục sẽ được sắp xếp:
**danh mục có `featured: true`** (hoặc **chứa món `featured: true`**) → lên đầu tiên,
sau đó tới các danh mục còn lại theo `sortOrder`.

## Ảnh món ăn

Thư mục nhận ảnh: **`backend/public/menu_image/`** (được phục vụ qua đường dẫn `/public/menu_image/...`).

1. Vào trang quản trị → thêm/sửa món → **Tải ảnh**. Ảnh được lưu vào thư mục trên và
   trả về đường dẫn dạng `/public/menu_image/<tên-file>`.
2. Muốn dùng lại ảnh đã tải: bấm **"Ảnh đã tải"** để mở gallery và chọn.
3. Chép đường dẫn ảnh vào trường `"image"` của món trong `seed-data.json`.

Lấy danh sách ảnh đã tải qua API: `GET /api/admin/menu-images`
→ trả về `[{ filename, imageUrl, size, modifiedAt }]` (mới nhất trước).

Trường `"image"` chấp nhận:
- Đường dẫn ảnh đã upload: `"/public/menu_image/abc.jpg"` (hoặc gọn hơn: `"abc.jpg"`).
- URL tuyệt đối: `"https://..."`.
