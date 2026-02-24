export class StorageQuotaExceededError extends Error {
  constructor() {
    super("Storage quota exceeded");
    this.name = "StorageQuotaExceededError";
  }
}
