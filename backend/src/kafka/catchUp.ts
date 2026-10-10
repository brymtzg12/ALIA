
export class CatchUp {
  private pending = new Map<string, number>();
  private resolveDone!: () => void;
  readonly done: Promise<void>;
  private finished = false;

  constructor(highs: Map<string, Map<number, number>>) {
    this.done = new Promise((r) => (this.resolveDone = r));
    for (const [topic, parts] of highs) {
      for (const [partition, high] of parts) {
        if (high > 0) this.pending.set(`${topic}|${partition}`, high);
      }
    }
    this.check();
  }

  committed(topic: string, partition: number, nextOffset: number) {
    const k = `${topic}|${partition}`;
    const high = this.pending.get(k);
    if (high != null && nextOffset >= high) this.pending.delete(k);
    this.check();
  }

  processed(topic: string, partition: number, offset: number) {
    this.committed(topic, partition, offset + 1);
  }

  get isDone() {
    return this.finished;
  }

  get remaining(): string[] {
    return [...this.pending.keys()];
  }

  private check() {
    if (!this.finished && this.pending.size === 0) {
      this.finished = true;
      this.resolveDone();
    }
  }
}
