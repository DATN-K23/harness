#!/usr/bin/env python3
"""
Annotate screenshot with red bounding boxes showing Column 1, Column 2, and Left/Right Dead Void.
"""

import os
import sys

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "Pillow"])
    from PIL import Image, ImageDraw, ImageFont

SRC_IMG = "/home/nguyen/.gemini/antigravity/brain/e672099d-2635-46ca-9ae1-f128ac6ddbaf/screenshots/01-form-validation-and-presets.png"
OUT_IMG = "/home/nguyen/.gemini/antigravity/brain/e672099d-2635-46ca-9ae1-f128ac6ddbaf/screenshots/01-annotated-columns-and-void.png"

def main():
    if not os.path.exists(SRC_IMG):
        print(f"Error: {SRC_IMG} does not exist.")
        sys.exit(1)

    img = Image.open(SRC_IMG).convert("RGBA")
    draw = ImageDraw.Draw(img)
    w, h = img.size

    # Overlay for annotations
    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    overlay_draw = ImageDraw.Draw(overlay)

    # 1. Column 1 Bounding Box (Left Card)
    # Card 1 bounds roughly: left ~240, top ~280, right ~1040, bottom ~800
    col1_box = [238, 280, 1042, 808]
    draw.rectangle(col1_box, outline="#ef4444", width=4)
    overlay_draw.rectangle(col1_box, fill=(239, 68, 68, 30))

    # 2. Column 2 Bounding Box (Right Card)
    # Card 2 bounds roughly: left ~1070, top ~280, right ~1672, bottom ~808
    col2_box = [1070, 280, 1672, 808]
    draw.rectangle(col2_box, outline="#3b82f6", width=4)
    overlay_draw.rectangle(col2_box, fill=(59, 130, 246, 30))

    # 3. Dead Void Space Left: [0, 0, 238, h]
    left_void = [0, 60, 230, h]
    draw.rectangle(left_void, outline="#f59e0b", width=2)
    overlay_draw.rectangle(left_void, fill=(245, 158, 11, 40))

    # 4. Dead Void Space Right: [1680, 0, w, h]
    right_void = [1680, 60, w, h]
    draw.rectangle(right_void, outline="#f59e0b", width=2)
    overlay_draw.rectangle(right_void, fill=(245, 158, 11, 40))

    # Combine image with semi-transparent overlays
    img = Image.alpha_composite(img, overlay)
    draw_final = ImageDraw.Draw(img)

    # Text Labels (using standard default or truetype font)
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 22)
        font_sm = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 16)
    except Exception:
        font = ImageFont.load_default()
        font_sm = ImageFont.load_default()

    # Draw label boxes
    draw_final.rectangle([238, 235, 680, 275], fill="#ef4444")
    draw_final.text((250, 242), "COT 1: Target Specification & Presets", fill="#ffffff", font=font)

    draw_final.rectangle([1070, 235, 1490, 275], fill="#3b82f6")
    draw_final.text((1080, 242), "COT 2: Telemetry & Quota Settings", fill="#ffffff", font=font)

    draw_final.rectangle([15, 450, 215, 520], fill="#f59e0b")
    draw_final.text((25, 460), "DEAD VOID", fill="#000000", font=font)
    draw_final.text((25, 490), "(Khoang trong trai)", fill="#000000", font=font_sm)

    draw_final.rectangle([w - 225, 450, w - 15, 520], fill="#f59e0b")
    draw_final.text((w - 215, 460), "DEAD VOID", fill="#000000", font=font)
    draw_final.text((w - 215, 490), "(Khoang trong phai)", fill="#000000", font=font_sm)

    img.convert("RGB").save(OUT_IMG, "PNG")
    print(f"[SUCCESS] Annotated screenshot saved to: {OUT_IMG}")

if __name__ == "__main__":
    main()
