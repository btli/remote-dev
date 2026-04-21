"use client";
import { type ReactNode, type CSSProperties } from "react";

interface Props {
  depth: number;
  isLastChild: boolean;
  children: ReactNode;
}

export function TreeConnector({ depth, isLastChild, children }: Props) {
  const left = depth * 12 + 8 + 7;
  const style: CSSProperties & Record<string, string> = {
    "--tree-connector-left": `${left}px`,
    "--tree-connector-width": "8px",
  };
  return (
    <div className="tree-item" data-tree-last={isLastChild ? "true" : undefined} style={style}>
      {children}
    </div>
  );
}
