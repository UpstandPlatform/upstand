import type { IUnitOfWork } from "@upstand/domain";
import { DrizzleAuditLogRepository } from "./audit-log/drizzle-audit-log.repository";
import { DrizzleBackupRunRepository } from "./backup/drizzle-backup-run.repository";
import { DrizzleBackupScheduleRepository } from "./backup/drizzle-backup-schedule.repository";
import { DrizzleCertificateRepository } from "./certificate/drizzle-certificate.repository";
import { DrizzleDeploymentRepository } from "./deployment/drizzle-deployment.repository";
import { DrizzleDockerRegistryRepository } from "./docker-registry/drizzle-docker-registry.repository";
import { DrizzleEnvironmentRepository } from "./environment/drizzle-environment.repository";
import { DrizzleGitProviderRepository } from "./git-provider/drizzle-git-provider.repository";
import { DrizzleMonitoringSettingsRepository } from "./monitoring/drizzle-monitoring-settings.repository";
import { DrizzleNotificationChannelRepository } from "./notification/drizzle-notification-channel.repository";
import { DrizzleNotificationDeliveryRepository } from "./notification/drizzle-notification-delivery.repository";
import { DrizzleOutboxRepository } from "./outbox/drizzle-outbox.repository";
import { DrizzlePreviewDeploymentRepository } from "./preview-deployment/drizzle-preview-deployment.repository";
import { DrizzleProjectRepository } from "./project/drizzle-project.repository";
import { DrizzleResourceRepository } from "./resource/drizzle-resource.repository";
import { DrizzleResourceRuntimeRepository } from "./resource/drizzle-resource-runtime.repository";
import { DrizzleS3DestinationRepository } from "./s3-destination/drizzle-s3-destination.repository";
import { DrizzleScheduleRepository } from "./schedule/drizzle-schedule.repository";
import { DrizzleScheduleLogRepository } from "./schedule/drizzle-schedule-log.repository";
import { DrizzleScimRepository } from "./scim/drizzle-scim.repository";
import { DrizzleSecretProviderRepository } from "./secret/drizzle-secret-provider.repository";
import { DrizzleSecretRotationScheduleRepository } from "./secret/drizzle-secret-rotation-schedule.repository";
import { DrizzleSecretVersionRepository } from "./secret/drizzle-secret-version.repository";
import { DrizzleServerRepository } from "./server/drizzle-server.repository";
import { DrizzleServerBuildSettingsRepository } from "./server-build-settings/drizzle-server-build-settings.repository";
import type { Executor } from "./shared/types";
import { DrizzleSshKeyRepository } from "./ssh-key/drizzle-ssh-key.repository";
import { DrizzleTagRepository } from "./tag/drizzle-tag.repository";
import { DrizzleTemplateRepository } from "./template/drizzle-template.repository";
import { DrizzleTwoFactorAdminRepository } from "./user/drizzle-two-factor-admin.repository";
import { DrizzleUserRepository } from "./user/drizzle-user.repository";
import { DrizzleWebServerSettingsRepository } from "./web-server/drizzle-web-server-settings.repository";

export class DrizzleUnitOfWork implements IUnitOfWork {
  public readonly auditLogRepository: DrizzleAuditLogRepository;
  public readonly backupScheduleRepository: DrizzleBackupScheduleRepository;
  public readonly certificateRepository: DrizzleCertificateRepository;
  public readonly backupRunRepository: DrizzleBackupRunRepository;
  public readonly userRepository: DrizzleUserRepository;
  public readonly projectRepository: DrizzleProjectRepository;
  public readonly tagRepository: DrizzleTagRepository;
  public readonly templateRepository: DrizzleTemplateRepository;
  public readonly environmentRepository: DrizzleEnvironmentRepository;
  public readonly resourceRepository: DrizzleResourceRepository;
  public readonly resourceRuntimeRepository: DrizzleResourceRuntimeRepository;
  public readonly sshKeyRepository: DrizzleSshKeyRepository;
  public readonly gitProviderRepository: DrizzleGitProviderRepository;
  public readonly webServerSettingsRepository: DrizzleWebServerSettingsRepository;
  public readonly s3DestinationRepository: DrizzleS3DestinationRepository;
  public readonly serverBuildSettingsRepository: DrizzleServerBuildSettingsRepository;
  public readonly deploymentRepository: DrizzleDeploymentRepository;
  public readonly dockerRegistryRepository: DrizzleDockerRegistryRepository;
  public readonly serverRepository: DrizzleServerRepository;
  public readonly notificationChannelRepository: DrizzleNotificationChannelRepository;
  public readonly notificationDeliveryRepository: DrizzleNotificationDeliveryRepository;
  public readonly monitoringSettingsRepository: DrizzleMonitoringSettingsRepository;
  public readonly previewDeploymentRepository: DrizzlePreviewDeploymentRepository;
  public readonly scheduleRepository: DrizzleScheduleRepository;
  public readonly scheduleLogRepository: DrizzleScheduleLogRepository;
  public readonly outboxRepository: DrizzleOutboxRepository;
  public readonly scimRepository: DrizzleScimRepository;
  public readonly twoFactorAdminRepository: DrizzleTwoFactorAdminRepository;
  public readonly secretVersionRepository: DrizzleSecretVersionRepository;
  public readonly secretProviderRepository: DrizzleSecretProviderRepository;
  public readonly secretRotationScheduleRepository: DrizzleSecretRotationScheduleRepository;

  constructor(private readonly executor: Executor) {
    this.auditLogRepository = new DrizzleAuditLogRepository(this.executor);
    this.backupScheduleRepository = new DrizzleBackupScheduleRepository(
      this.executor,
    );
    this.certificateRepository = new DrizzleCertificateRepository(
      this.executor,
    );
    this.backupRunRepository = new DrizzleBackupRunRepository(this.executor);
    this.userRepository = new DrizzleUserRepository(this.executor);
    this.projectRepository = new DrizzleProjectRepository(this.executor);
    this.tagRepository = new DrizzleTagRepository(this.executor);
    this.templateRepository = new DrizzleTemplateRepository(this.executor);
    this.environmentRepository = new DrizzleEnvironmentRepository(
      this.executor,
    );
    this.resourceRepository = new DrizzleResourceRepository(this.executor);
    this.resourceRuntimeRepository = new DrizzleResourceRuntimeRepository(
      this.executor,
    );
    this.sshKeyRepository = new DrizzleSshKeyRepository(this.executor);
    this.gitProviderRepository = new DrizzleGitProviderRepository(
      this.executor,
    );
    this.webServerSettingsRepository = new DrizzleWebServerSettingsRepository(
      this.executor,
    );
    this.s3DestinationRepository = new DrizzleS3DestinationRepository(
      this.executor,
    );
    this.serverBuildSettingsRepository =
      new DrizzleServerBuildSettingsRepository(this.executor);
    this.deploymentRepository = new DrizzleDeploymentRepository(this.executor);
    this.dockerRegistryRepository = new DrizzleDockerRegistryRepository(
      this.executor,
    );
    this.serverRepository = new DrizzleServerRepository(this.executor);
    this.notificationChannelRepository =
      new DrizzleNotificationChannelRepository(this.executor);
    this.notificationDeliveryRepository =
      new DrizzleNotificationDeliveryRepository(this.executor);
    this.monitoringSettingsRepository = new DrizzleMonitoringSettingsRepository(
      this.executor,
    );
    this.previewDeploymentRepository = new DrizzlePreviewDeploymentRepository(
      this.executor,
    );
    this.scheduleRepository = new DrizzleScheduleRepository(this.executor);
    this.scheduleLogRepository = new DrizzleScheduleLogRepository(
      this.executor,
    );
    this.outboxRepository = new DrizzleOutboxRepository(this.executor);
    this.scimRepository = new DrizzleScimRepository(this.executor);
    this.twoFactorAdminRepository = new DrizzleTwoFactorAdminRepository(
      this.executor,
    );
    this.secretVersionRepository = new DrizzleSecretVersionRepository(
      this.executor,
    );
    this.secretProviderRepository = new DrizzleSecretProviderRepository(
      this.executor,
    );
    this.secretRotationScheduleRepository =
      new DrizzleSecretRotationScheduleRepository(this.executor);
  }

  async transaction<T>(work: (uow: IUnitOfWork) => Promise<T>): Promise<T> {
    return this.executor.transaction(async (tx) => {
      const txUow = new DrizzleUnitOfWork(tx);
      return work(txUow);
    });
  }
}
