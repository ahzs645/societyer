// One-shot local setup for the Over the Edge keycard access workflow.
// It creates/reuses the OTE Facilities workflow with n8n as the execution
// provider. By default it runs once, which requires the n8n workflow to be
// imported and active; pass --workflow-only to only configure Societyer.
//
// Run: npm run setup:ote-keycard
//      npm run setup:ote-keycard -- --workflow-only
//      npm run setup:ote-keycard -- --dry-run

import path from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { config } from "dotenv";

config({ path: path.join(process.cwd(), ".env.local"), quiet: true });

const api = anyApi;
const SOCIETY_NAME = "Over the Edge Newspaper Society";
const WORKFLOW_NAME = "OTE individual access request";
const RECIPE = "ote_keycard_access_request";
const DRY_RUN = process.argv.includes("--dry-run");
const QUEUE_DRAFT = !process.argv.includes("--workflow-only") && !process.argv.includes("--no-run");

const url =
  process.env.VITE_CONVEX_URL ??
  process.env.CONVEX_SELF_HOSTED_URL ??
  process.env.CONVEX_URL;

if (!url) throw new Error("Missing VITE_CONVEX_URL / CONVEX_SELF_HOSTED_URL / CONVEX_URL.");

const client = new ConvexHttpClient(url);

const societies = await client.query(api.society.list, {});
const society = societies.find((row) => row.name === SOCIETY_NAME);
if (!society) throw new Error(`Society not found: ${SOCIETY_NAME}`);

const users = await client.query(api.users.list, { societyId: society._id });
const actor = users.find((user) => ["Owner", "Admin", "Director"].includes(user.role));
if (!actor) throw new Error(`No Director/Admin/Owner user found for ${SOCIETY_NAME}.`);

const catalog = await client.query(api.workflows.listCatalog, {});
const recipe = catalog.find((entry) => entry.key === RECIPE);
if (!recipe) throw new Error(`Workflow recipe is not deployed locally yet: ${RECIPE}`);

const person = await pickAccessPerson(society._id);
const request = buildRequest(person);
const expectedBody = expectedBodyFor(request);

const workflows = await client.query(api.workflows.list, { societyId: society._id });
let workflow = workflows.find((row) => row.recipe === RECIPE) ??
  workflows.find((row) => row.name === WORKFLOW_NAME || row.name === "OTE keycard access request");

console.log(`${DRY_RUN ? "Dry run: " : ""}${society.name} (${society._id})`);
console.log(`Access request person: ${request.access_person_name}${request.access_person_context}`);

if (!workflow) {
  if (DRY_RUN) {
    console.log(`Would create workflow: ${WORKFLOW_NAME}`);
  } else {
    const workflowId = await client.mutation(api.workflows.create, {
      societyId: society._id,
      recipe: RECIPE,
      name: WORKFLOW_NAME,
      status: "active",
      provider: "n8n",
      providerConfig: providerConfigForOte(),
      trigger: { kind: "manual" },
      actingUserId: actor._id,
    });
    workflow = await client.query(api.workflows.get, { id: workflowId });
    console.log(`Created workflow: ${WORKFLOW_NAME} (${workflowId})`);
  }
} else {
  console.log(`Using existing workflow: ${workflow.name} (${workflow._id})`);
  if (DRY_RUN) {
    console.log(`Would update workflow form/config to the generic individual access intake.`);
  } else {
    await client.mutation(api.workflows.configure, {
      id: workflow._id,
      patch: {
        name: WORKFLOW_NAME,
        status: "active",
        provider: "n8n",
        providerConfig: providerConfigForOte(),
        trigger: { kind: "manual" },
        nodePreview: sanitizeNodePreview(recipe.nodePreview),
        config: recipe.config,
      },
      actingUserId: actor._id,
    });
    workflow = await client.query(api.workflows.get, { id: workflow._id });
    console.log(`Updated workflow form/config: ${workflow.name}`);
  }
  if (workflow.status !== "active") {
    if (DRY_RUN) {
      console.log(`Would activate workflow: ${workflow.name}`);
    } else {
      await client.mutation(api.workflows.setStatus, {
        id: workflow._id,
        status: "active",
        actingUserId: actor._id,
      });
      workflow = await client.query(api.workflows.get, { id: workflow._id });
      console.log(`Activated workflow: ${workflow.name}`);
    }
  }
}

if (!QUEUE_DRAFT) {
  console.log("Workflow setup complete. Skipped draft queue (--workflow-only).");
  process.exit(0);
}

if (!workflow) {
  console.log("Would queue Facilities draft after creating the workflow.");
  process.exit(0);
}

const pendingEmails = await client.query(api.pendingEmails.list, { societyId: society._id });
const staleDrafts = pendingEmails.filter((row) =>
  row.workflowId === workflow._id &&
  row.status !== "sent" &&
  row.status !== "cancelled" &&
  /remove access/i.test(row.body ?? "")
);
if (staleDrafts.length > 0) {
  if (DRY_RUN) {
    console.log(`Would cancel ${staleDrafts.length} stale board add/remove draft(s).`);
  } else {
    for (const draft of staleDrafts) {
      await client.mutation(api.pendingEmails.cancel, {
        id: draft._id,
        reason: "Superseded by generic individual access workflow setup.",
        actingUserId: actor._id,
      });
      console.log(`Cancelled stale board add/remove draft: ${draft._id}`);
    }
  }
}

const existingDraft = pendingEmails.find((row) =>
  row.to === request.facilities_email &&
  row.subject === request.request_subject &&
  row.body === expectedBody &&
  row.status !== "sent" &&
  row.status !== "cancelled"
);

if (existingDraft) {
  console.log(`Facilities draft already queued: ${existingDraft._id}`);
  process.exit(0);
}

if (DRY_RUN) {
  console.log(`Would run ${workflow.name} and queue a Facilities draft to ${request.facilities_email}.`);
  process.exit(0);
}

const result = await client.action(api.workflows.run, {
  societyId: society._id,
  workflowId: workflow._id,
  triggeredBy: "manual",
  actingUserId: actor._id,
  input: { intake: request },
});

console.log(`Ran workflow: ${result.runId} (${result.status})`);

const refreshed = await client.query(api.pendingEmails.list, { societyId: society._id });
const draft = refreshed.find((row) =>
  row.workflowRunId === result.runId &&
  row.to === request.facilities_email &&
  row.subject === request.request_subject
);

if (draft) {
  console.log(`Queued Facilities draft: ${draft._id}`);
} else {
  console.log("Workflow finished, but no matching Facilities draft was found.");
}

async function pickAccessPerson(societyId) {
  const [directors, volunteers, employees] = await Promise.all([
    client.query(api.directors.list, { societyId }),
    client.query(api.volunteers.list, { societyId }),
    client.query(api.employees.list, { societyId }),
  ]);
  const candidates = [
    ...directors.map((row) => ({ category: "directors", row })),
    ...volunteers.map((row) => ({ category: "volunteers", row })),
    ...employees.map((row) => ({ category: "employees", row })),
  ];
  const preferred = candidates.find(({ row }) => displayName(row).toLowerCase() === "nazanin parvizi");
  return preferred ?? candidates.find(({ category, row }) => category === "directors" && row.status === "Active") ??
    candidates[0] ?? {
      category: "directors",
      row: { _id: "", firstName: "Nazanin", lastName: "Parvizi", email: "", position: "Director" },
    };
}

function buildRequest(person) {
  const name = displayName(person.row);
  const role = roleForPerson(person.category, person.row);
  return {
    access_person: {
      category: person.category,
      recordId: person.row._id ? String(person.row._id) : "",
      name,
      email: person.row.email ?? "",
      role,
    },
    access_person_name: name,
    access_person_email: person.row.email ?? "",
    access_person_context: role ? ` (${role})` : "",
    access_scope: "keycard access",
    access_notes: "",
    sender_name: "Ahmad Jalil",
    sender_title: "Editor in Chief",
    from_name: "Over the Edge",
    from_email: "ote@unbc.ca",
    facilities_email: "facilities@unbc.ca",
    request_subject: "Keycard access",
    source_sent_at_iso: "2026-04-10T14:34:00-07:00",
    source_sent_at_display: "Friday, April 10, 2026 2:34 PM",
  };
}

function expectedBodyFor(request) {
  return [
    "Hello There,",
    "",
    `Can you provide keycard access for ${request.access_person_name}${request.access_person_context}?`,
    "",
    "Thanks,",
    request.sender_name,
    request.sender_title,
  ].join("\n");
}

function displayName(row) {
  return `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim() || row.name || row.email || "Unnamed";
}

function roleForPerson(category, row) {
  if (category === "directors") return row.position || "Director";
  if (category === "volunteers") return row.roleWanted || row.status || "Volunteer";
  if (category === "employees") return row.role || row.employmentType || "Employee";
  return "";
}

function sanitizeNodePreview(nodes) {
  return (nodes ?? []).map((node) => ({
    key: node.key,
    type: node.type,
    label: node.label,
    ...(node.description ? { description: node.description } : {}),
    ...(node.status ? { status: node.status } : {}),
    ...(node.config ? { config: node.config } : {}),
  }));
}

function providerConfigForOte() {
  const base = process.env.N8N_WEBHOOK_BASE_URL ?? "http://127.0.0.1:5678/webhook";
  const webhookPath =
    process.env.N8N_OTE_KEYCARD_WEBHOOK_PATH ??
    "societyer-ote-individual-access-request/societyer%2520webhook/societyer/ote-individual-access-request";
  const externalEditUrl = process.env.N8N_BASE_URL
    ? `${process.env.N8N_BASE_URL.replace(/\/$/, "")}/workflow`
    : "http://127.0.0.1:5678/workflow";
  return {
    externalWorkflowId: "societyer-ote-individual-access-request",
    externalWebhookUrl: `${base.replace(/\/$/, "")}/${webhookPath}`,
    externalEditUrl,
  };
}
