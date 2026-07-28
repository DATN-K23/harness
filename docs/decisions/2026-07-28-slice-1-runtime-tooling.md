# Runtime và command contract cho Slice 1

---

**Ngày:** 2026-07-28
**Người quyết định:** TV3 triển khai; TV1, TV5 và TV6 review integration contract
**Trạng thái:** Đang áp dụng

## Bối cảnh

Slice 1 cần cùng một runtime và cùng tên lệnh trên Windows/Linux trước khi scaffold. Blueprint đã chốt
TypeScript, Node.js LTS và pnpm workspace nhưng chưa pin major hoặc command contract.

## Các phương án đã cân nhắc

| Phương án | Ưu điểm | Nhược điểm |
|---|---|---|
| Node.js 24 LTS + pnpm 11 | Đúng blueprint, Node 24 đang là LTS, khớp môi trường phát triển hiện tại | Phải pin và nâng cấp có kiểm soát |
| Node.js 26 Current | Mới hơn | Chưa phải LTS tại thời điểm quyết định |
| Bun | Toolchain gọn | Không cần Bun-specific API và làm tăng thêm một biến số runtime |

## Quyết định

- Pin Node.js major `24` trong `.node-version`.
- WP1 sẽ đặt `engines.node` là `>=24 <25`.
- Dùng pnpm major `11`; WP1 đã pin `pnpm@11.17.0` trong `packageManager` và tạo lockfile.
- Public command contract của Slice 1:
  - `pnpm check`;
  - `pnpm test`;
  - `pnpm test:e2e:slice1`;
  - `pnpm demo:slice1`.

## Cơ sở

Node.js 24 là nhánh LTS chính thức trong ngày ra quyết định, còn Node.js 26 vẫn là Current. Node.js khuyến
nghị production application dùng Active hoặc Maintenance LTS. Máy phát triển hiện có đúng runtime family
Node.js 24 và pnpm 11, nhưng Node.js `v24.9.0` hiện tại là patch trước LTS (`process.release.lts` chưa có).
Trước khi chạy WP1 phải chuyển sang một patch Node.js 24 LTS hiện hành; không dùng `v24.9.0` làm CI baseline.

Nguồn:

- [Node.js release status](https://nodejs.org/en/about/previous-releases)
- [pnpm releases](https://github.com/pnpm/pnpm/releases)

## Đánh đổi đã chấp nhận

Pin major thay vì một Node patch giúp Windows/Linux dùng patch bảo mật mới trong cùng nhánh 24. CI phải kiểm
tra `process.release.lts` và ghi patch thực tế vào log. Nếu native dependency tạo khác biệt theo patch, nhóm
sẽ pin exact patch bằng decision record mới. pnpm được pin exact từ WP1 vì lockfile semantics phụ thuộc
package-manager version.
