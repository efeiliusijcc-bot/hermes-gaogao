export interface UserPreferenceResponse {
  preferenceId: string | null;
  ownerId: string;
  defaultReportType: string | null;
  defaultRegion: string | null;
  defaultLanguage: string;
  writingStyle: string | null;
  tone: string | null;
  defaultSourceOptions: Record<string, unknown>;
  defaultOutlineOptions: Record<string, unknown>;
  preferenceJson: Record<string, unknown>;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface UserTemplateResponse {
  templateId: string;
  ownerId: string;
  templateName: string;
  templateType: string | null;
  description: string;
  templateJson: Record<string, unknown>;
  isDefault: boolean;
  isShared: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface PromptSnippetResponse {
  snippetId: string;
  ownerId: string;
  snippetName: string;
  snippetType: string | null;
  content: string;
  tags: string[];
  usageCount: number;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface UserPreferenceContext {
  ownerId: string;
  preferences: Record<string, unknown>;
  template: Record<string, unknown> | null;
  promptSnippets: Array<Record<string, unknown>>;
}

export interface ListQuery {
  ownerId?: string;
  templateType?: string;
  snippetType?: string;
  page?: string | number;
  pageSize?: string | number;
}
