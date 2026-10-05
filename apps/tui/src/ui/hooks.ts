import { useStdout } from "ink";
import { useEffect, useState } from "react";

/** Wall-clock time that ticks every `intervalMs`, for relative ages. */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** The terminal's size, updated on resize (a toggleterm float resizes often). */
export function useViewport(): { readonly rows: number; readonly columns: number } {
  const { stdout } = useStdout();
  const tty = stdout as NodeJS.WriteStream;
  const read = () => ({ rows: tty.rows || 24, columns: tty.columns || 80 });
  const [size, setSize] = useState(read);
  useEffect(() => {
    const onResize = () => setSize(read());
    stdout.on("resize", onResize);
    return () => {
      stdout.off("resize", onResize);
    };
  }, [stdout]);
  return size;
}
