/**
 * Images the terminal holds for ct, so each is sent once. Kitty placeholders
 * name an image by id; once transmitted, any number of repaints, remounts,
 * and scrolls draw it again from plain text with no bytes re-sent. The store
 * keeps one terminal image per (source, size), counts who shows it, and only
 * deletes images nobody shows once it holds more than `capacity`.
 *
 * @module imageStore
 */

export interface ImageStore {
  /** The image's id, transmitting it first if the terminal doesn't have it yet. */
  readonly acquire: (
    key: string,
    image: { readonly png: Uint8Array; readonly columns: number; readonly rows: number },
  ) => number;
  readonly release: (key: string) => void;
  /** Deletes every image ct sent (on exit), leaving other programs' images alone. */
  readonly clear: () => void;
}

export function makeImageStore(options: {
  readonly write: (sequence: string) => void;
  readonly transmit: (id: number, png: Uint8Array, columns: number, rows: number) => string;
  readonly remove: (id: number) => string;
  readonly firstId: number;
  readonly capacity?: number;
}): ImageStore {
  const capacity = options.capacity ?? 48;
  // Insertion order doubles as least-recently-used order: acquire re-inserts.
  const entries = new Map<string, { id: number; users: number }>();
  let nextId = options.firstId;

  const evict = () => {
    for (const [key, entry] of entries) {
      if (entries.size <= capacity) return;
      if (entry.users > 0) continue;
      options.write(options.remove(entry.id));
      entries.delete(key);
    }
  };

  return {
    acquire: (key, image) => {
      const existing = entries.get(key);
      if (existing) {
        existing.users += 1;
        entries.delete(key);
        entries.set(key, existing);
        return existing.id;
      }
      const id = nextId;
      nextId += 1;
      options.write(options.transmit(id, image.png, image.columns, image.rows));
      entries.set(key, { id, users: 1 });
      evict();
      return id;
    },
    release: (key) => {
      const entry = entries.get(key);
      if (entry) entry.users = Math.max(0, entry.users - 1);
      evict();
    },
    clear: () => {
      for (const entry of entries.values()) options.write(options.remove(entry.id));
      entries.clear();
    },
  };
}
