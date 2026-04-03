import { prisma } from "./prisma";

interface DeviceInfo {
  fingerprint: string;
  deviceName?: string;
  browser?: string;
  os?: string;
}

interface LoginContext {
  userId: string;
  ip: string;
  userAgent?: string;
  device?: DeviceInfo;
}

export class DeviceService {

  /**
   * Track device and login session. Returns { device, session, isNewDevice, isSuspicious, reason }
   */
  static async trackLogin(ctx: LoginContext) {
    const { userId, ip, userAgent, device } = ctx;
    let deviceRecord = null;
    let isNewDevice = false;
    let isSuspicious = false;
    let suspiciousReason = "";

    // 1. Track device if fingerprint provided
    if (device?.fingerprint) {
      const existing = await prisma.userDevice.findUnique({
        where: { userId_fingerprint: { userId, fingerprint: device.fingerprint } },
      });

      if (existing) {
        // Known device — update last seen
        if (existing.isBlocked) {
          throw new Error("该设备已被禁止登录，请联系管理员");
        }
        deviceRecord = await prisma.userDevice.update({
          where: { id: existing.id },
          data: { lastSeenAt: new Date(), lastIp: ip },
        });
      } else {
        // New device — check device limit + create in a transaction to prevent races
        const txResult = await prisma.$transaction(async (tx) => {
          const user = await tx.user.findUnique({ where: { id: userId }, select: { maxDevices: true } });
          const maxDevices = user?.maxDevices ?? 3;
          const deviceCount = await tx.userDevice.count({ where: { userId, isBlocked: false } });

          if (maxDevices > 0 && deviceCount >= maxDevices) {
            // Check if any trusted devices exist — if so, block new device
            const trustedCount = await tx.userDevice.count({ where: { userId, isTrusted: true } });
            if (trustedCount > 0) {
              throw new Error(`设备数量已达上限(${maxDevices}个)，请联系管理员添加新设备`);
            }
            // No trusted devices yet — auto-trust this one (first-time setup)
          }

          const newDevice = await tx.userDevice.create({
            data: {
              userId,
              fingerprint: device.fingerprint,
              deviceName: device.deviceName,
              browser: device.browser,
              os: device.os,
              lastIp: ip,
              isTrusted: deviceCount === 0, // First device is auto-trusted
            },
          });
          return { newDevice, deviceCount };
        }, { isolationLevel: "Serializable" });

        deviceRecord = txResult.newDevice;
        isNewDevice = true;
        if (txResult.deviceCount > 0) {
          isSuspicious = true;
          suspiciousReason = `新设备登录: ${device.browser || "未知浏览器"} / ${device.os || "未知系统"}`;
        }
      }
    }

    // 2. Check IP risk — compare with recent IPs
    const recentSessions = await prisma.loginSession.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { ip: true, createdAt: true },
    });

    const knownIPs = new Set(recentSessions.map(s => s.ip));
    if (recentSessions.length > 0 && !knownIPs.has(ip)) {
      isSuspicious = true;
      suspiciousReason = suspiciousReason
        ? suspiciousReason + "; 新IP: " + ip
        : "新IP登录: " + ip;
    }

    // 3. Create login session record
    const session = await prisma.loginSession.create({
      data: {
        userId,
        deviceId: deviceRecord?.id,
        ip,
        userAgent,
        isSuspicious,
        suspiciousReason: suspiciousReason || null,
      },
    });

    return { device: deviceRecord, session, isNewDevice, isSuspicious, suspiciousReason };
  }

  /** Get all devices for a user */
  static async getUserDevices(userId: string) {
    return prisma.userDevice.findMany({
      where: { userId },
      orderBy: { lastSeenAt: "desc" },
    });
  }

  /** Get recent login sessions for a user */
  static async getUserSessions(userId: string, limit = 20) {
    return prisma.loginSession.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: { device: { select: { fingerprint: true, deviceName: true, browser: true, os: true } } },
    });
  }

  /** Admin: get all suspicious sessions */
  static async getSuspiciousSessions(limit = 50) {
    return prisma.loginSession.findMany({
      where: { isSuspicious: true },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        user: { select: { id: true, username: true } },
        device: { select: { deviceName: true, browser: true, os: true } },
      },
    });
  }

  /** Admin: trust or block a device */
  static async updateDeviceStatus(deviceId: string, action: "trust" | "block" | "unblock") {
    const data = action === "trust"   ? { isTrusted: true, isBlocked: false }
               : action === "block"   ? { isBlocked: true, isTrusted: false }
               :                        { isBlocked: false };
    return prisma.userDevice.update({ where: { id: deviceId }, data });
  }

  /** Admin: remove a device */
  static async removeDevice(deviceId: string) {
    return prisma.userDevice.delete({ where: { id: deviceId } });
  }

  /** Admin: get all devices for all users (with user info) */
  static async getAllDevices() {
    return prisma.userDevice.findMany({
      orderBy: { lastSeenAt: "desc" },
      include: { user: { select: { id: true, username: true } } },
    });
  }
}
