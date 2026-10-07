/**
 * The image on the system clipboard, for pasting a screenshot into the
 * composer. A terminal only pastes text, so the TUI asks the OS for it.
 *
 * @module clipboard
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeOS from "node:os";

const run = (command: string, args: ReadonlyArray<string>, encoding: "buffer" | "utf8") =>
  new Promise<Buffer | string | null>((resolve) => {
    NodeChildProcess.execFile(
      command,
      args,
      { encoding, maxBuffer: 64 * 1024 * 1024, timeout: 5000 },
      (error, stdout) => resolve(error ? null : stdout),
    );
  });

/** `«data PNGf89504E47…»`, how AppleScript prints clipboard image data. */
export function parseAppleScriptData(output: string): Uint8Array | null {
  const hex = /«data PNGf([0-9A-Fa-f]+)»/.exec(output)?.[1];
  return hex ? new Uint8Array(Buffer.from(hex, "hex")) : null;
}

/** PNG bytes of the clipboard's image, or null when it holds none. */
export async function readClipboardImage(): Promise<Uint8Array | null> {
  if (NodeOS.platform() === "darwin") {
    const output = await run("osascript", ["-e", "the clipboard as «class PNGf»"], "utf8");
    return typeof output === "string" ? parseAppleScriptData(output) : null;
  }
  const attempts: ReadonlyArray<readonly [string, ReadonlyArray<string>]> = process.env
    .WAYLAND_DISPLAY
    ? [["wl-paste", ["--no-newline", "--type", "image/png"]]]
    : [["xclip", ["-selection", "clipboard", "-target", "image/png", "-out"]]];
  for (const [command, args] of attempts) {
    const output = await run(command, args, "buffer");
    if (Buffer.isBuffer(output) && output.byteLength > 8 && output.readUInt32BE(0) === 0x89504e47)
      return new Uint8Array(output);
  }
  return null;
}
