import { createContext, useContext, useState, type ReactNode } from "react";
import { type Locale, translations } from "@/lib/i18n";

type LocaleContextType = {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (typeof translations)[Locale];
};

const LocaleContext = createContext<LocaleContextType | undefined>(undefined);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(() => {
    if (typeof window === "undefined") return "zh";
    return (localStorage.getItem("presence-locale") as Locale) || "zh";
  });

  const handleSetLocale = (l: Locale) => {
    setLocale(l);
    localStorage.setItem("presence-locale", l);
  };

  return (
    <LocaleContext.Provider value={{ locale, setLocale: handleSetLocale, t: translations[locale] }}>
      {children}
    </LocaleContext.Provider>
  );
}

export function useLocale() {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useLocale must be used within LocaleProvider");
  return ctx;
}
