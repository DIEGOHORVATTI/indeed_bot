/**
 * Job registry — ported from Python job_registry.py.
 * Uses chrome.storage.local instead of JSON file.
 */

const STORAGE_KEY = 'jobRegistry';

interface RegistryData {
  applied: string[];
  skipped: Record<string, string>;
}

export class JobRegistry {
  private applied = new Set<string>();
  private skipped = new Map<string, string>();
  private loaded = false;

  async load(): Promise<void> {
    if (this.loaded) return;
    const data = await chrome.storage.local.get(STORAGE_KEY);
    const registry: RegistryData = data[STORAGE_KEY] || { applied: [], skipped: {} };
    this.applied = new Set(registry.applied);
    this.skipped = new Map(Object.entries(registry.skipped));
    this.loaded = true;
  }

  private async save(): Promise<void> {
    const data: RegistryData = {
      applied: Array.from(this.applied).sort(),
      skipped: Object.fromEntries(Array.from(this.skipped.entries()).sort()),
    };
    await chrome.storage.local.set({ [STORAGE_KEY]: data });
  }

  async isKnown(jobKey: string): Promise<boolean> {
    await this.load();
    return this.applied.has(jobKey) || this.skipped.has(jobKey);
  }

  async markApplied(jobKey: string): Promise<void> {
    await this.load();
    this.applied.add(jobKey);
    this.skipped.delete(jobKey);
    await this.save();
  }

  async markSkipped(jobKey: string, reason: string): Promise<void> {
    await this.load();
    if (this.applied.has(jobKey)) return;
    this.skipped.set(jobKey, reason);
    await this.save();
  }

  async statusOf(jobKey: string): Promise<string | null> {
    await this.load();
    if (this.applied.has(jobKey)) return 'applied';
    const reason = this.skipped.get(jobKey);
    if (reason) return `skipped:${reason}`;
    return null;
  }

  get appliedCount(): number {
    return this.applied.size;
  }

  get skippedCount(): number {
    return this.skipped.size;
  }
}
