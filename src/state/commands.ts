/**
 * A minimal command stack for undo/redo. Each command knows how to undo and
 * redo itself; pushing a new command clears the redo branch. Building actions
 * (snapping a brick) push a command; the palm menu drives undo/redo.
 */
export interface Command {
  label: string;
  undo(): void;
  redo(): void;
}

export class CommandStack {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];

  push(cmd: Command): void {
    this.undoStack.push(cmd);
    this.redoStack.length = 0;
  }

  undo(): void {
    const cmd = this.undoStack.pop();
    if (!cmd) return;
    cmd.undo();
    this.redoStack.push(cmd);
  }

  redo(): void {
    const cmd = this.redoStack.pop();
    if (!cmd) return;
    cmd.redo();
    this.undoStack.push(cmd);
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }
}
