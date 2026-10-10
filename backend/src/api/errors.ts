
export class HttpError extends Error {
  status: number;
  constructor(status: number, detail: string) {
    super(detail);
    this.status = status;
  }
}

export const notFound = (detail: string) => new HttpError(404, detail);
export const conflict = (detail: string) => new HttpError(409, detail);
export const unprocessable = (detail: string) => new HttpError(422, detail);
