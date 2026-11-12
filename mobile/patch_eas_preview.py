"""eas.json: preview profile -> standalone APK with the server API baked in (2026-11-09).

Adds to the preview profile:
- android.buildType "apk" (direct-install APK for family/friends, not an AAB).
- env EXPO_PUBLIC_API_URL https://api.raoshahzaib.site/api/v1
  (baked into the JS bundle at build time — no Metro, no Expo Go).
Build with: cd ~/lifequest/mobile && eas build --profile preview --platform android
"""

import json
from pathlib import Path

p = Path("~/lifequest/mobile/eas.json").expanduser()
data = json.loads(p.read_text())
preview = data.setdefault("build", {}).setdefault("preview", {})

changed = []
if preview.get("distribution") != "internal":
    preview["distribution"] = "internal"
    changed.append("distribution -> internal")
android = preview.setdefault("android", {})
if android.get("buildType") != "apk":
    android["buildType"] = "apk"
    changed.append("android.buildType -> apk")
env = preview.setdefault("env", {})
url = "https://api.raoshahzaib.site/api/v1"
if env.get("EXPO_PUBLIC_API_URL") != url:
    env["EXPO_PUBLIC_API_URL"] = url
    changed.append("EXPO_PUBLIC_API_URL -> " + url)

if changed:
    p.write_text(json.dumps(data, indent=2) + "\n")
    print("OK: " + "; ".join(changed))
else:
    print("SKIP (already applied): preview profile already set")

print("verify: preview = " + json.dumps(preview))
