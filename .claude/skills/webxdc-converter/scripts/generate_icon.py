#!/usr/bin/env python3
"""Generate an icon for a webxdc app from the app name."""

import argparse
import os
import random
from pathlib import Path

# Colors for icon background
COLORS = [
    "#FF6B6B",  # Coral
    "#4ECDC4",  # Teal
    "#45B7D1",  # Sky Blue
    "#96CEB4",  # Mint
    "#FFEAA7",  # Light Yellow
    "#DDA0DD",  # Plum
    "#98D8C8",  # Seafoam
    "#F7DC6F",  # Light Orange
    "#BB8FCE",  # Lavender
    "#85C1E8",  # Light Blue
]


def get_initials(name: str) -> str:
    """Extract initials from app name."""
    words = name.split()
    if len(words) >= 2:
        return (words[0][0] + words[1][0]).upper()
    elif len(name) >= 2:
        return name[:2].upper()
    else:
        return name.upper()


def generate_svg(name: str, output_path: str, size: int = 128) -> None:
    """Generate an SVG icon.

    Args:
        name: App name
        output_path: Output SVG path
        size: Icon size in pixels
    """
    initials = get_initials(name)
    color = random.choice(COLORS)

    svg = (
        f'<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n'
        f'<svg width="{size}" height="{size}" viewBox="0 0 {size} {size}" '
        f'xmlns="http://www.w3.org/2000/svg">\n'
        f'  <rect width="{size}" height="{size}" fill="{color}" rx="20"/>\n'
        f'  <text x="{size/2}" y="{size/2}" text-anchor="middle" '
        f'dy="0.35em" font-family="Arial, sans-serif" font-size="{size/3}" '
        f'font-weight="bold" fill="white">{initials}</text>\n'
        f"</svg>"
    )

    with open(output_path, "w") as f:
        f.write(svg)
    print(f"Generated SVG icon: {output_path}")


def generate_png(name: str, output_path: str, size: int = 128) -> bool:
    """Generate a PNG icon using Pillow if available.

    Args:
        name: App name
        output_path: Output PNG path
        size: Icon size in pixels

    Returns:
        True if PNG was generated, False if Pillow not available
    """
    try:
        from PIL import Image, ImageDraw, ImageFont
        import io
    except ImportError:
        return False

    initials = get_initials(name)
    color = random.choice(COLORS)

    # Create image
    img = Image.new("RGB", (size, size), color)
    draw = ImageDraw.Draw(img)

    # Try to use a nice font, fall back to default
    try:
        font_size = size // 3
        # Use arial or similar
        font = ImageFont.truetype("arial.ttf", font_size)
    except Exception:
        font = ImageFont.load_default()

    # Calculate text position
    # textbbox returns (left, top, right, bottom)
    bbox = draw.textbbox((0, 0), initials, font=font)
    text_width = bbox[2] - bbox[0]
    text_height = bbox[3] - bbox[1]
    x = (size - text_width) / 2
    y = (size - text_height) / 2

    # Draw text
    draw.text((x, y), initials, fill="white", font=font)

    # Save
    img.save(output_path)
    print(f"Generated PNG icon: {output_path}")
    return True


def main():
    parser = argparse.ArgumentParser(description="Generate an icon for webxdc app")
    parser.add_argument("name", help="App name")
    parser.add_argument("output", help="Output icon path (.png or .svg)")
    parser.add_argument("--size", type=int, default=128, help="Icon size in pixels")

    args = parser.parse_args()

    output_path = Path(args.output)

    # Try PNG first if output ends with .png
    if output_path.suffix.lower() == ".png":
        if not generate_png(args.name, args.output, args.size):
            print("Pillow not available, generating SVG instead")
            output_path = output_path.with_suffix(".svg")
            generate_svg(args.name, str(output_path), args.size)
    else:
        generate_svg(args.name, args.output, args.size)


if __name__ == "__main__":
    main()
