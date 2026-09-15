import { useCallback, useEffect, useRef, useState } from "react";
import { copyText } from "@/lib/browser";

export interface UseCopyToClipboardOptions {
  timeout?: number;
  onCopy?: () => void;
  onError?: (error: Error) => void;
}

export function useCopyToClipboard(
  textToCopy: string,
  options?: UseCopyToClipboardOptions,
) {
  const [isCopied, setIsCopied] = useState(false);
  const timeoutRef = useRef<number>(0);
  const timeout = options?.timeout ?? 2000;
  const onCopy = options?.onCopy;
  const onError = options?.onError;

  const copyToClipboard = useCallback(async () => {
    try {
      if (!isCopied) {
        await copyText(textToCopy);
        setIsCopied(true);
        onCopy?.();
        timeoutRef.current = window.setTimeout(
          () => setIsCopied(false),
          timeout,
        );
      }
    } catch (error) {
      onError?.(error as Error);
    }
  }, [textToCopy, onCopy, onError, timeout, isCopied]);

  useEffect(
    () => () => {
      window.clearTimeout(timeoutRef.current);
    },
    [],
  );

  return { isCopied, copyToClipboard };
}
