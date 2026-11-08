import type { InvoiceBrand } from "./invoiceBranding";

/** A presentation profile never supplies the workspace's legal/display name. */
export type WorkspaceBrandSource = {
  _id?: string;
  name?: string | null;
  workspaceBrand?: InvoiceBrand | null;
  workspaceBrandUseAccent?: boolean;
  logoUrl?: string | null;
  logoDarkUrl?: string | null;
  logoInvertInDarkMode?: boolean;
};

export function workspaceInitial(name?: string | null): string {
  return Array.from(name?.trim() || "Workspace")[0].toLocaleUpperCase();
}

/** Supplied portable variants are immutable artwork. Older snapshots have no
 * variants; their interface reverse treatment must include stroked geometry. */
export function workspaceLogoSvg(brand: InvoiceBrand, variant: "primary" | "reverse"): string {
  if (variant === "primary") return brand.logoSvg;
  if (brand.consumerProfileSchema === "brandkit/consumer-profile/1" && brand.logoVariants) return brand.logoVariants.reverse;
  return brand.logoSvg.replace(/\b(fill|stroke)="#[0-9a-f]{6}"/gi, '$1="#FFFFFF"');
}

type RGB = [number, number, number];
function rgb(value: string): RGB {
  if (/^#[\da-f]{6}$/i.test(value)) return [1, 3, 5].map(index => parseInt(value.slice(index, index + 2), 16)) as RGB;
  if (/^#[\da-f]{3}$/i.test(value)) return [1, 2, 3].map(index => parseInt(value[index].repeat(2), 16)) as RGB;
  const channels = value.match(/^rgba?\(\s*(\d+(?:\.\d+)?)[,\s]+(\d+(?:\.\d+)?)[,\s]+(\d+(?:\.\d+)?)/i);
  if (channels) return channels.slice(1, 4).map(channel => Math.max(0, Math.min(255, Number(channel)))) as RGB;
  throw new Error("Expected a resolved interface color.");
}

function mix(from: string, to: string, amount: number): string {
  const a = rgb(from), b = rgb(to);
  return `#${a.map((channel, index) => Math.round(channel + (b[index] - channel) * amount).toString(16).padStart(2, "0")).join("")}`;
}

export function workspaceColorContrast(a: string, b: string): number {
  const luminance = (color: string) => rgb(color).map(channel => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
  const l1 = luminance(a), l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/** Keep brand hue, but make controls and links readable on the actual theme. */
export function workspaceAccentPalette(primary: string, dark: boolean, surfaces?: string[]) {
  const fallback = dark ? ["#111113", "#212225"] : ["#ffffff", "#f0f0f3"];
  const backgrounds = (surfaces?.length ? surfaces : fallback).map((color, index) => {
    try { rgb(color); return color; } catch { return fallback[index % fallback.length]; }
  });
  const source = /^#[\da-f]{6}$/i.test(primary) ? primary : "#0B2B4A";
  const target = dark ? "#ffffff" : "#000000";
  let accent = source;
  for (let step = 0; step <= 100; step++) {
    accent = mix(source, target, step / 100);
    const washes = [mix(backgrounds[0], accent, 0.08), mix(backgrounds[0], accent, 0.14)];
    if ([...backgrounds, ...washes].every(surface => workspaceColorContrast(accent, surface) >= 4.5)) break;
  }
  const on = workspaceColorContrast(accent, "#ffffff") >= workspaceColorContrast(accent, "#000000") ? "#ffffff" : "#000000";
  const soft = mix(backgrounds[0], accent, 0.08);
  const strong = mix(backgrounds[0], accent, 0.14);
  let text = accent;
  for (let step = 0; step <= 100; step++) {
    text = mix(accent, target, step / 100);
    if ([...backgrounds, soft, strong].every(surface => workspaceColorContrast(text, surface) >= 4.5)) break;
  }
  return { accent, on, text, soft, strong, hover: mix(accent, target, 0.12) };
}
