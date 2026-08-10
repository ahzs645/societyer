import { useEffect, useState } from "react";
import { Download, Share } from "lucide-react";
import {
  getDeferredInstallPrompt,
  isIosSafari,
  isStandalonePwa,
  promptInstall,
  subscribeToInstallAvailability,
} from "../lib/pwa";

/**
 * Offers the browser's install prompt when one is available. Chrome and Edge
 * hand us a deferred `beforeinstallprompt` event; iOS Safari never does, so it
 * gets the manual "Add to Home Screen" instructions instead. Already-installed
 * launches render nothing.
 */
export function InstallAppPrompt({ compact = false }: { compact?: boolean }) {
  const [available, setAvailable] = useState(() => Boolean(getDeferredInstallPrompt()));
  const [installed] = useState(() => isStandalonePwa());
  const [showIosHelp, setShowIosHelp] = useState(false);

  useEffect(() => subscribeToInstallAvailability(() => setAvailable(Boolean(getDeferredInstallPrompt()))), []);

  if (installed) return null;

  const ios = isIosSafari();
  if (!available && !ios) return null;

  if (ios) {
    return (
      <div className={`install-prompt${compact ? " install-prompt--compact" : ""}`}>
        <button className="btn btn--sm" type="button" onClick={() => setShowIosHelp((value) => !value)}>
          <Share size={14} /> Add to Home Screen
        </button>
        {showIosHelp && (
          <p className="install-prompt__help">
            In Safari, tap the Share button, then <strong>Add to Home Screen</strong>. Societyer then opens
            like an app and keeps working offline.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className={`install-prompt${compact ? " install-prompt--compact" : ""}`}>
      <button
        className="btn btn--sm"
        type="button"
        onClick={() => {
          void promptInstall();
        }}
      >
        <Download size={14} /> Install Societyer
      </button>
      {!compact && (
        <p className="install-prompt__help">
          Installing keeps Societyer in your app list and lets it open offline.
        </p>
      )}
    </div>
  );
}
