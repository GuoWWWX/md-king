export type Template = {
  id: string;
  name: string;
  description?: string;
  referenceDocxPath: string;
  previewImagePath?: string;
  tags: string[];
  isBuiltIn: boolean;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ImportTemplateRequest = {
  name: string;
  description?: string;
  referenceDocxPath: string;
  tags: string[];
  isDefault?: boolean;
};
