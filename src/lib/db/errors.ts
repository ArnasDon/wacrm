export class RecordNotFoundError extends Error {
  readonly code = 'P0002';
  constructor(message = 'Record not found.') {
    super(message);
    this.name = 'RecordNotFoundError';
  }
}
