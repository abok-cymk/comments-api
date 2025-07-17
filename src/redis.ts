import { createClient } from 'redis';

const redisClient = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
});

redisClient.on('error', (err) => console.error('Redis Client Error', err));

redisClient
  .connect()
  .catch((err) => console.error('Redis Connection Error', err));

export async function getCachedData<T>(key: string): Promise<T | null> {
  try {
    const data = await redisClient.get(key);
    return data ? JSON.parse(data) : null;
  } catch (error) {
    console.error('Redis get error:', error);
    return null;
  }
}

export async function setCachedData<T>(
  key: string,
  data: T,
  expirySeconds = 3600
): Promise<void> {
  try {
    await redisClient.setEx(key, expirySeconds, JSON.stringify(data));
  } catch (error) {
    console.error('Redis set error:', error);
  }
}

export async function clearCache(pattern: string): Promise<void> {
  try {
    const keys = await redisClient.keys(pattern);
    if (keys.length > 0) {
      await redisClient.del(keys);
    }
  } catch (error) {
    console.error('Redis clear cache error:', error);
  }
}

export default redisClient;
