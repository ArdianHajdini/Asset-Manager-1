
import { CheckCircle, XCircle, Info, X } from "lucide-react";
import { useApp } from "../context/AppContext";
import { cn } from "@/lib/utils";

export function StatusBar() {
  const { status, clearStatus } = useApp();
  if (!status) return null;

  const icons = {
    success: <CheckCircle className="w-4 h-4 shrink-0" />,
    error: <XCircle className="w-4 h-4 shrink-0" />,
    info: <Info className="w-4 h-4 shrink-0" />,
  };

  const colors = {
    success: "bg-green-900/60 border-green-700 text-green-200",
    error: "bg-red-900/60 border-red-700 text-red-200",
    info: "bg-blue-900/60 border-blue-700 text-blue-200",
  };

  return (
    <div
      className={cn(
        "fixed bottom-6 left-1/2 -translate-x-1/2 z-50",
        "flex items-start gap-3 px-5 py-3 rounded-xl border backdrop-blur-sm shadow-2xl",
        "max-w-lg w-full mx-4",
        "animate-in fade-in slide-in-from-bottom-4 duration-300",
        colors[status.type]
      )}
    >
      {icons[status.type]}
      <p className="text-sm leading-relaxed flex-1">{status.message}</p>
      <button onClick={clearStatus} className="opacity-60 hover:opacity-100 transition-opacity">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
