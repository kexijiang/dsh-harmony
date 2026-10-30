"use client";
import { useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import styles from "../../ConfirmDialog.module.css";
export function HarmonySettingsSurface({ children, onClose, title }: { children: ReactNode; onClose: () => void; title: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, true, { onEscape: onClose });
  return createPortal(<div className="harmony-settings-backdrop"><div ref={ref} className="harmony-settings-sheet" role="dialog" aria-modal="true" aria-label={title}>{children}</div></div>, document.body);
}
