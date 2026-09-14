# -*- coding: utf-8 -*-
"""
TÁC DỤNG: Tự động khởi tạo cấu trúc thư mục của một Kỹ năng (Skill) Agent mới chuẩn hóa.
Ý NGHĨA: Thiết lập cấu trúc thư mục modular (SKILL.md, scripts/, references/, assets/) và gieo cấy sẵn 
        template SKILL.md chứa 4 chương bắt buộc chống rập khuôn để bảo vệ tính sáng tạo của AI.
PHẠM VI: Toàn cầu (Global Scope), sử dụng cho mọi ngôn ngữ và công nghệ (Web, Python, C#, v.v.).

CÁCH DÙNG:
    python .agents/scripts/init_skill.py <tên-skill-viết-thường-gạch-nối> [--path <đường-dẫn-thư-mục-lưu>]
Ví dụ:
    python .agents/scripts/init_skill.py global-performance-optimizer --path .agents/skills
"""

import os
import sys
import argparse

# Cấu hình UTF-8 cho stdout/stderr để tránh lỗi Unicode trên Windows Terminal
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

def parse_args():
    parser = argparse.ArgumentParser(description="Khởi tạo cấu trúc Agent Skill mới chuẩn hóa.")
    parser.add_argument("name", help="Tên của skill (chữ viết thường, phân tách bằng dấu gạch ngang, ví dụ: my-cool-skill)")
    parser.add_argument("--path", default=os.path.join(".agents", "skills"), help="Đường dẫn đến thư mục chứa các skills")
    return parser.parse_args()

def validate_name(name):
    import re
    if not re.match(r"^[a-z0-9]+(-[a-z0-9]+)*$", name):
        print(f"[ERROR] Tên skill '{name}' không hợp lệ! Chỉ cho phép chữ thường, số và dấu gạch ngang (ví dụ: web-opt).")
        sys.exit(1)

def create_skill_structure(base_path, skill_name):
    skill_dir = os.path.join(base_path, skill_name)
    if os.path.exists(skill_dir):
        print(f"[WARNING] Thư mục skill '{skill_name}' đã tồn tại tại: {skill_dir}")
        return skill_dir

    subdirs = ["scripts", "references", "assets"]
    for subdir in subdirs:
        path = os.path.join(skill_dir, subdir)
        os.makedirs(path, exist_ok=True)
        with open(os.path.join(path, ".gitkeep"), "w") as f:
            pass

    print(f"[SUCCESS] Đã tạo cấu trúc thư mục modular cho skill tại: {skill_dir}")
    return skill_dir

def generate_skill_markdown(skill_dir, skill_name):
    skill_file_path = os.path.join(skill_dir, "SKILL.md")
    
    template_content = f"""---
name: {skill_name}
description: Mô tả ngắn gọn về tác dụng của skill (thêm từ khóa kích hoạt để RAG tìm kiếm tốt hơn)
license: MIT
metadata:
  author: Antigravity
  version: "1.0"
---

# Kỹ năng: {skill_name.replace('-', ' ').title()}

> [!IMPORTANT]
> **HƯỚNG DẪN TƯ DUY**: Hãy sử dụng tài liệu này như một cẩm nang nguyên lý gốc. 
> Tuyệt đối không sao chép máy móc các giải pháp mẫu. Hãy luôn phân tích bối cảnh đặc thù của dự án hiện tại trước khi triển khai.

---

## 1. First-Principles Explanations (Nguyên Lý Gốc)

*Giải thích cặn kẽ cơ chế sâu xa tại sao vấn đề lại phát sinh dưới góc độ khoa học máy tính hoặc kiến trúc hệ thống thay vì đưa ra code mẫu mì ăn liền.*
*Sử dụng sơ đồ Mermaid hoặc mã giả (pseudocode) để minh họa luồng xử lý nếu cần.*

- **Bản chất vấn đề**: [Giải thích tại đây]
- **Tại sao cách làm thông thường lại chậm/lỗi**: [Giải thích tại đây]

---

## 2. Measurement-First Guides (Hướng Dẫn Đo Đạc Thực Tế)

*Mô tả chi tiết quy trình viết mã nguồn hoặc sử dụng công cụ đo kiểm để xác nhận điểm nghẽn (bottleneck) tồn tại TRƯỚC khi thực hiện tối ưu hóa/sửa đổi.*

- **Công cụ đo đạc khuyên dùng**: [Ví dụ: Stopwatch cho C#, cProfile cho Python, Lighthouse cho Web]
- **Quy trình đo kiểm chi tiết**:
  1. [Bước 1...]
  2. [Bước 2...]

---

## 3. Pitfalls & Bias Warnings (Cảnh Báo Điểm Mù & Thiên Lệch)

*Cảnh báo các lỗi nhận thức, thiên lệch xác nhận (Confirmation Bias) của AI khi áp dụng skill này một cách máy móc.*

- **Điểm mù thường gặp**: [Ví dụ: Tối ưu hóa phỏng đoán khi chưa đo đạc, làm phức tạp hóa mã nguồn]
- **Cách tự vệ tránh vết xe đổ**: [Ví dụ: Giữ thiết kế đơn giản nhất có thể - Simplicity First]

---

## 4. Active Evolution Log (Nhật Ký Tiến Hóa Tri Thức)

*Nơi ghi chép động sự tiến hóa tri thức của các Agent khi làm việc trên dự án thực tế.*

- **[2026-05-25]** ({skill_name}): Khởi tạo khung xương kỹ năng chống rập khuôn.
"""

    with open(skill_file_path, "w", encoding="utf-8") as f:
        f.write(template_content)
    
    print(f"[SUCCESS] Đã khởi tạo tệp tin SKILL.md chống rập khuôn tại: {skill_file_path}")

def main():
    args = parse_args()
    validate_name(args.name)
    skill_dir = create_skill_structure(args.path, args.name)
    generate_skill_markdown(skill_dir, args.name)
    print("\n[COMPLETE] Chúc mừng! Skill của bạn đã được khởi tạo hoàn hảo và tuân thủ 100% quy chuẩn chống rập khuôn tri thức.")

if __name__ == "__main__":
    main()
