import { Link } from "react-router-dom";
import { BellRing, ChevronRight } from "lucide-react";
import { NOTIFICATION_SETTINGS_HREF } from "./links";

/** The Settings page entry point to personal notification settings and alert thresholds. */
export function NotificationSettingsRow() {
  return (
    <Link to={NOTIFICATION_SETTINGS_HREF} className="notif-settings-link">
      <BellRing size={16} aria-hidden="true" className="notif-settings-link__icon" />
      <span className="notif-settings-link__text">
        <span className="notif-settings-link__title">Notification settings</span>
        <span className="notif-settings-link__hint">Choose what you hear about and how, set alert thresholds and turn on the weekly summary.</span>
      </span>
      <ChevronRight size={16} aria-hidden="true" className="notif-settings-link__chevron" />
    </Link>
  );
}
