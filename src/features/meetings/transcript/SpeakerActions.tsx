import { MoreHorizontal } from "lucide-react";
import { Menu } from "../../../components/Menu";
import { speakerName } from "../../../../shared/transcriptModel";
import type { TranscriptSpeaker } from "./timedTranscript";
import type { AssignSpeaker } from "./SpeakerPanel";

export function SpeakerActions({
  label,
  speakers,
  first,
  sample,
  canMerge,
  canWrite,
  hasMedia,
  onAssign,
  onJump,
  onPlaySample,
  onOpenMerge,
}: {
  label: string;
  speakers: readonly TranscriptSpeaker[];
  first: number;
  sample: number;
  canMerge: boolean;
  canWrite: boolean;
  hasMedia: boolean;
  onAssign: AssignSpeaker;
  onJump: (index: number) => void;
  onPlaySample: (index: number) => void;
  onOpenMerge: (label: string) => void;
}) {
  const name = speakerName(label, speakers);
  const assigned = name !== label;
  return (
    <Menu
      align="right"
      label={`Actions for ${name}`}
      minWidth={200}
      trigger={
        <button type="button" className="btn-action transcript-icon" aria-label={`Actions for ${name}`}>
          <MoreHorizontal size={16} />
        </button>
      }
      sections={[
        {
          id: "speaker",
          items: [
            {
              id: "sample",
              label: "Play sample",
              disabled: !hasMedia,
              onSelect: () => onPlaySample(sample),
            },
            { id: "jump", label: "Jump to first", onSelect: () => onJump(first) },
            ...(canWrite
              ? [
                  {
                    id: "merge",
                    label: "Combine speakers…",
                    disabled: !canMerge,
                    onSelect: () => {
                      onOpenMerge(label);
                    },
                  },
                  {
                    id: "clear",
                    label: "Clear name",
                    disabled: !assigned,
                    onSelect: () => {
                      void onAssign(label).catch(() => undefined);
                    },
                  },
                ]
              : []),
          ],
        },
      ]}
    />
  );
}
