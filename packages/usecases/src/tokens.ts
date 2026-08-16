import { createToken } from "@circulo-ai/di";
import type { IUnitOfWork } from "@upstand/domain";
import type * as UseCases from "./index";
import type { NotificationTransport } from "./notification/notification-transport.port";
import type { CaddyServicePort } from "./ports/caddy";
import type { ContainerFileSystemPort } from "./ports/container-file-system";
import type { DatabaseHealthPort } from "./ports/database-health";
import type {
  DockerArchiveTransferPort,
  DockerContainerControllerPort,
  DockerExecPort,
  DockerInventoryReaderPort,
  DockerPrunePort,
  DockerResourceControllerPort,
  DockerServicePort,
} from "./ports/docker";
import type { ExternalSecretProviderPort } from "./ports/external-secrets";
import type { ManagedUserProvisioner } from "./ports/managed-user-provisioner";

// Application composition token. The domain exposes the IUnitOfWork contract,
// while the DI token belongs to the outer composition layer.
export const UnitOfWorkToken = createToken<IUnitOfWork>("IUnitOfWork");
export const DatabaseHealthToken =
  createToken<DatabaseHealthPort>("DatabaseHealth");

export const NotificationTransportToken = createToken<NotificationTransport>(
  "NotificationTransport",
);
export const ManagedUserProvisionerToken = createToken<ManagedUserProvisioner>(
  "ManagedUserProvisioner",
);
export const ExternalSecretProviderToken =
  createToken<ExternalSecretProviderPort>("ExternalSecretProvider");
export const ListSecretVersionsUseCaseToken =
  createToken<UseCases.ListSecretVersionsUseCase>("ListSecretVersionsUseCase");
export const GetSecretVersionUseCaseToken =
  createToken<UseCases.GetSecretVersionUseCase>("GetSecretVersionUseCase");
export const RestoreSecretVersionUseCaseToken =
  createToken<UseCases.RestoreSecretVersionUseCase>(
    "RestoreSecretVersionUseCase",
  );
export const CreateSecretProviderUseCaseToken =
  createToken<UseCases.CreateSecretProviderUseCase>(
    "CreateSecretProviderUseCase",
  );
export const ListSecretProvidersUseCaseToken =
  createToken<UseCases.ListSecretProvidersUseCase>(
    "ListSecretProvidersUseCase",
  );
export const DeleteSecretProviderUseCaseToken =
  createToken<UseCases.DeleteSecretProviderUseCase>(
    "DeleteSecretProviderUseCase",
  );
export const UpdateSecretProviderUseCaseToken =
  createToken<UseCases.UpdateSecretProviderUseCase>(
    "UpdateSecretProviderUseCase",
  );
export const SyncSecretProviderUseCaseToken =
  createToken<UseCases.SyncSecretProviderUseCase>("SyncSecretProviderUseCase");
export const TestSecretProviderConnectionUseCaseToken =
  createToken<UseCases.TestSecretProviderConnectionUseCase>(
    "TestSecretProviderConnectionUseCase",
  );
export const RotateSecretsUseCaseToken =
  createToken<UseCases.RotateSecretsUseCase>("RotateSecretsUseCase");
export const CreateSecretRotationScheduleUseCaseToken =
  createToken<UseCases.CreateSecretRotationScheduleUseCase>(
    "CreateSecretRotationScheduleUseCase",
  );
export const ListSecretRotationSchedulesUseCaseToken =
  createToken<UseCases.ListSecretRotationSchedulesUseCase>(
    "ListSecretRotationSchedulesUseCase",
  );
export const UpdateSecretRotationScheduleUseCaseToken =
  createToken<UseCases.UpdateSecretRotationScheduleUseCase>(
    "UpdateSecretRotationScheduleUseCase",
  );
export const DeleteSecretRotationScheduleUseCaseToken =
  createToken<UseCases.DeleteSecretRotationScheduleUseCase>(
    "DeleteSecretRotationScheduleUseCase",
  );
export const RunDueSecretRotationsUseCaseToken =
  createToken<UseCases.RunDueSecretRotationsUseCase>(
    "RunDueSecretRotationsUseCase",
  );
export const CaddyServiceToken = createToken<CaddyServicePort>("CaddyService");
export const DockerServiceToken =
  createToken<DockerServicePort>("DockerService");
export const DatabaseCommandUseCaseToken =
  createToken<UseCases.DatabaseCommandUseCase>("DatabaseCommandUseCase");
export const RunDatabaseMigrationUseCaseToken =
  createToken<UseCases.RunDatabaseMigrationUseCase>(
    "RunDatabaseMigrationUseCase",
  );
export const DockerInventoryReaderToken =
  createToken<DockerInventoryReaderPort>("DockerInventoryReader");
export const DockerContainerControllerToken =
  createToken<DockerContainerControllerPort>("DockerContainerController");
export const DockerResourceControllerToken =
  createToken<DockerResourceControllerPort>("DockerResourceController");
export const DockerPruneToken = createToken<DockerPrunePort>("DockerPrune");
export const DockerExecToken = createToken<DockerExecPort>("DockerExec");
export const ContainerFileSystemToken = createToken<ContainerFileSystemPort>(
  "ContainerFileSystem",
);
export const DockerArchiveTransferToken =
  createToken<DockerArchiveTransferPort>("DockerArchiveTransfer");
export const PublishNotificationUseCaseToken =
  createToken<UseCases.NotificationPublisher>("PublishNotificationUseCase");
export const CreateAuditLogUseCaseToken =
  createToken<UseCases.CreateAuditLogUseCase>("CreateAuditLogUseCase");
export const ListAuditLogsUseCaseToken =
  createToken<UseCases.ListAuditLogsUseCase>("ListAuditLogsUseCase");

export * from "./project/update-project.usecase";
export const CreateProjectUseCaseToken =
  createToken<UseCases.CreateProjectUseCase>("CreateProjectUseCase");
export const UpdateProjectUseCaseToken =
  createToken<UseCases.UpdateProjectUseCase>("UpdateProjectUseCase");
export const GetProjectsUseCaseToken =
  createToken<UseCases.GetProjectsUseCase>("GetProjectsUseCase");
export const GetProjectUseCaseToken =
  createToken<UseCases.GetProjectUseCase>("GetProjectUseCase");
export const DeleteProjectUseCaseToken =
  createToken<UseCases.DeleteProjectUseCase>("DeleteProjectUseCase");
export const DuplicateProjectUseCaseToken =
  createToken<UseCases.DuplicateProjectUseCase>("DuplicateProjectUseCase");
export const ListTagsUseCaseToken =
  createToken<UseCases.ListTagsUseCase>("ListTagsUseCase");
export const CreateTagUseCaseToken =
  createToken<UseCases.CreateTagUseCase>("CreateTagUseCase");
export const UpdateTagUseCaseToken =
  createToken<UseCases.UpdateTagUseCase>("UpdateTagUseCase");
export const DeleteTagUseCaseToken =
  createToken<UseCases.DeleteTagUseCase>("DeleteTagUseCase");
export const ListResourceTagsUseCaseToken =
  createToken<UseCases.ListResourceTagsUseCase>("ListResourceTagsUseCase");
export const AssignResourceTagUseCaseToken =
  createToken<UseCases.AssignResourceTagUseCase>("AssignResourceTagUseCase");
export const RemoveResourceTagUseCaseToken =
  createToken<UseCases.RemoveResourceTagUseCase>("RemoveResourceTagUseCase");
export const ListTemplatesUseCaseToken =
  createToken<UseCases.ListTemplatesUseCase>("ListTemplatesUseCase");
export const CreateTemplateUseCaseToken =
  createToken<UseCases.CreateTemplateUseCase>("CreateTemplateUseCase");
export const UpdateTemplateUseCaseToken =
  createToken<UseCases.UpdateTemplateUseCase>("UpdateTemplateUseCase");
export const DeleteTemplateUseCaseToken =
  createToken<UseCases.DeleteTemplateUseCase>("DeleteTemplateUseCase");
export const DeployTemplateUseCaseToken =
  createToken<UseCases.DeployTemplateUseCase>("DeployTemplateUseCase");
export const CreateEnvironmentUseCaseToken =
  createToken<UseCases.CreateEnvironmentUseCase>("CreateEnvironmentUseCase");
export const GetEnvironmentsUseCaseToken =
  createToken<UseCases.GetEnvironmentsUseCase>("GetEnvironmentsUseCase");
export const GetEnvironmentUseCaseToken =
  createToken<UseCases.GetEnvironmentUseCase>("GetEnvironmentUseCase");
export const DeleteEnvironmentUseCaseToken =
  createToken<UseCases.DeleteEnvironmentUseCase>("DeleteEnvironmentUseCase");
export const UpdateEnvironmentUseCaseToken =
  createToken<UseCases.UpdateEnvironmentUseCase>("UpdateEnvironmentUseCase");
export const CloneEnvironmentUseCaseToken =
  createToken<UseCases.CloneEnvironmentUseCase>("CloneEnvironmentUseCase");
export const DiffEnvironmentsUseCaseToken =
  createToken<UseCases.DiffEnvironmentsUseCase>("DiffEnvironmentsUseCase");
export const PromoteEnvironmentUseCaseToken =
  createToken<UseCases.PromoteEnvironmentUseCase>("PromoteEnvironmentUseCase");
export const CreateResourceUseCaseToken =
  createToken<UseCases.CreateResourceUseCase>("CreateResourceUseCase");
export const GetResourcesUseCaseToken =
  createToken<UseCases.GetResourcesUseCase>("GetResourcesUseCase");
export const GetResourceUseCaseToken =
  createToken<UseCases.GetResourceUseCase>("GetResourceUseCase");
export const UpdateResourceUseCaseToken =
  createToken<UseCases.UpdateResourceUseCase>("UpdateResourceUseCase");
export const RotateResourceWebhookTokenUseCaseToken =
  createToken<UseCases.RotateResourceWebhookTokenUseCase>(
    "RotateResourceWebhookTokenUseCase",
  );
export const DeleteResourceUseCaseToken =
  createToken<UseCases.DeleteResourceUseCase>("DeleteResourceUseCase");
export const DeployResourceUseCaseToken =
  createToken<UseCases.DeployResourceUseCase>("DeployResourceUseCase");
export const ControlResourceUseCaseToken =
  createToken<UseCases.ControlResourceUseCase>("ControlResourceUseCase");
export const RollbackResourceUseCaseToken =
  createToken<UseCases.RollbackResourceUseCase>("RollbackResourceUseCase");
export const RebuildDatabaseUseCaseToken =
  createToken<UseCases.RebuildDatabaseUseCase>("RebuildDatabaseUseCase");
export const RandomizeComposeUseCaseToken =
  createToken<UseCases.RandomizeComposeUseCase>("RandomizeComposeUseCase");
export const InspectComposeUseCaseToken =
  createToken<UseCases.InspectComposeUseCase>("InspectComposeUseCase");
export const ValidateDomainUseCaseToken =
  createToken<UseCases.ValidateDomainUseCase>("ValidateDomainUseCase");
export const ContainerFileManagerUseCaseToken =
  createToken<UseCases.ContainerFileManagerUseCase>(
    "ContainerFileManagerUseCase",
  );
export const ControlContainerUseCaseToken =
  createToken<UseCases.ControlContainerUseCase>("ControlContainerUseCase");
export const GetResourceContainersUseCaseToken =
  createToken<UseCases.GetResourceContainersUseCase>(
    "GetResourceContainersUseCase",
  );
export const GetResourceLogsUseCaseToken =
  createToken<UseCases.GetResourceLogsUseCase>("GetResourceLogsUseCase");
export const GetResourcePreviewsUseCaseToken =
  createToken<UseCases.GetResourcePreviewsUseCase>(
    "GetResourcePreviewsUseCase",
  );
export const GetResourceRoutingTargetsUseCaseToken =
  createToken<UseCases.GetResourceRoutingTargetsUseCase>(
    "GetResourceRoutingTargetsUseCase",
  );
export const GetResourceStatsUseCaseToken =
  createToken<UseCases.GetResourceStatsUseCase>("GetResourceStatsUseCase");
export const GetServerRuntimeStatsUseCaseToken =
  createToken<UseCases.GetServerRuntimeStatsUseCase>(
    "GetServerRuntimeStatsUseCase",
  );
export const GetServerCountUseCaseToken =
  createToken<UseCases.GetServerCountUseCase>("GetServerCountUseCase");
export const GetAccountStatusUseCaseToken =
  createToken<UseCases.GetAccountStatusUseCase>("GetAccountStatusUseCase");
export const GetSetupStatusUseCaseToken =
  createToken<UseCases.GetSetupStatusUseCase>("GetSetupStatusUseCase");
export const ResetTwoFactorUseCaseToken =
  createToken<UseCases.ResetTwoFactorUseCase>("ResetTwoFactorUseCase");
export const ScimUseCaseToken =
  createToken<UseCases.ScimUseCase>("ScimUseCase");
export const GetDockerInventoryUseCaseToken =
  createToken<UseCases.GetDockerInventoryUseCase>("GetDockerInventoryUseCase");
export const GetTopologyGraphUseCaseToken =
  createToken<UseCases.GetTopologyGraphUseCase>("GetTopologyGraphUseCase");
export const PruneDockerResourcesUseCaseToken =
  createToken<UseCases.PruneDockerResourcesUseCase>(
    "PruneDockerResourcesUseCase",
  );
export const ExecContainerCommandUseCaseToken =
  createToken<UseCases.ExecContainerCommandUseCase>(
    "ExecContainerCommandUseCase",
  );
export const ExecServerTerminalCommandUseCaseToken =
  createToken<UseCases.ExecServerTerminalCommandUseCase>(
    "ExecServerTerminalCommandUseCase",
  );
export const CreateSshKeyUseCaseToken =
  createToken<UseCases.CreateSshKeyUseCase>("CreateSshKeyUseCase");
export const GetSshKeysUseCaseToken =
  createToken<UseCases.GetSshKeysUseCase>("GetSshKeysUseCase");
export const DeleteSshKeyUseCaseToken =
  createToken<UseCases.DeleteSshKeyUseCase>("DeleteSshKeyUseCase");
export const GenerateSshKeyUseCaseToken =
  createToken<UseCases.GenerateSshKeyUseCase>("GenerateSshKeyUseCase");
export const UpdateSshKeyUseCaseToken =
  createToken<UseCases.UpdateSshKeyUseCase>("UpdateSshKeyUseCase");
export const CreateGitProviderUseCaseToken =
  createToken<UseCases.CreateGitProviderUseCase>("CreateGitProviderUseCase");
export const GetGitProvidersUseCaseToken =
  createToken<UseCases.GetGitProvidersUseCase>("GetGitProvidersUseCase");
export const DeleteGitProviderUseCaseToken =
  createToken<UseCases.DeleteGitProviderUseCase>("DeleteGitProviderUseCase");
export const UpdateGitProviderUseCaseToken =
  createToken<UseCases.UpdateGitProviderUseCase>("UpdateGitProviderUseCase");
export const ListGitRepositoriesUseCaseToken =
  createToken<UseCases.ListGitRepositoriesUseCase>(
    "ListGitRepositoriesUseCase",
  );
export const ListGitBranchesUseCaseToken =
  createToken<UseCases.ListGitBranchesUseCase>("ListGitBranchesUseCase");
export const CreateS3DestinationUseCaseToken =
  createToken<UseCases.CreateS3DestinationUseCase>(
    "CreateS3DestinationUseCase",
  );
export const GetS3DestinationsUseCaseToken =
  createToken<UseCases.GetS3DestinationsUseCase>("GetS3DestinationsUseCase");
export const UpdateS3DestinationUseCaseToken =
  createToken<UseCases.UpdateS3DestinationUseCase>(
    "UpdateS3DestinationUseCase",
  );
export const DeleteS3DestinationUseCaseToken =
  createToken<UseCases.DeleteS3DestinationUseCase>(
    "DeleteS3DestinationUseCase",
  );
export const TestS3DestinationConnectionUseCaseToken =
  createToken<UseCases.TestS3DestinationConnectionUseCase>(
    "TestS3DestinationConnectionUseCase",
  );
export const BackupSchedulerToken =
  createToken<UseCases.BackupScheduler>("BackupScheduler");
export const CreateCertificateUseCaseToken =
  createToken<UseCases.CreateCertificateUseCase>("CreateCertificateUseCase");
export const ListCertificatesUseCaseToken =
  createToken<UseCases.ListCertificatesUseCase>("ListCertificatesUseCase");
export const UpdateCertificateUseCaseToken =
  createToken<UseCases.UpdateCertificateUseCase>("UpdateCertificateUseCase");
export const DeleteCertificateUseCaseToken =
  createToken<UseCases.DeleteCertificateUseCase>("DeleteCertificateUseCase");
export const GeneralSchedulerToken =
  createToken<UseCases.GeneralScheduler>("GeneralScheduler");
export const GetSchedulesUseCaseToken =
  createToken<UseCases.GetSchedulesUseCase>("GetSchedulesUseCase");
export const GetOrganizationSchedulesUseCaseToken =
  createToken<UseCases.GetOrganizationSchedulesUseCase>(
    "GetOrganizationSchedulesUseCase",
  );
export const GetScheduleLogsUseCaseToken =
  createToken<UseCases.GetScheduleLogsUseCase>("GetScheduleLogsUseCase");
export const SyncUpstandConfigUseCaseToken =
  createToken<UseCases.SyncUpstandConfigUseCase>("SyncUpstandConfigUseCase");
export const CreateScheduleUseCaseToken =
  createToken<UseCases.CreateScheduleUseCase>("CreateScheduleUseCase");
export const UpdateScheduleUseCaseToken =
  createToken<UseCases.UpdateScheduleUseCase>("UpdateScheduleUseCase");
export const DeleteScheduleUseCaseToken =
  createToken<UseCases.DeleteScheduleUseCase>("DeleteScheduleUseCase");
export const CreateBackupScheduleUseCaseToken =
  createToken<UseCases.CreateBackupScheduleUseCase>(
    "CreateBackupScheduleUseCase",
  );
export const CreateWebServerBackupScheduleUseCaseToken =
  createToken<UseCases.CreateWebServerBackupScheduleUseCase>(
    "CreateWebServerBackupScheduleUseCase",
  );
export const UpdateWebServerBackupScheduleUseCaseToken =
  createToken<UseCases.UpdateWebServerBackupScheduleUseCase>(
    "UpdateWebServerBackupScheduleUseCase",
  );
export const GetBackupSchedulesUseCaseToken =
  createToken<UseCases.GetBackupSchedulesUseCase>("GetBackupSchedulesUseCase");
export const UpdateBackupScheduleUseCaseToken =
  createToken<UseCases.UpdateBackupScheduleUseCase>(
    "UpdateBackupScheduleUseCase",
  );
export const DeleteBackupScheduleUseCaseToken =
  createToken<UseCases.DeleteBackupScheduleUseCase>(
    "DeleteBackupScheduleUseCase",
  );
export const GetBackupRunsUseCaseToken =
  createToken<UseCases.GetBackupRunsUseCase>("GetBackupRunsUseCase");
export const TriggerBackupRunUseCaseToken =
  createToken<UseCases.TriggerBackupRunUseCase>("TriggerBackupRunUseCase");
export const RestoreBackupRunUseCaseToken =
  createToken<UseCases.RestoreBackupRunUseCase>("RestoreBackupRunUseCase");
export const VerifyBackupRunUseCaseToken =
  createToken<UseCases.VerifyBackupRunUseCase>("VerifyBackupRunUseCase");
export const ExecuteBackupRunUseCaseToken =
  createToken<UseCases.ExecuteBackupRunUseCase>("ExecuteBackupRunUseCase");
export const ListBackupVolumesUseCaseToken =
  createToken<UseCases.ListBackupVolumesUseCase>("ListBackupVolumesUseCase");
export const ListComposeServicesUseCaseToken =
  createToken<UseCases.ListComposeServicesUseCase>(
    "ListComposeServicesUseCase",
  );
export const GetWebServerSettingsUseCaseToken =
  createToken<UseCases.GetWebServerSettingsUseCase>(
    "GetWebServerSettingsUseCase",
  );
export const UpdateWebServerSettingsUseCaseToken =
  createToken<UseCases.UpdateWebServerSettingsUseCase>(
    "UpdateWebServerSettingsUseCase",
  );
export const GetWebServerLogsUseCaseToken =
  createToken<UseCases.GetWebServerLogsUseCase>("GetWebServerLogsUseCase");
export const ReloadWebServerUseCaseToken =
  createToken<UseCases.ReloadWebServerUseCase>("ReloadWebServerUseCase");
export const GetUpdateStatusUseCaseToken =
  createToken<UseCases.GetUpdateStatusUseCase>("GetUpdateStatusUseCase");
export const TriggerUpdateUseCaseToken =
  createToken<UseCases.TriggerUpdateUseCase>("TriggerUpdateUseCase");
export const InitSwarmUseCaseToken =
  createToken<UseCases.InitSwarmUseCase>("InitSwarmUseCase");
export const GetSwarmInfoUseCaseToken =
  createToken<UseCases.GetSwarmInfoUseCase>("GetSwarmInfoUseCase");
export const GetSwarmNodesUseCaseToken =
  createToken<UseCases.GetSwarmNodesUseCase>("GetSwarmNodesUseCase");
export const UpdateSwarmNodeUseCaseToken =
  createToken<UseCases.UpdateSwarmNodeUseCase>("UpdateSwarmNodeUseCase");
export const RemoveSwarmNodeUseCaseToken =
  createToken<UseCases.RemoveSwarmNodeUseCase>("RemoveSwarmNodeUseCase");
export const GetSwarmJoinCommandsUseCaseToken =
  createToken<UseCases.GetSwarmJoinCommandsUseCase>(
    "GetSwarmJoinCommandsUseCase",
  );
export const RotateSwarmJoinTokenUseCaseToken =
  createToken<UseCases.RotateSwarmJoinTokenUseCase>(
    "RotateSwarmJoinTokenUseCase",
  );
export const GetDeploymentsUseCaseToken =
  createToken<UseCases.GetDeploymentsUseCase>("GetDeploymentsUseCase");
export const ReconcileStaleDeploymentsUseCaseToken =
  createToken<UseCases.ReconcileStaleDeploymentsUseCase>(
    "ReconcileStaleDeploymentsUseCase",
  );
export const GetDeploymentServerSettingsUseCaseToken =
  createToken<UseCases.GetDeploymentServerSettingsUseCase>(
    "GetDeploymentServerSettingsUseCase",
  );
export const GetQueueUseCaseToken =
  createToken<UseCases.GetQueueUseCase>("GetQueueUseCase");
export const GetRequestsUseCaseToken =
  createToken<UseCases.GetRequestsUseCase>("GetRequestsUseCase");
export const GlobalSearchUseCaseToken =
  createToken<UseCases.GlobalSearchUseCase>("GlobalSearchUseCase");
export const UpdateConcurrencyUseCaseToken =
  createToken<UseCases.UpdateConcurrencyUseCase>("UpdateConcurrencyUseCase");
export const CreateDockerRegistryUseCaseToken =
  createToken<UseCases.CreateDockerRegistryUseCase>(
    "CreateDockerRegistryUseCase",
  );
export const DeleteDockerRegistryUseCaseToken =
  createToken<UseCases.DeleteDockerRegistryUseCase>(
    "DeleteDockerRegistryUseCase",
  );
export const GetDockerRegistriesUseCaseToken =
  createToken<UseCases.GetDockerRegistriesUseCase>(
    "GetDockerRegistriesUseCase",
  );
export const TestDockerRegistryConnectionUseCaseToken =
  createToken<UseCases.TestDockerRegistryConnectionUseCase>(
    "TestDockerRegistryConnectionUseCase",
  );
export const UpdateDockerRegistryUseCaseToken =
  createToken<UseCases.UpdateDockerRegistryUseCase>(
    "UpdateDockerRegistryUseCase",
  );
export const CreateServerUseCaseToken =
  createToken<UseCases.CreateServerUseCase>("CreateServerUseCase");
export const DeleteServerUseCaseToken =
  createToken<UseCases.DeleteServerUseCase>("DeleteServerUseCase");
export const GetServersUseCaseToken =
  createToken<UseCases.GetServersUseCase>("GetServersUseCase");
export const GetServerUseCaseToken =
  createToken<UseCases.GetServerUseCase>("GetServerUseCase");
export const SetupServerUseCaseToken =
  createToken<UseCases.SetupServerUseCase>("SetupServerUseCase");
export const UpdateServerUseCaseToken =
  createToken<UseCases.UpdateServerUseCase>("UpdateServerUseCase");
export const MigrateResourceUseCaseToken =
  createToken<UseCases.MigrateResourceUseCase>("MigrateResourceUseCase");
export const WorkloadMigrationPortToken =
  createToken<UseCases.WorkloadMigrationPort>("WorkloadMigrationPort");
export const GetWorkloadMigrationUseCaseToken =
  createToken<UseCases.GetWorkloadMigrationUseCase>(
    "GetWorkloadMigrationUseCase",
  );
export const GetResourceWorkloadMigrationUseCaseToken =
  createToken<UseCases.GetResourceWorkloadMigrationUseCase>(
    "GetResourceWorkloadMigrationUseCase",
  );
export const CancelWorkloadMigrationUseCaseToken =
  createToken<UseCases.CancelWorkloadMigrationUseCase>(
    "CancelWorkloadMigrationUseCase",
  );
export const RollbackWorkloadMigrationUseCaseToken =
  createToken<UseCases.RollbackWorkloadMigrationUseCase>(
    "RollbackWorkloadMigrationUseCase",
  );
export const ConfirmWorkloadMigrationUseCaseToken =
  createToken<UseCases.ConfirmWorkloadMigrationUseCase>(
    "ConfirmWorkloadMigrationUseCase",
  );
export const GetServerHistoricalMetricsUseCaseToken =
  createToken<UseCases.GetServerHistoricalMetricsUseCase>(
    "GetServerHistoricalMetricsUseCase",
  );
export const GetServerMonitoringStatusUseCaseToken =
  createToken<UseCases.GetServerMonitoringStatusUseCase>(
    "GetServerMonitoringStatusUseCase",
  );
export const UpdateMonitoringSettingsUseCaseToken =
  createToken<UseCases.UpdateMonitoringSettingsUseCase>(
    "UpdateMonitoringSettingsUseCase",
  );
export const GetSwarmContainersUseCaseToken =
  createToken<UseCases.GetSwarmContainersUseCase>("GetSwarmContainersUseCase");
export const CreateNotificationChannelUseCaseToken =
  createToken<UseCases.CreateNotificationChannelUseCase>(
    "CreateNotificationChannelUseCase",
  );
export const GetNotificationChannelsUseCaseToken =
  createToken<UseCases.GetNotificationChannelsUseCase>(
    "GetNotificationChannelsUseCase",
  );
export const UpdateNotificationChannelUseCaseToken =
  createToken<UseCases.UpdateNotificationChannelUseCase>(
    "UpdateNotificationChannelUseCase",
  );
export const DeleteNotificationChannelUseCaseToken =
  createToken<UseCases.DeleteNotificationChannelUseCase>(
    "DeleteNotificationChannelUseCase",
  );
export const TestNotificationChannelUseCaseToken =
  createToken<UseCases.TestNotificationChannelUseCase>(
    "TestNotificationChannelUseCase",
  );
export const DeliverNotificationUseCaseToken =
  createToken<UseCases.DeliverNotificationUseCase>(
    "DeliverNotificationUseCase",
  );
export const RetryNotificationDeliveryUseCaseToken =
  createToken<UseCases.RetryNotificationDeliveryUseCase>(
    "RetryNotificationDeliveryUseCase",
  );
export const ScanServerHostKeyUseCaseToken =
  createToken<UseCases.ScanServerHostKeyUseCase>("ScanServerHostKeyUseCase");
