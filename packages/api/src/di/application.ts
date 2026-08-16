import * as dependencies from "./dependencies";

type ServiceCollection = InstanceType<typeof dependencies.ServiceCollection>;

export function registerApplicationFeatures(services: ServiceCollection) {
  services.addSingleton(
    dependencies.ManagedUserProvisionerToken,
    () => new dependencies.BetterAuthManagedUserProvisioner(),
  );
  services.addTransient(
    dependencies.ScimUseCaseToken,
    (c) =>
      new dependencies.ScimUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
        c.resolve(dependencies.ManagedUserProvisionerToken),
      ),
  );
  services.addTransient(
    dependencies.GetSetupStatusUseCaseToken,
    (c) =>
      new dependencies.GetSetupStatusUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.ResetTwoFactorUseCaseToken,
    (c) =>
      new dependencies.ResetTwoFactorUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  // 4. Use Cases (transient)
  services.addTransient(
    dependencies.CreateProjectUseCaseToken,
    (c) =>
      new dependencies.CreateProjectUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.UpdateProjectUseCaseToken,
    (c) =>
      new dependencies.UpdateProjectUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.GetProjectsUseCaseToken,
    (c) =>
      new dependencies.GetProjectsUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.GetProjectUseCaseToken,
    (c) =>
      new dependencies.GetProjectUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.DeleteProjectUseCaseToken,
    (c) =>
      new dependencies.DeleteProjectUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.DuplicateProjectUseCaseToken,
    (c) =>
      new dependencies.DuplicateProjectUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.ListTagsUseCaseToken,
    (c) =>
      new dependencies.ListTagsUseCase(c.resolve(dependencies.UnitOfWorkToken)),
  );
  services.addTransient(
    dependencies.CreateTagUseCaseToken,
    (c) =>
      new dependencies.CreateTagUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.UpdateTagUseCaseToken,
    (c) =>
      new dependencies.UpdateTagUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.DeleteTagUseCaseToken,
    (c) =>
      new dependencies.DeleteTagUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.ListResourceTagsUseCaseToken,
    (c) =>
      new dependencies.ListResourceTagsUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.AssignResourceTagUseCaseToken,
    (c) =>
      new dependencies.AssignResourceTagUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.RemoveResourceTagUseCaseToken,
    (c) =>
      new dependencies.RemoveResourceTagUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.ListTemplatesUseCaseToken,
    (c) =>
      new dependencies.ListTemplatesUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.CreateTemplateUseCaseToken,
    (c) =>
      new dependencies.CreateTemplateUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.UpdateTemplateUseCaseToken,
    (c) =>
      new dependencies.UpdateTemplateUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.DeleteTemplateUseCaseToken,
    (c) =>
      new dependencies.DeleteTemplateUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.DeployTemplateUseCaseToken,
    (c) =>
      new dependencies.DeployTemplateUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
        c.resolve(dependencies.CreateResourceUseCaseToken),
        c.resolve(dependencies.DeployResourceUseCaseToken),
      ),
  );

  services.addTransient(
    dependencies.CreateEnvironmentUseCaseToken,
    (c) =>
      new dependencies.CreateEnvironmentUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.GetEnvironmentsUseCaseToken,
    (c) =>
      new dependencies.GetEnvironmentsUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.GetEnvironmentUseCaseToken,
    (c) =>
      new dependencies.GetEnvironmentUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.DeleteEnvironmentUseCaseToken,
    (c) =>
      new dependencies.DeleteEnvironmentUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.UpdateEnvironmentUseCaseToken,
    (c) =>
      new dependencies.UpdateEnvironmentUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.ListSecretVersionsUseCaseToken,
    (c) =>
      new dependencies.ListSecretVersionsUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.GetSecretVersionUseCaseToken,
    (c) =>
      new dependencies.GetSecretVersionUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.RestoreSecretVersionUseCaseToken,
    (c) =>
      new dependencies.RestoreSecretVersionUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.CreateSecretProviderUseCaseToken,
    (c) =>
      new dependencies.CreateSecretProviderUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.ListSecretProvidersUseCaseToken,
    (c) =>
      new dependencies.ListSecretProvidersUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.DeleteSecretProviderUseCaseToken,
    (c) =>
      new dependencies.DeleteSecretProviderUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.UpdateSecretProviderUseCaseToken,
    (c) =>
      new dependencies.UpdateSecretProviderUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.SyncSecretProviderUseCaseToken,
    (c) =>
      new dependencies.SyncSecretProviderUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
        c.resolve(dependencies.ExternalSecretProviderToken),
      ),
  );
  services.addTransient(
    dependencies.TestSecretProviderConnectionUseCaseToken,
    (c) =>
      new dependencies.TestSecretProviderConnectionUseCase(
        c.resolve(dependencies.ExternalSecretProviderToken),
      ),
  );
  services.addTransient(
    dependencies.RotateSecretsUseCaseToken,
    (c) =>
      new dependencies.RotateSecretsUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.CreateSecretRotationScheduleUseCaseToken,
    (c) =>
      new dependencies.CreateSecretRotationScheduleUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.ListSecretRotationSchedulesUseCaseToken,
    (c) =>
      new dependencies.ListSecretRotationSchedulesUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.UpdateSecretRotationScheduleUseCaseToken,
    (c) =>
      new dependencies.UpdateSecretRotationScheduleUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.DeleteSecretRotationScheduleUseCaseToken,
    (c) =>
      new dependencies.DeleteSecretRotationScheduleUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.RunDueSecretRotationsUseCaseToken,
    (c) =>
      new dependencies.RunDueSecretRotationsUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.CloneEnvironmentUseCaseToken,
    (c) =>
      new dependencies.CloneEnvironmentUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.DiffEnvironmentsUseCaseToken,
    (c) =>
      new dependencies.DiffEnvironmentsUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.PromoteEnvironmentUseCaseToken,
    (c) =>
      new dependencies.PromoteEnvironmentUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );

  services.addTransient(
    dependencies.CreateResourceUseCaseToken,
    (c) =>
      new dependencies.CreateResourceUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.GetResourcesUseCaseToken,
    (c) =>
      new dependencies.GetResourcesUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.GetResourceUseCaseToken,
    (c) =>
      new dependencies.GetResourceUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.UpdateResourceUseCaseToken,
    (c) =>
      new dependencies.UpdateResourceUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
        c.resolve(dependencies.CaddyServiceToken),
      ),
  );
  services.addTransient(
    dependencies.RotateResourceWebhookTokenUseCaseToken,
    (c) =>
      new dependencies.RotateResourceWebhookTokenUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.DeleteResourceUseCaseToken,
    (c) =>
      new dependencies.DeleteResourceUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
        c.resolve(dependencies.CaddyServiceToken),
        c.resolve(dependencies.DockerServiceToken),
      ),
  );
  services.addTransient(
    dependencies.RollbackResourceUseCaseToken,
    (c) =>
      new dependencies.RollbackResourceUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
        c.resolve(dependencies.DockerServiceToken),
      ),
  );
  services.addTransient(
    dependencies.RebuildDatabaseUseCaseToken,
    (c) =>
      new dependencies.RebuildDatabaseUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
        c.resolve(dependencies.DockerServiceToken),
      ),
  );
  services.addTransient(
    dependencies.DatabaseCommandUseCaseToken,
    (c) =>
      new dependencies.DatabaseCommandUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
        c.resolve(dependencies.DockerServiceToken),
      ),
  );
  services.addTransient(
    dependencies.RunDatabaseMigrationUseCaseToken,
    (c) =>
      new dependencies.RunDatabaseMigrationUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
        c.resolve(dependencies.DockerServiceToken),
      ),
  );
  services.addTransient(
    dependencies.RandomizeComposeUseCaseToken,
    (c) =>
      new dependencies.RandomizeComposeUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.InspectComposeUseCaseToken,
    () => new dependencies.InspectComposeUseCase(),
  );
  services.addTransient(
    dependencies.ValidateDomainUseCaseToken,
    () => new dependencies.ValidateDomainUseCase(),
  );
  services.addTransient(
    dependencies.DeployResourceUseCaseToken,
    (c) =>
      new dependencies.DeployResourceUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.ControlResourceUseCaseToken,
    (c) =>
      new dependencies.ControlResourceUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
        c.resolve(dependencies.DockerServiceToken),
      ),
  );
  services.addTransient(
    dependencies.ControlContainerUseCaseToken,
    (c) =>
      new dependencies.ControlContainerUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
        c.resolve(dependencies.DockerServiceToken),
      ),
  );
  services.addTransient(
    dependencies.GetResourceContainersUseCaseToken,
    (c) =>
      new dependencies.GetResourceContainersUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
        c.resolve(dependencies.DockerServiceToken),
      ),
  );
  services.addTransient(
    dependencies.GetResourceLogsUseCaseToken,
    (c) =>
      new dependencies.GetResourceLogsUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
        c.resolve(dependencies.DockerServiceToken),
      ),
  );
  services.addTransient(
    dependencies.GetResourcePreviewsUseCaseToken,
    (c) =>
      new dependencies.GetResourcePreviewsUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.GetResourceRoutingTargetsUseCaseToken,
    (c) =>
      new dependencies.GetResourceRoutingTargetsUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
        c.resolve(dependencies.DockerServiceToken),
      ),
  );
  services.addTransient(
    dependencies.GetResourceStatsUseCaseToken,
    (c) =>
      new dependencies.GetResourceStatsUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
        c.resolve(dependencies.DockerServiceToken),
      ),
  );
  services.addTransient(
    dependencies.GetServerRuntimeStatsUseCaseToken,
    (c) =>
      new dependencies.GetServerRuntimeStatsUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
        c.resolve(dependencies.DockerServiceToken),
      ),
  );
  services.addTransient(
    dependencies.GetDeploymentServerSettingsUseCaseToken,
    (c) =>
      new dependencies.GetDeploymentServerSettingsUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
        c.resolve(dependencies.DockerInventoryReaderToken),
      ),
  );
  services.addTransient(
    dependencies.GetAccountStatusUseCaseToken,
    (c) =>
      new dependencies.GetAccountStatusUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.GetDockerInventoryUseCaseToken,
    (c) =>
      new dependencies.GetDockerInventoryUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
        c.resolve(dependencies.DockerInventoryReaderToken),
        c.resolve(dependencies.DockerContainerControllerToken),
        c.resolve(dependencies.DockerResourceControllerToken),
        c.resolve(dependencies.DockerArchiveTransferToken),
      ),
  );
  services.addTransient(
    dependencies.PruneDockerResourcesUseCaseToken,
    (c) =>
      new dependencies.PruneDockerResourcesUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
        c.resolve(dependencies.DockerPruneToken),
      ),
  );
  services.addTransient(
    dependencies.ExecContainerCommandUseCaseToken,
    (c) =>
      new dependencies.ExecContainerCommandUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
        c.resolve(dependencies.DockerExecToken),
        c.resolve(dependencies.DockerInventoryReaderToken),
      ),
  );
  services.addTransient(
    dependencies.ContainerFileManagerUseCaseToken,
    (c) =>
      new dependencies.ContainerFileManagerUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
        c.resolve(dependencies.DockerInventoryReaderToken),
        c.resolve(dependencies.ContainerFileSystemToken),
      ),
  );
  services.addTransient(
    dependencies.ExecServerTerminalCommandUseCaseToken,
    (c) =>
      new dependencies.ExecServerTerminalCommandUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
        c.resolve(dependencies.DockerExecToken),
      ),
  );

  services.addTransient(
    dependencies.CreateSshKeyUseCaseToken,
    (c) =>
      new dependencies.CreateSshKeyUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.GetSshKeysUseCaseToken,
    (c) =>
      new dependencies.GetSshKeysUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.GenerateSshKeyUseCaseToken,
    (c) =>
      new dependencies.GenerateSshKeyUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.DeleteSshKeyUseCaseToken,
    (c) =>
      new dependencies.DeleteSshKeyUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.UpdateSshKeyUseCaseToken,
    (c) =>
      new dependencies.UpdateSshKeyUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );

  services.addTransient(
    dependencies.CreateGitProviderUseCaseToken,
    (c) =>
      new dependencies.CreateGitProviderUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.GetGitProvidersUseCaseToken,
    (c) =>
      new dependencies.GetGitProvidersUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.DeleteGitProviderUseCaseToken,
    (c) =>
      new dependencies.DeleteGitProviderUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.UpdateGitProviderUseCaseToken,
    (c) =>
      new dependencies.UpdateGitProviderUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.ListGitRepositoriesUseCaseToken,
    (c) =>
      new dependencies.ListGitRepositoriesUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.ListGitBranchesUseCaseToken,
    (c) =>
      new dependencies.ListGitBranchesUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );

  services.addTransient(
    dependencies.CreateCertificateUseCaseToken,
    (c) =>
      new dependencies.CreateCertificateUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.ListCertificatesUseCaseToken,
    (c) =>
      new dependencies.ListCertificatesUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.UpdateCertificateUseCaseToken,
    (c) =>
      new dependencies.UpdateCertificateUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.DeleteCertificateUseCaseToken,
    (c) =>
      new dependencies.DeleteCertificateUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );

  services.addTransient(
    dependencies.CreateS3DestinationUseCaseToken,
    (c) =>
      new dependencies.CreateS3DestinationUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.GetS3DestinationsUseCaseToken,
    (c) =>
      new dependencies.GetS3DestinationsUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.UpdateS3DestinationUseCaseToken,
    (c) =>
      new dependencies.UpdateS3DestinationUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.DeleteS3DestinationUseCaseToken,
    (c) =>
      new dependencies.DeleteS3DestinationUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.TestS3DestinationConnectionUseCaseToken,
    (c) =>
      new dependencies.TestS3DestinationConnectionUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.ListComposeServicesUseCaseToken,
    (c) =>
      new dependencies.ListComposeServicesUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
        c.resolve(dependencies.InspectComposeUseCaseToken),
      ),
  );
}
