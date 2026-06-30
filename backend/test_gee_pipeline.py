#!/usr/bin/env python3
"""
🛰️ Google Earth Engine (GEE) & Gemini API - Pipeline Test Runner
Usage: python3 backend/test_gee_pipeline.py
"""

import os
import sys
import json
from pathlib import Path

# Set up module path resolution
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

try:
    import gee_pipeline
    import lulc_labels
except ImportError:
    print("❌ Error: Could not import gee_pipeline or lulc_labels modules. Make sure you run from the project root or backend folder.")

def run_test():
    print("=" * 80)
    print("🛰️  SATELLITE DATA PIPELINE (GEE & GEMINI BRIDGE) - HEALTH TEST")
    print("=" * 80)

    # 1. Check Python and GEE Libraries
    print("\n🔍 Step 1: Checking System Libraries...")
    print(f" • Python version: {sys.version.split()[0]}")
    
    try:
        import ee
        HAS_EE = True
        print(" • Google Earth Engine library (ee): ✅ Installed")
    except ImportError:
        HAS_EE = False
        print(" • Google Earth Engine library (ee): ❌ Not installed")

    try:
        import google.genai
        print(" • Gemini GenAI SDK (google-genai): ✅ Installed")
    except ImportError:
        print(" • Gemini GenAI SDK (google-genai): ⚠️ Not installed (using server-side http requests fallback if needed)")

    # 2. Check credentials & environment keys
    print("\n🔑 Step 2: Scanning Environment Credentials...")
    
    # Check env files
    env_file = Path(__file__).resolve().parent / ".env"
    if not env_file.exists():
        env_file = Path(__file__).resolve().parent.parent / ".env"

    if env_file.exists():
        print(f" • Loaded environment variables from: {env_file.name}")
        for raw in env_file.read_text().splitlines():
            line = raw.strip().lstrip("env")
            if line and "=" in line and not line.startswith("#"):
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())
    else:
        print(" • ⚠️ No .env file detected (reading direct environment variables only)")

    gee_email = os.environ.get("GEE_SERVICE_ACCOUNT_EMAIL")
    gee_key = os.environ.get("GEE_SERVICE_ACCOUNT_KEY")
    gee_key_path = os.environ.get("GEE_KEY_PATH")
    gemini_key = os.environ.get("GEMINI_API_KEY")

    print(f" • GEE_SERVICE_ACCOUNT_EMAIL : {'✅ Set (' + gee_email + ')' if gee_email else '❌ Missing'}")
    print(f" • GEE_SERVICE_ACCOUNT_KEY   : {'✅ Set (Key String)' if gee_key else '❌ Missing'}")
    print(f" • GEE_KEY_PATH               : {'✅ Set (' + gee_key_path + ')' if gee_key_path else '❌ Missing'}")
    print(f" • GEMINI_API_KEY             : {'✅ Set (AI Studio Gemini Key)' if gemini_key else '❌ Missing'}")

    # 3. Test GEE connection with Dynamic World
    print("\n🌐 Step 3: Verifying Earth Engine Connection & Datasets...")
    if not HAS_EE:
        print(" ⚠️ GEE library missing. Skipping connection test.")
    else:
        connected = False
        try:
            if gee_email and gee_key:
                try:
                    key_dict = json.loads(gee_key)
                    cred = ee.ServiceAccountCredentials(gee_email, json.dumps(key_dict))
                except Exception:
                    cred = ee.ServiceAccountCredentials(gee_email, gee_key)
                ee.Initialize(cred)
                connected = True
                print(" • ee.Initialize(): ✅ Success using service account credentials.")
            elif gee_email and gee_key_path:
                k_path = Path(gee_key_path)
                if not k_path.is_absolute():
                    for base in [Path(__file__).resolve().parent, Path(__file__).resolve().parent.parent]:
                        if (base / gee_key_path).exists():
                            k_path = base / gee_key_path
                            break
                if k_path.exists():
                    cred = ee.ServiceAccountCredentials(gee_email, str(k_path))
                    ee.Initialize(cred)
                    connected = True
                    print(f" • ee.Initialize(): ✅ Success using key file path: {k_path}")
                else:
                    print(f" • ee.Initialize(): ❌ Key file path {gee_key_path} does not exist.")
            else:
                ee.Initialize()
                connected = True
                print(" • ee.Initialize(): ✅ Success using default user authentication.")
        except Exception as e:
            print(f" • ee.Initialize(): ❌ Failed to authenticate: {e}")

        if connected:
            try:
                # Test querying standard collections (Sentinel and Dynamic World)
                test_geom = ee.Geometry.Point([75.85, 30.95]) # Ludhiana, Punjab
                
                print(" • Testing Sentinel-2 Harmonized access...")
                s2_size = ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED").filterBounds(test_geom).limit(5).size().getInfo()
                print(f"   - Sentinel-2 S2_SR_HARMONIZED: ✅ Connected ({s2_size} images found)")
                
                print(" • Testing Google Dynamic World V1 access (Fixing old ESRI LULC issues)...")
                dw_size = ee.ImageCollection("GOOGLE/DYNAMICWORLD/V1").filterBounds(test_geom).limit(5).size().getInfo()
                print(f"   - Google Dynamic World dataset: ✅ Connected ({dw_size} images found)")
                print("   - SUCCESS: No access restrictions or permissions issues found on Google's Dynamic World dataset!")
            except Exception as e:
                print(f" • Dataset queries: ❌ Failed query: {e}")

    # 4. Detailed Guidelines about adding keys
    print("\n" + "=" * 80)
    print("🔑 DETAILED INSTRUCTIONS: WHERE AND HOW TO CONFIGURE KEYS")
    print("=" * 80)
    
    print("\n1️⃣ GOOGLE EARTH ENGINE (GEE) CREDENTIALS:")
    print("   To run live Earth Engine queries instead of high-fidelity simulations, you need a GCP Service Account Key:")
    print("   • Go to GCP Console -> IAM & Admin -> Service Accounts.")
    print("   • Create a Service Account and grant it 'Earth Engine Resource Viewer' or similar access.")
    print("   • Generate a new private key in JSON format and download it.")
    print("   • Configure these in your environment variables or in your workspace's secrets via Settings:")
    print("     - GEE_SERVICE_ACCOUNT_EMAIL  --> The email of your GCP service account.")
    print("     - GEE_SERVICE_ACCOUNT_KEY    --> Copy/paste the entire JSON key file content directly into this variable.")
    print("     - OR GEE_KEY_PATH            --> Save the JSON key as `gee-key.json` and set this variable to `backend/gee-key.json`.")

    print("\n2️⃣ GEMINI AI API KEY (FOR CROP ADVISORIES & SMART CHAT):")
    print("   To use Gemini for smart natural language advisories and chat insights:")
    print("   • Obtain an API key from Google AI Studio (https://aistudio.google.com/).")
    print("   • Add it to your workspace's secrets via the AI Studio Build Settings:")
    print("     - GEMINI_API_KEY             --> Set this directly to your Gemini API key.")
    print("   • In server-side code (Node or Python), this is loaded securely via `process.env.GEMINI_API_KEY` or `os.environ['GEMINI_API_KEY']`.")
    print("     It is completely hidden from the user's browser, preventing key theft.")
    print("=" * 80 + "\n")

if __name__ == "__main__":
    run_test()
