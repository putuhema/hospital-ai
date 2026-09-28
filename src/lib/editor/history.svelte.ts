/** Undo/redo stacks of serialised editor states. */
export class History {
  past = $state<string[]>([]);
  future = $state<string[]>([]);

  /** Remember `current` before a change; a new change drops the redo stack. */
  record(current: string) {
    this.past = [...this.past, current];
    this.future = [];
  }

  /** The state to restore, or null when there is nothing to undo. */
  undo(current: string) {
    const previous = this.past.at(-1);
    if (previous === undefined) return null;
    this.future = [...this.future, current];
    this.past = this.past.slice(0, -1);
    return previous;
  }

  redo(current: string) {
    const next = this.future.at(-1);
    if (next === undefined) return null;
    this.past = [...this.past, current];
    this.future = this.future.slice(0, -1);
    return next;
  }

  clear() {
    this.past = [];
    this.future = [];
  }
}
