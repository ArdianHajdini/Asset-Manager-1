/**
 * FaceitCallbackPage — handles the OAuth2 redirect from FACEIT.
 *
 * Route: /faceit/callback
 *
 * FACEIT redirects here with ?code=...&state=... after the user authorizes.
 * This page exchanges the code for tokens and then navigates to /faceit.
 */

import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { completeOAuthFlow } from "../services/faceitAuthService";
import { useFaceit } from "../context/FaceitContext";

export function FaceitCallbackPage() {
  const [, navigate] = useLocation();
  const { setConnection } = useFaceit();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function handleCallback() {
      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");
      const state = params.get("state");
      const oauthError = params.get("error");

      if (oauthError) {
        setError(`FACEIT verweigerte den Zugriff: ${params.get("error_description") ?? oauthError}`);
        setStatus("error");
        return;
      }

      if (!code || !state) {
        setError("Ungültige Callback-URL — fehlende Parameter.");
        setStatus("error");
        return;
      }

      try {
        const conn = await completeOAuthFlow(code, state);
        setConnection(conn);
        setStatus("success");
        setTimeout(() => navigate("/faceit"), 1500);
      } catch (err) {
        setError(String(err));
        setStatus("error");
      }
    }

    handleCallback();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="text-center">
        {status === "loading" && (
          <>
            <Loader2 className="w-10 h-10 text-[#FF5500] animate-spin mx-auto mb-4" />
            <p className="text-white/60 text-sm">FACEIT-Verbindung wird abgeschlossen...</p>
          </>
        )}
        {status === "success" && (
          <>
            <CheckCircle2 className="w-10 h-10 text-green-400 mx-auto mb-4" />
            <p className="text-white font-semibold">Erfolgreich verbunden!</p>
            <p className="text-white/40 text-sm mt-1">Du wirst weitergeleitet...</p>
          </>
        )}
        {status === "error" && (
          <>
            <AlertCircle className="w-10 h-10 text-red-400 mx-auto mb-4" />
            <p className="text-white font-semibold">Verbindung fehlgeschlagen</p>
            <p className="text-red-300/80 text-sm mt-2 max-w-sm">{error}</p>
            <button
              onClick={() => navigate("/faceit")}
              className="mt-6 px-5 py-2 rounded-xl bg-white/8 hover:bg-white/15 text-white/70 text-sm transition-colors"
            >
              Zurück zu FACEIT
            </button>
          </>
        )}
      </div>
    </div>
  );
}
