import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

interface AuthRequest extends Request {
  user?: { id: number; username: string };
}

export const authMiddleware = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    console.error('Auth error: No token provided');
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    if (!process.env.JWT_SECRET) {
      console.error('Auth error: JWT_SECRET not set');
      throw new Error('JWT_SECRET not set');
    }
    const decoded = jwt.verify(token, process.env.JWT_SECRET) as {
      id: number;
      username: string;
    };
    req.user = decoded;
    next();
  } catch (error: any) {
    console.error('Auth error:', error);
    return res
      .status(401)
      .json({ error: 'Invalid token', details: error.message });
  }
};
