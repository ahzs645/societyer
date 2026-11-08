import { broadcastResponseToMainFrame } from "@azure/msal-browser/redirect-bridge";

// This page deliberately loads neither the app router nor the Societyer session.
void broadcastResponseToMainFrame().catch(() => {
  const status = document.getElementById("status");
  if (status) status.textContent = "Sign-in could not return to Societyer. Close this window and connect the document source again.";
});
