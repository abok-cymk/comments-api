import { z } from 'zod';

export const createCommentSchema = z.object({
  content: z
    .string()
    .min(1, 'Comment content is required')
    .max(1000, 'Comment content is too long'),
  parentId: z.number().int().positive().nullable().optional(),
  replyingTo: z.string().nullable().optional(),
});

export const updateCommentSchema = z.object({
  content: z
    .string()
    .min(1, 'Comment content is required')
    .max(1000, 'Comment content is too long'),
});

export const voteCommentSchema = z.object({
  vote: z.enum(['up', 'down']),
});
