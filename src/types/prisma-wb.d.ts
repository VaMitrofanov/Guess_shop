/**
 * Temporary type shim for WbCode model until `prisma generate` is run locally.
 * DELETE this file after running: npx prisma generate
 */

import { PrismaClient } from "@prisma/client";

export interface WbCodeRow {
  id:                 string;
  code:               string;
  denomination:       number;
  isUsed:             boolean;
  usedAt:             Date | null;
  batch:              string | null;
  reviewBonusClaimed: boolean;
  userId:             string | null;
  createdAt:          Date;
}

export interface WbCodeCreateManyInput {
  code:               string;
  denomination:       number;
  batch?:             string;
  userId?:            string;
  reviewBonusClaimed?: boolean;
}

export interface WbCodeDelegate {
  findUnique(args: { where: { code?: string; id?: string } }): Promise<WbCodeRow | null>;
  update(args: { where: { id?: string; code?: string }; data: Partial<WbCodeRow> }): Promise<WbCodeRow>;
  createMany(args: { data: WbCodeCreateManyInput[]; skipDuplicates?: boolean }): Promise<{ count: number }>;
  groupBy(args: {
    by: string[];
    _count?: { id?: boolean };
    orderBy?: Record<string, string>;
  }): Promise<Array<{ denomination: number; isUsed: boolean; _count: { id: number } }>>;
}

/** Typed extension of PrismaClient that includes the WbCode delegate */
export type PrismaClientWithWb = PrismaClient & { wbCode: WbCodeDelegate };
