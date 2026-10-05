// SMS adapter - Twilio in live mode, no-op (logged) in demo.

export type SentSms = {
  provider: "twilio" | "demo";
  accepted: boolean;
  id: string;
  to: string;
  bodyPreview: string;
  sentAtISO: string;
};

function env(name: string) {
  return (globalThis as any)?.process?.env?.[name] as string | undefined;
}

function basicAuth(username: string, password: string) {
  const raw = `${username}:${password}`;
  return typeof globalThis.btoa === "function"
    ? globalThis.btoa(raw)
    : Buffer.from(raw, "utf8").toString("base64");
}

export async function sendSms(args: {
  to: string;
  body: string;
  tag?: string;
  demo?: boolean;
}): Promise<SentSms> {
  const sentAtISO = new Date().toISOString();
  const bodyPreview = args.body.slice(0, 140);
  const accountSid = env("TWILIO_ACCOUNT_SID");
  const authToken = env("TWILIO_AUTH_TOKEN");
  const fromNumber = env("TWILIO_FROM_NUMBER");
  const messagingServiceSid = env("TWILIO_MESSAGING_SERVICE_SID");
  const statusCallback = env("TWILIO_STATUS_CALLBACK_URL");
  const endpoint =
    env("TWILIO_MESSAGES_API_BASE_URL") ??
    (accountSid
      ? `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`
      : undefined);

  if (args.demo === true) {
    return {
      provider: "demo",
      accepted: true,
      id: `demo-sms-${Math.random().toString(36).slice(2, 10)}`,
      to: args.to,
      bodyPreview,
      sentAtISO,
    };
  }

  if (!accountSid || !authToken || (!fromNumber && !messagingServiceSid) || !endpoint) {
    throw new Error("SMS delivery requires TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER or TWILIO_MESSAGING_SERVICE_SID.");
  }

  const params = new URLSearchParams({
    To: args.to,
    Body: args.body,
  });
  if (fromNumber) params.set("From", fromNumber);
  if (messagingServiceSid) params.set("MessagingServiceSid", messagingServiceSid);
  if (statusCallback) params.set("StatusCallback", statusCallback);

  const response = await fetch(endpoint, {
    method: "POST",
    signal: AbortSignal.timeout(15_000),
    headers: {
      Authorization: `Basic ${basicAuth(accountSid, authToken)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  if (!response.ok) {
    throw new Error(`Twilio request failed with status ${response.status}.`);
  }

  const data = await response.json().catch(() => ({}));
  if (typeof (data as any)?.sid !== "string" || !(data as any).sid.trim()) throw new Error("Twilio did not return a delivery identifier; acceptance is unconfirmed.");
  return {
    provider: "twilio",
    accepted: true,
    id: String((data as any).sid),
    to: args.to,
    bodyPreview,
    sentAtISO,
  };
}
