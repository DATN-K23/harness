# -*- coding: utf-8 -*-
"""
TÁC DỤNG: Gác cổng chất lượng - Kiểm tra và kiểm định tính hợp lệ của một Agent Skill.
Ý NGHĨA: Xác minh cú pháp YAML Frontmatter và dùng biểu thức chính quy (Regex) quét cấu trúc 
        bắt buộc phải chứa đủ 4 chương chống rập khuôn tri thức (First-Principles, Measurement, Bias, Evolution).
PHẠM VI: Toàn cầu (Global Scope), không giới hạn ngôn ngữ hay công nghệ, tự động hóa chất lượng Agent.

CÁCH DÙNG:
    python .agents/scripts/quick_validate.py <đường-dẫn-thư-mục-skill>
Ví dụ:
    python .agents/scripts/quick_validate.py .agents/skills/skill-creator
"""

import os
import sys
import re

# Cấu hình UTF-8 cho stdout/stderr để tránh lỗi Unicode trên Windows Terminal
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

def parse_yaml_frontmatter(content):
    frontmatter_match = re.match(r"^---\s*\n(.*?)\n---\s*\n", content, re.DOTALL)
    if not frontmatter_match:
        return False, "Không tìm thấy phần định nghĩa Frontmatter (---) ở đầu file SKILL.md!"

    yaml_text = frontmatter_match.group(1)
    required_fields = ["name", "description"]
    missing_fields = []
    
    for field in required_fields:
        if not re.search(fr"^{field}\s*:", yaml_text, re.MULTILINE):
            missing_fields.append(field)
            
    if missing_fields:
        return False, f"Frontmatter thiếu các trường bắt buộc: {', '.join(missing_fields)}"

    name_match = re.search(r"^name\s*:\s*([^\n]+)", yaml_text, re.MULTILINE)
    if name_match:
        name_val = name_match.group(1).strip().strip('"').strip("'")
        if not re.match(r"^[a-z0-9]+(-[a-z0-9]+)*$", name_val):
            return False, f"Tên skill '{name_val}' trong Frontmatter không hợp lệ! Chỉ cho phép chữ thường, số và gạch ngang."

    return True, "Frontmatter hợp lệ."

def validate_anti_template_sections(content):
    mandatory_sections = [
        ("First-Principles", r"##\s*1\.\s*First-Principles\s+Explanations"),
        ("Measurement Guide", r"##\s*2\.\s*Measurement-First\s+Guides"),
        ("Bias Warnings", r"##\s*3\.\s*Pitfalls\s+&\s+Bias\s+Warnings"),
        ("Evolution Log", r"##\s*4\.\s*Active\s+Evolution\s+Log")
    ]
    
    missing_sections = []
    for section_name, pattern in mandatory_sections:
        if not re.search(pattern, content, re.IGNORECASE):
            missing_sections.append(section_name)
            
    if missing_sections:
        return False, f"Tệp SKILL.md vi phạm quy chuẩn chống rập khuôn! Thiếu các chương bắt buộc sau: {', '.join(missing_sections)}"
        
    return True, "Các chương chống rập khuôn đầy đủ và hợp lệ."

def main():
    if len(sys.argv) < 2:
        print("[ERROR] Thiếu đường dẫn thư mục skill! Cách dùng: python quick_validate.py <path-to-skill>")
        sys.exit(1)
        
    skill_path = sys.argv[1]
    if not os.path.isdir(skill_path):
        print(f"[ERROR] Không tìm thấy thư mục skill tại: {skill_path}")
        sys.exit(1)
        
    skill_md_path = os.path.join(skill_path, "SKILL.md")
    if not os.path.isfile(skill_md_path):
        print(f"[ERROR] Không tìm thấy tệp SKILL.md tại thư mục: {skill_path}")
        sys.exit(1)
        
    try:
        with open(skill_md_path, "r", encoding="utf-8") as f:
            content = f.read()
    except Exception as e:
        print(f"[ERROR] Không thể đọc tệp SKILL.md: {e}")
        sys.exit(1)
        
    fm_ok, fm_msg = parse_yaml_frontmatter(content)
    if not fm_ok:
        print(f"[FAIL] {fm_msg}")
        sys.exit(1)
        
    sec_ok, sec_msg = validate_anti_template_sections(content)
    if not sec_ok:
        print(f"[FAIL] {sec_msg}")
        sys.exit(1)
        
    print(f"[PASS] Kiểm định thành công! Skill tại '{skill_path}' đạt chuẩn chất lượng cao và tuân thủ 100% quy chuẩn chống rập khuôn tri thức.")
    sys.exit(0)

if __name__ == "__main__":
    main()
