import type { CreateServerDTO, Server } from "../entities/server.entity";

export interface IServerRepository {
  findById(id: string): Promise<Server | null>;
  findByOrganizationId(organizationId: string): Promise<Server[]>;
  findMany(): Promise<Server[]>;
  create(data: CreateServerDTO): Promise<Server>;
  updateById(
    id: string,
    data: Partial<CreateServerDTO>,
  ): Promise<Server | null>;
  deleteById(id: string): Promise<boolean>;
}
