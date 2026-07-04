﻿// Local-only mode  -  no login required.
// On first call, upserts the local user into the DB (satisfies all FK constraints).

import { prisma } from "@/lib/prisma";

export interface LocalUser {
  id: string;
  email: string;
  name: string;
  role: string;
  instagramAccountId: string | null;
  instagramToken: string | null;
}

export async function getServerSession(..._args: unknown[]): Promise<{ user: LocalUser }> {
  // Always read fresh from DB. On first run, create the local user. The legacy
  // instagramToken/instagramAccountId columns remain on the row (schema back-compat)
  // but are no longer seeded from env — this is a YouTube-only build.
  const BRAND_NAME = process.env.BRAND_NAME ?? "YouTubePilot AI";

  const user = await prisma.user.upsert({
    where: { id: "local-user" },
    update: {},
    create: {
      id:       "local-user",
      email:    "local@localhost",
      name:     `${BRAND_NAME} User`,
      password: "local-no-auth",
      role:     "ADMIN",
    },
  });

  return {
    user: {
      id:                 user.id,
      email:              user.email,
      name:               user.name ?? `${BRAND_NAME} User`,
      role:               user.role,
      instagramToken:     user.instagramToken,
      instagramAccountId: user.instagramAccountId,
    },
  };
}

// Kept for import compatibility
export const authOptions = {};

