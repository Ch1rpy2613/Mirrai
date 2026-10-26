import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { trpc } from "@/lib/trpc";
import {
  translate,
  LOCALE_NAMES,
  zh,
  type Locale,
  type TranslationKey,
  type TranslationParams,
  type ValueAt,
} from "@/i18n";

export type { Locale, TranslationKey, TranslationParams };

type LocaleContextType = {
  locale: Locale;
  setLocale: (l: Locale) => void;
  /** Translates a dotted key, with optional `{{name}}` placeholders. */
  t: <K extends TranslationKey>(
    key: K,
    params?: TranslationParams,
  ) => ValueAt<typeof zh, K>;
  /** The locale's own name, for the switcher. */
  localeName: string;
};

const LocaleContext = createContext<LocaleContextType | undefined>(undefined);

/**
 * The stored language, if there is one.
 *
 * The storage can refuse: private mode, cookies disabled, a full quota.
 * It used to be read without a guard, in the state initialiser — so the
 * whole app failed to mount when it threw.
 */
function storedLocale(): Locale {
  if (typeof window === "undefined") return "zh";
  try {
    const value = localStorage.getItem("mirrai-locale");
    return value === "en" ? "en" : "zh";
  } catch {
    return "zh";
  }
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(storedLocale);

  /**
   * Tells the server which language the user reads.
   *
   * The interface sends it on every request, but the things the app sends
   * on its own — a reminder at midnight, a reply in a chat window — have
   * to know it without being asked.
   */
  const setLocaleMutation = trpc.user.setLocale.useMutation({
    onError: () => {
      /* the interface language is what matters most; the server will catch
         up on the next request that carries the header */
    },
  });

  const setLocale = (l: Locale) => {
    setLocaleState(l);
    try {
      localStorage.setItem("mirrai-locale", l);
    } catch {
      // A browser that will not keep the choice is not a problem: the
      // language still changes for this session.
    }
    // The document language should follow the interface language.
    if (typeof document !== "undefined") {
      document.documentElement.lang = l === "zh" ? "zh-CN" : "en";
    }
    // The server has to know too: the things it sends on its own — a
    // reminder at midnight, a reply in a chat window — are not asked.
    setLocaleMutation.mutate({ locale: l });
  };

  /**
   * The document language follows the interface language from the start.
   *
   * It used to be set only when the language was *changed*, so a fresh
   * load in English left the document saying it was Chinese — which is
   * what a screen reader reads out.
   */
  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.lang = locale === "en" ? "en" : "zh-CN";
      /**
       * The page's description follows the language too.
       *
       * It was Chinese in the markup and never changed: so an English
       * reader who shared the link, or who found it in a search, was
       * told what the app was in a language they do not read.
       */
      const description = document.querySelector('meta[name="description"]');
      if (description) {
        description.setAttribute("content", translate(locale, "common.pageDescription"));
      }
    }
  }, [locale]);

  const value = useMemo<LocaleContextType>(
    () => ({
      locale,
      setLocale,
      t: (key, params) => translate(locale, key, params),
      localeName: LOCALE_NAMES[locale],
    }),
    [locale],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useLocale must be used within LocaleProvider");
  return ctx;
}
