/**
 * Images the composer attaches from a path or the clipboard, as the upload
 * shape a turn carries. Pure (bytes in), so the limits are testable.
 *
 * @module attachments
 */
import {
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
  isProviderSendTurnSupportedImageMimeType,
  type UploadChatImageAttachment,
} from "@cz/contracts";

const MIME_BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

/** The image attachment for a file's bytes, or why it can't be sent. */
export function imageAttachment(
  name: string,
  bytes: Uint8Array,
): UploadChatImageAttachment | { readonly error: string } {
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  const mimeType = MIME_BY_EXTENSION[extension];
  if (!mimeType || !isProviderSendTurnSupportedImageMimeType(mimeType)) {
    return { error: `${name}: only PNG, JPEG, GIF, and WebP images can be attached.` };
  }
  if (bytes.byteLength > PROVIDER_SEND_TURN_MAX_IMAGE_BYTES) {
    return { error: `${name} is over the 10 MB image limit.` };
  }
  return {
    type: "image",
    name,
    mimeType,
    sizeBytes: bytes.byteLength,
    dataUrl: `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`,
  };
}

/** `~/shot.png` or `'/path with spaces.png'` as typed or dropped into a terminal. */
export function expandPath(typed: string, home: string): string {
  const trimmed = typed.trim().replace(/^(['"])(.*)\1$/, "$2").replace(/\\ /g, " ");
  return trimmed === "~" || trimmed.startsWith("~/") ? home + trimmed.slice(1) : trimmed;
}
