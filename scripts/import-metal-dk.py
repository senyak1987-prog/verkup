import argparse
import html
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin

from pypdf import PdfReader


BASE_URL = "https://metall-dk.ru"
METAL_GROUP = "Металл"
SOURCE_LABEL = "Металл-ДК; price_metal_dk.pdf"

HEADER_SKIP_PARTS = (
    "+7",
    "zakaz@",
    "Металлобаза",
    "№ наименование",
    "Прайс-лист",
    "https://",
)

ROW_PATTERN = re.compile(
    r"^\d+\s+(.+?)\s+([0-9]+([\.,][0-9]+)?)\s+(м2|м²|м|шт|т|кг)$",
    re.IGNORECASE,
)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--pdf", required=True, type=Path)
    parser.add_argument("--catalog-html", type=Path)
    parser.add_argument("--catalog-json", default=Path("public/data/catalogs.json"), type=Path)
    args = parser.parse_args()

    data = json.loads(args.catalog_json.read_text(encoding="utf-8"))
    existing_items = data.get("items", [])
    existing_metal = {item["id"]: item for item in existing_items if item.get("id", "").startswith("metall-dk-")}
    images = parse_catalog_images(args.catalog_html) if args.catalog_html and args.catalog_html.exists() else {}
    price_date, rows = parse_pdf_rows(args.pdf)
    metal_items = build_catalog_items(rows, images, existing_metal, price_date)

    data["items"] = [
        item for item in existing_items
        if not item.get("id", "").startswith("metall-dk-")
    ] + metal_items
    data["generatedAt"] = datetime.now(timezone.utc).isoformat()
    args.catalog_json.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    print(f"Imported {len(metal_items)} Metal-DK items into {args.catalog_json}")


def parse_pdf_rows(pdf_path: Path):
    reader = PdfReader(str(pdf_path))
    lines = []
    for page_index, page in enumerate(reader.pages, start=1):
        for raw_line in (page.extract_text() or "").splitlines():
            line = " ".join(raw_line.strip().split())
            if line:
                lines.append((page_index, line))

    price_date = next((line for _, line in lines if re.fullmatch(r"\d{2}\.\d{2}\.\d{4}", line)), "")
    current_subgroup = ""
    rows = []

    for page_index, line in lines:
        match = ROW_PATTERN.match(line)
        if match:
            title = normalize_title(match.group(1))
            price = parse_float(match.group(2))
            unit = normalize_unit(match.group(4))
            if title and price > 0:
                rows.append(
                    {
                        "title": title,
                        "price": price,
                        "unit": unit,
                        "subgroup": current_subgroup,
                        "page": page_index,
                    }
                )
            continue

        if is_header(line):
            current_subgroup = normalize_title(line)

    return price_date, rows


def parse_catalog_images(html_path: Path):
    text = html_path.read_text(encoding="utf-8", errors="ignore")
    link_pattern = re.compile(r'<a\s+href="(?P<href>/catalog/[^"]+/)"[^>]*?>(?P<body>.*?)</a>', re.S)
    images = {}

    for match in link_pattern.finditer(text):
        href = match.group("href")
        body = match.group("body")
        img_match = re.search(r"<img\b[^>]*>", body, re.S)
        src = ""
        title = ""

        if img_match:
            attrs = dict(re.findall(r'([\w:-]+)="([^"]*)"', img_match.group(0)))
            src = attrs.get("data-src") or attrs.get("src") or ""
            title = attrs.get("alt") or attrs.get("title") or ""

        name_match = re.search(r'<span[^>]*class="[^"]*name[^"]*"[^>]*>(.*?)</span>', body, re.S)
        if name_match:
            title = html.unescape(re.sub(r"<.*?>", "", name_match.group(1)).strip()) or title

        if not title:
            continue

        images[normalize_key(title)] = {
            "title": title,
            "imageUrl": urljoin(BASE_URL, src) if src else "",
            "productUrl": urljoin(BASE_URL, href),
        }

    return images


def build_catalog_items(rows, images, existing_metal, price_date):
    items = []
    used_ids = set()

    for index, row in enumerate(rows, start=1):
        title = row["title"]
        family = detect_family(title, row["subgroup"])
        subgroup = normalize_subgroup(title, row["subgroup"], family)
        unit = row["unit"]
        unit_cost = row["price"]

        if is_sheet_like(title) and unit == "шт":
            area = extract_sheet_area(title)
            if area:
                unit = "м2"
                unit_cost = unit_cost / area

        media = find_media(title, subgroup, family, images)
        item_id = unique_id(f"metall-dk-{slugify(family)}-{slugify(subgroup)}-{slugify(title)}", used_ids)
        old_item = existing_metal.get(item_id, {})

        item = {
            "id": item_id,
            "section": "materials",
            "title": title,
            "unit": unit,
            "unitCost": round(unit_cost, 2),
            "source": source_text(price_date, row["page"]),
            "materialGroup": METAL_GROUP,
            "materialFamily": family,
            "materialSubgroup": subgroup,
            "materialGroupPath": f"{METAL_GROUP} / {family} / {subgroup}",
            "productUrl": media.get("productUrl", urljoin(BASE_URL, "/price/")),
            "imageUrl": media.get("imageUrl", ""),
            "favorite": bool(old_item.get("favorite", False)),
        }
        items.append(item)

    return items


def is_header(line: str):
    if any(part in line for part in HEADER_SKIP_PARTS):
        return False
    if re.fullmatch(r"\d{2}\.\d{2}\.\d{4}", line):
        return False
    if re.match(r"^\d+\s+", line):
        return False
    return True


def normalize_title(value: str):
    return " ".join(value.replace("ё", "е").split())


def parse_float(value: str):
    return float(value.replace(",", "."))


def normalize_unit(unit: str):
    unit = unit.lower().replace("м²", "м2")
    if unit == "м":
        return "п/м"
    return unit


def detect_family(title: str, subgroup: str):
    normalized = title.lower()
    subgroup_lower = subgroup.lower()

    if "труба профильная" in normalized:
        return "Труба профильная"
    if "труба" in normalized:
        return "Труба"
    if "лист" in normalized or "пвл" in normalized:
        return "Листовой прокат"
    if "уголок" in normalized:
        return "Уголок"
    if "швеллер" in normalized:
        return "Швеллер"
    if "двутавр" in normalized or "балка" in normalized:
        return "Балка двутавровая"
    if "полоса" in normalized:
        return "Полоса"
    if "квадрат" in normalized:
        return "Квадрат стальной"
    if "сетка" in normalized:
        return "Сетка металлическая"
    if "проволока" in normalized:
        return "Проволока вязальная"
    if "профнастил" in normalized:
        return "Профнастил"
    if "сва" in normalized or "оголовок" in normalized:
        return "Винтовые сваи"
    if "петл" in normalized:
        return "Петли"
    if any(word in normalized for word in ("бочонок", "гайка", "муфта", "отвод", "резьба", "сгон")):
        return "Фитинги"
    if "арматур" in normalized or "арматур" in subgroup_lower:
        return "Арматура"
    return subgroup or "Металлопрокат"


def normalize_subgroup(title: str, subgroup: str, family: str):
    normalized = title.replace("x", "х")

    if family == "Труба профильная":
        match = re.search(r"Труба профильная\s+(\d+(?:[.,]\d+)?)\s*х\s*(\d+(?:[.,]\d+)?)", normalized, re.I)
        if match:
            return f"Труба {match.group(1)}х{match.group(2)}"

    if family == "Труба":
        match = re.search(r"Труба\s+(?:оц\.?\s*)?(\d+(?:[.,]\d+)?)", normalized, re.I)
        if match:
            return f"Труба {match.group(1)}"

    return subgroup or family


def is_sheet_like(title: str):
    normalized = title.lower()
    return any(word in normalized for word in ("лист", "пвл", "профнастил"))


def extract_sheet_area(title: str):
    normalized = title.replace(",", ".").replace("×", "х").lower()
    candidates = re.findall(
        r"(\d+(?:\.\d+)?)\s*х\s*(\d+(?:\.\d+)?)(?:\s*х\s*(\d+(?:\.\d+)?))?",
        normalized,
    )

    for candidate in candidates:
        numbers = [float(value) for value in candidate if value]
        millimeters = [value for value in numbers if value >= 100]
        if len(millimeters) >= 2:
            width, height = millimeters[-2], millimeters[-1]
            area = width * height / 1_000_000
            return area if area > 0 else None

    return None


def find_media(title: str, subgroup: str, family: str, images):
    for key in (subgroup, family):
        media = images.get(normalize_key(key))
        if media and media.get("imageUrl"):
            return media

    normalized = title.lower()
    fallback_titles = [
        ("труба профильная", "Труба профильная"),
        ("труба", "Труба круглая"),
        ("лист", "Листовой прокат"),
        ("пвл", "Листовой прокат"),
        ("уголок", "Уголок"),
        ("швеллер", "Швеллер"),
        ("двутавр", "Балка двутавровая"),
        ("балка", "Балка двутавровая"),
        ("полоса", "Полоса"),
        ("квадрат", "Квадрат стальной"),
        ("сетка", "Сетка металлическая"),
        ("проволока", "Проволока вязальная"),
        ("профнастил", "Профнастил"),
        ("свая", "Винтовые сваи"),
        ("петл", "Петли"),
        ("арматур", "Арматура"),
    ]

    for needle, image_title in fallback_titles:
        if needle in normalized:
            media = images.get(normalize_key(image_title))
            if media:
                return media

    return images.get(normalize_key("Листовой прокат"), {})


def source_text(price_date: str, page: int):
    date_part = f" от {price_date}" if price_date else ""
    return f"{SOURCE_LABEL}{date_part}; страница PDF {page}"


def normalize_key(value: str):
    return re.sub(r"\s+", " ", value.lower().replace("ё", "е").replace("×", "x").replace("х", "x")).strip()


def slugify(value: str):
    slug = re.sub(r"[^a-zа-я0-9]+", "-", value.lower().replace("ё", "е"), flags=re.IGNORECASE)
    return slug.strip("-")[:70] or "item"


def unique_id(base_id: str, used_ids: set[str]):
    item_id = base_id
    suffix = 2
    while item_id in used_ids:
        item_id = f"{base_id}-{suffix}"
        suffix += 1
    used_ids.add(item_id)
    return item_id


if __name__ == "__main__":
    main()
