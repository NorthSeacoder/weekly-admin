/**
 * Quail 发布服务
 * 用于将周刊发布到 Quail Newsletter 平台
 */

import { prisma } from '@/lib/db';
import {
  getQuailApi,
  isQuailConfigured,
  QuailPost,
  CreatePostRequest,
  QuailApiError,
  QuailChannel,
} from './quail-api';
import { DataSourceService } from './data-source';

export interface PublishResult {
  success: boolean;
  quailPostId?: string;
  quailPostSlug?: string;
  error?: string;
}

export interface PublishStatus {
  published: boolean;
  delivered: boolean;
  quailPostId?: string;
  quailPostSlug?: string;
  publishedAt?: Date;
  deliveredAt?: Date;
  error?: string;
}

export interface ChannelInfo {
  title: string;
  slug: string;
  description?: string;
  subscriberCount?: number;
  avatarUrl?: string;
}

/**
 * Quail 发布服务类
 */
export class QuailService {
  /**
   * 发布周刊到 Quail
   * 流程：创建/更新文章 → 发布 → 可选发送邮件
   */
  async publishWeekly(
    issueId: number,
    options?: {
      forceRepublish?: boolean;
      deliver?: boolean;
    }
  ): Promise<PublishResult> {
    try {
      // 检查配置
      if (!isQuailConfigured()) {
        return {
          success: false,
          error: 'Quail API 未配置',
        };
      }

      const quailApi = getQuailApi();

      // 获取周刊数据
      const issue = await prisma.weekly_issues.findUnique({
        where: { id: issueId },
        include: {
          weekly_content_items: {
            orderBy: { sort_order: 'asc' },
            include: {
              content: {
                include: {
                  categories: true,
                  content_tags: {
                    include: { tag: true },
                  },
                },
              },
            },
          },
        },
      });

      if (!issue) {
        return {
          success: false,
          error: '周刊不存在',
        };
      }

      // 检查是否已发布到 Quail
      if (issue.quail_post_slug && !options?.forceRepublish) {
        // 已存在，更新文章
        const postData = this.generateQuailContent(issue);
        await quailApi.updatePost(issue.quail_post_slug, postData);
        await prisma.weekly_issues.update({
          where: { id: issueId },
          data: {
            status: 'published',
            quail_publish_error: null,
          },
        });

        return {
          success: true,
          quailPostId: issue.quail_post_id || undefined,
          quailPostSlug: issue.quail_post_slug,
        };
      }

      // 生成 Quail 文章内容
      const postData = this.generateQuailContent(issue);

      // 创建文章
      const createResponse = await quailApi.createPost(postData);
      const post = createResponse.data;

      // 发布文章
      await quailApi.publishPost(post.slug);

      // 更新数据库
      await prisma.weekly_issues.update({
        where: { id: issueId },
        data: {
          status: 'published',
          quail_post_id: String(post.id),
          quail_post_slug: post.slug,
          quail_published_at: new Date(),
          quail_publish_error: null,
        },
      });

      // 可选：发送邮件
      if (options?.deliver) {
        try {
          await quailApi.deliverPost(post.slug);
          await prisma.weekly_issues.update({
            where: { id: issueId },
            data: { quail_delivered_at: new Date() },
          });
        } catch (deliverError) {
          console.error('Quail 邮件发送失败:', deliverError);
          // 邮件发送失败不影响发布结果
        }
      }

      // 更新各数据源的入刊统计
      await this.updateSourcePublishStats(issue);

      return {
        success: true,
        quailPostId: post.id,
        quailPostSlug: post.slug,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '发布失败';
      console.error('Quail 发布失败:', error);

      // 记录错误到数据库
      await prisma.weekly_issues.update({
        where: { id: issueId },
        data: { quail_publish_error: errorMessage },
      });

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * 发送邮件给订阅者（文章已发布的情况）
   */
  async deliverWeekly(issueId: number): Promise<PublishResult> {
    try {
      if (!isQuailConfigured()) {
        return { success: false, error: 'Quail API 未配置' };
      }

      const issue = await prisma.weekly_issues.findUnique({
        where: { id: issueId },
        select: { quail_post_slug: true },
      });

      if (!issue?.quail_post_slug) {
        return { success: false, error: '周刊尚未发布到 Quail' };
      }

      const quailApi = getQuailApi();
      await quailApi.deliverPost(issue.quail_post_slug);

      await prisma.weekly_issues.update({
        where: { id: issueId },
        data: { quail_delivered_at: new Date() },
      });

      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '发送失败';
      console.error('Quail 邮件发送失败:', error);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * 获取 Quail 发布历史
   */
  async getPublishHistory(options?: {
    page?: number;
    limit?: number;
  }): Promise<{
    posts: QuailPost[];
    total: number;
  }> {
    try {
      if (!isQuailConfigured()) {
        return { posts: [], total: 0 };
      }

      const quailApi = getQuailApi();
      const response = await quailApi.getPosts({
        page: options?.page || 1,
        limit: options?.limit || 20,
        public: true,
      });

      // Quail API 返回格式: { data: { pagination, items }, ts }
      const data = (response as any).data || response;

      return {
        posts: data.items || [],
        total: data.pagination?.total || 0,
      };
    } catch (error) {
      console.error('获取 Quail 发布历史失败:', error);
      return { posts: [], total: 0 };
    }
  }

  /**
   * 检查周刊的 Quail 发布状态
   */
  async checkPublishStatus(issueId: number): Promise<PublishStatus> {
    try {
      const issue = await prisma.weekly_issues.findUnique({
        where: { id: issueId },
        select: {
          quail_post_id: true,
          quail_post_slug: true,
          quail_published_at: true,
          quail_delivered_at: true,
          quail_publish_error: true,
        },
      });

      if (!issue) {
        return {
          published: false,
          delivered: false,
          error: '周刊不存在',
        };
      }

      return {
        published: !!issue.quail_published_at,
        delivered: !!issue.quail_delivered_at,
        quailPostId: issue.quail_post_id || undefined,
        quailPostSlug: issue.quail_post_slug || undefined,
        publishedAt: issue.quail_published_at || undefined,
        deliveredAt: issue.quail_delivered_at || undefined,
        error: issue.quail_publish_error || undefined,
      };
    } catch (error) {
      console.error('检查 Quail 发布状态失败:', error);
      return {
        published: false,
        delivered: false,
        error: error instanceof Error ? error.message : '检查失败',
      };
    }
  }

  /**
   * 获取频道信息
   */
  async getChannelInfo(): Promise<ChannelInfo | null> {
    try {
      if (!isQuailConfigured()) {
        return null;
      }

      const quailApi = getQuailApi();
      const response = await quailApi.getChannel();
      const channel = response.data;

      return {
        title: channel.title,
        slug: channel.slug,
        description: channel.description,
        subscriberCount: channel.subscriber_count,
        avatarUrl: channel.avatar_url,
      };
    } catch (error) {
      console.error('获取 Quail 频道信息失败:', error);
      return null;
    }
  }

  /**
   * 更新各数据源的入刊统计
   * 统计周刊中各内容来源的数据源，增加其 total_published 计数
   */
  private async updateSourcePublishStats(issue: any): Promise<void> {
    try {
      // 统计各数据源的入刊数量
      const sourceCountMap = new Map<number, number>();

      for (const item of issue.weekly_content_items) {
        const content = item.content;
        if (!content) continue;

        // 查找该内容对应的 inbox_item，获取其 source_id
        const inboxItem = await prisma.inbox_items.findFirst({
          where: { content_id: content.id },
          select: { source_id: true },
        });

        if (inboxItem) {
          const count = sourceCountMap.get(inboxItem.source_id) || 0;
          sourceCountMap.set(inboxItem.source_id, count + 1);
        }
      }

      // 更新各数据源的统计
      for (const [sourceId, count] of sourceCountMap) {
        await DataSourceService.updateSourceStats(sourceId, { increment_published: count });
      }
    } catch (error) {
      console.error('更新数据源入刊统计失败:', error);
      // 不抛出错误，避免影响发布流程
    }
  }

  /**
   * 生成周刊的 Quail 发布内容
   */
  private generateQuailContent(issue: any): CreatePostRequest {
    // 生成文章内容
    const contentParts: string[] = [];

    // 添加描述
    if (issue.desc) {
      contentParts.push(issue.desc);
      contentParts.push('\n\n---\n\n');
    }

    // 按分类组织内容
    const contentsBySection: Record<string, any[]> = {};
    for (const item of issue.weekly_content_items) {
      const section = item.section || '其他';
      if (!contentsBySection[section]) {
        contentsBySection[section] = [];
      }
      contentsBySection[section].push(item);
    }

    // 生成各分类内容
    for (const [section, items] of Object.entries(contentsBySection)) {
      contentParts.push(`## ${section}\n\n`);

      for (const item of items) {
        const content = item.content;
        contentParts.push(`### [${content.title}](${content.source_url || '#'})\n\n`);

        // 添加描述（简短介绍）
        if (content.description) {
          contentParts.push(`${content.description}\n\n`);
        }

        // 添加摘要（详细内容，已替代废弃的 content 字段）
        if (content.summary) {
          contentParts.push(`${content.summary}\n\n`);
        }

        // 添加标签
        const tags = content.content_tags?.map((ct: any) => ct.tag.name) || [];
        if (tags.length > 0) {
          contentParts.push(`标签: ${tags.map((t: string) => `\`${t}\``).join(' ')}\n\n`);
        }

        contentParts.push('---\n\n');
      }
    }

    // 收集所有标签
    const allTags = new Set<string>();
    for (const item of issue.weekly_content_items) {
      const tags = item.content.content_tags?.map((ct: any) => ct.tag.name) || [];
      tags.forEach((t: string) => allTags.add(t));
    }

    // 生成 Quail 友好的 slug（避免纯数字）
    const quailSlug = /^\d+$/.test(issue.slug)
      ? `weekly-${issue.slug}`
      : issue.slug;

    // Quail API 的 tags 字段是逗号分隔的字符串，不是数组
    const tagsString = Array.from(allTags).slice(0, 5).join(',');

    return {
      title: issue.title,
      slug: quailSlug,
      content: contentParts.join(''),
      summary: issue.desc || undefined,
      tags: tagsString || undefined,
    };
  }
}

// 导出单例实例
export const quailService = new QuailService();
