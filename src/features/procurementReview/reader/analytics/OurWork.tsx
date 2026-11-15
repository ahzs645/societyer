/**
 * The award analysis's "Our work" controls: a toggle between the work this
 * organisation bids on and the whole market, and a small editor for the
 * keywords that define it (ourWorkStore.ts). The choice of view is in the URL
 * (`market=all` for the whole market), so it survives Back and a shared link
 * shows the whole market to someone who has set nothing.
 */
import { useState } from "react";
import { Modal } from "../../../../components/Modal";
import { Segmented } from "../../../../components/primitives";
import { Field } from "../../../../components/ui";
import { describeOurWork, parseTerms, type OurWork } from "./ourWorkStore";

export { MARKET_PARAM } from "./analysisParam";
export type MarketScope = "ours" | "all";

/** The toggle and what "our work" means, under the analysis header. Shown once a set is saved. */
export function OurWorkBar({ work, scope, onScope, onEdit }: {
  work: OurWork;
  scope: MarketScope;
  onScope: (next: MarketScope) => void;
  onEdit: () => void;
}) {
  return (
    <div className="procurement-analytics__scope">
      <div role="group" aria-label="Awards in this analysis">
        <Segmented<MarketScope>
          value={scope}
          onChange={onScope}
          items={[
            { id: "ours", label: "Our work" },
            { id: "all", label: "Whole market" },
          ]}
        />
      </div>
      <p className="muted">
        {scope === "ours" ? `Awards mentioning ${describeOurWork(work)}.` : "Every award, whatever the work."}
      </p>
      <button type="button" className="btn btn--ghost btn--sm" onClick={onEdit}>
        Edit our work
      </button>
    </div>
  );
}

/** The editor: keywords, optional places, and where they are kept. */
export function OurWorkDialog({ work, save, close }: {
  work: OurWork | null;
  save: (next: OurWork | null) => void;
  close: () => void;
}) {
  const [keywords, setKeywords] = useState(work?.keywords.join(", ") ?? "");
  const [regions, setRegions] = useState(work?.regions.join(", ") ?? "");
  const next: OurWork = { keywords: parseTerms(keywords), regions: parseTerms(regions) };
  const empty = !next.keywords.length && !next.regions.length;
  return (
    <Modal
      open
      onClose={close}
      size="sm"
      title="Our work"
      footer={
        <>
          {work && (
            <button type="button" className="btn btn--ghost procurement-analytics__reset" onClick={() => { save(null); close(); }}>
              Clear
            </button>
          )}
          <button type="button" className="btn" onClick={close}>
            Cancel
          </button>
          <button type="button" className="btn btn--accent" disabled={empty} onClick={() => { save(next); close(); }}>
            Save
          </button>
        </>
      }
    >
      <p className="muted procurement-analytics__caption">
        The kinds of work you bid on, so the award analysis can show that part of the market first. Saved in this browser
        for you in this workspace; other people and devices don't see it.
      </p>
      <Field label="Keywords" hint="Separated by commas. An award counts when its title or procurement type mentions any of them.">
        <textarea
          className="textarea procurement-analytics__keywords"
          rows={3}
          value={keywords}
          onChange={(event) => setKeywords(event.target.value)}
          placeholder="facilitation, engagement, evaluation"
        />
      </Field>
      <Field label="Places (optional)" hint="With places, an award also has to name one in its title or source region.">
        <input
          className="input"
          value={regions}
          onChange={(event) => setRegions(event.target.value)}
          placeholder="Vancouver, Fraser"
        />
      </Field>
    </Modal>
  );
}
