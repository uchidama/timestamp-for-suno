#!/usr/bin/env python3
"""
Generates high-resolution Chrome extension icons (16, 32, 48, 128px) for Suno Timestamp Extension.
Design C: Modern Dark Studio Squircle + Neon Gradient Audio Waveform Bars + Glowing Timestamp Clock Badge.
"""

import math
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw, ImageFilter


def lerp_color(c1: tuple[int, int, int, int], c2: tuple[int, int, int, int], t: float) -> tuple[int, int, int, int]:
    t = max(0.0, min(1.0, t))
    return (
        int(round(c1[0] + (c2[0] - c1[0]) * t)),
        int(round(c1[1] + (c2[1] - c1[1]) * t)),
        int(round(c1[2] + (c2[2] - c1[2]) * t)),
        int(round(c1[3] + (c2[3] - c1[3]) * t)),
    )


def create_diagonal_gradient(
    size: int,
    stops: list[tuple[float, tuple[int, int, int, int]]],
) -> Image.Image:
    """Creates a smooth diagonal gradient image of (size x size)."""
    img = Image.new("RGBA", (size, size))
    px = img.load()
    max_d = 2.0 * (size - 1)
    for y in range(size):
        for x in range(size):
            t = (x + y) / max_d
            # Find stop interval
            color = stops[-1][1]
            for i in range(len(stops) - 1):
                t0, c0 = stops[i]
                t1, c1 = stops[i + 1]
                if t <= t1:
                    local_t = (t - t0) / max(1e-6, (t1 - t0))
                    color = lerp_color(c0, c1, local_t)
                    break
            px[x, y] = color
    return img


def build_master_icon(size: int = 512) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))

    # 1. Squircle mask and deep studio dark background
    pad = int(size * 0.04)
    radius = int(size * 0.22)
    squircle_mask = Image.new("L", (size, size), 0)
    mask_draw = ImageDraw.Draw(squircle_mask)
    mask_draw.rounded_rectangle(
        [pad, pad, size - 1 - pad, size - 1 - pad],
        radius=radius,
        fill=255,
    )

    bg_grad = create_diagonal_gradient(
        size,
        [
            (0.0, (20, 23, 40, 255)),
            (0.55, (12, 14, 24, 255)),
            (1.0, (28, 17, 42, 255)),
        ],
    )
    canvas.paste(bg_grad, (0, 0), squircle_mask)

    # 2. Subtle ambient neon glow inside the background
    ambient = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    amb_draw = ImageDraw.Draw(ambient)
    amb_draw.ellipse(
        [int(size * 0.08), int(size * 0.10), int(size * 0.72), int(size * 0.76)],
        fill=(255, 61, 119, 60),
    )
    amb_draw.ellipse(
        [int(size * 0.42), int(size * 0.42), int(size * 0.92), int(size * 0.92)],
        fill=(0, 245, 212, 50),
    )
    ambient = ambient.filter(ImageFilter.GaussianBlur(radius=int(size * 0.10)))
    ambient_masked = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ambient_masked.paste(ambient, (0, 0), squircle_mask)
    canvas = Image.alpha_composite(canvas, ambient_masked)

    # 3. Neon border around squircle
    border_mask = Image.new("L", (size, size), 0)
    b_draw = ImageDraw.Draw(border_mask)
    b_draw.rounded_rectangle(
        [pad + 2, pad + 2, size - 3 - pad, size - 3 - pad],
        radius=radius - 2,
        outline=255,
        width=int(size * 0.022),
    )
    border_grad = create_diagonal_gradient(
        size,
        [
            (0.0, (255, 168, 0, 210)),
            (0.5, (255, 45, 133, 180)),
            (1.0, (0, 245, 212, 220)),
        ],
    )
    canvas.paste(border_grad, (0, 0), border_mask)

    # 4. Neon Audio Waveform Bars (5 bold studio bars)
    wave_mask = Image.new("L", (size, size), 0)
    w_draw = ImageDraw.Draw(wave_mask)

    bar_width = int(size * 0.082)
    bar_radius = bar_width // 2

    # (center_x_ratio, top_y_ratio, bottom_y_ratio)
    bars = [
        (0.185, 0.36, 0.64),
        (0.315, 0.21, 0.79),
        (0.445, 0.13, 0.85),
        (0.575, 0.25, 0.68),
        (0.705, 0.33, 0.56),
    ]
    for cx_r, top_r, bot_r in bars:
        cx = int(size * cx_r)
        x0 = cx - bar_width // 2
        x1 = cx + bar_width // 2
        y0 = int(size * top_r)
        y1 = int(size * bot_r)
        w_draw.rounded_rectangle([x0, y0, x1, y1], radius=bar_radius, fill=255)

    wave_grad = create_diagonal_gradient(
        size,
        [
            (0.0, (255, 195, 0, 255)),     # Suno Warm Amber/Gold
            (0.42, (255, 55, 120, 255)),   # Neon Coral/Magenta
            (0.85, (165, 65, 255, 255)),   # Electric Violet
        ],
    )

    # Soft outer glow for the waveform bars
    wave_layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    wave_layer.paste(wave_grad, (0, 0), wave_mask)
    wave_glow = wave_layer.filter(ImageFilter.GaussianBlur(radius=int(size * 0.028)))
    canvas = Image.alpha_composite(canvas, wave_glow)
    canvas = Image.alpha_composite(canvas, wave_layer)

    # 5. Timestamp Clock Badge (Bottom-Right Foreground)
    clock_cx = int(size * 0.675)
    clock_cy = int(size * 0.675)
    outer_r = int(size * 0.245)
    ring_r = int(size * 0.205)
    inner_r = int(size * 0.160)

    clock_layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    c_draw = ImageDraw.Draw(clock_layer)

    # Dark backing cutout halo for high contrast against the waveform bars
    c_draw.ellipse(
        [clock_cx - outer_r, clock_cy - outer_r, clock_cx + outer_r, clock_cy + outer_r],
        fill=(10, 12, 20, 250),
    )

    # Glowing Cyan-to-Blue clock ring
    ring_mask = Image.new("L", (size, size), 0)
    rm_draw = ImageDraw.Draw(ring_mask)
    rm_draw.ellipse(
        [clock_cx - ring_r, clock_cy - ring_r, clock_cx + ring_r, clock_cy + ring_r],
        fill=255,
    )
    rm_draw.ellipse(
        [clock_cx - inner_r, clock_cy - inner_r, clock_cx + inner_r, clock_cy + inner_r],
        fill=0,
    )

    # Inner dark dial face
    c_draw.ellipse(
        [clock_cx - inner_r, clock_cy - inner_r, clock_cx + inner_r, clock_cy + inner_r],
        fill=(18, 22, 38, 255),
    )

    ring_grad = create_diagonal_gradient(
        size,
        [
            (0.0, (0, 255, 215, 255)),
            (1.0, (0, 175, 255, 255)),
        ],
    )
    ring_img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ring_img.paste(ring_grad, (0, 0), ring_mask)
    ring_glow = ring_img.filter(ImageFilter.GaussianBlur(radius=int(size * 0.016)))

    clock_layer = Image.alpha_composite(clock_layer, ring_glow)
    clock_layer = Image.alpha_composite(clock_layer, ring_img)

    c_draw = ImageDraw.Draw(clock_layer)

    # 4 cardinal tick dots (12, 3, 6, 9)
    tick_dist = int(size * 0.132)
    tick_r = int(size * 0.011)
    for dx, dy in [(0, -tick_dist), (tick_dist, 0), (0, tick_dist), (-tick_dist, 0)]:
        tx = clock_cx + dx
        ty = clock_cy + dy
        c_draw.ellipse([tx - tick_r, ty - tick_r, tx + tick_r, ty + tick_r], fill=(130, 245, 230, 230))

    # Clock Hands (Minute hand pointing 12 o'clock, Hour hand pointing 4 o'clock)
    hand_width = int(size * 0.036)

    def draw_rounded_line(
        draw_ctx: ImageDraw.ImageDraw,
        p1: tuple[int, int],
        p2: tuple[int, int],
        width: int,
        color: tuple[int, int, int, int],
    ) -> None:
        draw_ctx.line([p1, p2], fill=color, width=width)
        hr = width // 2
        for px_x, px_y in (p1, p2):
            draw_ctx.ellipse([px_x - hr, px_y - hr, px_x + hr, px_y + hr], fill=color)

    # Minute hand (12 o'clock - crisp white)
    min_end = (clock_cx, clock_cy - int(size * 0.105))
    draw_rounded_line(c_draw, (clock_cx, clock_cy), min_end, hand_width, (255, 255, 255, 255))

    # Hour hand (4 o'clock - neon cyan)
    angle_rad = math.radians(32)
    hour_len = int(size * 0.088)
    hour_end = (
        clock_cx + int(math.cos(angle_rad) * hour_len),
        clock_cy + int(math.sin(angle_rad) * hour_len),
    )
    draw_rounded_line(c_draw, (clock_cx, clock_cy), hour_end, hand_width, (0, 245, 212, 255))

    # Center pivot cap (Warm Amber)
    pivot_r = int(size * 0.026)
    c_draw.ellipse(
        [clock_cx - pivot_r, clock_cy - pivot_r, clock_cx + pivot_r, clock_cy + pivot_r],
        fill=(255, 190, 0, 255),
    )

    canvas = Image.alpha_composite(canvas, clock_layer)

    # Apply final squircle alpha clip so nothing bleeds outside the icon boundary
    r, g, b, a = canvas.split()
    final_alpha = ImageChops.multiply(a, squircle_mask)
    canvas.putalpha(final_alpha)
    return canvas


def main() -> None:
    root = Path(__file__).resolve().parent.parent
    icons_dir = root / "icons"
    icons_dir.mkdir(parents=True, exist_ok=True)

    master = build_master_icon(512)
    for target_size in (128, 48, 32, 16):
        resized = master.resize((target_size, target_size), Image.Resampling.LANCZOS)
        out_path = icons_dir / f"icon-{target_size}.png"
        resized.save(out_path, format="PNG", optimize=True)
        print(f"Generated {out_path} ({target_size}x{target_size})")


if __name__ == "__main__":
    main()
