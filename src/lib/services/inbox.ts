import { prisma } from '@/lib/db';
import type { InboxBatchInput, InboxBatchPromoteInput, InboxListQuery, InboxPromoteInput } from '@/lib/validations/inbox';
import type { Prisma } from '@prisma/client';
import {
  addBookmarkToKarakeepList,
  archiveKarakeepBookmark,
  removeBookmarkFromKarakeepList,
} from '@/lib/services/karakeep-api';
import { DataSourceService } from '@/lib/services/data-source';

const KARAKEEP_WEEKLY_LIST_ID = process.env.KARAKEEP_WEEKLY_LIST_ID || '';
const KARAKEEP_DRAFT_LIST_ID = process.env.KARAKEEP_DRAFT_LIST_ID || '';

export type InboxItemWithRelations = Awaited<
  ReturnType<
    typeof prisma.inbox_items.findFirst<{
      include: { data_source: true; linked_content: true; duplicate_of: true; duplicates: true };
    }>
  >
>;

export type InboxListResponse = {
  data: InboxItemWithRelations[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
};

function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .substring(0, 100);
}

function hostnameFromUrl(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'Unknown';
  }
}

function parseTagsSuggestion(value: unknown): Array<{ name?: string }> {
  if (!value) return [];
  if (Array.isArray(value)) return value as Array<{ name?: string }>;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed as Array<{ name?: string }>;
    } catch {
      return [];
    }
  }
  return [];
}

type InboxItemForPromotion = {
  title: string | null;
  slug: string | null;
  url: string;
  summary: string | null;
  description: string | null;
  note: string | null;
  content: string | null;
  image_url: string | null;
  source_name: string | null;
  ai_score: number | null;
  synced_at: Date | null;
  created_at: Date | null;
  category_suggestion: string | null;
  data_source: { default_content_type_id: number | null; default_category_id: number | null } | null;
};

type PromotionOverrides = {
  auto_promoted?: boolean;
  original_score?: number | null;
  category_id?: number | null;
  content_type_id?: number | null;
  content_format?: string;
};

export async function buildContentDataForPromotion(
  item: InboxItemForPromotion,
  overrides: PromotionOverrides = {},
): Promise<Prisma.contentsCreateInput> {
  const contentTypeId = overrides.content_type_id ?? item.data_source?.default_content_type_id ?? 3;
  const contentFormat = overrides.content_format ?? 'markdown';

  let resolvedCategoryId = overrides.category_id ?? item.data_source?.default_category_id ?? null;
  if (!resolvedCategoryId && item.category_suggestion) {
    const suggestedName = item.category_suggestion.trim();
    if (suggestedName) {
      const slugBase = generateSlug(suggestedName);
      let category = await prisma.categories.findFirst({
        where: { OR: [{ name: suggestedName }, { slug: slugBase }] },
      });
      if (!category) {
        let uniqueSlug = slugBase || `category-${Date.now()}`;
        let counter = 1;
         
        while (true) {
          const exists = await prisma.categories.findFirst({ where: { slug: uniqueSlug } });
          if (!exists) break;
          uniqueSlug = `${slugBase}-${counter++}`;
          if (counter > 50) {
            uniqueSlug = `${slugBase}-${Date.now()}`;
            break;
          }
        }
        category = await prisma.categories.create({
          data: { name: suggestedName, slug: uniqueSlug },
        });
      }
      resolvedCategoryId = category.id;
    }
  }

  const title = (item.title || '').trim() || item.url;
  const slug = item.slug || `${generateSlug(title)}-${Date.now()}`;
  const description = item.description || item.summary || item.note || '';
  const summary = item.summary || item.description || item.note || null;
  const sourceUrl = item.url;

  return {
    content_type_id: contentTypeId,
    ...(resolvedCategoryId ? { categories: { connect: { id: resolvedCategoryId } } } : {}),
    title,
    slug,
    description,
    summary,
    content:
      item.content ||
      [
        `## ${title}`,
        '',
        summary ? summary.trim() : '',
        '',
        `**来源**: [${item.source_name || hostnameFromUrl(sourceUrl)}](${sourceUrl})`,
        item.note ? `\n**笔记**\n${item.note}` : '',
      ]
        .filter(Boolean)
        .join('\n')
        .trim(),
    content_format: contentFormat as Prisma.contentsCreateInput['content_format'],
    status: overrides.auto_promoted ? 'ready' : 'draft',
    source: item.source_name,
    source_url: sourceUrl,
    word_count: 0,
    original_score: overrides.original_score ?? item.ai_score ?? null,
    collected_at: item.synced_at ?? item.created_at ?? new Date(),
  };
}

async function moveKarakeepBookmarkToWeekly(karakeepId: string) {
  if (!karakeepId) return;

  if (KARAKEEP_WEEKLY_LIST_ID) {
    try {
      await addBookmarkToKarakeepList(KARAKEEP_WEEKLY_LIST_ID, karakeepId);
      console.log(`已将书签添加到 Karakeep 周刊列表: ${KARAKEEP_WEEKLY_LIST_ID}`);
    } catch (error) {
      console.error('添加到 Karakeep 周刊列表失败:', error);
    }
  }

  if (KARAKEEP_DRAFT_LIST_ID) {
    try {
      await removeBookmarkFromKarakeepList(KARAKEEP_DRAFT_LIST_ID, karakeepId);
      console.log(`已从 Karakeep Draft 列表移除书签: ${KARAKEEP_DRAFT_LIST_ID}`);
    } catch (error) {
      console.error('从 Karakeep Draft 列表移除失败:', error);
    }
  }
}

export class InboxService {
  static async getInboxList(query: InboxListQuery): Promise<InboxListResponse> {
    const {
      page = 1,
      pageSize = 20,
      status,
      source_id,
      keyword,
      showDuplicates = 'all',
      sortBy = 'collected_at',
      sortOrder = 'asc',
      ai_score_min,
    } = query;

    const where: Prisma.inbox_itemsWhereInput = {};
    if (status) where.status = status;
    if (source_id) where.source_id = source_id;

    if (keyword) {
      where.OR = [
        { title: { contains: keyword } },
        { url: { contains: keyword } },
        { description: { contains: keyword } },
        { note: { contains: keyword } },
        { summary: { contains: keyword } },
      ];
    }

    if (showDuplicates === 'original') where.duplicate_of_id = null;
    if (showDuplicates === 'duplicate') where.duplicate_of_id = { not: null };

    // AI 评分筛选
    if (ai_score_min !== undefined) {
      where.ai_score = { gte: ai_score_min };
    }

    const orderBy: Prisma.inbox_itemsOrderByWithRelationInput =
      sortBy === 'updated_at'
        ? { updated_at: sortOrder }
        : sortBy === 'priority'
          ? { priority: sortOrder }
          : sortBy === 'ai_score'
            ? { ai_score: sortOrder }
          : sortBy === 'synced_at'
            ? { synced_at: sortOrder }
            : sortBy === 'source_published_at'
              ? { source_published_at: sortOrder }
              : sortBy === 'collected_at'
                ? { collected_at: sortOrder }
                : { created_at: sortOrder };

    const total = await prisma.inbox_items.count({ where });
    const rows = await prisma.inbox_items.findMany({
      where,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        data_source: true,
        linked_content: true,
        duplicate_of: true,
        duplicates: true,
      },
    });

    return {
      data: rows,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    };
  }

  static async getInboxById(id: bigint) {
    return prisma.inbox_items.findUnique({
      where: { id },
      include: {
        data_source: true,
        linked_content: true,
        duplicate_of: true,
        duplicates: true,
      },
    });
  }

  static async getInboxStats() {
    const [all, pending, promoted, rejected, duplicate] = await Promise.all([
      prisma.inbox_items.count(),
      prisma.inbox_items.count({ where: { status: 'pending' } }),
      prisma.inbox_items.count({ where: { status: 'promoted' } }),
      prisma.inbox_items.count({ where: { status: 'rejected' } }),
      prisma.inbox_items.count({ where: { status: 'duplicate' } }),
    ]);

    return {
      all,
      pending,
      promoted,
      rejected,
      duplicate,
    };
  }

  static async promoteInboxItem(id: bigint, input: InboxPromoteInput) {
    const item = await prisma.inbox_items.findUnique({
      where: { id },
      include: { data_source: true },
    });
    if (!item) throw new Error('收件箱条目不存在');
    if (item.content_id) throw new Error('该条目已晋升为内容');

    const content = await prisma.contents.create({
      data: await buildContentDataForPromotion(item, {
        content_type_id: input.content_type_id,
        category_id: input.category_id,
        content_format: input.content_format,
      }),
    });

    const explicitTagIds = input.tag_ids ?? [];
    const suggestedTags = explicitTagIds.length === 0 ? parseTagsSuggestion(item.tags_suggestion) : [];
    const finalTagIds: number[] = [...explicitTagIds];

    if (suggestedTags.length > 0) {
      for (const t of suggestedTags) {
        if (!t.name) continue;
        let tag = await prisma.tags.findFirst({
          where: { name: t.name },
        });
        if (!tag) {
          const baseSlug = generateSlug(t.name);
          tag = await prisma.tags.create({
            data: { name: t.name, slug: `${baseSlug}-${Date.now()}`, count: 0 },
          });
        }
        finalTagIds.push(tag.id);
      }
    }

    if (finalTagIds.length > 0) {
      for (const tagId of finalTagIds) {
        await prisma.content_tags.create({
          data: { content_id: content.id, tag_id: tagId },
        });
      }
      await prisma.tags.updateMany({
        where: { id: { in: finalTagIds } },
        data: { count: { increment: 1 } },
      });
    }

    await prisma.inbox_items.update({
      where: { id },
      data: {
        status: 'promoted',
        content_id: content.id,
        auto_promoted: false,
      },
    });

    // 【双向同步】在 Karakeep 中归档并移动列表
    if (item.data_source?.type === 'karakeep' && item.source_item_id) {
      const karakeepId = item.source_item_id;

      if (KARAKEEP_WEEKLY_LIST_ID) {
        try {
          await addBookmarkToKarakeepList(KARAKEEP_WEEKLY_LIST_ID, karakeepId);
          console.log(`已将书签添加到 Karakeep 周刊列表: ${KARAKEEP_WEEKLY_LIST_ID}`);
        } catch (error) {
          console.error('添加到 Karakeep 周刊列表失败:', error);
        }
      }

      if (KARAKEEP_DRAFT_LIST_ID) {
        try {
          await removeBookmarkFromKarakeepList(KARAKEEP_DRAFT_LIST_ID, karakeepId);
          console.log(`已从 Karakeep Draft 列表移除书签: ${KARAKEEP_DRAFT_LIST_ID}`);
        } catch (error) {
          console.error('从 Karakeep Draft 列表移除失败:', error);
        }
      }

      try {
        await archiveKarakeepBookmark(karakeepId);
        console.log(`已在 Karakeep 中归档书签: ${karakeepId}`);
      } catch (error) {
        console.error('归档 Karakeep 书签失败:', error);
      }
    }

    // 更新数据源的晋升统计
    try {
      await DataSourceService.updateSourceStats(item.source_id, { increment_promoted: 1 });
    } catch (error) {
      console.error('更新数据源统计失败:', error);
    }

    return content;
  }

  static async batchAction(input: InboxBatchInput) {
    const ids = input.ids.map((id) => (typeof id === 'string' ? BigInt(id) : BigInt(id)));
    if (ids.length === 0) return { updated: 0 };

    if (input.action === 'reject') {
      const items = await prisma.inbox_items.findMany({
        where: { id: { in: ids } },
        select: {
          source_item_id: true,
          data_source: { select: { type: true } },
        },
      });
      const result = await prisma.inbox_items.updateMany({
        where: { id: { in: ids } },
        data: { status: 'rejected' },
      });

      const karakeepIds = items
        .filter((item) => item.data_source?.type === 'karakeep' && item.source_item_id)
        .map((item) => item.source_item_id as string);

      for (const karakeepId of karakeepIds) {
        await moveKarakeepBookmarkToWeekly(karakeepId);
      }

      return { updated: result.count };
    }

    if (input.action === 'mark_duplicate') {
      const result = await prisma.inbox_items.updateMany({
        where: { id: { in: ids } },
        data: { status: 'duplicate' },
      });
      return { updated: result.count };
    }

    const result = await prisma.inbox_items.updateMany({
      where: { id: { in: ids } },
      data: { status: 'pending' },
    });
    return { updated: result.count };
  }

  /**
   * 批量晋升收件箱条目为内容
   * @returns 成功/失败/跳过统计
   */
  static async batchPromote(input: InboxBatchPromoteInput) {
    const ids = input.ids.map((id) => (typeof id === 'string' ? BigInt(id) : BigInt(id)));
    if (ids.length === 0) return { promoted: 0, failed: 0, skipped: 0, errors: [] as string[] };

    const result = {
      promoted: 0,
      failed: 0,
      skipped: 0,
      errors: [] as string[],
      contentIds: [] as string[],
    };

    // 获取所有待晋升的条目
    const items = await prisma.inbox_items.findMany({
      where: { id: { in: ids } },
      select: { id: true, title: true, status: true, content_id: true },
    });

    for (const item of items) {
      // 跳过已晋升的
      if (item.status === 'promoted' || item.content_id) {
        result.skipped += 1;
        continue;
      }

      try {
        const content = await this.promoteInboxItem(item.id, {
          content_type_id: input.content_type_id,
          category_id: input.category_id,
          tag_ids: input.tag_ids,
          content_format: input.content_format,
        });
        result.promoted += 1;
        result.contentIds.push(content.id.toString());
      } catch (error) {
        result.failed += 1;
        const message = error instanceof Error ? error.message : String(error);
        result.errors.push(`[${item.id}] ${item.title || 'Untitled'}: ${message}`);
      }
    }

    return result;
  }
}
