
export interface Demo {
  id: string;
  filename: string;
  displayName: string;
  filepath: string;
  size: number;
  modifiedAt: string;
  directory: string;
}

export interface AppSettings {
  demoDirectory: string;
  cs2Path: string;
  steamPath: string;
  autoExtractGz: boolean;
  autoAddToLibrary: boolean;
}

export type CS2Status = "found" | "not_found" | "unknown";

export type StatusMessage =
  | { type: "success"; message: string }
  | { type: "error"; message: string }
  | { type: "info"; message: string }
  | null;
