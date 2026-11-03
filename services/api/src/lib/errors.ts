export class ApiError extends Error {
  constructor(public status: number, public code: string, message?: string, public details?: unknown) {
    super(message ?? code);
  }
}
export const bad = (code: string, msg?: string, details?: unknown) => new ApiError(400, code, msg, details);
export const unauthorised = (msg = 'Sign in required') => new ApiError(401, 'unauthorised', msg);
export const forbidden = (msg = 'Not allowed') => new ApiError(403, 'forbidden', msg);
export const notFound = (what = 'Resource') => new ApiError(404, 'not_found', `${what} not found`);
export const conflict = (code: string, msg?: string) => new ApiError(409, code, msg);
