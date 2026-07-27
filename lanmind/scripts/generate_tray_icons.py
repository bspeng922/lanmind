"""Generate crisp 32x32 tray icons for LAN chat unread notification blinking."""
import os
from PIL import Image, ImageDraw

def generate_icons():
    output_dir = os.path.join(os.path.dirname(__file__), '..', 'src-tauri', 'icons')
    os.makedirs(output_dir, exist_ok=True)

    # 1. Generate Chat Tray Icon (32x32)
    # 4x supersampled for antialiasing
    scale = 4
    size = 32 * scale
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Draw rounded chat bubble (Cyan-Blue #0284c7 -> #38bdf8)
    bubble_x0 = 3 * scale
    bubble_y0 = 4 * scale
    bubble_x1 = 28 * scale
    bubble_y1 = 23 * scale
    corner_r = 7 * scale

    # Speech bubble body
    draw.rounded_rectangle(
        [bubble_x0, bubble_y0, bubble_x1, bubble_y1],
        radius=corner_r,
        fill=(14, 165, 233, 255),
        outline=(2, 132, 199, 255),
        width=int(1.5 * scale)
    )

    # Speech tail at bottom left
    tail = [
        (7 * scale, 22 * scale),
        (5 * scale, 28 * scale),
        (13 * scale, 22 * scale),
    ]
    draw.polygon(tail, fill=(14, 165, 233, 255))
    draw.line([(7 * scale, 22 * scale), (5 * scale, 28 * scale)], fill=(2, 132, 199, 255), width=int(1.5 * scale))
    draw.line([(5 * scale, 28 * scale), (13 * scale, 22 * scale)], fill=(2, 132, 199, 255), width=int(1.5 * scale))

    # Inner 3 dots in the bubble (White)
    dot_y = 13.5 * scale
    dot_r = 1.8 * scale
    for dot_x in [10.5 * scale, 15.5 * scale, 20.5 * scale]:
        draw.ellipse([dot_x - dot_r, dot_y - dot_r, dot_x + dot_r, dot_y + dot_r], fill=(255, 255, 255, 250))

    # Red/Rose Unread Notification Dot at top right
    badge_x = 24.5 * scale
    badge_y = 6.5 * scale
    badge_r = 4.2 * scale
    draw.ellipse(
        [badge_x - badge_r, badge_y - badge_r, badge_x + badge_r, badge_y + badge_r],
        fill=(244, 63, 94, 255),
        outline=(255, 255, 255, 255),
        width=int(1.2 * scale)
    )

    # Resize with high quality Lanczos filter to 32x32
    chat_icon_32 = img.resize((32, 32), Image.Resampling.LANCZOS)
    chat_icon_path = os.path.join(output_dir, 'chat-tray.png')
    chat_icon_32.save(chat_icon_path, 'PNG')
    rgba_path = os.path.join(output_dir, 'chat-tray.rgba')
    with open(rgba_path, 'wb') as f:
        f.write(chat_icon_32.convert('RGBA').tobytes())
    print(f'Generated: {chat_icon_path} and {rgba_path}')

    # 2. Generate Empty Transparent Icon (32x32) for blinking alternate frame
    empty_img = Image.new('RGBA', (32, 32), (0, 0, 0, 0))
    empty_icon_path = os.path.join(output_dir, 'chat-tray-empty.png')
    empty_img.save(empty_icon_path, 'PNG')
    empty_rgba_path = os.path.join(output_dir, 'chat-tray-empty.rgba')
    with open(empty_rgba_path, 'wb') as f:
        f.write(empty_img.tobytes())
    print(f'Generated: {empty_icon_path} and {empty_rgba_path}')

if __name__ == '__main__':
    generate_icons()
