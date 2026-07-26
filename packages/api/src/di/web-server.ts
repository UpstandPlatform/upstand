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
}
