import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import YAML from "yaml";

export const ROOT_DIR = process.cwd();
export const DATA_DIR = path.join(ROOT_DIR, "data");
export const RAW_DIR = path.join(DATA_DIR, "raw");
export const REPORT_DIR = path.join(DATA_DIR, "reports");
export const ANNOUNCEMENT_DIR = path.join(DATA_DIR, "announcements");
export const EXPORT_DIR = path.join(DATA_DIR, "exports");
export const LOG_EXPORT_DIR = path.join(ROOT_DIR, "logs", "exports");
export const TEMPLATE_DIR = path.join(ROOT_DIR, "templates");
export const DESKTOP_LEADS_DIR = "/Users/jarvis/Desktop/Leads";

const REQUIRED_DIRS = [DATA_DIR, RAW_DIR, REPORT_DIR, ANNOUNCEMENT_DIR, EXPORT_DIR, LOG_EXPORT_DIR, DESKTOP_LEADS_DIR];

export function ensureRuntimeDirs(): void {
  for (const dir of REQUIRED_DIRS) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
}

export function validateWorkflowTemplates(): string[] {
  const files = readdirSync(TEMPLATE_DIR)
    .filter((entry) => entry.endsWith(".yaml"))
    .sort();
  const validated: string[] = [];
  for (const file of files) {
    const fullPath = path.join(TEMPLATE_DIR, file);
    const raw = readFileSync(fullPath, "utf8");
    YAML.parse(raw);
    validated.push(file);
  }
  return validated;
}

export function writeJson(filePath: string, value: unknown): void {
  ensureRuntimeDirs();
  writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function csvCell(value: unknown): string {
  const text = value === undefined || value === null ? "" : String(value);
  if (!text.includes(",") && !text.includes('"') && !text.includes("\n") && !text.includes("\r")) {
    return text;
  }
  return `"${text.replace(/"/g, '""')}"`;
}

export function writeCsv(filePath: string, headers: string[], rows: Array<Record<string, unknown>>): void {
  ensureRuntimeDirs();
  const lines = [headers.map((header) => csvCell(header)).join(",")];
  for (const row of rows) {
    lines.push(headers.map((header) => csvCell(row[header])).join(","));
  }
  writeFileSync(filePath, lines.join("\n"), "utf8");
}
