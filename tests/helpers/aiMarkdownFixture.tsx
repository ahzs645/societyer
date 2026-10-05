import { createRoot } from "react-dom/client";
import { MarkdownView } from "../../src/features/ai/GlobalAiAssistant";

/** Exercise the production markdown renderer with synthetic provider output. */
export function mountAiMarkdownFixture(text: string) {
  const container = document.createElement("section");
  container.dataset.testid = "ai-markdown-fixture";
  document.body.appendChild(container);
  const root = createRoot(container);
  root.render(<MarkdownView text={text} />);
}
