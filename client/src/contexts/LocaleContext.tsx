import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
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

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    if (typeof window === "undefined") return "zh";
    return (localStorage.getItem("mirrai-locale") as Locale) || "zh";
  });

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
    localStorage.setItem("mirrai-locale", l);
    // The document language should follow the interface language.
    if (typeof document !== "undefined") {
      document.documentElement.lang = l === "zh" ? "zh-CN" : "en";
    }
    // The server has to know too: the things it sends on its own — a
    // reminder at midnight, a reply in a chat window — are not asked.
    setLocaleMutation.mutate({ locale: l });
  };

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
