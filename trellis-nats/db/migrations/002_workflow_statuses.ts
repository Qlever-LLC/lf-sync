export const workflowStatusesMigration = {
  name: "workflow_statuses",
  sql: `
ALTER TYPE workflow_status ADD VALUE IF NOT EXISTS 'review-required';
ALTER TYPE workflow_status ADD VALUE IF NOT EXISTS 'approval-revoked';
`,
} as const;
