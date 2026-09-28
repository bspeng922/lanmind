export class OpticalSessionController {
  private epoch = 0;
  private controller?: AbortController;

  begin(): { epoch: number; signal: AbortSignal } {
    this.cancel();
    this.controller = new AbortController();
    return { epoch: ++this.epoch, signal: this.controller.signal };
  }

  isCurrent(epoch: number): boolean {
    return epoch === this.epoch && !this.controller?.signal.aborted;
  }

  cancel(): void {
    this.controller?.abort();
    this.controller = undefined;
    this.epoch += 1;
  }

  dispose(): void {
    this.cancel();
  }
}
