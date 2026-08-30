export type ConvertStatus = "pending" | "running" | "success" | "failed";

export type ConvertRequest = {
  input: string;
  inputKind?: "text" | "path";
  sourcePath?: string;
  output?: string;
  templateId?: string;
  openAfterConvert?: boolean;
  overwrite?: boolean;
  conflictStrategy?: "overwrite" | "rename" | "ask";
  headingNumbering?: "auto" | "source" | "word" | "none";
  tocPageNumbers?: Array<{ anchorId: string; page: number }>;
  updateFields?: "none" | "wps" | "word";
};

export type ConvertResult = {
  ok: boolean;
  simulated?: boolean;
  input: string;
  output?: string;
  templateId?: string;
  resolvedTemplatePath?: string;
  templateSha256?: string;
  durationMs: number;
  warnings: string[];
  diagnostics: Array<{
    code: string;
    severity: "warning" | "error";
    message: string;
    line?: number;
  }>;
  fieldUpdateStatus?: "notRun" | "notRequested" | "pendingOnOpen" | "updated" | "failed";
  fieldUpdateProvider?: "WPS" | "Word";
  errorCode?: string;
  message?: string;
};

export type PandocStatus = {
  available: boolean;
  version?: string;
  path?: string;
  errorCode?: string;
  message?: string;
};
