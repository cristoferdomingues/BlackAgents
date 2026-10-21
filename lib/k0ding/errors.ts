export class K0dingError extends Error {
  readonly status: number

  constructor(message: string, status = 400) {
    super(message)
    this.name = "K0dingError"
    this.status = status
  }
}
