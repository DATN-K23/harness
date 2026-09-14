# -*- coding: utf-8 -*-
"""
TÁC DỤNG: Tự động so sánh sự thay đổi của Skill trước và sau nâng cấp.
Ý NGHĨA: Đo đạc sự phát triển kích thước, số lượng file, số dòng code và dòng chữ của tệp SKILL.md 
        để tự động sinh ra bảng báo cáo nâng cấp thay đổi (Change Report Template) khoa học.
PHẠM VI: Toàn cầu (Global Scope), sử dụng cho mọi ngôn ngữ và công nghệ.

CÁCH DÙNG:
    python .agents/scripts/compare_skill.py <thư-mục-backup> <thư-mục-hiện-tại>
Ví dụ:
    python .agents/scripts/compare_skill.py .agents/skills/my-skill.backup .agents/skills/my-skill
"""

import os
import sys

# Cấu hình UTF-8 cho stdout/stderr để tránh lỗi Unicode trên Windows Terminal
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

def count_lines_and_words(file_path):
    if not os.path.isfile(file_path):
        return 0, 0, 0
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            lines = f.readlines()
        text = "".join(lines)
        words = len(text.split())
        return len(lines), words, len(text)
    except Exception:
        return 0, 0, 0

def analyze_directory(dir_path):
    data = {}
    if not os.path.isdir(dir_path):
        return data
        
    for root, _, files in os.walk(dir_path):
        for file in files:
            if file == ".gitkeep":
                continue
            abs_path = os.path.join(root, file)
            rel_path = os.path.relpath(abs_path, dir_path)
            lines, words, size = count_lines_and_words(abs_path)
            data[rel_path] = {
                "lines": lines,
                "words": words,
                "size": size
            }
    return data

def main():
    if len(sys.argv) < 3:
        print("[ERROR] Thiếu đường dẫn thư mục so sánh! Cách dùng: python compare_skill.py <path-backup> <path-current>")
        sys.exit(1)
        
    backup_dir = sys.argv[1]
    current_dir = sys.argv[2]
    
    if not os.path.isdir(backup_dir):
        print(f"[ERROR] Không tìm thấy thư mục backup tại: {backup_dir}")
        sys.exit(1)
    if not os.path.isdir(current_dir):
        print(f"[ERROR] Không tìm thấy thư mục hiện tại tại: {current_dir}")
        sys.exit(1)
        
    backup_data = analyze_directory(backup_dir)
    current_data = analyze_directory(current_dir)
    
    print("## BÁO CÁO THAY ĐỔI NÂNG CẤP KỸ NĂNG (SKILL UPGRADE REPORT)")
    print(f"- **Thư mục Backup**: `{backup_dir}`")
    print(f"- **Thư mục Hiện tại**: `{current_dir}`\n")
    
    print("### 1. Bảng Chi Tiết Thay Đổi File")
    print("| File | Trạng Thái | Kích Thước (Bytes) | Số Dòng | Mô tả thay đổi |")
    print("| :--- | :--- | :--- | :--- | :--- |")
    
    all_files = set(list(backup_data.keys()) + list(current_data.keys()))
    
    for file in sorted(all_files):
        if file in backup_data and file in current_data:
            b_info = backup_data[file]
            c_info = current_data[file]
            if b_info["size"] == c_info["size"]:
                status = "Không đổi"
            else:
                status = "Đã chỉnh sửa"
            size_diff = f"{c_info['size']} ({c_info['size'] - b_info['size']:+d})"
            lines_diff = f"{c_info['lines']} ({c_info['lines'] - b_info['lines']:+d})"
        elif file in current_data:
            c_info = current_data[file]
            status = "**Thêm mới**"
            size_diff = f"{c_info['size']} (+{c_info['size']})"
            lines_diff = f"{c_info['lines']} (+{c_info['lines']})"
        else:
            b_info = backup_data[file]
            status = "~~Đã xóa~~"
            size_diff = f"0 (-{b_info['size']})"
            lines_diff = f"0 (-{b_info['lines']})"
            
        print(f"| `{file}` | {status} | {size_diff} | {lines_diff} | [Tự động so sánh] |")
        
    print("\n### 2. So Sánh Chỉ Số Tổng Quan (Before vs After)")
    
    b_total_files = len(backup_data)
    c_total_files = len(current_data)
    
    b_total_lines = sum(info["lines"] for info in backup_data.values())
    c_total_lines = sum(info["lines"] for info in current_data.values())
    
    b_total_words = sum(info["words"] for info in backup_data.values())
    c_total_words = sum(info["words"] for info in current_data.values())
    
    print("| Chỉ số (Metric) | Trước nâng cấp (Before) | Sau nâng cấp (After) | Thay đổi (Change) |")
    print("| :--- | :--- | :--- | :--- |")
    print(f"| Số lượng files | {b_total_files} | {c_total_files} | {c_total_files - b_total_files:+d} |")
    print(f"| Tổng số dòng | {b_total_lines} | {c_total_lines} | {c_total_lines - b_total_lines:+d} |")
    print(f"| Tổng số từ (Words) | {b_total_words} | {c_total_words} | {c_total_words - b_total_words:+d} |")
    
    print("\n[INFO] Báo cáo so sánh được tạo tự động bởi compare_skill.py thành công.")

if __name__ == "__main__":
    main()
