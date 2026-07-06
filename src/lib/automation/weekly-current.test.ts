// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const findFirstMock = vi.fn();

vi.mock('@/lib/db', () => ({
  prisma: {
    weekly_issues: {
      findFirst: (...args: unknown[]) => findFirstMock(...args),
    },
  },
}));

import { getCurrentWeeklyIssue } from './weekly-current';

describe('getCurrentWeeklyIssue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty when no issue covers the target week', async () => {
    findFirstMock.mockResolvedValueOnce(null);

    await expect(getCurrentWeeklyIssue({ date: '2026-07-06' })).resolves.toMatchObject({
      status: 'empty',
      issue: null,
      range: {
        startDate: '2026-07-05',
        endDate: '2026-07-11',
      },
    });
  });

  it('returns the cross-week issue that covers the target week', async () => {
    findFirstMock.mockResolvedValueOnce({
      id: 92,
      issue_number: 92,
      title: '我不知道的周刊第 92 期',
      slug: 'issue-92',
      status: 'published',
      start_date: new Date('2026-03-29T00:00:00.000Z'),
      end_date: new Date('2026-07-11T00:00:00.000Z'),
      total_items: 12,
      quail_post_id: '18583',
      quail_post_slug: 'issue-92',
      published_at: new Date('2026-07-06T14:19:33.000Z'),
      _count: { weekly_content_items: 12 },
    });

    await expect(getCurrentWeeklyIssue({ date: '2026-07-06' })).resolves.toMatchObject({
      status: 'succeeded',
      issue: {
        id: 92,
        issueNumber: 92,
        slug: 'issue-92',
        startDate: '2026-03-29',
        endDate: '2026-07-11',
        linkedCount: 12,
      },
    });

    expect(findFirstMock).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        start_date: { lte: expect.any(Date) },
        end_date: { gte: expect.any(Date) },
      },
      orderBy: { issue_number: 'desc' },
    }));
  });
});
