export type ConvertStatus = "pending" | "running" | "success" | "failed";

export type ConvertRequest = {
  input: string;
  output?: string;
  templateId?: string;
  openAfterConvert?: boolean;
  overwrite?: boolean;
  conflictStrategy?: "overwrite" | "rename" | "ask";
};

export type ConvertResult = {
  ok: boolean;
  simulated?: boolean;
  input: string;
  output?: string;
  templateId?: string;
  durationMs: number;
  warnings: string[];
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
