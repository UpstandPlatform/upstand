import * as dependencies from "./dependencies";

type ServiceCollection = InstanceType<typeof dependencies.ServiceCollection>;

export function registerRuntime(services: ServiceCollection) {
  // Swarm registrations
  services.addTransient(
    dependencies.InitSwarmUseCaseToken,
    () => new dependencies.InitSwarmUseCase(),
  );
  services.addTransient(
    dependencies.GetSwarmInfoUseCaseToken,
    () => new dependencies.GetSwarmInfoUseCase(),
  );
  services.addTransient(
    dependencies.GetSwarmNodesUseCaseToken,
    () => new dependencies.GetSwarmNodesUseCase(),
  );
  services.addTransient(
    dependencies.UpdateSwarmNodeUseCaseToken,
    () => new dependencies.UpdateSwarmNodeUseCase(),
  );
  services.addTransient(
    dependencies.RemoveSwarmNodeUseCaseToken,
    () => new dependencies.RemoveSwarmNodeUseCase(),
  );
  services.addTransient(
    dependencies.GetSwarmJoinCommandsUseCaseToken,
    () => new dependencies.GetSwarmJoinCommandsUseCase(),
  );
  services.addTransient(
    dependencies.RotateSwarmJoinTokenUseCaseToken,
    () => new dependencies.RotateSwarmJoinTokenUseCase(),
  );

  services.addTransient(
    dependencies.GetDeploymentsUseCaseToken,
    (c) =>
      new dependencies.GetDeploymentsUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.ReconcileStaleDeploymentsUseCaseToken,
    (c) =>
      new dependencies.ReconcileStaleDeploymentsUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.GetQueueUseCaseToken,
    (c) =>
      new dependencies.GetQueueUseCase(c.resolve(dependencies.UnitOfWorkToken)),
  );
  services.addTransient(
    dependencies.GetRequestsUseCaseToken,
    (c) =>
      new dependencies.GetRequestsUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
        c.resolve(dependencies.GetDeploymentsUseCaseToken),
        c.resolve(dependencies.GetQueueUseCaseToken),
      ),
  );
  services.addTransient(
    dependencies.GlobalSearchUseCaseToken,
    (c) =>
      new dependencies.GlobalSearchUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.UpdateConcurrencyUseCaseToken,
    (c) =>
      new dependencies.UpdateConcurrencyUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );

  // Docker Registry registrations
  services.addTransient(
    dependencies.CreateDockerRegistryUseCaseToken,
    (c) =>
      new dependencies.CreateDockerRegistryUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.DeleteDockerRegistryUseCaseToken,
    (c) =>
      new dependencies.DeleteDockerRegistryUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.GetDockerRegistriesUseCaseToken,
    (c) =>
      new dependencies.GetDockerRegistriesUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.TestDockerRegistryConnectionUseCaseToken,
    () => new dependencies.TestDockerRegistryConnectionUseCase(),
  );
  services.addTransient(
    dependencies.UpdateDockerRegistryUseCaseToken,
    (c) =>
      new dependencies.UpdateDockerRegistryUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );

  // Server registrations
  services.addTransient(
    dependencies.CreateServerUseCaseToken,
    (c) =>
      new dependencies.CreateServerUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.DeleteServerUseCaseToken,
    (c) =>
      new dependencies.DeleteServerUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.GetServersUseCaseToken,
    (c) =>
      new dependencies.GetServersUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.SetupServerUseCaseToken,
    (c) =>
      new dependencies.SetupServerUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
        dependencies.createServerProvisioningPort(),
      ),
  );
  services.addTransient(
    dependencies.ScanServerHostKeyUseCaseToken,
    () => new dependencies.ScanServerHostKeyUseCase(),
  );
  services.addTransient(
    dependencies.GetServerHistoricalMetricsUseCaseToken,
    (c) =>
      new dependencies.GetServerHistoricalMetricsUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.GetServerMonitoringStatusUseCaseToken,
    (c) =>
      new dependencies.GetServerMonitoringStatusUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.UpdateMonitoringSettingsUseCaseToken,
    (c) =>
      new dependencies.UpdateMonitoringSettingsUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.GetServerCountUseCaseToken,
    (c) =>
      new dependencies.GetServerCountUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.GetServerUseCaseToken,
    (c) =>
      new dependencies.GetServerUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.UpdateServerUseCaseToken,
    (c) =>
      new dependencies.UpdateServerUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );

  // Swarm Containers registration
  services.addTransient(
    dependencies.GetSwarmContainersUseCaseToken,
    () => new dependencies.GetSwarmContainersUseCase(),
  );

  // Notifications
  services.addTransient(
    dependencies.CreateNotificationChannelUseCaseToken,
    (c) =>
      new dependencies.CreateNotificationChannelUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.GetNotificationChannelsUseCaseToken,
    (c) =>
      new dependencies.GetNotificationChannelsUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.UpdateNotificationChannelUseCaseToken,
    (c) =>
      new dependencies.UpdateNotificationChannelUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.DeleteNotificationChannelUseCaseToken,
    (c) =>
      new dependencies.DeleteNotificationChannelUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.TestNotificationChannelUseCaseToken,
    (c) =>
      new dependencies.TestNotificationChannelUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
        c.resolve(dependencies.NotificationTransportToken),
      ),
  );
  services.addTransient(
    dependencies.PublishNotificationUseCaseToken,
    (c) =>
      new dependencies.PublishNotificationUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.DeliverNotificationUseCaseToken,
    (c) =>
      new dependencies.DeliverNotificationUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
        c.resolve(dependencies.NotificationTransportToken),
      ),
  );
  services.addTransient(
    dependencies.RetryNotificationDeliveryUseCaseToken,
    (c) =>
      new dependencies.RetryNotificationDeliveryUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
}
