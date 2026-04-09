import { Library, Home, Settings, Crosshair } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useApp } from "../context/AppContext";
import { getCS2Status } from "../services/cs2Service";

export function Navbar() {
  const [location] = useLocation();
  const { settings } = useApp();
  const { t } = useTranslation();
  const cs2Status = getCS2Status(settings.cs2Path);

  const navItems = [
    { label: t("nav.library"), icon: Library, path: "/library" },
    { label: t("nav.import"), icon: Home, path: "/" },
    { label: t("nav.settings"), icon: Settings, path: "/settings" },
  ];

  return (
    <nav className="fixed top-0 left-0 right-0 z-40 border-b border-white/10 bg-[#0d1117]/90 backdrop-blur-md">
      <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
        {/* Logo */}
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-orange-500/20 border border-orange-500/40 flex items-center justify-center">
            <Crosshair className="w-4 h-4 text-orange-400" />
          </div>
          <div className="flex flex-col">
            <span className="font-bold text-sm tracking-wide text-white leading-tight">FACEIT easyDemo</span>
            <span className="text-[10px] text-orange-400/70 font-mono leading-tight tracking-wider">CS2</span>
          </div>
        </div>

        {/* Nav items */}
        <div className="flex items-center gap-1">
          {navItems.map(({ label, icon: Icon, path }) => {
            const active = location === path || (path !== "/" && location.startsWith(path));
            return (
              <Link key={path} to={path}>
                <button
                  className={cn(
                    "flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-sm font-medium transition-all duration-150",
                    active
                      ? "bg-white/10 text-white"
                      : "text-white/50 hover:text-white/80 hover:bg-white/5"
                  )}
                >
                  <Icon className="w-4 h-4" />
                  {label}
                </button>
              </Link>
            );
          })}
        </div>

        {/* Right: CS2 status */}
        <div className="flex items-center gap-2">
          <div
            className={cn(
              "w-2 h-2 rounded-full",
              cs2Status === "found" ? "bg-green-400 shadow-[0_0_6px_2px_rgba(74,222,128,0.4)]" :
              cs2Status === "not_found" ? "bg-red-400" :
              "bg-yellow-400/60"
            )}
          />
          <span className="text-xs text-white/35 hidden sm:block">
            {cs2Status === "found" ? t("nav.cs2Ready") :
             cs2Status === "not_found" ? t("nav.cs2NotFound") :
             t("nav.cs2NotConfigured")}
          </span>
        </div>
      </div>
    </nav>
  );
}
