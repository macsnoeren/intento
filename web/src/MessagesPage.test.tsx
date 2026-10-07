import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { AccountPublic, MessageListQuery, MessagePublic } from '@intento/shared';
import { MessagesPage, deliverySummary } from './MessagesPage.tsx';
import { ApiRequestError, type Api } from './api.ts';

/** Berichtenoverzicht (N11.6, INTENTO-NEW-DESIGN §32, §49). */

const admin: AccountPublic = {
  id: 'acc-1',
  email: 'admin@intento.local',
  role: 'ADMIN',
  organizationId: 'org-1',
  name: null,
  emailVerified: true,
  mustChangePassword: false,
  isOperator: false,
};

function message(n: number, deliveries: MessagePublic['deliveries'] = []): MessagePublic {
  return {
    id: `m-${n}`,
    confirmedAt: '2026-10-07T09:00:00.000Z',
    user: { id: 'u-1', name: 'Sanne' },
    message: `Bericht ${n}.`,
    deliveries,
  };
}

function fakeApi(all: MessagePublic[]): { api: Api; queries: MessageListQuery[] } {
  const queries: MessageListQuery[] = [];
  const notImplemented = () =>
    Promise.reject(new ApiRequestError(500, 'NOT_IMPLEMENTED', 'niet in deze test'));
  const base = new Proxy({}, { get: () => notImplemented }) as Api;
  return {
    queries,
    api: {
      ...base,
      listMessages(query = {}) {
        queries.push(query);
        const page = query.page ?? 1;
        const pageSize = query.pageSize ?? 25;
        return Promise.resolve({
          items: all.slice((page - 1) * pageSize, page * pageSize),
          total: all.length,
          page,
          pageSize,
        });
      },
    },
  };
}

describe('berichten', () => {
  it('toont van wie, de boodschap en aan wie verstuurd', async () => {
    const { api } = fakeApi([
      message(1, [
        { contactName: 'Tim', status: 'failed', at: '2026-10-07T09:00:00.000Z' },
        { contactName: 'Mama', status: 'sent', at: '2026-10-07T09:01:00.000Z' },
      ]),
      message(2),
    ]);
    render(<MessagesPage api={api} account={admin} onLogout={() => {}} onNavigate={() => {}} />);
    const rows = await screen.findAllByRole('listitem');
    expect(within(rows[0]!).getByText('"Bericht 1."')).toBeTruthy();
    expect(rows[0]?.textContent).toContain('Sanne');
    expect(rows[0]?.textContent).toContain('Niet gelukt: Tim · Verstuurd aan Mama');
    expect(rows[1]?.textContent).toContain('Niet verstuurd');
    expect(screen.getByRole('status').textContent).toBe('2 berichten');
  });

  it('bladert met 25 per pagina', async () => {
    const { api, queries } = fakeApi(Array.from({ length: 30 }, (_, i) => message(i)));
    render(<MessagesPage api={api} account={admin} onLogout={() => {}} onNavigate={() => {}} />);
    expect(await screen.findByText('Pagina 1 van 2')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Volgende' }));
    expect(await screen.findByText('Pagina 2 van 2')).toBeTruthy();
    expect(queries.at(-1)).toEqual({ page: 2, pageSize: 25 });
  });

  it('een verwijderd contact heeft geen naam meer', () => {
    expect(
      deliverySummary(
        message(1, [{ contactName: null, status: 'sent', at: '2026-10-07T09:00:00.000Z' }]),
      ),
    ).toBe('Verstuurd aan een verwijderd contact');
  });
});
