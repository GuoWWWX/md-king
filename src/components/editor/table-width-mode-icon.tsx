import type { ComponentPropsWithoutRef } from "react";
import type { TableWidthMode } from "./cm/table-display-settings";

type TableWidthModeIconProps = ComponentPropsWithoutRef<"svg"> & {
  mode: TableWidthMode;
};

/** 参考常见文档编辑器：窗口模式在表格上方拉伸，内容模式在表格内按内容收缩。 */
export function TableWidthModeIcon({ mode, ...props }: TableWidthModeIconProps) {
  const isWindow = mode === "window";

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <g stroke="currentColor">
        <rect x="4.5" y="8" width="15" height="11.5" rx="0.7" />
        <path d="M4.5 11.75h15M9.5 8v11.5M14.5 8v11.5" />
      </g>
      {isWindow ? (
        <g stroke="#10b981" strokeWidth="2">
          <path d="M3.25 4h17.5" />
          <path d="M3.25 4 5.75 1.75M3.25 4l2.5 2.25M20.75 4l-2.5-2.25M20.75 4l-2.5 2.25" />
        </g>
      ) : (
        <g stroke="#3b82f6" strokeWidth="2">
          <path d="M11 15.5h5M11 15.5l2-1.75M11 15.5l2 1.75M16 15.5l-2-1.75M16 15.5l-2 1.75" />
          <path d="M12 22v-2.25M12 22l-1.75-1.75M12 22l1.75-1.75" />
        </g>
      )}
    </svg>
  );
}
