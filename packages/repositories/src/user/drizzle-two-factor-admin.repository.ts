import { twoFactor, user } from "@upstand/db/schema/auth";
import type {
  ITwoFactorAdminRepository,
  TwoFactorAdminUser,
} from "@upstand/domain";
import { eq } from "drizzle-orm";
import type { Executor } from "../shared/types";

export class DrizzleTwoFactorAdminRepository
  implements ITwoFactorAdminRepository
{
  constructor(private readonly executor: Executor) {}

  async findEnabledUsers(): Promise<TwoFactorAdminUser[]> {
    return this.executor
      .select({ id: user.id, name: user.name, email: user.email })
      .from(user)
      .where(eq(user.twoFactorEnabled, true));
  }

  async findUserByEmail(email: string): Promise<TwoFactorAdminUser | null> {
    const [row] = await this.executor
      .select({ id: user.id, name: user.name, email: user.email })
      .from(user)
      .where(eq(user.email, email.trim().toLowerCase()))
      .limit(1);
    return row ?? null;
  }

  async resetForUser(userId: string): Promise<void> {
    await this.executor.transaction(async (tx) => {
      await tx
        .update(user)
        .set({ twoFactorEnabled: false })
        .where(eq(user.id, userId));
      await tx.delete(twoFactor).where(eq(twoFactor.userId, userId));
    });
  }
}
