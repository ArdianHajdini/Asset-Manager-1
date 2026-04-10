import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import en from "./locales/en";
import de from "./locales/de";
import fr from "./locales/fr";
import es from "./locales/es";
import pt from "./locales/pt";
import ru from "./locales/ru";
import zh from "./locales/zh";
import tr from "./locales/tr";
import ar from "./locales/ar";
import ko from "./locales/ko";
import pl from "./locales/pl";

export const LANGUAGES: { code: string; label: string; nativeLabel: string }[] = [
  { code: "en", label: "English", nativeLabel: "English" },
  { code: "de", label: "German", nativeLabel: "Deutsch" },
  { code: "fr", label: "French", nativeLabel: "Français" },
  { code: "es", label: "Spanish", nativeLabel: "Español" },
  { code: "pt", label: "Portuguese", nativeLabel: "Português" },
  { code: "ru", label: "Russian", nativeLabel: "Русский" },
  { code: "zh", label: "Chinese", nativeLabel: "中文" },
  { code: "tr", label: "Turkish", nativeLabel: "Türkçe" },
  { code: "ar", label: "Arabic", nativeLabel: "العربية" },
  { code: "ko", label: "Korean", nativeLabel: "한국어" },
  { code: "pl", label: "Polish", nativeLabel: "Polski" },
];

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      de: { translation: de },
      fr: { translation: fr },
      es: { translation: es },
      pt: { translation: pt },
      ru: { translation: ru },
      zh: { translation: zh },
      tr: { translation: tr },
      ar: { translation: ar },
      ko: { translation: ko },
      pl: { translation: pl },
    },
    fallbackLng: "en",
    load: "languageOnly",
    detection: {
      order: ["localStorage", "navigator"],
      lookupLocalStorage: "i18nextLng",
      caches: ["localStorage"],
    },
    interpolation: { escapeValue: false },
  });

export default i18n;
