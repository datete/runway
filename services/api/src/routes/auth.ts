import { Router, Request, Response } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { prisma } from "../services/prisma";
import { authMiddleware, JWT_SECRET } from "../middleware/auth";

const router = Router();

// POST /api/runway/auth/login
router.post("/login", async (req: Request, res: Response) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "用户名和密码必填" });
  }

  try {
    const user = await prisma.user.findUnique({ where: { username } });
    if (!user) return res.status(401).json({ error: "用户名或密码错误" });

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(401).json({ error: "用户名或密码错误" });

    if (!user.isActive) return res.status(403).json({ error: "账号已被禁用，请联系管理员" });

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: "24h" }
    );

    // 记录登录日志
    await prisma.userLog.create({
      data: {
        userId: user.id,
        action: "login",
        ip: (req.headers["x-forwarded-for"] as string)?.split(",")[0] || req.socket.remoteAddress || "",
      },
    }).catch(() => {});

    res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/runway/auth/me
router.get("/me", authMiddleware, async (req: Request, res: Response) => {
  res.json(req.user);
});

export { router as authRouter };
