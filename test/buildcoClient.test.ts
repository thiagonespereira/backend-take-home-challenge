import { BuildcoClient } from '../src/clients/buildco';

const fetchMock = jest.fn();

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

describe('BuildcoClient', () => {
  it('lists projects with the API key in the Authorization header', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ items: [{ id: 'bc-proj-1', name: 'Riverside Tower' }], page: 1, has_more: false }),
    );
    const client = new BuildcoClient('key-123', 'https://api.buildco.test/v1');

    const result = await client.listProjects(1);

    expect(result.items).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.buildco.test/v1/projects?page=1&per_page=100',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Authorization: 'Bearer key-123' }),
      }),
    );
  });

  it('requests the given page when listing contacts', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ items: [], page: 3, has_more: false }));
    const client = new BuildcoClient('key-123', 'https://api.buildco.test/v1');

    await client.listContacts(3);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.buildco.test/v1/contacts?page=3&per_page=100',
      expect.anything(),
    );
  });

  it('posts the usage report payload', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}));
    const client = new BuildcoClient('key-123', 'https://api.buildco.test/v1');
    const report = {
      account_id: 'acct-100',
      projects_synced: 12,
      contacts_synced: 40,
      synced_at: '2024-06-18T02:00:00Z',
    };

    await client.reportUsage(report);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.buildco.test/v1/usage-report',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(report),
      }),
    );
  });

  it('throws when the tenant API key is missing instead of using a global fallback', () => {
    expect(() => new BuildcoClient('')).toThrow('BuildCo API key is required');
    expect(() => new BuildcoClient(null)).toThrow('BuildCo API key is required');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
