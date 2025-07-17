import express, { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import DOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';
import rateLimit from 'express-rate-limit';
import cors from 'cors';
import { authMiddleware } from './middleware/auth';
import {
  createCommentSchema,
  updateCommentSchema,
  voteCommentSchema,
} from './validation/comment';
import { getCachedData, setCachedData, clearCache } from './redis';

const app = express();
const PORT = process.env.PORT || 3000;
const prisma = new PrismaClient();
const { window } = new JSDOM('');
const domPurify = DOMPurify(window);

// CORS configuration
const corsOptions = {
  origin: 'http://localhost:5173/comments-frontend', // Allow frontend origin
  credentials: true, // Allow cookies/auth headers
};
app.use(cors(corsOptions));

// Rate limiter: 100 requests per 15 minutes per IP
const commentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: { error: 'Too many requests, please try again later.' },
});

app.use(express.json());

app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ message: 'API is running' });
});

app.post('/register', async (req: Request, res: Response) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const existingUser = await prisma.user.findFirst({
      where: { OR: [{ username }, { email }] },
    });
    if (existingUser) {
      return res
        .status(400)
        .json({ error: 'Username or email already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        username,
        email,
        password: hashedPassword,
      },
    });

    const token = jwt.sign(
      { id: user.id, username: user.username },
      process.env.JWT_SECRET!,
      {
        expiresIn: '1h',
      }
    );

    res
      .status(201)
      .json({
        token,
        user: { id: user.id, username: user.username, email: user.email },
      });
  } catch (error: any) {
    console.error('Register error:', error);
    res
      .status(500)
      .json({ error: 'Failed to register user', details: error.message });
  }
});

app.post('/login', async (req: Request, res: Response) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { username },
    });
    if (!user || !user.password) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username },
      process.env.JWT_SECRET!,
      {
        expiresIn: '1h',
      }
    );

    res
      .status(200)
      .json({
        token,
        user: { id: user.id, username: user.username, email: user.email },
      });
  } catch (error: any) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Failed to login', details: error.message });
  }
});

app.post(
  '/comments',
  authMiddleware,
  commentLimiter,
  async (req: Request, res: Response) => {
    try {
      const parsed = createCommentSchema.parse(req.body);
      const sanitizedContent = domPurify.sanitize(parsed.content);
      const user = (req as any).user;
      if (!user) {
        throw new Error('User not authenticated');
      }

      const comment = await prisma.comment.create({
        data: {
          content: sanitizedContent,
          userId: user.id,
          parentId: parsed.parentId || null,
          replyingTo: parsed.replyingTo || null,
          score: 0,
        },
        include: {
          user: true,
          replies: true,
        },
      });

      // Invalidate cache for comments
      await clearCache('comments:*');

      res.status(201).json(comment);
    } catch (error: any) {
      console.error('Create comment error:', error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res
        .status(500)
        .json({ error: 'Failed to create comment', details: error.message });
    }
  }
);

app.get('/comments', authMiddleware, async (req: Request, res: Response) => {
  try {
    const cacheKey = 'comments:all';
    const cachedComments = await getCachedData<any[]>(cacheKey);
    if (cachedComments) {
      return res.status(200).json(cachedComments);
    }

    const comments = await prisma.comment.findMany({
      where: { parentId: null },
      include: {
        user: true,
        replies: {
          include: { user: true },
        },
      },
    });

    await setCachedData(cacheKey, comments);
    res.status(200).json(comments);
  } catch (error: any) {
    console.error('Get comments error:', error);
    res
      .status(500)
      .json({ error: 'Failed to fetch comments', details: error.message });
  }
});

app.get(
  '/comments/:id',
  authMiddleware,
  async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const cacheKey = `comments:${id}`;
      const cachedComment = await getCachedData<any>(cacheKey);
      if (cachedComment) {
        return res.status(200).json(cachedComment);
      }

      const comment = await prisma.comment.findUnique({
        where: { id },
        include: {
          user: true,
          replies: {
            include: { user: true },
          },
        },
      });
      if (!comment) {
        return res.status(404).json({ error: 'Comment not found' });
      }

      await setCachedData(cacheKey, comment);
      res.status(200).json(comment);
    } catch (error: any) {
      console.error('Get comment error:', error);
      res
        .status(500)
        .json({ error: 'Failed to fetch comment', details: error.message });
    }
  }
);

app.put(
  '/comments/:id',
  authMiddleware,
  commentLimiter,
  async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const parsed = updateCommentSchema.parse(req.body);
      const sanitizedContent = domPurify.sanitize(parsed.content);
      const user = (req as any).user;

      const comment = await prisma.comment.findUnique({ where: { id } });
      if (!comment) {
        return res.status(404).json({ error: 'Comment not found' });
      }
      if (comment.userId !== user.id) {
        return res
          .status(403)
          .json({ error: 'Not authorized to update this comment' });
      }

      const updatedComment = await prisma.comment.update({
        where: { id },
        data: { content: sanitizedContent },
        include: {
          user: true,
          replies: true,
        },
      });

      // Invalidate cache for this comment and all comments
      await clearCache(`comments:${id}`);
      await clearCache('comments:*');

      res.status(200).json(updatedComment);
    } catch (error: any) {
      console.error('Update comment error:', error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res
        .status(500)
        .json({ error: 'Failed to update comment', details: error.message });
    }
  }
);

app.delete(
  '/comments/:id',
  authMiddleware,
  commentLimiter,
  async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const user = (req as any).user;

      const comment = await prisma.comment.findUnique({ where: { id } });
      if (!comment) {
        return res.status(404).json({ error: 'Comment not found' });
      }
      if (comment.userId !== user.id) {
        return res
          .status(403)
          .json({ error: 'Not authorized to delete this comment' });
      }

      await prisma.comment.delete({ where: { id } });

      // Invalidate cache for this comment and all comments
      await clearCache(`comments:${id}`);
      await clearCache('comments:*');

      res.status(204).send();
    } catch (error: any) {
      console.error('Delete comment error:', error);
      res
        .status(500)
        .json({ error: 'Failed to delete comment', details: error.message });
    }
  }
);

app.post(
  '/comments/:id/vote',
  authMiddleware,
  commentLimiter,
  async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const parsed = voteCommentSchema.parse(req.body);
      const user = (req as any).user;

      const comment = await prisma.comment.findUnique({ where: { id } });
      if (!comment) {
        return res.status(404).json({ error: 'Comment not found' });
      }

      const existingVote = await prisma.vote.findUnique({
        where: {
          userId_commentId: { userId: user.id, commentId: id },
        },
      });

      let scoreChange = 0;
      if (existingVote) {
        if (existingVote.voteType === parsed.vote) {
          return res
            .status(400)
            .json({
              error: `You already voted ${parsed.vote} on this comment`,
            });
        }
        // Change vote (e.g., up to down or down to up)
        scoreChange = parsed.vote === 'up' ? 2 : -2; // Reverse previous vote and apply new
        await prisma.vote.update({
          where: { id: existingVote.id },
          data: { voteType: parsed.vote },
        });
      } else {
        // New vote
        scoreChange = parsed.vote === 'up' ? 1 : -1;
        await prisma.vote.create({
          data: {
            userId: user.id,
            commentId: id,
            voteType: parsed.vote,
          },
        });
      }

      const updatedComment = await prisma.comment.update({
        where: { id },
        data: { score: { increment: scoreChange } },
        include: {
          user: true,
          replies: true,
        },
      });

      // Invalidate cache for this comment and all comments
      await clearCache(`comments:${id}`);
      await clearCache('comments:*');

      res.status(200).json(updatedComment);
    } catch (error: any) {
      console.error('Vote comment error:', error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res
        .status(500)
        .json({ error: 'Failed to vote on comment', details: error.message });
    }
  }
);

app.listen(PORT, async () => {
  console.log(`Server is running on port ${PORT}`);
});
