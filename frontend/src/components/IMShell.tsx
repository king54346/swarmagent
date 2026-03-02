import type { ReactNode, CSSProperties } from "react";

type IMShellProps = {
  left: ReactNode;
  mid: ReactNode;
  right: ReactNode;
  leftResizer?: ReactNode;
  rightResizer?: ReactNode;
  className?: string;
  style?: CSSProperties;
};

export function IMShell({ left, leftResizer, mid, rightResizer, right, className, style }: IMShellProps) {
  return (
    <div className={`app dark${className ? ` ${className}` : ""}`} style={style}>
      {left}
      {leftResizer}
      {mid}
      {rightResizer}
      {right}
    </div>
  );
}
