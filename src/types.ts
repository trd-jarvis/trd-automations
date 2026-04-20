export type WorkerCategory = "ai-monitor" | "entity-audit" | "review-monitor" | "lead-scrape";
export type SourceType = "sample-file" | "json-file" | "apify-actor";
export type RunStatus = "RUNNING" | "SUCCESS" | "FAILED";
export type SignalSentiment = "POSITIVE" | "NEUTRAL" | "NEGATIVE";
export type ActionBucket = "REPORT" | "OPTIMIZE" | "WATCH";
export type ApprovalStatus = "PENDING" | "APPROVED" | "DENIED";
export type DispatchStatus = "AWAITING_APPROVAL" | "READY" | "PREVIEWED" | "DISPATCHED" | "BLOCKED";
export type DispatchChannel = "email" | "sms" | "voice";
export type ShareJobStatus = "QUEUED" | "UPLOADED" | "FAILED";
export type AnnouncementAudience = "internal" | "client";
export type AnnouncementStatus = "QUEUED" | "SENT";
export type LeadPipelineStatus =
  | "STAGED"
  | "SCORED"
  | "APPROVAL_PENDING"
  | "READY"
  | "DISPATCHED"
  | "GHL_SYNCED"
  | "ANALYZED"
  | "EMAIL_READY"
  | "VOICE_READY"
  | "CALL_QUEUED"
  | "SMS_READY"
  | "SMS_SENT";
export type LeadSource = "generated";
export type NegativeAnalysisStatus = "PENDING" | "READY" | "FAILED";
export type VoiceDispatchStatus = "PENDING" | "READY" | "QUEUED" | "FAILED";
export type SmsDispatchStatus = "PENDING" | "READY" | "SENT" | "FAILED";

export interface ClientAccount {
  id: string;
  name: string;
  brandTerms: string[];
  domains: string[];
  startUrls?: string[];
  competitors?: string[];
  reportRecipients?: string[];
  reportCc?: string[];
  internalRecipients?: string[];
  workerKeys: string[];
  seedQueries: string[];
  targetAreas?: string[];
  icp?: string;
  primaryOffer?: string;
  leadSearchCategories?: string[];
  leadSearchLocations?: string[];
  leadSearchQueries?: string[];
  blitzClientId?: string;
  blitzClientName?: string;
  blitzUrl?: string;
  websiteUrl?: string;
  gbpUrl?: string;
  primaryContactName?: string;
  primaryContactEmail?: string;
  contactCc?: string[];
  announceRecipients?: string[];
  announceCc?: string[];
  automationCadence?: AutomationCadence;
  leadBatchPolicy?: LeadBatchPolicy;
}

export interface ClientContactRecord {
  clientId?: string;
  clientName: string;
  primaryContactName: string;
  primaryContactEmail: string;
  ccEmails?: string[];
  title?: string;
  notes?: string;
}

export interface WorkerFieldMap {
  title?: string;
  url?: string;
  snippet?: string;
  publishedAt?: string;
  rank?: string;
  rating?: string;
}

export interface LeadFieldMap {
  company?: string;
  website?: string;
  phone?: string;
  email?: string;
  city?: string;
  state?: string;
  rating?: string;
  reviewCount?: string;
  weaknessHints?: string;
}

export interface SignalRuleSet {
  requiredKeywords: string[];
  boostKeywords: string[];
  blockedKeywords: string[];
  minimumScore: number;
}

export interface WorkerSource {
  type: SourceType;
  path?: string;
  actorId?: string;
  inputTemplate?: Record<string, unknown>;
}

export interface WorkerDefinition {
  key: string;
  label: string;
  category: WorkerCategory;
  source: WorkerSource;
  datasetFields: WorkerFieldMap;
  leadFields?: LeadFieldMap;
  positiveRules: SignalRuleSet;
  negativeRules: SignalRuleSet;
}

export interface ActorRunMetadata {
  actorId: string;
  actorRunId: string;
  defaultDatasetId?: string;
  usageTotalUsd?: number | null;
  tokenLabel?: string;
  searchQueries?: string[];
}

export interface AnnouncementTemplate {
  key: string;
  audience: AnnouncementAudience;
  title: string;
  summary: string;
  recipient: string;
  cc: string[];
  ctas: Array<{ label: string; url: string }>;
  metrics: Array<{ label: string; value: string; tone?: "accent" | "neutral" | "success" | "warning" }>;
  chart?: {
    label: string;
    bars: Array<{ label: string; value: number; tone?: "amber" | "sage" | "slate" }>;
  };
  sections: Array<{ heading: string; body: string }>;
  artifactPath?: string;
  metadata?: Record<string, unknown>;
}

export interface AutomationCadence {
  positiveReport?: string;
  readinessAudit?: string;
  postQueue?: string;
  leadGeneration?: string;
  joseQueue?: string;
}

export interface LeadBatchPolicy {
  batchSize: number;
  targetStates: string[];
  businessModel: "service" | "mixed";
  marketTier: "high-ticket" | "mixed";
}

export interface RawFinding {
  title: string;
  url: string;
  snippet: string;
  sourceLabel: string;
  publishedAt?: string | null;
  rank?: number | null;
  rating?: number | null;
  raw: Record<string, unknown>;
}

export interface SignalFinding extends RawFinding {
  score: number;
  sentiment: SignalSentiment;
  reasons: string[];
  actionBucket: ActionBucket;
}

export interface LeadRecord {
  id: string;
  clientId: string;
  workerKey: string;
  leadSource: LeadSource;
  company: string;
  website?: string;
  phone?: string;
  email?: string;
  city?: string;
  state?: string;
  rating?: number | null;
  reviewCount?: number | null;
  weaknessSignals: string[];
  weaknessScore: number;
  qualificationScore: number;
  recommendedChannel: DispatchChannel;
  status: LeadPipelineStatus;
  ghlContactId?: string;
  ghlTags?: string[];
  ghlSyncedAt?: string | null;
  ghlLastError?: string | null;
  negativeAnalysisStatus?: NegativeAnalysisStatus;
  negativeAnalysis?: {
    summary: string;
    issues: string[];
    emailAngle: string;
    voiceBrief: string;
    smsAngle: string;
    severityScore: number;
  } | null;
  negativeAnalysisGeneratedAt?: string | null;
  emailSubject?: string;
  emailBody?: string;
  emailHtmlPath?: string | null;
  emailPayloadPath?: string | null;
  emailPreparedAt?: string | null;
  emailSentAt?: string | null;
  emailMessageId?: string | null;
  voiceBatchId?: string | null;
  voiceSlotIndex?: number | null;
  voicePhoneNumberId?: string | null;
  voiceAssistantId?: string | null;
  voiceCallId?: string | null;
  voiceStatus?: VoiceDispatchStatus;
  voicePreparedAt?: string | null;
  voiceCalledAt?: string | null;
  smsBody?: string;
  smsStatus?: SmsDispatchStatus;
  smsSid?: string | null;
  smsSentAt?: string | null;
  raw: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ApprovalItem {
  id: string;
  leadId: string;
  clientId: string;
  channel: DispatchChannel;
  summary: string;
  status: ApprovalStatus;
  createdAt: string;
  approvedAt?: string | null;
  approvedBy?: string | null;
}

export interface DispatchPlan {
  id: string;
  leadId: string;
  clientId: string;
  channel: DispatchChannel;
  subject?: string;
  body: string;
  nextAction: string;
  status: DispatchStatus;
  approvalId?: string | null;
  previewPath?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChannelTarget {
  key: string;
  type: "slack" | "gmail" | "drive" | "calendar";
  label: string;
  destination: string;
  placeholder: boolean;
  description?: string;
}

export interface IntegrationStatus {
  key: string;
  label: string;
  status: "ready" | "missing" | "degraded";
  requiredEnv: string[];
  message: string;
  usesPlugin: boolean;
}

export interface RunSummary {
  runId: string;
  clientId: string;
  workerKey: string;
  status: RunStatus;
  sourceType: SourceType;
  itemCount: number;
  positiveCount: number;
  negativeCount: number;
  snapshotPath?: string;
  errorMessage?: string;
}

export interface QueuedReportPayload {
  reportId: string;
  clientId: string;
  recipient: string;
  cc: string[];
  subject: string;
  htmlPath: string;
  body: string;
  signalIds: string[];
}

export interface ReportQueueResult {
  kind: "queued" | "suppressed";
  clientId: string;
  recipient?: string;
  cc?: string[];
  reportId?: string;
  htmlPath?: string;
  findingCount: number;
  reason?: string;
  announcementId?: string;
}

export interface QueuedAnnouncementPayload {
  announcementId: string;
  clientId?: string | null;
  audience: AnnouncementAudience;
  type: string;
  recipient: string;
  cc: string[];
  subject: string;
  htmlPath: string;
  body: string;
}

export interface ShareJob {
  id: string;
  artifactPath: string;
  recipients: string[];
  reason: string;
  createdAt: string;
  status: ShareJobStatus;
  remoteId?: string | null;
  completedAt?: string | null;
  errorMessage?: string | null;
}

export interface DriveShareTarget {
  folderId?: string;
  recipients: string[];
  notify: boolean;
}

export interface BlitzReadinessRow {
  clientId: string;
  clientName: string;
  organizationId: string;
  websiteUrl?: string | null;
  locationCount: number;
  activeGbpConnections: number;
  approvedAssetCount: number;
  sitemapUrl?: string | null;
  defaultPostUrl?: string | null;
  pendingActionCount: number;
  pendingActionTypes: string[];
  postReady: boolean;
}
