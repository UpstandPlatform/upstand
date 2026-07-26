import { user } from "@upstand/db";
import type { CreateUserDTO, IUserRepository, User } from "@upstand/domain";
import { eq } from "drizzle-orm";
import { BaseRepository } from "../shared/base.repository";
import type { Executor } from "../shared/types";

export class DrizzleUserRepository
  extends BaseRepository<typeof user, User, CreateUserDTO>
  implements IUserRepository
{
  constructor(executor: Executor) {
    super(executor, user);
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.findOne(eq(user.email, email));
  }
}
