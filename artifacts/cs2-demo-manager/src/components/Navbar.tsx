import { Crosshair, Library, Home, Settings } from "lucide-react";
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { useApp } from "../context/AppContext";
import { useFaceit } from "../context/FaceitContext";
import { getCS2Status } from "../services/cs2Service";

const navItems = [
  {
    label: "FACEIT",
    path: "/faceit",
    primary: true,
    FaceitIcon: () => (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z" />
      </svg>
    ),
  },
  { label: "Bibliothek", icon: Library, path: "/library" },
  { label: "Import", icon: Home, path: "/" },
  { label: "Einstellungen", icon: Settings, path: "/settings" },
];

export function Navbar() {
  const [location] = useLocation();
  const { settings } = useApp();
  const { isConnected, connection } = useFaceit();
  const cs2Status = getCS2Status(settings.cs2Path);

  return (
    <nav className="fixed top-0 left-0 right-0 z-40 border-b border-white/10 bg-[#0d1117]/90 backdrop-blur-md">
      <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
        {/* Logo */}
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-orange-500/20 border border-orange-500/40 flex items-center justify-center">
            <Crosshair className="w-4 h-4 text-orange-400" />
          </div>
          <span className="font-bold text-sm tracking-wide text-white">CS2 Demo Manager</span>
        </div>

        {/* Nav items */}
        <div className="flex items-center gap-1">
          {navItems.map(({ label, icon: Icon, path, primary, FaceitIcon }) => {
            const active = location === path || (path !== "/" && location.startsWith(path));

            if (primary && FaceitIcon) {
              return (
                <Link key={path} to={path}>
                  <button
                    className={cn(
                      "flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-sm font-semibold transition-all duration-150",
                      active
                        ? "bg-[#FF5500]/20 text-[#FF5500] border border-[#FF5500]/30"
                        : "text-[#FF5500]/70 hover:text-[#FF5500] hover:bg-[#FF5500]/10"
                    )}
                  >
                    <FaceitIcon />
                    {label}
                    {isConnected && (
                      <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
                    )}
                  </button>
                </Link>
              );
            }

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
                  {Icon && <Icon className="w-4 h-4" />}
                  {label}
                </button>
              </Link>
            );
          })}
        </div>

        {/* Right: FACEIT user + CS2 status */}
        <div className="flex items-center gap-4">
          {isConnected && connection && (
            <div className="flex items-center gap-1.5">
              {connection.avatar ? (
                <img src={connection.avatar} alt="" className="w-5 h-5 rounded object-cover" />
              ) : (
                <div className="w-5 h-5 rounded bg-[#FF5500]/20 border border-[#FF5500]/30" />
              )}
              <span className="text-[#FF5500]/80 text-xs font-medium">{connection.nickname}</span>
            </div>
          )}
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
              {cs2Status === "found" ? "CS2 bereit" :
               cs2Status === "not_found" ? "CS2 nicht gefunden" :
               "CS2 nicht konfiguriert"}
            </span>
          </div>
        </div>
      </div>
    </nav>
  );
}
