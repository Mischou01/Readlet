/** A random id for annotations, sessions and shelves (accepted by the Rust validators). */
export function newId(): string {
  return crypto.randomUUID()
}
