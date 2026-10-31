import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { DatePicker } from "../../../src/components/DatePicker";
import { ConfirmProvider, Modal } from "../../../src/components/Modal";
import { useDirtyCloseGuard } from "../../../src/features/meetings/lib/useDirtyCloseGuard";
import "../../../src/theme/palette.css";
import "../../../src/theme/tokens.css";
import "../../../src/styles/index.scss";
function Controls() {
  const [bounded, setBounded] = useState("");
  const [date, setDate] = useState("2026-10-31");
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const close = useDirtyCloseGuard(Boolean(text), () => { setOpen(false); setText(""); }, "fixture edits");
  return <main style={{ padding: 16 }}><h1>Real interaction controls</h1>
    <label htmlFor="bounded">Bounded date</label><DatePicker id="bounded" value={bounded} min="2026-10-31" max="2026-10-31" onChange={setBounded} /><output data-testid="bounded-value">{bounded}</output>
    <label htmlFor="year">Year navigation</label><DatePicker id="year" value={date} onChange={setDate} /><output data-testid="year-value">{date}</output>
    <button onClick={() => setOpen(true)}>Open guarded form</button>
    <Modal open={open} title="Guarded form" onClose={() => { void close(); }} footer={<button onClick={() => { void close(); }}>Cancel form</button>}>
      <label>Draft text<input value={text} onChange={event => setText(event.target.value)} /></label>
    </Modal>
  </main>;
}
createRoot(document.getElementById("root")!).render(<ConfirmProvider><Controls /></ConfirmProvider>);
