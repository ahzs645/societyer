import { useEffect, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { minutesQuorumLabel, recordedMinutesQuorum } from "../../shared/minutesQuorum";
import { useSociety } from "../hooks/useSociety";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Badge, RecordChip } from "../components/ui";
import { formatDate } from "../lib/format";
import { FileText } from "lucide-react";
import { RecordTableMetadataEmpty } from "../components/RecordTableMetadataEmpty";
import {
  RecordTable,
  RecordTableScope,
  RecordTableViewToolbar,
  RecordTableFilterChips,
  RecordTableFilterPopover,
  useObjectRecordTableData,
} from "@/platform/record-engine";
import { useState } from "react";
import type { Id } from "../../convex/_generated/dataModel";

export function MinutesPage() {
  const society = useSociety();
  // Light summaries: counts include section-level action items (F19) and
  // no minutes text is loaded for the list (F26).
  const minutes = useQuery(api.minutes.listSummaries, society ? { societyId: society._id } : "skip") as any[] | undefined;
  const meetings = useQuery(api.meetings.list, society ? { societyId: society._id } : "skip");
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [currentViewId, setCurrentViewId] = useState<Id<"views"> | undefined>(undefined);
  const [filterOpen, setFilterOpen] = useState(false);

  const tableData = useObjectRecordTableData({
    societyId: society?._id,
    nameSingular: "minute",
    viewId: currentViewId,
  });
  const showMetadataWarning = !tableData.loading && !tableData.objectMetadata;

  const byId = useMemo(() => new Map<string, any>((meetings ?? []).map((m: any) => [m._id, m])), [meetings]);
  const records: any[] = useMemo(() => {
    return (minutes ?? []).map((m: any) => {
      const meeting = byId.get(m.meetingId);
      // A minutes stub is auto-created for every meeting, so minutes for a
      // meeting that hasn't been held yet aren't "Not met" / "Pending" — they
      // just haven't happened. Render those neutrally instead of as failures.
      const notHeldYet = meeting ? meeting.status === "Scheduled" : false;
      return {
        ...m,
        meetingDeleted: !meeting,
        meeting: meeting?.title ?? "Deleted meeting",
        meetingType: meeting?.type ?? "",
        notHeldYet,
        motionCount: m.motionCount ?? 0,
        pendingActions: m.openActionItemCount ?? 0,
        totalActions: m.actionItemCount ?? 0,
        quorum: notHeldYet ? "Not held yet" : minutesQuorumLabel(m),
        actions: (m.openActionItemCount ?? 0) > 0 ? "Open" : (m.actionItemCount ?? 0) > 0 ? "Done" : "None",
        approved: m.approvedAt ? formatDate(m.approvedAt) : notHeldYet ? "—" : "Pending",
      };
    });
  }, [minutes, byId]);

  useEffect(() => {
    if (!society || minutes === undefined || meetings === undefined) return;
    if (params.get("intent") !== "draft") return;
    const minuteMeetingIds = new Set((minutes ?? []).map((m: any) => String(m.meetingId)));
    const target = (meetings ?? []).find((meeting: any) => !minuteMeetingIds.has(String(meeting._id))) ?? meetings?.[0];
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("intent");
      return next;
    }, { replace: true });
    if (target) navigate(`/app/meetings/${target._id}?tab=minutes&intent=draft-minutes`);
  }, [meetings, minutes, navigate, params, setParams, society]);

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  return (
    <div className="page">
      <PageHeader
        title="Minutes"
        icon={<FileText size={16} />}
        iconColor="turquoise"
        subtitle="All meeting minutes on file. Minutes of general meetings (AGM/SGM) are accessible to members."
      />

      {showMetadataWarning ? (
        <RecordTableMetadataEmpty societyId={society?._id} objectLabel="minutes" />
      ) : tableData.objectMetadata ? (
        <RecordTableScope
          tableId="minutes"
          objectMetadata={tableData.objectMetadata}
          hydratedView={tableData.hydratedView}
          records={records}
        >
          <RecordTableViewToolbar
            societyId={society._id}
            objectMetadataId={tableData.objectMetadata._id as Id<"objectMetadata">}
            icon={<FileText size={14} />}
            label="All minutes"
            views={tableData.views}
            currentViewId={currentViewId ?? tableData.views[0]?._id ?? null}
            onChangeView={(viewId) => setCurrentViewId(viewId as Id<"views">)}
            onOpenFilter={() => setFilterOpen((x) => !x)}
          />
          <RecordTableFilterPopover open={filterOpen} onClose={() => setFilterOpen(false)} />
          <RecordTableFilterChips />
          <RecordTable
            loading={tableData.loading || minutes === undefined}
            renderCell={({ record, field }) => {
              if (field.name === "meeting") {
                if (record.meetingDeleted) {
                  return <span className="muted">Deleted meeting</span>;
                }
                return (
                  <>
                    <RecordChip
                      to={`/app/meetings/${record.meetingId}`}
                      onClick={(e) => e.stopPropagation()}
                      tone={record.meetingType === "AGM" ? "purple" : record.meetingType === "Committee" ? "turquoise" : "gray"}
                      avatar={(record.meetingType || "MT").slice(0, 2).toUpperCase()}
                      label={<strong>{record.meeting}</strong>}
                    />{" "}
                    {record.meetingType && <Badge tone={record.meetingType === "AGM" ? "accent" : "info"}>{record.meetingType}</Badge>}
                  </>
                );
              }
              if (field.name === "heldAt") return <span className="mono">{formatDate(record.heldAt)}</span>;
              if (field.name === "quorum") {
                if (record.notHeldYet) return <Badge tone="neutral">Not held yet</Badge>;
                const quorum = recordedMinutesQuorum(record);
                return <Badge tone={quorum === null ? "neutral" : quorum ? "success" : "danger"}>{minutesQuorumLabel(record)}</Badge>;
              }
              if (field.name === "actions") {
                if (record.pendingActions > 0) return <Badge tone="warn">{record.pendingActions} open of {record.totalActions}</Badge>;
                return record.totalActions > 0 ? <Badge tone="success">All {record.totalActions} done</Badge> : <span className="muted">None recorded</span>;
              }
              if (field.name === "approved") {
                if (record.approvedAt) return <Badge tone="success">{formatDate(record.approvedAt)}</Badge>;
                return record.notHeldYet ? <span className="muted">—</span> : <Badge tone="warn">Pending</Badge>;
              }
              return undefined;
            }}
          />
        </RecordTableScope>
      ) : null}
    </div>
  );
}
