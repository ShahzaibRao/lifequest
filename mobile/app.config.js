// LifeQuest app config — variant-aware (dev / staging / production).
//
// APP_VARIANT selects the app identity. Each variant is a SEPARATE Android
// app (different package), so dev / staging / production install side by
// side instead of replacing each other:
//   dev        -> "LifeQuest Dev",     com.raoshahzaib.lifequest.dev
//   staging    -> "LifeQuest Staging", com.raoshahzaib.lifequest.staging
//   production -> "LifeQuest",         com.raoshahzaib.lifequest (default)
//
// APP_VARIANT comes from eas.json `env` per build profile. Locally (Metro /
// `expo run`), set it in the shell; it defaults to production. The scheme
// matches the package so the Google OAuth redirect returns to the right
// app. Dev (orange DEV badge) / Staging (blue STAGING badge) icons make the
// variant obvious on the home screen.
const variant = process.env.APP_VARIANT || "production";

const VARIANTS = {
  dev: {
    name: "LifeQuest Dev",
    package: "com.raoshahzaib.lifequest.dev",
    icon: "./assets/icon-dev.png",
    adaptiveIconForeground: "./assets/android-icon-foreground-dev.png",
  },
  staging: {
    name: "LifeQuest Staging",
    package: "com.raoshahzaib.lifequest.staging",
    icon: "./assets/icon-staging.png",
    adaptiveIconForeground: "./assets/android-icon-foreground-staging.png",
  },
  production: {
    name: "LifeQuest",
    package: "com.raoshahzaib.lifequest",
    icon: "./assets/icon.png",
    adaptiveIconForeground: "./assets/android-icon-foreground.png",
  },
};

const cfg = VARIANTS[variant] || VARIANTS.production;

module.exports = {
  expo: {
    name: cfg.name,
    slug: "mobile",
    scheme: cfg.package,
    version: "1.0.0",
    orientation: "portrait",
    icon: cfg.icon,
    userInterfaceStyle: "light",
    ios: {
      supportsTablet: true,
    },
    android: {
      adaptiveIcon: {
        backgroundColor: "#E6F4FE",
        foregroundImage: cfg.adaptiveIconForeground,
        backgroundImage: "./assets/android-icon-background.png",
        monochromeImage: "./assets/android-icon-monochrome.png",
      },
      predictiveBackGestureEnabled: false,
      package: cfg.package,
      permissions: [
        "ACTIVITY_RECOGNITION",
        "android.permission.ACCESS_COARSE_LOCATION",
        "android.permission.ACCESS_FINE_LOCATION",
        "android.permission.ACCESS_BACKGROUND_LOCATION",
        "android.permission.RECEIVE_BOOT_COMPLETED",
        "android.permission.FOREGROUND_SERVICE",
        "android.permission.FOREGROUND_SERVICE_LOCATION",
        "android.permission.POST_NOTIFICATIONS",
      ],
    },
    web: {
      favicon: "./assets/favicon.png",
    },
    plugins: [
      "expo-secure-store",
      "expo-sqlite",
      "@maplibre/maplibre-react-native",
      [
        "expo-location",
        {
          locationAlwaysAndWhenInUsePermission:
            "Allow LifeQuest to use your location in the background while you walk, so your walk keeps recording even when the app is in the background.",
          locationWhenInUsePermission:
            "Allow LifeQuest to use your location while you walk.",
          isAndroidBackgroundLocationEnabled: true,
          isAndroidForegroundServiceEnabled: true,
        },
      ],
    ],
    extra: {
      eas: {
        projectId: "7407bf0a-4b3f-45ab-b15a-735f37adbab9",
      },
    },
    runtimeVersion: {
      policy: "appVersion",
    },
    updates: {
      url: "https://u.expo.dev/7407bf0a-4b3f-45ab-b15a-735f37adbab9",
    },
  },
};
