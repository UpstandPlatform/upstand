export type TwoFactorAdminUser = {
  id: string;
  name: string;
  email: string;
};

export interface ITwoFactorAdminRepository {
  findEnabledUsers(): Promise<TwoFactorAdminUser[]>;
  findUserByEmail(email: string): Promise<TwoFactorAdminUser | null>;
  resetForUser(userId: string): Promise<void>;
}
