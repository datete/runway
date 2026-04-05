import { PrismaClient } from "@prisma/client";

// Singleton PrismaClient — all API modules must import from here
export const prisma = new PrismaClient();
