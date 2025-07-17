import { PrismaClient } from '@prisma/client';
import * as fs from 'fs/promises';
import * as path from 'path';
import { parse, sub } from 'date-fns';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

function parseRelativeDate(relativeDate: string): Date {
  const now = new Date();
  const [value, unit] = relativeDate.split(' ');
  const count = parseInt(value) || 1;

  if (unit.includes('month')) {
    return sub(now, { months: count });
  } else if (unit.includes('week')) {
    return sub(now, { weeks: count });
  } else if (unit.includes('day')) {
    return sub(now, { days: count });
  }
  return now;
}

async function seed() {
  try {
    const dataPath = path.join(__dirname, '../data.json');
    const rawData = await fs.readFile(dataPath, 'utf-8');
    const data = JSON.parse(rawData);
    const defaultPassword = await bcrypt.hash('password123', 10);

    // Seed currentUser
    await prisma.user.upsert({
      where: { username: data.currentUser.username },
      update: {},
      create: {
        username: data.currentUser.username,
        imagePng: data.currentUser.image.png,
        imageWebp: data.currentUser.image.webp,
        password: defaultPassword,
      },
    });

    // Seed other users
    for (const comment of data.comments) {
      await prisma.user.upsert({
        where: { username: comment.user.username },
        update: {},
        create: {
          username: comment.user.username,
          imagePng: comment.user.image.png,
          imageWebp: comment.user.image.webp,
          password: defaultPassword,
        },
      });
      for (const reply of comment.replies) {
        await prisma.user.upsert({
          where: { username: reply.user.username },
          update: {},
          create: {
            username: reply.user.username,
            imagePng: reply.user.image.png,
            imageWebp: reply.user.image.webp,
            password: defaultPassword,
          },
        });
      }
    }

    // Seed comments
    for (const comment of data.comments) {
      const user = await prisma.user.findUnique({
        where: { username: comment.user.username },
      });
      if (!user) throw new Error(`User ${comment.user.username} not found`);

      await prisma.comment.create({
        data: {
          content: comment.content,
          userId: user.id,
          score: comment.score,
          createdAt: parseRelativeDate(comment.createdAt),
          updatedAt: parseRelativeDate(comment.createdAt),
        },
      });

      // Seed replies
      for (const reply of comment.replies) {
        const replyUser = await prisma.user.findUnique({
          where: { username: reply.user.username },
        });
        if (!replyUser)
          throw new Error(`User ${reply.user.username} not found`);

        const parentComment = await prisma.comment.findFirst({
          where: { content: comment.content, userId: user.id },
        });
        if (!parentComment) throw new Error(`Parent comment not found`);

        await prisma.comment.create({
          data: {
            content: reply.content,
            userId: replyUser.id,
            parentId: parentComment.id,
            score: reply.score,
            replyingTo: reply.replyingTo,
            createdAt: parseRelativeDate(reply.createdAt),
            updatedAt: parseRelativeDate(reply.createdAt),
          },
        });
      }
    }

    console.log('Database seeded successfully');
  } catch (error: any) {
    console.error('Error seeding database:', error);
  } finally {
    await prisma.$disconnect();
  }
}

seed();
