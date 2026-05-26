#!/usr/bin/env python3
"""Validate extractor output against StandardProduct (requires em_product package)."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "product-validator" / "src"))

from em_product.product import ProductSource, StandardProduct  # noqa: E402


def main():
    sample_path = Path(__file__).with_name("sample_product.json")
    data = json.loads(sample_path.read_text(encoding="utf-8"))
    source = ProductSource(**data)
    standard = StandardProduct(**data)
    print("ProductSource OK", source.product_id, (source.title or "")[:40])
    print("StandardProduct OK", standard.sku, standard.title[:40])


if __name__ == "__main__":
    main()
