"""app.json: slug wapas "mobile" rakho (EAS build fix, 2026-11-09).

EAS project (projectId 7407bf0a-...) "mobile" slug se registered hai.
Slug badalne se build fail hoti hai ("slug does not match").
Slug sirf Expo ka internal identifier hai — phone par dikhne wala naam
"name" field se aata hai, jo "LifeQuest" hi rehta hai.
Package "com.raoshahzaib.lifequest" bhi unchanged rehta hai.
"""

import json
from pathlib import Path

p = Path("~/lifequest/mobile/app.json").expanduser()
data = json.loads(p.read_text())
expo = data["expo"]

changed = []
if expo.get("slug") != "mobile":
    expo["slug"] = "mobile"
    changed.append("slug -> mobile (EAS project match)")
if expo.get("name") != "LifeQuest":
    expo["name"] = "LifeQuest"
    changed.append("name -> LifeQuest")
pkg = expo.get("android", {}).get("package")
if pkg != "com.raoshahzaib.lifequest":
    expo.setdefault("android", {})["package"] = "com.raoshahzaib.lifequest"
    changed.append("package -> com.raoshahzaib.lifequest")

if changed:
    p.write_text(json.dumps(data, indent=2) + "\n")
    print("OK: " + "; ".join(changed))
else:
    print("SKIP (already applied)")

print("verify: name=%s slug=%s package=%s" % (expo["name"], expo["slug"], expo["android"]["package"]))
