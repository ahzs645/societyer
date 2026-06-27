// WorkflowDetail: person dropdown picker for intake form fields.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { useCurrentUserId } from "../hooks/useCurrentUser";
import { useToast } from "../components/Toast";
import { Badge, Drawer, Field } from "../components/ui";
import { MarkdownEditor } from "../components/MarkdownEditor";
import { Modal } from "../components/Modal";
import { Select } from "../components/Select";
import { SeedPrompt } from "./_helpers";
import {
  ArrowLeft,
  Bot,
  ClipboardList,
  ExternalLink,
  FileText,
  FormInput,
  History,
  Mail,
  Pause,
  Play,
  Plus,
  Power,
  Save,
  Settings,
  Trash2,
  UserPlus,
} from "lucide-react";
import { formatDateTime } from "../lib/format";
import {
  IntakeField,
} from "./WorkflowDetail.internal.intakeFields";


export function AccessPersonPicker({
  societyId,
  field,
  value,
  onChange,
}: {
  societyId: string;
  field: IntakeField;
  value: any;
  onChange: (value: any) => void;
}) {
  const categoryOptions = (field.categories?.length
    ? field.categories
    : ["directors", "volunteers", "employees"]
  ).filter((category) => ["directors", "volunteers", "employees"].includes(category));
  const selectedCategory = typeof value?.category === "string" ? value.category : categoryOptions[0];
  const societyArg = { societyId: societyId as any };
  const directors = useQuery(api.directors.list, selectedCategory === "directors" ? societyArg : "skip");
  const volunteers = useQuery(api.volunteers.list, selectedCategory === "volunteers" ? societyArg : "skip");
  const employees = useQuery(api.employees.list, selectedCategory === "employees" ? societyArg : "skip");
  const people =
    selectedCategory === "directors"
      ? directors ?? []
      : selectedCategory === "volunteers"
        ? volunteers ?? []
        : selectedCategory === "employees"
          ? employees ?? []
          : [];

  const labelForCategory = (category: string) =>
    category === "directors" ? "Directors" : category === "volunteers" ? "Volunteers" : "Employees";
  const displayName = (person: any) => {
    const full = `${person.firstName ?? ""} ${person.lastName ?? ""}`.trim();
    return full || person.name || person.email || "Unnamed";
  };
  const roleForPerson = (person: any) => {
    if (selectedCategory === "directors") return person.position || "Director";
    if (selectedCategory === "volunteers") return person.roleWanted || person.status || "Volunteer";
    if (selectedCategory === "employees") return person.role || person.employmentType || "Employee";
    return "";
  };
  const selectedId = typeof value?.recordId === "string" ? value.recordId : "";

  const updateCategory = (category: string) => {
    onChange({
      category,
      recordId: "",
      name: "",
      email: "",
      role: "",
    });
  };

  const updatePerson = (recordId: string) => {
    const person = people.find((row: any) => String(row._id) === recordId);
    if (!person) {
      onChange({
        category: selectedCategory,
        recordId: "",
        name: "",
        email: "",
        role: "",
      });
      return;
    }
    onChange({
      category: selectedCategory,
      recordId,
      name: displayName(person),
      email: person.email ?? "",
      role: roleForPerson(person),
    });
  };

  return (
    <div className="person-ref-picker">
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <Select
          value={selectedCategory}
          onChange={(next) => updateCategory(next)}
          options={categoryOptions.map((category) => ({
            value: category,
            label: labelForCategory(category),
          }))}
        />
        <Select
          value={selectedId}
          onChange={(next) => updatePerson(next)}
          options={[
            { value: "", label: "Pick individual" },
            ...people.map((person: any) => ({
              value: person._id,
              label: `${displayName(person)}${person.email ? ` · ${person.email}` : ""}`,
            })),
          ]}
        />
      </div>
      {selectedCategory && people.length === 0 && (
        <div className="muted" style={{ fontSize: "var(--fs-xs)" }}>
          No {labelForCategory(selectedCategory).toLowerCase()} are available yet.
        </div>
      )}
    </div>
  );
}
