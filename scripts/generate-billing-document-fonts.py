"""Rebuild the action-only, licensed font bundle without depending on runtime disk paths."""
from pathlib import Path
import base64
root = Path(__file__).resolve().parent.parent
files = {
 "inter": "src/assets/invoice-branding/Inter-Regular.ttf", "interBold": "src/assets/invoice-branding/Inter-SemiBold.ttf", "display": "src/assets/invoice-branding/InterDisplay-Medium.ttf", "mono": "src/assets/invoice-branding/SpaceMono-Regular.ttf", "serif": "src/assets/pdf-fonts/NotoSerif-Regular.ttf", "serifBold": "src/assets/pdf-fonts/NotoSerif-Bold.ttf", "openSans": "src/assets/invoice-branding/OpenSans-Regular.ttf", "openSansBold": "src/assets/invoice-branding/OpenSans-Bold.ttf", "liberation": "src/assets/invoice-branding/LiberationSerif-Regular.ttf", "liberationBold": "src/assets/invoice-branding/LiberationSerif-Bold.ttf",
}
lines = ['\"use node\";', '/** ACTION-ONLY generated font data. Rebuild: python3 scripts/generate-billing-document-fonts.py', ' * Sources: src/assets/invoice-branding and src/assets/pdf-fonts.', ' * Inter, Space Mono, Noto Serif and Liberation Serif are distributed', ' * under SIL OFL 1.1; Open Sans is under Apache 2.0. Copyright/license notices are', ' * retained beside the source assets (OFL*.txt / *LICENSE*). Do not import into browser bundles.', ' */', 'import type { FontRegistration } from "@formepdf/react";', 'import type { InvoiceTemplate } from "../../shared/invoiceCommerce";']
for license in ["src/assets/invoice-branding/Inter-OFL.txt", "src/assets/invoice-branding/SpaceMono-OFL.txt", "src/assets/invoice-branding/OpenSans-license.txt", "src/assets/invoice-branding/Liberation-license.txt", "src/assets/pdf-fonts/LICENSE.txt"]:
 lines.append("/* Original notice: " + license + "\n" + (root / license).read_text().replace("*/", "* /") + "\n*/")
for name, file in files.items():
 lines.append(f'const {name} = "{base64.b64encode((root / file).read_bytes()).decode()}";')
lines.extend(['const bytes = (base64: string) => new Uint8Array(Buffer.from(base64, "base64"));', 'export function billingDocumentFonts(config?: InvoiceTemplate): FontRegistration[] {', ' const brandSerif = !config?.brand || config.brand.font === "serif";', ' return ['])
for family, regular, bold in [("Invoice", "brandSerif ? serif : inter", "brandSerif ? serifBold : interBold"), ("InvoiceSans", "inter", "interBold"), ("InvoiceSerif", "serif", "serifBold"), ("InvoiceMono", "mono", "mono"), ("InvoiceOpenSans", "openSans", "openSansBold"), ("InvoiceLiberationSerif", "liberation", "liberationBold")]:
 lines.append(f'  {{ family: "{family}", src: bytes({regular}) }}, {{ family: "{family}", src: bytes({bold}), fontWeight: "bold" }},')
lines.extend(['  { family: "InvoiceDisplay", src: bytes(display) }, { family: "InvoiceLabel", src: bytes(mono) },', ' ];', '}'])
(root / "convex/lib/billingDocumentFonts.ts").write_text("\n".join(lines) + "\n")
