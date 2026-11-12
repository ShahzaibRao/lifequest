import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { I18nManager } from "react-native";
import * as SecureStore from "expo-secure-store";
import {
  translations,
  type Language,
  type TranslationKey,
} from "./translations";

// First-run default. Settings picker aane ke baad ye sirf fallback rahega.
const DEFAULT_LANGUAGE: Language = "en";
const STORAGE_KEY = "lifequest-language";

type LanguageContextValue = {
  language: Language;
  setLanguage: (lang: Language) => Promise<void>;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  isRTL: boolean;
};

function translate(
  language: Language,
  key: TranslationKey,
  params?: Record<string, string | number>,
): string {
  let text = translations[language][key] ?? translations.en[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace("{" + k + "}", String(v));
    }
  }
  return text;
}

// Provider wire hone se pehle (App.tsx wiring baaqi hai) useLanguage English
// fallback deta hai taake app crash na ho.
const fallback: LanguageContextValue = {
  language: "en",
  setLanguage: async () => {},
  t: (key, params) => translate("en", key, params),
  isRTL: false,
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(DEFAULT_LANGUAGE);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const saved = await SecureStore.getItemAsync(STORAGE_KEY);
        if (
          saved === "en" ||
          saved === "ur" ||
          saved === "es" ||
          saved === "ar"
        ) {
          setLanguageState(saved);
        }
      } catch {
        // Persisted language na mile to default rehta hai.
      } finally {
        setReady(true);
      }
    })();
  }, []);

  const isRTL = language === "ar";

  useEffect(() => {
    I18nManager.allowRTL(true);
    if (I18nManager.isRTL !== isRTL) {
      // Poori RTL layout agle app launch par lagegi (Arabic text foran RTL dikhta hai).
      I18nManager.forceRTL(isRTL);
    }
  }, [isRTL]);

  const setLanguage = async (lang: Language) => {
    setLanguageState(lang);
    try {
      await SecureStore.setItemAsync(STORAGE_KEY, lang);
    } catch {
      // Save fail ho to bhi isi session mein language badal jati hai.
    }
  };

  if (!ready) return null;

  return (
    <LanguageContext.Provider
      value={{
        language,
        setLanguage,
        t: (key, params) => translate(language, key, params),
        isRTL,
      }}
    >
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage(): LanguageContextValue {
  return useContext(LanguageContext) ?? fallback;
}
