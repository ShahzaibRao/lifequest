"""app.json: rename the app to LifeQuest (2026-11-09).

- name "mobile" -> "LifeQuest" (display name on the phone).
- slug "mobile" -> "lifequest".
- android package "com.raoshahzaib.mobile" -> "com.raoshahzaib.lifequest".
Note: the new package installs as a SEPARATE app from the old dev build
(uninstall the old one). Fresh login needed (fresh DB on the server anyway).
"""

import json
from pathlib import Path

p = Path("~/lifequest/mobile/app.json").expanduser()
data = json.loads(p.read_text())
expo = data["expo"]

changed = []
if expo.get("name") != "LifeQuest":
    expo["name"] = "LifeQuest"
    changed.append("name -> LifeQuest")
if expo.get("slug") != "lifequest":
    expo["slug"] = "lifequest"
    changed.append("slug -> lifequest")
pkg = expo.get("android", {}).get("package")
if pkg != "com.raoshahzaib.lifequest":
    expo.setdefault("android", {})["package"] = "com.raoshahzaib.lifequest"
    changed.append("package -> com.raoshahzaib.lifequest")

if changed:
    p.write_text(json.dumps(data, indent=2) + "\n")
    print("OK: " + "; ".join(changed))
else:
    print("SKIP (already applied): name/slug/package already LifeQuest")

print("verify: name=%s slug=%s package=%s" % (expo["name"], expo["slug"], expo["android"]["package"]))
