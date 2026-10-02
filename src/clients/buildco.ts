import { config } from '../config';

export interface BuildcoProjectDto {
  id: string;
  name: string;
  projectStatus: string;
  site_address: string | null;
  budget_cents: number | null;
  updated_at: string;
}

export interface BuildcoContactDto {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  role: string | null;
  project_id: string | null;
  updated_at: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  page: number;
  has_more: boolean;
}

export interface UsageReport {
  account_id: string;
  projects_synced: number;
  contacts_synced: number;
  synced_at: string;
}

const BASE_DELAY_MS = 500;
const BACKOFF_FACTOR = 2;
const MAX_ATTEMPTS = 5;

class HttpError extends Error {
  readonly status: number;
  readonly response: Response;

  constructor(status: number, message: string, response: Response) {
    super(message);
    this.status = status;
    this.response = response;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitteredDelay(attempt: number): number {
  const base = BASE_DELAY_MS * Math.pow(BACKOFF_FACTOR, attempt - 1);
  return base + Math.random() * base * 0.25;
}

function isNetworkError(err: unknown): boolean {
  return err instanceof TypeError;
}

function isRetryableHttpError(err: unknown): boolean {
  return err instanceof HttpError && (err.status >= 500 || err.status === 429);
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const canRetry = isNetworkError(err) || isRetryableHttpError(err);
      if (!canRetry || attempt === MAX_ATTEMPTS) {
        break;
      }
      await sleep(jitteredDelay(attempt));
    }
  }
  throw lastError;
}

export class BuildcoClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(apiKey: string | null | undefined, baseUrl: string = config.buildco.baseUrl) {
    if (!apiKey) {
      throw new Error('BuildCo API key is required');
    }
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  async listProjects(page: number): Promise<PaginatedResponse<BuildcoProjectDto>> {
    return this.request('GET', `/projects?page=${page}&per_page=100`);
  }

  async listContacts(page: number): Promise<PaginatedResponse<BuildcoContactDto>> {
    return this.request('GET', `/contacts?page=${page}&per_page=100`);
  }

  async reportUsage(report: UsageReport): Promise<void> {
    await this.request('POST', '/usage-report', report);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    return withRetry(async () => {
      let response: Response;
      try {
        response = await fetch(`${this.baseUrl}${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      } catch (err) {
        throw err;
      }

      if (!response.ok) {
        throw new HttpError(
          response.status,
          `BuildCo API returned ${response.status} for ${method} ${path}`,
          response,
        );
      }

      if (response.status === 204) {
        return undefined as T;
      }

      return (await response.json()) as T;
    });
  }
}
