export type ManagedUser = {
  id: string;
  email: string;
  name: string;
};

export type CreateManagedUserInput = {
  email: string;
  name: string;
  password: string;
};

export interface ManagedUserProvisioner {
  createManagedUser(input: CreateManagedUserInput): Promise<ManagedUser>;
}
