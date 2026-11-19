export type WorkspaceRole = "owner" | "admin" | "member" | "viewer";
export type TaskStatus = "backlog" | "todo" | "in_progress" | "in_review" | "blocked" | "done";
export type TaskPriority = "low" | "medium" | "high" | "urgent";
export type TaskType = "epic" | "feature" | "task" | "bug" | "tech_debt";
export type CanvasNodeType = "task_card" | "sticky_note" | "frame" | "doc_block";
export type CanvasEdgeType = "blocks" | "parent_of" | "relates_to" | "derived_from";
export type ActorType = "human" | "internal_ai" | "external_agent";
export type AIProvider = "anthropic" | "openai" | "google";

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  created_by: string;
  created_at: string;
}

export interface WorkspaceMember {
  workspace_id: string;
  user_id: string;
  role: WorkspaceRole;
  created_at: string;
}

export interface Project {
  id: string;
  workspace_id: string;
  name: string;
  slug: string;
  key_prefix: string;
  task_counter: number;
  description: string | null;
  created_at: string;
}

export interface Canvas {
  id: string;
  project_id: string;
  name: string;
  is_default: boolean;
  viewport: { x: number; y: number; zoom: number };
  created_at: string;
  updated_at: string;
}

export interface Task {
  id: string;
  project_id: string;
  task_key: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  type: TaskType;
  sprint: string | null;
  estimate_points: number | null;
  assignee_id: string | null;
  parent_task_id: string | null;
  spec_json: SpecJson;
  spec_markdown: string;
  acceptance_criteria: AcceptanceCriterion[];
  agent_execution_log: AgentExecutionLogEntry[];
  last_updated_by_type: ActorType;
  last_updated_by_label: string | null;
  created_at: string;
  updated_at: string;
}

export interface SpecJson {
  type: "doc";
  content: SpecContent[];
}

export type SpecContent =
  | { type: "paragraph"; content?: SpecContent[]; text?: string; marks?: SpecMark[] }
  | { type: "heading"; attrs: { level: 1 | 2 | 3 }; content: SpecContent[] }
  | { type: "bulletList"; content: SpecContent[] }
  | { type: "orderedList"; content: SpecContent[] }
  | { type: "listItem"; content: SpecContent[] }
  | { type: "codeBlock"; attrs: { language?: string }; content: SpecContent[] }
  | { type: "taskList"; content: SpecContent[] }
  | { type: "taskItem"; attrs: { checked: boolean }; content: SpecContent[] }
  | { type: "blockquote"; content: SpecContent[] }
  | { type: "horizontalRule" }
  | { type: "hardBreak" };

export interface SpecMark {
  type: "bold" | "italic" | "strike" | "code" | "link";
  attrs?: { href?: string };
}

export interface AcceptanceCriterion {
  id: string;
  text: string;
  completed: boolean;
}

export interface AgentExecutionLogEntry {
  id: string;
  timestamp: string;
  actor: string;
  actor_type: ActorType;
  summary: string;
  files_changed?: string[];
  category?: "progress" | "architecture" | "blocker" | "test_result";
  commit_or_pr_url?: string;
}

export interface CanvasNode {
  id: string;
  canvas_id: string;
  node_type: CanvasNodeType;
  task_id: string | null;
  parent_frame_id: string | null;
  position_x: number;
  position_y: number;
  width: number | null;
  height: number | null;
  z_index: number;
  needs_auto_layout: boolean;
  data: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface CanvasEdge {
  id: string;
  canvas_id: string;
  source_node_id: string;
  target_node_id: string;
  edge_type: CanvasEdgeType;
  label: string | null;
  created_at: string;
}

export interface Comment {
  id: string;
  workspace_id: string;
  task_id: string | null;
  canvas_id: string | null;
  pin_x: number | null;
  pin_y: number | null;
  parent_comment_id: string | null;
  actor_type: ActorType;
  author_user_id: string | null;
  author_label: string;
  body_markdown: string;
  resolved: boolean;
  created_at: string;
}

export interface AIProviderKey {
  id: string;
  workspace_id: string;
  provider: AIProvider;
  default_model: string;
  encrypted_api_key: string;
  key_iv: string;
  key_auth_tag: string;
  key_preview: string;
  is_active: boolean;
  created_by: string;
  created_at: string;
}

export interface AgentToken {
  id: string;
  workspace_id: string;
  project_id: string | null;
  name: string;
  actor_label: string;
  token_hash: string;
  token_prefix: string;
  scopes: string[];
  allow_direct_done: boolean;
  last_used_at: string | null;
  revoked_at: string | null;
  created_by: string;
  created_at: string;
}

export interface ActivityLog {
  id: string;
  workspace_id: string;
  project_id: string | null;
  task_id: string | null;
  actor_type: ActorType;
  actor_user_id: string | null;
  actor_label: string;
  action: string;
  payload: Record<string, unknown>;
  created_at: string;
}

// API Response types
export interface PaginatedResponse<T> {
  data: T[];
  count: number;
  page: number;
  page_size: number;
  total_pages: number;
}

// MCP Types
export interface MCPContext {
  workspaceId: string;
  projectId: string | null;
  actorLabel: string;
  scopes: string[];
  allowDirectDone: boolean;
}

export type ListProjectsParams = Record<string, never>;
export interface ListProjectsResult {
  projects: Array<{
    id: string;
    slug: string;
    name: string;
    key_prefix: string;
    default_canvas_id: string | null;
  }>;
}

export interface GetBacklogTasksParams {
  project_slug: string;
  status?: TaskStatus[];
  priority?: TaskPriority[];
  type?: TaskType[];
  limit?: number;
}
export interface GetBacklogTasksResult {
  tasks: Array<{
    task_key: string;
    title: string;
    status: TaskStatus;
    priority: TaskPriority;
    type: TaskType;
    parent_task_key: string | null;
  }>;
}

export interface GetTaskContextParams {
  task_key: string;
}
export interface GetTaskContextResult {
  task: Task;
  connected_tasks: {
    blocks: Task[];
    blocked_by: Task[];
    children: Task[];
  };
  comments: Comment[];
}

export interface UpdateTaskStatusParams {
  task_key: string;
  status: TaskStatus;
  summary: string;
  files_changed?: string[];
  commit_or_pr_url?: string;
}

export interface CreateLinkedTaskParams {
  project_slug: string;
  title: string;
  type: TaskType;
  priority?: TaskPriority;
  spec_markdown?: string;
  acceptance_criteria?: string[];
  parent_task_key?: string;
  edge_type?: CanvasEdgeType;
}
export interface CreateLinkedTaskResult {
  task_key: string;
  canvas_node_id: string;
}

export interface AppendAgentNoteParams {
  task_key: string;
  markdown: string;
  files_changed?: string[];
  category?: "progress" | "architecture" | "blocker" | "test_result";
}

export interface GetCanvasOverviewParams {
  project_slug: string;
}
export interface GetCanvasOverviewResult {
  frames: Array<{
    id: string;
    title: string;
    node_count: number;
  }>;
  status_counts: Record<TaskStatus, number>;
  active_blockers: Task[];
  unpromoted_sticky_notes: number;
}

// AI Types
export interface DecomposeEpicInput {
  nodes: Array<{ id: string; type: CanvasNodeType; title: string; content?: string }>;
}
export interface DecomposeEpicOutput {
  subtasks: Array<{
    title: string;
    type: TaskType;
    priority: TaskPriority;
    spec_markdown: string;
    acceptance_criteria: string[];
    depends_on_index: number[];
  }>;
}

export interface ClusterNotesInput {
  sticky_notes: Array<{ id: string; text: string; position_x: number; position_y: number }>;
}
export interface ClusterNotesOutput {
  groups: Array<{
    title: string;
    description: string;
    note_ids: string[];
  }>;
}

export interface DraftSpecInput {
  task_title: string;
  connected_tasks: Array<{ task_key: string; title: string; type: TaskType }>;
}
export interface DraftSpecOutput {
  spec_markdown: string;
  acceptance_criteria: string[];
}

export interface SummarizeCanvasInput {
  project_id: string;
}
export interface SummarizeCanvasOutput {
  executive_summary: string;
  bottlenecks: string[];
  stale_blocked_tasks: Array<{ task_key: string; title: string; days_blocked: number }>;
  circular_dependencies: Array<{ task_key_a: string; task_key_b: string }>;
  prioritization_suggestions: string[];
}