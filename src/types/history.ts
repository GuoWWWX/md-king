export type HistoryItem = {
  id: string;
  inputPath: string;
  outputPath?: string;
  templateId?: string;
  simulated?: boolean;
  status: "pending" | "running" | "success" | "failed";
  durationMs?: number;
  errorCode?: string;
  errorMessage?: string;
  createdAt: string;
  finishedAt?: string;
};
