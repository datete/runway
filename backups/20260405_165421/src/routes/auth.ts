import { Router, Request, Response } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { prisma } from "../services/prisma";
import { authMiddleware, JWT_SECRET } from "../middleware/auth";
import { DeviceService } from "../services/device.service";

// Simple rate limiter for login
const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const LOGIN_RATE_LIMIT = 5; // max attempts
const LOGIN_RATE_WINDOW = 60000; // 1 minute

function checkLoginRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || now > entry.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + LOGIN_RATE_WINDOW });
    return true;
  }
  entry.count++;
  return entry.count <= LOGIN_RATE_LIMIT;
}

// Clean up old entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of loginAttempts) {
    if (now > entry.resetAt) loginAttempts.delete(ip);
  }
}, 300000);

const router = Router();

// POST /api/runway/auth/login
router.post("/login", async (req: Request, res: Response) => {
  const clientIp = req.ip || req.connection.remoteAddress || 'unknown';
  if (!checkLoginRateLimit(clientIp)) {
    return res.status(429).json({ error: '登录尝试过于频繁，请稍后再试' });
  }

  const { username, password, device } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "用户名和密码必填" });
  }

  try {
    const user = await prisma.user.findUnique({ where: { username } });
    if (!user) return res.status(401).json({ error: "用户名或密码错误" });

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(401).json({ error: "用户名或密码错误" });

    if (!user.isActive) return res.status(403).json({ error: "账号已被禁用，请联系管理员" });

    const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket.remoteAddress || "";

    // Track device and IP
    let deviceResult;
    try {
      deviceResult = await DeviceService.trackLogin({
        userId: user.id,
        ip,
        userAgent: req.headers["user-agent"],
        device: device ? {
          fingerprint: device.fingerprint,
          deviceName: device.deviceName,
          browser: device.browser,
          os: device.os,
        } : undefined,
      });
    } catch (deviceErr: any) {
      return res.status(403).json({ error: deviceErr.message });
    }

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
        ip,
        detail: deviceResult?.isNewDevice ? "新设备" : undefined,
      },
    }).catch(() => {});

    res.json({
      token,
      user: { id: user.id, username: user.username, role: user.role },
      isNewDevice: deviceResult?.isNewDevice,
      isSuspicious: deviceResult?.isSuspicious,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/runway/auth/me
router.get("/me", authMiddleware, async (req: Request, res: Response) => {
  res.json(req.user);
});

// GET /api/runway/auth/devices — list my devices
router.get("/devices", authMiddleware, async (req: Request, res: Response) => {
  try {
    const devices = await DeviceService.getUserDevices(req.user!.id);
    res.json(devices);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/runway/auth/sessions — list my login sessions
router.get("/sessions", authMiddleware, async (req: Request, res: Response) => {
  try {
    const sessions = await DeviceService.getUserSessions(req.user!.id);
    res.json(sessions);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});



// POST /api/runway/auth/change-password
router.post("/change-password", authMiddleware, async (req: Request, res: Response) => {
  const { oldPassword, newPassword } = req.body;
  if (!oldPassword || !newPassword) {
    return res.status(400).json({ error: "请输入当前密码和新密码" });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ error: "新密码至少6位" });
  }
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) return res.status(404).json({ error: "用户不存在" });

    const valid = await bcrypt.compare(oldPassword, user.passwordHash);
    if (!valid) return res.status(401).json({ error: "当前密码错误" });

    const hash = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: hash } });

    await prisma.userLog.create({
      data: { userId: user.id, action: "change_password", ip: (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket.remoteAddress || "" },
    }).catch(() => {});

    res.json({ success: true, message: "密码修改成功" });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/runway/auth/devices/:id — admin-only device unbind
router.delete("/devices/:id", authMiddleware, async (req: Request, res: Response) => {
  try {
    if (req.user!.role !== 'admin') {
      return res.status(403).json({ error: "只有管理员可以解绑设备，请联系管理员" });
    }
    const deviceId = req.params.id;
    await DeviceService.removeDevice(deviceId);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export { router as authRouter };
