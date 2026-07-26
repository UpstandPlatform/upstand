import type {
  CreateManagedUserInput,
  ManagedUser,
  ManagedUserProvisioner,
} from "@upstand/usecases";
import { auth } from "../auth";

export class BetterAuthManagedUserProvisioner
  implements ManagedUserProvisioner
{
  async createManagedUser(input: CreateManagedUserInput): Promise<ManagedUser> {
    const result = await auth.api.createUser({
      body: {
        email: input.email,
        name: input.name,
        password: input.password,
        role: "user",
        data: { managed: true },
      },
    });
    return {
      id: result.user.id,
      email: result.user.email,
      name: result.user.name,
    };
  }
}
