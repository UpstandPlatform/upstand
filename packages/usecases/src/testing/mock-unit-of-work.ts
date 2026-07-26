import type { IUnitOfWork } from "@upstand/domain";

export function mockUnitOfWork<T extends object>(
  overrides = {} as T,
): IUnitOfWork & T {
  const emptyRepository = () => ({});
  const uow = {
    auditLogRepository: emptyRepository(),
    backupScheduleRepository: emptyRepository(),
    certificateRepository: emptyRepository(),
    backupRunRepository: emptyRepository(),
    userRepository: emptyRepository(),
    projectRepository: emptyRepository(),
    tagRepository: emptyRepository(),
    templateRepository: emptyRepository(),
    environmentRepository: emptyRepository(),
    resourceRepository: emptyRepository(),
    resourceRuntimeRepository: emptyRepository(),
    sshKeyRepository: emptyRepository(),
    gitProviderRepository: emptyRepository(),
    webServerSettingsRepository: emptyRepository(),
    s3DestinationRepository: emptyRepository(),
    serverBuildSettingsRepository: emptyRepository(),
    deploymentRepository: emptyRepository(),
    dockerRegistryRepository: emptyRepository(),
    serverRepository: emptyRepository(),
    notificationChannelRepository: emptyRepository(),
    notificationDeliveryRepository: emptyRepository(),
    monitoringSettingsRepository: emptyRepository(),
    previewDeploymentRepository: emptyRepository(),
    scheduleRepository: emptyRepository(),
    outboxRepository: emptyRepository(),
    transaction: async (work: (unitOfWork: IUnitOfWork) => Promise<unknown>) =>
      work(uow),
    ...overrides,
  } as IUnitOfWork & T;

  return uow;
}
