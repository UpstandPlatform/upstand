import { createToken } from "@circulo-ai/di";
import type { DatabaseExecutor } from "@upstand/db";
import type {
  IAIRepository,
  IBackupRunRepository,
  IBackupScheduleRepository,
  ICertificateRepository,
  IEnvironmentRepository,
  IGitProviderRepository,
  IMonitoringSettingsRepository,
  INotificationChannelRepository,
  INotificationDeliveryRepository,
  IProjectRepository,
  IResourceRepository,
  IS3DestinationRepository,
  ISecretProviderRepository,
  ISecretVersionRepository,
  ISshKeyRepository,
  ITagRepository,
  ITemplateRepository,
  IUserRepository,
  IWebServerSettingsRepository,
} from "@upstand/domain";

export const DbToken = createToken<DatabaseExecutor>("DatabaseExecutor");
export const AIRepositoryToken = createToken<IAIRepository>("IAIRepository");
export const UserRepositoryToken =
  createToken<IUserRepository>("IUserRepository");
export const BackupScheduleRepositoryToken =
  createToken<IBackupScheduleRepository>("IBackupScheduleRepository");
export const CertificateRepositoryToken = createToken<ICertificateRepository>(
  "ICertificateRepository",
);
export const BackupRunRepositoryToken = createToken<IBackupRunRepository>(
  "IBackupRunRepository",
);
export const ProjectRepositoryToken =
  createToken<IProjectRepository>("IProjectRepository");
export const TagRepositoryToken = createToken<ITagRepository>("ITagRepository");
export const TemplateRepositoryToken = createToken<ITemplateRepository>(
  "ITemplateRepository",
);
export const EnvironmentRepositoryToken = createToken<IEnvironmentRepository>(
  "IEnvironmentRepository",
);
export const ResourceRepositoryToken = createToken<IResourceRepository>(
  "IResourceRepository",
);
export const SshKeyRepositoryToken =
  createToken<ISshKeyRepository>("ISshKeyRepository");
export const GitProviderRepositoryToken = createToken<IGitProviderRepository>(
  "IGitProviderRepository",
);
export const WebServerSettingsRepositoryToken =
  createToken<IWebServerSettingsRepository>("IWebServerSettingsRepository");
export const SecretProviderRepositoryToken =
  createToken<ISecretProviderRepository>("ISecretProviderRepository");
export const SecretVersionRepositoryToken =
  createToken<ISecretVersionRepository>("ISecretVersionRepository");
export const S3DestinationRepositoryToken =
  createToken<IS3DestinationRepository>("IS3DestinationRepository");
export const NotificationChannelRepositoryToken =
  createToken<INotificationChannelRepository>("INotificationChannelRepository");
export const NotificationDeliveryRepositoryToken =
  createToken<INotificationDeliveryRepository>(
    "INotificationDeliveryRepository",
  );
export const MonitoringSettingsRepositoryToken =
  createToken<IMonitoringSettingsRepository>("IMonitoringSettingsRepository");
