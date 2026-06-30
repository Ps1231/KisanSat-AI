#!/usr/bin/env python3
"""
Standalone raster test — run from backend/ with GEE creds set in .env.
Confirms run_gee_raster_pipeline returns real tile URLs (not an error).
    python3 test_raster.py
"""
import os, json
from pathlib import Path

# load .env
for ep in [Path(".env"), Path("..")/".env"]:
    if ep.exists():
        for line in ep.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
        break

from gee_pipeline import init_gee, run_gee_raster_pipeline

ok, msg = init_gee()
print("GEE init:", "OK" if ok else "FAIL", "-", msg)
if not ok:
    raise SystemExit("Fix GEE creds first (see test_gee_pipeline.py)")

# Rural Ludhiana cropland box (matches frontend AOI #1)
aoi = [[75.95,30.78],[75.99,30.78],[75.99,30.82],[75.95,30.82],[75.95,30.78]]
res = run_gee_raster_pipeline(aoi, "2023-11-01", "2024-03-31", 4)

if "error" in res:
    print("RASTER FAILED:", res["error"])
else:
    print("RASTER OK — mode:", res["mode"])
    for k, url in res["tiles"].items():
        print(f"  {k:9s}: {url[:80]}...")
    print("\nIf you see 3 tile URLs above, the raster pipeline works.")
    print("Paste one into a browser tile tester or just run the app.")