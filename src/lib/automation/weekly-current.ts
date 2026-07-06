import { z } from 'zod';

import { prisma } from '@/lib/db';
import { getWeekRange, getWeekRangeByOffset } from '@/lib/utils/weekly-date';

export const WeeklyCurrentQuerySchema = z.object({
  weekOffset: z.coerce.number().int().min(-52).max(52).optional(),
  date: z.string().optional(),
});

export type WeeklyCurrentQuery = z.infer<typeof WeeklyCurrentQuerySchema>;

export async function getCurrentWeeklyIssue(query: WeeklyCurrentQuery) {
  const range = query.date ? getWeekRange(query.date) : getWeekRangeByOffset(query.weekOffset ?? 0);
  const issue = await prisma.weekly_issues.findFirst({
    where: {
      start_date: { lte: range.endDate },
      end_date: { gte: range.startDate },
    },
    orderBy: { issue_number: 'desc' },
    select: {
      id: true,
      issue_number: true,
      title: true,
      slug: true,
      status: true,
      start_date: true,
      end_date: true,
      total_items: true,
      quail_post_id: true,
      quail_post_slug: true,
      published_at: true,
      _count: {
        select: {
          weekly_content_items: true,
        },
      },
    },
  });

  return {
    status: issue ? 'succeeded' as const : 'empty' as const,
    range: {
      startDate: range.startDateStr,
      endDate: range.endDateStr,
    },
    issue: issue
      ? {
        id: issue.id,
        issueNumber: issue.issue_number,
        title: issue.title,
        slug: issue.slug,
        status: issue.status,
        startDate: formatDate(issue.start_date),
        endDate: formatDate(issue.end_date),
        totalItems: issue.total_items,
        linkedCount: issue._count.weekly_content_items,
        quailPostId: issue.quail_post_id,
        quailPostSlug: issue.quail_post_slug,
        publishedAt: issue.published_at?.toISOString() ?? null,
      }
      : null,
  };
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
