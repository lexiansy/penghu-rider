"""Prepare the Phase 2 game-art set for mobile delivery and review."""

from collections import deque
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "visual-assets" / "source"
PUBLIC = ROOT / "site" / "public" / "art"
REVIEW = ROOT / "visual-assets"

MONSTERS = [
    "following-distance",
    "intersection",
    "vehicle-check",
    "distracted-driving",
    "accident-response",
    "large-vehicle",
    "bad-weather",
    "hazard-perception",
]


def trimmed(image: Image.Image, pad: int = 18) -> Image.Image:
    rgba = image.convert("RGBA")
    alpha = rgba.getchannel("A")
    box = alpha.getbbox()
    if not box:
        return rgba
    left, top, right, bottom = box
    return rgba.crop(
        (
            max(0, left - pad),
            max(0, top - pad),
            min(rgba.width, right + pad),
            min(rgba.height, bottom + pad),
        )
    )


def save_contained(image: Image.Image, path: Path, box: tuple[int, int], quality: int = 84) -> None:
    item = trimmed(image)
    item.thumbnail(box, Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", box, (0, 0, 0, 0))
    canvas.alpha_composite(item, ((box[0] - item.width) // 2, (box[1] - item.height) // 2))
    canvas.save(path, "WEBP", quality=quality, method=6)


def remove_connected_light_background(image: Image.Image) -> Image.Image:
    rgba = image.convert("RGBA")
    pixels = rgba.load()
    width, height = rgba.size
    seen: set[tuple[int, int]] = set()
    queue: deque[tuple[int, int]] = deque()

    def is_background(x: int, y: int) -> bool:
        red, green, blue, _ = pixels[x, y]
        return min(red, green, blue) >= 218 and max(red, green, blue) - min(red, green, blue) <= 22

    for x in range(width):
        if is_background(x, 0):
            queue.append((x, 0))
        if is_background(x, height - 1):
            queue.append((x, height - 1))
    for y in range(height):
        if is_background(0, y):
            queue.append((0, y))
        if is_background(width - 1, y):
            queue.append((width - 1, y))

    while queue:
        x, y = queue.popleft()
        if (x, y) in seen or not is_background(x, y):
            continue
        seen.add((x, y))
        red, green, blue, _ = pixels[x, y]
        pixels[x, y] = (red, green, blue, 0)
        if x:
            queue.append((x - 1, y))
        if x + 1 < width:
            queue.append((x + 1, y))
        if y:
            queue.append((x, y - 1))
        if y + 1 < height:
            queue.append((x, y + 1))
    return rgba


def remove_tiny_alpha_components(image: Image.Image, minimum_area: int = 50) -> Image.Image:
    rgba = image.convert("RGBA")
    alpha = rgba.getchannel("A")
    pixels = alpha.load()
    width, height = alpha.size
    seen: set[tuple[int, int]] = set()
    for y in range(height):
        for x in range(width):
            if pixels[x, y] < 16 or (x, y) in seen:
                continue
            component: list[tuple[int, int]] = []
            queue: deque[tuple[int, int]] = deque([(x, y)])
            seen.add((x, y))
            while queue:
                point = queue.popleft()
                component.append(point)
                current_x, current_y = point
                for neighbor in (
                    (current_x - 1, current_y),
                    (current_x + 1, current_y),
                    (current_x, current_y - 1),
                    (current_x, current_y + 1),
                ):
                    neighbor_x, neighbor_y = neighbor
                    if (
                        0 <= neighbor_x < width
                        and 0 <= neighbor_y < height
                        and pixels[neighbor_x, neighbor_y] >= 16
                        and neighbor not in seen
                    ):
                        seen.add(neighbor)
                        queue.append(neighbor)
            if len(component) < minimum_area:
                for component_x, component_y in component:
                    rgba.putpixel((component_x, component_y), (*rgba.getpixel((component_x, component_y))[:3], 0))
    return rgba


def font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for candidate in (Path("C:/Windows/Fonts/seguisb.ttf"), Path("C:/Windows/Fonts/segoeui.ttf")):
        if candidate.exists():
            return ImageFont.truetype(candidate, size)
    return ImageFont.load_default()


def place_contained(canvas: Image.Image, image: Image.Image, box: tuple[int, int, int, int]) -> None:
    left, top, right, bottom = box
    item = image.convert("RGBA")
    item.thumbnail((right - left, bottom - top), Image.Resampling.LANCZOS)
    canvas.alpha_composite(item, (left + (right - left - item.width) // 2, top + (bottom - top - item.height) // 2))


def main() -> None:
    PUBLIC.mkdir(parents=True, exist_ok=True)
    REVIEW.mkdir(parents=True, exist_ok=True)

    map_image = Image.open(SOURCE / "adventure-map.png").convert("RGB")
    map_image.thumbnail((720, 1600), Image.Resampling.LANCZOS)
    map_image.save(PUBLIC / "adventure-map.webp", "WEBP", quality=84, method=6)

    clear_image = Image.open(SOURCE / "clear-coast.png").convert("RGB")
    clear_image.thumbnail((960, 640), Image.Resampling.LANCZOS)
    clear_image.save(PUBLIC / "clear-coast.webp", "WEBP", quality=84, method=6)

    transparent_assets = {
        "player-scooter-hono.webp": ("player-scooter-hono.png", (320, 300)),
        "day1-lookout.webp": ("day1-lookout.png", (300, 260)),
        "day2-lair.webp": ("day2-lair.png", (300, 240)),
        "boss-roadkeeper.webp": ("boss-roadkeeper.png", (420, 420)),
    }
    for output_name, (source_name, dimensions) in transparent_assets.items():
        save_contained(Image.open(SOURCE / source_name), PUBLIC / output_name, dimensions)

    atlas = Image.open(SOURCE / "monster-atlas.png")
    cell_width, cell_height = atlas.width // 4, atlas.height // 2
    for index, name in enumerate(MONSTERS):
        column, row = index % 4, index // 4
        cell = atlas.crop(
            (
                column * cell_width,
                row * cell_height,
                (column + 1) * cell_width,
                (row + 1) * cell_height,
            )
        )
        isolated = remove_tiny_alpha_components(remove_connected_light_background(cell))
        save_contained(isolated, PUBLIC / f"monster-{name}.webp", (192, 192), quality=88)

    icon = Image.open(SOURCE / "app-icon.png").convert("RGBA")
    for size in (192, 512):
        output = ImageOps.fit(icon, (size, size), method=Image.Resampling.LANCZOS)
        output.save(PUBLIC / f"app-icon-{size}.png", "PNG", optimize=True)

    canvas = Image.new("RGBA", (1600, 1700), "#dceee9")
    draw = ImageDraw.Draw(canvas)
    title_font = font(42)
    label_font = font(21)
    draw.text((56, 42), "PENGHU RIDER · VISUAL ASSET SET", fill="#15373c", font=title_font)
    draw.text((58, 95), "flat coastal adventure · bold ink · printed paper texture", fill="#4e777b", font=label_font)

    place_contained(canvas, Image.open(PUBLIC / "adventure-map.webp"), (40, 150, 440, 1020))
    draw.text((56, 1030), "Adventure map", fill="#15373c", font=label_font)
    place_contained(canvas, Image.open(PUBLIC / "clear-coast.webp"), (480, 150, 1560, 830))
    draw.text((496, 842), "CLEAR coast", fill="#15373c", font=label_font)

    showcase = [
        ("player-scooter-hono.webp", "Scooter + Hono"),
        ("day1-lookout.webp", "Day 1 lookout"),
        ("day2-lair.webp", "Day 2 lair"),
        ("boss-roadkeeper.webp", "Road-rule Boss"),
        ("app-icon-192.png", "PWA icon"),
    ]
    for index, (filename, label) in enumerate(showcase):
        left = 470 + index * 220
        place_contained(canvas, Image.open(PUBLIC / filename), (left, 900, left + 190, 1100))
        draw.text((left, 1110), label, fill="#15373c", font=font(16))

    for index, name in enumerate(MONSTERS):
        column, row = index % 4, index // 4
        left, top = 465 + column * 275, 1190 + row * 235
        place_contained(canvas, Image.open(PUBLIC / f"monster-{name}.webp"), (left, top, left + 180, top + 180))
        draw.text((left, top + 184), name.replace("-", " "), fill="#15373c", font=font(16))

    canvas.convert("RGB").save(REVIEW / "visual-asset-set.webp", "WEBP", quality=88, method=6)

    total = sum(path.stat().st_size for path in PUBLIC.iterdir() if path.is_file())
    print(f"Prepared {len(list(PUBLIC.iterdir()))} public art assets ({total / 1024:.1f} KiB)")


if __name__ == "__main__":
    main()
