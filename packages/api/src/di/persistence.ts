import * as dependencies from "./dependencies";

type ServiceCollection = InstanceType<typeof dependencies.ServiceCollection>;

export function registerPersistence(services: ServiceCollection) {
  // 1. Database Infrastructure
  services.addSingleton(dependencies.DbToken, () => dependencies.db);
  services.addScoped(
    dependencies.AIRepositoryToken,
    (c) =>
      new dependencies.DrizzleAIRepository(c.resolve(dependencies.DbToken)),
  );
  services.addSingleton(
    dependencies.CaddyServiceToken,
    () => new dependencies.CaddyService(),
  );
  services.addSingleton(
    dependencies.DockerServiceToken,
    () => new dependencies.DockerService(),
  );
  services.addSingleton(
    dependencies.DockerInventoryReaderToken,
    () => new dependencies.DockerReadOnlyService(),
  );
  services.addSingleton(
    dependencies.DockerContainerControllerToken,
    () => new dependencies.DockerReadOnlyService(),
  );
  services.addSingleton(
    dependencies.DockerResourceControllerToken,
    () => new dependencies.DockerReadOnlyService(),
  );
  services.addSingleton(
    dependencies.DockerPruneToken,
    () => new dependencies.DockerReadOnlyService(),
  );
  services.addSingleton(
    dependencies.DockerExecToken,
    () => new dependencies.DockerReadOnlyService(),
  );
  services.addSingleton(
    dependencies.DockerArchiveTransferToken,
    () => new dependencies.DockerReadOnlyService(),
  );
  services.addSingleton(
    dependencies.NotificationTransportToken,
    () => dependencies.AuthNotificationTransport,
  );

  // 2. Repositories (scoped per request)
  services.addScoped(dependencies.UserRepositoryToken, (c) => {
    const executor = c.resolve(dependencies.DbToken);
    return new dependencies.DrizzleUserRepository(executor);
  });
  services.addScoped(
    dependencies.ProjectRepositoryToken,
    (c) =>
      new dependencies.DrizzleProjectRepository(
        c.resolve(dependencies.DbToken),
      ),
  );
  services.addScoped(
    dependencies.TagRepositoryToken,
    (c) =>
      new dependencies.DrizzleTagRepository(c.resolve(dependencies.DbToken)),
  );
  services.addScoped(
    dependencies.TemplateRepositoryToken,
    (c) =>
      new dependencies.DrizzleTemplateRepository(
        c.resolve(dependencies.DbToken),
      ),
  );
  services.addScoped(
    dependencies.EnvironmentRepositoryToken,
    (c) =>
      new dependencies.DrizzleEnvironmentRepository(
        c.resolve(dependencies.DbToken),
      ),
  );
  services.addScoped(
    dependencies.BackupScheduleRepositoryToken,
    (c) =>
      new dependencies.DrizzleBackupScheduleRepository(
        c.resolve(dependencies.DbToken),
      ),
  );
  services.addScoped(
    dependencies.BackupRunRepositoryToken,
    (c) =>
      new dependencies.DrizzleBackupRunRepository(
        c.resolve(dependencies.DbToken),
      ),
  );
  services.addScoped(
    dependencies.CertificateRepositoryToken,
    (c) =>
      new dependencies.DrizzleCertificateRepository(
        c.resolve(dependencies.DbToken),
      ),
  );
  services.addScoped(
    dependencies.ResourceRepositoryToken,
    (c) =>
      new dependencies.DrizzleResourceRepository(
        c.resolve(dependencies.DbToken),
      ),
  );
  services.addScoped(
    dependencies.SshKeyRepositoryToken,
    (c) =>
      new dependencies.DrizzleSshKeyRepository(c.resolve(dependencies.DbToken)),
  );
  services.addScoped(
    dependencies.GitProviderRepositoryToken,
    (c) =>
      new dependencies.DrizzleGitProviderRepository(
        c.resolve(dependencies.DbToken),
      ),
  );
  services.addScoped(
    dependencies.S3DestinationRepositoryToken,
    (c) =>
      new dependencies.DrizzleS3DestinationRepository(
        c.resolve(dependencies.DbToken),
      ),
  );
  services.addScoped(
    dependencies.WebServerSettingsRepositoryToken,
    (c) =>
      new dependencies.DrizzleWebServerSettingsRepository(
        c.resolve(dependencies.DbToken),
      ),
  );
  services.addSingleton(
    dependencies.ExternalSecretProviderToken,
    () => new dependencies.SecretProviderRegistry(),
  );
  services.addScoped(
    dependencies.SecretVersionRepositoryToken,
    (c) =>
      new dependencies.DrizzleSecretVersionRepository(
        c.resolve(dependencies.DbToken),
      ),
  );
  services.addScoped(
    dependencies.SecretProviderRepositoryToken,
    (c) =>
      new dependencies.DrizzleSecretProviderRepository(
        c.resolve(dependencies.DbToken),
      ),
  );
  services.addScoped(
    dependencies.NotificationChannelRepositoryToken,
    (c) =>
      new dependencies.DrizzleNotificationChannelRepository(
        c.resolve(dependencies.DbToken),
      ),
  );
  services.addScoped(
    dependencies.NotificationDeliveryRepositoryToken,
    (c) =>
      new dependencies.DrizzleNotificationDeliveryRepository(
        c.resolve(dependencies.DbToken),
      ),
  );
  services.addScoped(
    dependencies.MonitoringSettingsRepositoryToken,
    (c) =>
      new dependencies.DrizzleMonitoringSettingsRepository(
        c.resolve(dependencies.DbToken),
      ),
  );

  // 3. Unit of Work (scoped per request)
  services.addScoped(dependencies.UnitOfWorkToken, (c) => {
    const executor = c.resolve(dependencies.DbToken);
    return new dependencies.DrizzleUnitOfWork(executor);
  });

  services.addTransient(
    dependencies.CreateAuditLogUseCaseToken,
    (c) =>
      new dependencies.CreateAuditLogUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.ListAuditLogsUseCaseToken,
    (c) =>
      new dependencies.ListAuditLogsUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
}
