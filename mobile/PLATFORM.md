# LifeQuest mobile app — platform policy (locked with the repo)

- **Target: iOS and Android, one Expo codebase.** Every dependency
  and every native capability (GPS, pedometer, background location,
  secure storage, maps) must be checked for both platforms before it
  is adopted. An Android-only library is not acceptable without an
  explicit, recorded exception.
- **Testing now: Android only**, because Rao only has an Android
  phone. Android is where walking/GPS tests run first.
- **iOS testing: later**, when an iPhone is available or via an
  Expo EAS cloud build. iOS is not removed from scope by testing
  on Android first.

## What must NOT be in the app

- Any ownership or XP decision on the client (server is authoritative).
- Run mode (Walk only in MVP — the CHECK constraint in the database
  forbids it, and the app must not offer it yet).
- Any LLM call or external AI endpoint.
