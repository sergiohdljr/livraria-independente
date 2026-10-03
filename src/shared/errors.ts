export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly erro: string,
  ) {
    super(erro);
  }
}
