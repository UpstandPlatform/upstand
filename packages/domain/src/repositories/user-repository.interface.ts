import type { CreateUserDTO, User } from "../entities/user";

export interface IUserRepository {
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  count(): Promise<number>;
  create(data: CreateUserDTO): Promise<User>;
}
