import { useState } from "react";
import { Search, Library, Plus, Loader2, RefreshCw } from "lucide-react";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { DemoCard } from "../components/DemoCard";
import { useApp } from "../context/AppContext";

export function LibraryPage() {
  const { demos, isLoadingDemos, refreshDemos } = useApp();
  const [query, setQuery] = useState("");
  const [, navigate] = useLocation();
  const { t } = useTranslation();

  const filtered = demos.filter((d) =>
    d.displayName.toLowerCase().includes(query.toLowerCase()) ||
    d.filename.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">{t("library.title")}</h1>
          <p className="text-white/40 text-sm mt-0.5">
            {isLoadingDemos
              ? t("library.loading")
              : t("library.subtitle", { count: demos.length })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => refreshDemos()}
            disabled={isLoadingDemos}
            title={t("library.refresh")}
            className="p-2 rounded-xl border border-white/10 bg-white/3 hover:bg-white/8 text-white/40 hover:text-white/70 transition-all disabled:opacity-50"
          >
            {isLoadingDemos
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <RefreshCw className="w-4 h-4" />
            }
          </button>
          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-orange-500 hover:bg-orange-400 text-white text-sm font-medium transition-colors"
          >
            <Plus className="w-4 h-4" />
            {t("library.addDemo")}
          </button>
        </div>
      </div>

      {/* Search */}
      {demos.length > 0 && (
        <div className="relative mb-6">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
          <input
            type="search"
            placeholder={t("library.searchPlaceholder")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-xl pl-11 pr-4 py-3 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-orange-500/50 transition-colors"
          />
        </div>
      )}

      {/* Loading state */}
      {isLoadingDemos && demos.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <Loader2 className="w-10 h-10 text-white/20 animate-spin mb-4" />
          <p className="text-white/40 text-sm">{t("library.readingFolder")}</p>
        </div>
      )}

      {/* Empty state */}
      {!isLoadingDemos && demos.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-20 h-20 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mb-5">
            <Library className="w-10 h-10 text-white/20" />
          </div>
          <h3 className="text-white/60 font-semibold text-lg">{t("library.empty")}</h3>
          <p className="text-white/30 text-sm mt-2 max-w-xs">{t("library.emptyHint")}</p>
          <button
            onClick={() => navigate("/")}
            className="mt-6 flex items-center gap-2 px-5 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-400 text-white text-sm font-medium transition-colors"
          >
            <Plus className="w-4 h-4" />
            {t("library.importDemo")}
          </button>
        </div>
      )}

      {/* No search results */}
      {!isLoadingDemos && demos.length > 0 && filtered.length === 0 && (
        <div className="flex flex-col items-center py-16 text-center">
          <Search className="w-10 h-10 text-white/15 mb-4" />
          <p className="text-white/40 text-sm">{t("library.noResults", { query })}</p>
          <button
            onClick={() => setQuery("")}
            className="mt-3 text-orange-400 hover:text-orange-300 text-sm transition-colors"
          >
            {t("library.resetSearch")}
          </button>
        </div>
      )}

      {/* Demo list */}
      {filtered.length > 0 && (
        <div className="space-y-3">
          {filtered.map((demo) => (
            <DemoCard key={demo.id} demo={demo} />
          ))}
        </div>
      )}
    </div>
  );
}
