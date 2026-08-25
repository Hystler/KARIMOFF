export class EvotorConfigurationError extends Error {
  public readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "EvotorConfigurationError";
    this.code = code;
  }
}
