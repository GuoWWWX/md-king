export class TableCellCompositionGuard {
  private phase: "idle" | "composing" | "cancelling" = "idle";

  get composing(): boolean {
    return this.phase !== "idle";
  }

  get acceptsInput(): boolean {
    return this.phase !== "cancelling";
  }

  start(): void {
    this.phase = "composing";
  }

  cancel(): void {
    if (this.phase === "composing") this.phase = "cancelling";
  }

  end(): "cancelled" | "complete" {
    const result = this.phase === "cancelling" ? "cancelled" : "complete";
    this.phase = "idle";
    return result;
  }
}
