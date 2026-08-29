"use client";

import { useEffect, useRef } from "react";

type FailureToastProps = {
  message: string | null | undefined;
  onDismiss: () => void;
  duration?: number;
};

/** A single, non-blocking failure surface shared by every client workflow. */
export function FailureToast({ message, onDismiss, duration = 5000 }: FailureToastProps) {
  const dismissButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(onDismiss, duration);
    return () => window.clearTimeout(timer);
  }, [duration, message, onDismiss]);

  useEffect(() => {
    if (!message) return;
    dismissButton.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onDismiss(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [message, onDismiss]);

  if (!message) return null;
  return <aside className="failure-toast" role="alert" aria-live="assertive" aria-atomic="true">
    <span className="failure-toast-mark" aria-hidden="true">!</span>
    <div><p className="failure-toast-kicker">处理提示 / FIELD NOTICE</p><b>操作未完成</b><p>{message}</p></div>
    <button ref={dismissButton} type="button" onClick={onDismiss} aria-label="关闭错误提示">×</button>
  </aside>;
}
