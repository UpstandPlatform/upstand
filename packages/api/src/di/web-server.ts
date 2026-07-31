import * as dependencies from "./dependencies";

type ServiceCollection = InstanceType<typeof dependencies.ServiceCollection>;

export function registerWebServer(services: ServiceCollection) {
  // Caddy Web Server Use Cases
  services.addTransient(
    dependencies.GetWebServerSettingsUseCaseToken,
    (c) =>
      new dependencies.GetWebServerSettingsUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
        c.resolve(dependencies.CaddyServiceToken),
      ),
  );
  services.addTransient(
    dependencies.UpdateWebServerSettingsUseCaseToken,
    (c) =>
      new dependencies.UpdateWebServerSettingsUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
        c.resolve(dependencies.CaddyServiceToken),
      ),
  );
  services.addTransient(
    dependencies.GetWebServerLogsUseCaseToken,
    (c) =>
      new dependencies.GetWebServerLogsUseCase(
        c.resolve(dependencies.CaddyServiceToken),
      ),
  );
  services.addTransient(
    dependencies.ReloadWebServerUseCaseToken,
    (c) =>
      new dependencies.ReloadWebServerUseCase(
        c.resolve(dependencies.CaddyServiceToken),
      ),
  );
  services.addTransient(
    dependencies.GetUpdateStatusUseCaseToken,
    () => new dependencies.GetUpdateStatusUseCase(),
  );
  services.addTransient(
    dependencies.TriggerUpdateUseCaseToken,
    (c) =>
      new dependencies.TriggerUpdateUseCase(
        c.resolve(dependencies.PublishNotificationUseCaseToken),
      ),
  );

  // Proxy Engine & Migration Registrations
  services.addSingleton(
    dependencies.ProxyDetectorToken,
    () => new dependencies.DefaultProxyDetector(),
  );
  services.addSingleton(
    dependencies.ProxyImporterToken,
    () => new dependencies.DefaultProxyImporter(),
  );
  services.addTransient(
    dependencies.ProxyTakeoverManagerToken,
    (c) =>
      new dependencies.DefaultProxyTakeoverManager(
        c.resolve(dependencies.UnitOfWorkToken),
        c.resolve(dependencies.ProxyDetectorToken),
        c.resolve(dependencies.ProxyImporterToken),
      ),
  );
  services.addTransient(
    dependencies.DetectProxyUseCaseToken,
    (c) =>
      new dependencies.DetectProxyUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
        c.resolve(dependencies.ProxyDetectorToken),
      ),
  );
  services.addTransient(
    dependencies.ScanProxySitesUseCaseToken,
    (c) =>
      new dependencies.ScanProxySitesUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
        c.resolve(dependencies.ProxyImporterToken),
      ),
  );
  services.addTransient(
    dependencies.TakeoverProxyUseCaseToken,
    (c) =>
      new dependencies.TakeoverProxyUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
        c.resolve(dependencies.ProxyTakeoverManagerToken),
      ),
  );
}
