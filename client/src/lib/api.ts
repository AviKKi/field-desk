import type { ApiError as ApiErrorBody } from '@crm/shared';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    body: ApiErrorBody,
  ) {
    super(
      body.issues
        ?.map(
          (issue) => `${issue.path ? `${issue.path}: ` : ''}${issue.message}`,
        )
        .join('. ') || body.message,
    );
  }
}

export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({
      message: 'Could not complete the request',
    }))) as ApiErrorBody;
    if (response.status === 401 && !path.startsWith('/auth/'))
      window.dispatchEvent(new Event('session-expired'));
    throw new ApiError(response.status, body);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'Something went wrong. Please try again.';
}
