import {
  Activity as ActivityFreeIcon,
  Alert02Icon as Alert02IconFreeIcon,
  AlertCircle as AlertCircleFreeIcon,
  ArchiveRestore as ArchiveRestoreFreeIcon,
  ArrowDown as ArrowDownFreeIcon,
  ArrowDownIcon as ArrowDownIconFreeIcon,
  ArrowLeft as ArrowLeftFreeIcon,
  ArrowLeftIcon as ArrowLeftIconFreeIcon,
  ArrowRightIcon as ArrowRightIconFreeIcon,
  ArrowUp as ArrowUpFreeIcon,
  ArrowUpRightIcon as ArrowUpRightIconFreeIcon,
  Attachment01Icon as Attachment01IconFreeIcon,
  Bell as BellFreeIcon,
  BookIcon as BookIconFreeIcon,
  BookmarkIcon as BookmarkIconFreeIcon,
  Bot as BotFreeIcon,
  Boxes as BoxesFreeIcon,
  BoxIcon as BoxIconFreeIcon,
  BrainIcon as BrainIconFreeIcon,
  Briefcase01Icon as Briefcase01FreeIcon,
  CalendarClock as CalendarClockFreeIcon,
  Cancel01Icon as Cancel01IconFreeIcon,
  CancelCircleIcon as CancelCircleIconFreeIcon,
  CheckCircle as CheckCircleFreeIcon,
  Check as CheckFreeIcon,
  CheckIcon as CheckIconFreeIcon,
  CheckmarkCircle02Icon as CheckmarkCircle02IconFreeIcon,
  ChevronDownIcon as ChevronDownIconFreeIcon,
  ChevronLeft as ChevronLeftFreeIcon,
  ChevronLeftIcon as ChevronLeftIconFreeIcon,
  ChevronRight as ChevronRightFreeIcon,
  ChevronRightIcon as ChevronRightIconFreeIcon,
  ChevronsDownUpIcon as ChevronsDownUpIconFreeIcon,
  CircleAlert as CircleAlertFreeIcon,
  CircleDot as CircleDotFreeIcon,
  CircleDotIcon as CircleDotIconFreeIcon,
  CircleIcon as CircleIconFreeIcon,
  CircleSmallIcon as CircleSmallIconFreeIcon,
  CircleX as CircleXFreeIcon,
  Clock as ClockFreeIcon,
  ClockIcon as ClockIconFreeIcon,
  Code as CodeFreeIcon,
  CodeIcon as CodeIconFreeIcon,
  Copy as CopyFreeIcon,
  CopyIcon as CopyIconFreeIcon,
  CornerDownLeftIcon as CornerDownLeftIconFreeIcon,
  Cpu as CpuFreeIcon,
  Database as DatabaseFreeIcon,
  DatabaseIcon as DatabaseIconFreeIcon,
  Delete02Icon as Delete02IconFreeIcon,
  DotIcon as DotIconFreeIcon,
  Download01Icon as Download01IconFreeIcon,
  Download as DownloadFreeIcon,
  DownloadIcon as DownloadIconFreeIcon,
  Edit02Icon as Edit02IconFreeIcon,
  ExternalLinkIcon as ExternalLinkIconFreeIcon,
  Eye as EyeFreeIcon,
  EyeIcon as EyeIconFreeIcon,
  EyeOff as EyeOffFreeIcon,
  EyeOffIcon as EyeOffIconFreeIcon,
  FemaleSymbolIcon as FemaleSymbolIconFreeIcon,
  File01Icon as File01IconFreeIcon,
  FileClockIcon as FileClockIconFreeIcon,
  FileIcon as FileIconFreeIcon,
  FilePlusIcon as FilePlusIconFreeIcon,
  FileText as FileTextFreeIcon,
  Filter as FilterFreeIcon,
  FolderIcon as FolderIconFreeIcon,
  FolderOpenIcon as FolderOpenIconFreeIcon,
  GitBranchIcon as GitBranchIconFreeIcon,
  GitCommitIcon as GitCommitIconFreeIcon,
  Globe as GlobeFreeIcon,
  GlobeIcon as GlobeIconFreeIcon,
  HardDrive as HardDriveFreeIcon,
  Hash as HashFreeIcon,
  History as HistoryFreeIcon,
  ImageIcon as ImageIconFreeIcon,
  Info as InfoFreeIcon,
  KeyRound as KeyRoundFreeIcon,
  Layers as LayersFreeIcon,
  LayoutTemplate as LayoutTemplateFreeIcon,
  LineChart as LineChartFreeIcon,
  Link2 as Link2FreeIcon,
  LoaderPinwheelIcon as LoaderPinwheelIconFreeIcon,
  Mail as MailFreeIcon,
  MaleSymbolIcon as MaleSymbolIconFreeIcon,
  MemoryStick as MemoryStickFreeIcon,
  Message01Icon as Message01IconFreeIcon,
  MessageCircle as MessageCircleFreeIcon,
  MessageSquare as MessageSquareFreeIcon,
  MicIcon as MicIconFreeIcon,
  MinusSignIcon as MinusSignIconFreeIcon,
  Monitor as MonitorFreeIcon,
  Moon as MoonFreeIcon,
  MoreVertical,
  MusicNote01Icon as MusicNote01IconFreeIcon,
  Network as NetworkFreeIcon,
  PackageIcon as PackageIconFreeIcon,
  Pause as PauseFreeIcon,
  PauseIcon as PauseIconFreeIcon,
  Pencil as PencilFreeIcon,
  Play as PlayFreeIcon,
  PlayIcon as PlayIconFreeIcon,
  Plus as PlusFreeIcon,
  PlusSignIcon as PlusSignIconFreeIcon,
  Radio as RadioFreeIcon,
  RefreshCw as RefreshCwFreeIcon,
  Robot01Icon as Robot01IconFreeIcon,
  Rocket as RocketFreeIcon,
  RotateCw as RotateCwFreeIcon,
  Save as SaveFreeIcon,
  Search as SearchFreeIcon,
  SearchIcon as SearchIconFreeIcon,
  Send as SendFreeIcon,
  Server as ServerFreeIcon,
  ServerStack01Icon as ServerStack01IconFreeIcon,
  Settings as SettingsFreeIcon,
  ShieldAlert as ShieldAlertFreeIcon,
  ShieldCheck as ShieldCheckFreeIcon,
  Shield as ShieldFreeIcon,
  Sparkles as SparklesFreeIcon,
  Square as SquareFreeIcon,
  SquareIcon as SquareIconFreeIcon,
  Sun as SunFreeIcon,
  Tag01Icon as Tag01IconFreeIcon,
  Terminal as TerminalFreeIcon,
  TerminalIcon as TerminalIconFreeIcon,
  Trash2 as Trash2FreeIcon,
  Upload01Icon as Upload01IconFreeIcon,
  Upload as UploadFreeIcon,
  UserIcon as UserIconFreeIcon,
  UserRound as UserRoundFreeIcon,
  Users as UsersFreeIcon,
  VideoIcon as VideoIconFreeIcon,
  WandSparkles as WandSparklesFreeIcon,
  WrenchIcon as WrenchIconFreeIcon,
  XCircle as XCircleFreeIcon,
  X as XFreeIcon,
} from "@hugeicons/core-free-icons";
import {
  HugeiconsIcon,
  type HugeiconsIconProps,
  type IconSvgElement,
} from "@hugeicons/react";
import type { ComponentType } from "react";

export type HugeIconProps = Omit<HugeiconsIconProps, "icon">;
export type HugeIcon = ComponentType<HugeIconProps>;

const iconMap: Record<string, IconSvgElement> = {
  Activity: ActivityFreeIcon,
  AlertCircle: AlertCircleFreeIcon,
  AlertTriangleIcon: Alert02IconFreeIcon,
  ArchiveRestore: ArchiveRestoreFreeIcon,
  ArrowDown: ArrowDownFreeIcon,
  ArrowDownIcon: ArrowDownIconFreeIcon,
  ArrowDownToLine: Download01IconFreeIcon,
  ArrowLeft: ArrowLeftFreeIcon,
  ArrowLeftIcon: ArrowLeftIconFreeIcon,
  ArrowRightIcon: ArrowRightIconFreeIcon,
  ArrowUp: ArrowUpFreeIcon,
  ArrowUpFromLine: Upload01IconFreeIcon,
  ArrowUpRightIcon: ArrowUpRightIconFreeIcon,
  Bell: BellFreeIcon,
  BookIcon: BookIconFreeIcon,
  BookmarkIcon: BookmarkIconFreeIcon,
  Bot: BotFreeIcon,
  BotIcon: Robot01IconFreeIcon,
  Boxes: BoxesFreeIcon,
  BoxIcon: BoxIconFreeIcon,
  BrainIcon: BrainIconFreeIcon,
  Briefcase: Briefcase01FreeIcon,
  CalendarClock: CalendarClockFreeIcon,
  Check: CheckFreeIcon,
  CheckCircle: CheckCircleFreeIcon,
  CheckCircle2: CheckmarkCircle02IconFreeIcon,
  CheckCircle2Icon: CheckmarkCircle02IconFreeIcon,
  CheckCircleIcon: CheckmarkCircle02IconFreeIcon,
  CheckIcon: CheckIconFreeIcon,
  ChevronDownIcon: ChevronDownIconFreeIcon,
  ChevronLeft: ChevronLeftFreeIcon,
  ChevronLeftIcon: ChevronLeftIconFreeIcon,
  ChevronRight: ChevronRightFreeIcon,
  ChevronRightIcon: ChevronRightIconFreeIcon,
  ChevronsUpDownIcon: ChevronsDownUpIconFreeIcon,
  CircleAlert: CircleAlertFreeIcon,
  CircleDot: CircleDotFreeIcon,
  CircleDotIcon: CircleDotIconFreeIcon,
  CircleIcon: CircleIconFreeIcon,
  CircleSmallIcon: CircleSmallIconFreeIcon,
  CircleX: CircleXFreeIcon,
  Clock: ClockFreeIcon,
  ClockIcon: ClockIconFreeIcon,
  Code: CodeFreeIcon,
  Code2: CodeIconFreeIcon,
  Copy: CopyFreeIcon,
  CopyIcon: CopyIconFreeIcon,
  CornerDownLeftIcon: CornerDownLeftIconFreeIcon,
  Cpu: CpuFreeIcon,
  Database: DatabaseFreeIcon,
  DatabaseIcon: DatabaseIconFreeIcon,
  DotIcon: DotIconFreeIcon,
  Download: DownloadFreeIcon,
  DownloadIcon: DownloadIconFreeIcon,
  Edit2: Edit02IconFreeIcon,
  ExternalLinkIcon: ExternalLinkIconFreeIcon,
  Eye: EyeFreeIcon,
  EyeIcon: EyeIconFreeIcon,
  EyeOff: EyeOffFreeIcon,
  EyeOffIcon: EyeOffIconFreeIcon,
  FileClock: FileClockIconFreeIcon,
  FileIcon: FileIconFreeIcon,
  FilePlus2: FilePlusIconFreeIcon,
  FileText: FileTextFreeIcon,
  FileTextIcon: File01IconFreeIcon,
  Filter: FilterFreeIcon,
  FolderIcon: FolderIconFreeIcon,
  FolderOpenIcon: FolderOpenIconFreeIcon,
  GitBranchIcon: GitBranchIconFreeIcon,
  GitCommitIcon: GitCommitIconFreeIcon,
  Globe: GlobeFreeIcon,
  GlobeIcon: GlobeIconFreeIcon,
  HardDrive: HardDriveFreeIcon,
  Hash: HashFreeIcon,
  History: HistoryFreeIcon,
  ImageIcon: ImageIconFreeIcon,
  Info: InfoFreeIcon,
  KeyRound: KeyRoundFreeIcon,
  Layers: LayersFreeIcon,
  LayoutTemplate: LayoutTemplateFreeIcon,
  LineChart: LineChartFreeIcon,
  Link2: Link2FreeIcon,
  Loader2: LoaderPinwheelIconFreeIcon,
  Mail: MailFreeIcon,
  MarsIcon: MaleSymbolIconFreeIcon,
  MarsStrokeIcon: MaleSymbolIconFreeIcon,
  MemoryStick: MemoryStickFreeIcon,
  MessageCircle: MessageCircleFreeIcon,
  MessageCircleIcon: Message01IconFreeIcon,
  MessageSquare: MessageSquareFreeIcon,
  MicIcon: MicIconFreeIcon,
  MinusIcon: MinusSignIconFreeIcon,
  Monitor: MonitorFreeIcon,
  Moon: MoonFreeIcon,
  Music2Icon: MusicNote01IconFreeIcon,
  Network: NetworkFreeIcon,
  NonBinaryIcon: UserIconFreeIcon,
  PackageIcon: PackageIconFreeIcon,
  PaperclipIcon: Attachment01IconFreeIcon,
  Pause: PauseFreeIcon,
  PauseIcon: PauseIconFreeIcon,
  Pencil: PencilFreeIcon,
  Play: PlayFreeIcon,
  PlayIcon: PlayIconFreeIcon,
  Plus: PlusFreeIcon,
  PlusIcon: PlusSignIconFreeIcon,
  Radio: RadioFreeIcon,
  RefreshCw: RefreshCwFreeIcon,
  Rocket: RocketFreeIcon,
  RotateCw: RotateCwFreeIcon,
  Save: SaveFreeIcon,
  Search: SearchFreeIcon,
  SearchIcon: SearchIconFreeIcon,
  Send: SendFreeIcon,
  Server: ServerFreeIcon,
  ServerIcon: ServerStack01IconFreeIcon,
  Settings: SettingsFreeIcon,
  Shield: ShieldFreeIcon,
  ShieldAlert: ShieldAlertFreeIcon,
  ShieldCheck: ShieldCheckFreeIcon,
  Sparkles: SparklesFreeIcon,
  Square: SquareFreeIcon,
  SquareIcon: SquareIconFreeIcon,
  Sun: SunFreeIcon,
  Tag01Icon: Tag01IconFreeIcon,
  Terminal: TerminalFreeIcon,
  TerminalIcon: TerminalIconFreeIcon,
  TransgenderIcon: UserIconFreeIcon,
  Trash2: Trash2FreeIcon,
  Trash2Icon: Delete02IconFreeIcon,
  TriangleAlert: Alert02IconFreeIcon,
  Upload: UploadFreeIcon,
  UserRound: UserRoundFreeIcon,
  Users: UsersFreeIcon,
  VenusAndMarsIcon: UserIconFreeIcon,
  VenusIcon: FemaleSymbolIconFreeIcon,
  VideoIcon: VideoIconFreeIcon,
  WandSparkles: WandSparklesFreeIcon,
  WrenchIcon: WrenchIconFreeIcon,
  X: XFreeIcon,
  XCircle: XCircleFreeIcon,
  XCircleIcon: CancelCircleIconFreeIcon,
  XIcon: Cancel01IconFreeIcon,
  MoreVertical: MoreVertical,
};

function createHugeIcon(icon: IconSvgElement): HugeIcon {
  return function HugeIcon(props) {
    return <HugeiconsIcon icon={icon} {...props} />;
  };
}

export const Activity = createHugeIcon(iconMap.Activity);
export const AlertCircle = createHugeIcon(iconMap.AlertCircle);
export const AlertTriangleIcon = createHugeIcon(iconMap.AlertTriangleIcon);
export const ArchiveRestore = createHugeIcon(iconMap.ArchiveRestore);
export const ArrowDown = createHugeIcon(iconMap.ArrowDown);
export const ArrowDownIcon = createHugeIcon(iconMap.ArrowDownIcon);
export const ArrowDownToLine = createHugeIcon(iconMap.ArrowDownToLine);
export const ArrowLeft = createHugeIcon(iconMap.ArrowLeft);
export const ArrowLeftIcon = createHugeIcon(iconMap.ArrowLeftIcon);
export const ArrowRightIcon = createHugeIcon(iconMap.ArrowRightIcon);
export const ArrowUp = createHugeIcon(iconMap.ArrowUp);
export const ArrowUpFromLine = createHugeIcon(iconMap.ArrowUpFromLine);
export const ArrowUpRightIcon = createHugeIcon(iconMap.ArrowUpRightIcon);
export const Bell = createHugeIcon(iconMap.Bell);
export const BookIcon = createHugeIcon(iconMap.BookIcon);
export const BookmarkIcon = createHugeIcon(iconMap.BookmarkIcon);
export const Bot = createHugeIcon(iconMap.Bot);
export const BotIcon = createHugeIcon(iconMap.BotIcon);
export const Boxes = createHugeIcon(iconMap.Boxes);
export const BoxIcon = createHugeIcon(iconMap.BoxIcon);
export const BrainIcon = createHugeIcon(iconMap.BrainIcon);
export const Briefcase = createHugeIcon(iconMap.Briefcase);
export const CalendarClock = createHugeIcon(iconMap.CalendarClock);
export const Check = createHugeIcon(iconMap.Check);
export const CheckCircle = createHugeIcon(iconMap.CheckCircle);
export const CheckCircle2 = createHugeIcon(iconMap.CheckCircle2);
export const CheckCircle2Icon = createHugeIcon(iconMap.CheckCircle2Icon);
export const CheckCircleIcon = createHugeIcon(iconMap.CheckCircleIcon);
export const CheckIcon = createHugeIcon(iconMap.CheckIcon);
export const ChevronDownIcon = createHugeIcon(iconMap.ChevronDownIcon);
export const ChevronLeft = createHugeIcon(iconMap.ChevronLeft);
export const ChevronLeftIcon = createHugeIcon(iconMap.ChevronLeftIcon);
export const ChevronRight = createHugeIcon(iconMap.ChevronRight);
export const ChevronRightIcon = createHugeIcon(iconMap.ChevronRightIcon);
export const ChevronsUpDownIcon = createHugeIcon(iconMap.ChevronsUpDownIcon);
export const CircleAlert = createHugeIcon(iconMap.CircleAlert);
export const CircleDot = createHugeIcon(iconMap.CircleDot);
export const CircleDotIcon = createHugeIcon(iconMap.CircleDotIcon);
export const CircleIcon = createHugeIcon(iconMap.CircleIcon);
export const CircleSmallIcon = createHugeIcon(iconMap.CircleSmallIcon);
export const CircleX = createHugeIcon(iconMap.CircleX);
export const Clock = createHugeIcon(iconMap.Clock);
export const ClockIcon = createHugeIcon(iconMap.ClockIcon);
export const Code = createHugeIcon(iconMap.Code);
export const Code2 = createHugeIcon(iconMap.Code2);
export const Copy = createHugeIcon(iconMap.Copy);
export const CopyIcon = createHugeIcon(iconMap.CopyIcon);
export const CornerDownLeftIcon = createHugeIcon(iconMap.CornerDownLeftIcon);
export const Cpu = createHugeIcon(iconMap.Cpu);
export const Database = createHugeIcon(iconMap.Database);
export const DatabaseIcon = createHugeIcon(iconMap.DatabaseIcon);
export const DotIcon = createHugeIcon(iconMap.DotIcon);
export const Download = createHugeIcon(iconMap.Download);
export const DownloadIcon = createHugeIcon(iconMap.DownloadIcon);
export const Edit2 = createHugeIcon(iconMap.Edit2);
export const ExternalLinkIcon = createHugeIcon(iconMap.ExternalLinkIcon);
export const Eye = createHugeIcon(iconMap.Eye);
export const EyeIcon = createHugeIcon(iconMap.EyeIcon);
export const EyeOff = createHugeIcon(iconMap.EyeOff);
export const EyeOffIcon = createHugeIcon(iconMap.EyeOffIcon);
export const FileClock = createHugeIcon(iconMap.FileClock);
export const FileIcon = createHugeIcon(iconMap.FileIcon);
export const FilePlus2 = createHugeIcon(iconMap.FilePlus2);
export const FileText = createHugeIcon(iconMap.FileText);
export const FileTextIcon = createHugeIcon(iconMap.FileTextIcon);
export const Filter = createHugeIcon(iconMap.Filter);
export const FolderIcon = createHugeIcon(iconMap.FolderIcon);
export const FolderOpenIcon = createHugeIcon(iconMap.FolderOpenIcon);
export const GitCommitIcon = createHugeIcon(iconMap.GitCommitIcon);
export const Globe = createHugeIcon(iconMap.Globe);
export const GlobeIcon = createHugeIcon(iconMap.GlobeIcon);
export const HardDrive = createHugeIcon(iconMap.HardDrive);
export const Hash = createHugeIcon(iconMap.Hash);
export const History = createHugeIcon(iconMap.History);
export const ImageIcon = createHugeIcon(iconMap.ImageIcon);
export const Info = createHugeIcon(iconMap.Info);
export const KeyRound = createHugeIcon(iconMap.KeyRound);
export const Layers = createHugeIcon(iconMap.Layers);
export const LineChart = createHugeIcon(iconMap.LineChart);
export const Link2 = createHugeIcon(iconMap.Link2);
export const Loader2 = createHugeIcon(iconMap.Loader2);
export const Mail = createHugeIcon(iconMap.Mail);
export const MarsIcon = createHugeIcon(iconMap.MarsIcon);
export const MarsStrokeIcon = createHugeIcon(iconMap.MarsStrokeIcon);
export const MemoryStick = createHugeIcon(iconMap.MemoryStick);
export const MessageCircle = createHugeIcon(iconMap.MessageCircle);
export const MessageCircleIcon = createHugeIcon(iconMap.MessageCircleIcon);
export const MessageSquare = createHugeIcon(iconMap.MessageSquare);
export const MicIcon = createHugeIcon(iconMap.MicIcon);
export const MinusIcon = createHugeIcon(iconMap.MinusIcon);
export const Monitor = createHugeIcon(iconMap.Monitor);
export const Moon = createHugeIcon(iconMap.Moon);
export const Music2Icon = createHugeIcon(iconMap.Music2Icon);
export const Network = createHugeIcon(iconMap.Network);
export const NonBinaryIcon = createHugeIcon(iconMap.NonBinaryIcon);
export const PackageIcon = createHugeIcon(iconMap.PackageIcon);
export const PaperclipIcon = createHugeIcon(iconMap.PaperclipIcon);
export const Pause = createHugeIcon(iconMap.Pause);
export const PauseIcon = createHugeIcon(iconMap.PauseIcon);
export const Pencil = createHugeIcon(iconMap.Pencil);
export const Play = createHugeIcon(iconMap.Play);
export const PlayIcon = createHugeIcon(iconMap.PlayIcon);
export const Plus = createHugeIcon(iconMap.Plus);
export const PlusIcon = createHugeIcon(iconMap.PlusIcon);
export const Radio = createHugeIcon(iconMap.Radio);
export const RefreshCw = createHugeIcon(iconMap.RefreshCw);
export const Rocket = createHugeIcon(iconMap.Rocket);
export const RotateCw = createHugeIcon(iconMap.RotateCw);
export const Save = createHugeIcon(iconMap.Save);
export const Search = createHugeIcon(iconMap.Search);
export const SearchIcon = createHugeIcon(iconMap.SearchIcon);
export const Send = createHugeIcon(iconMap.Send);
export const Server = createHugeIcon(iconMap.Server);
export const ServerIcon = createHugeIcon(iconMap.ServerIcon);
export const Settings = createHugeIcon(iconMap.Settings);
export const Shield = createHugeIcon(iconMap.Shield);
export const ShieldAlert = createHugeIcon(iconMap.ShieldAlert);
export const ShieldCheck = createHugeIcon(iconMap.ShieldCheck);
export const Sparkles = createHugeIcon(iconMap.Sparkles);
export const Square = createHugeIcon(iconMap.Square);
export const SquareIcon = createHugeIcon(iconMap.SquareIcon);
export const Sun = createHugeIcon(iconMap.Sun);
export const Terminal = createHugeIcon(iconMap.Terminal);
export const TerminalIcon = createHugeIcon(iconMap.TerminalIcon);
export const TransgenderIcon = createHugeIcon(iconMap.TransgenderIcon);
export const Trash2 = createHugeIcon(iconMap.Trash2);
export const Trash2Icon = createHugeIcon(iconMap.Trash2Icon);
export const TriangleAlert = createHugeIcon(iconMap.TriangleAlert);
export const Upload = createHugeIcon(iconMap.Upload);
export const UserRound = createHugeIcon(iconMap.UserRound);
export const Users = createHugeIcon(iconMap.Users);
export const VenusAndMarsIcon = createHugeIcon(iconMap.VenusAndMarsIcon);
export const VenusIcon = createHugeIcon(iconMap.VenusIcon);
export const VideoIcon = createHugeIcon(iconMap.VideoIcon);
export const WandSparkles = createHugeIcon(iconMap.WandSparkles);
export const WrenchIcon = createHugeIcon(iconMap.WrenchIcon);
export const X = createHugeIcon(iconMap.X);
export const XCircle = createHugeIcon(iconMap.XCircle);
export const XCircleIcon = createHugeIcon(iconMap.XCircleIcon);
export const MoreVerticalIcon = createHugeIcon(iconMap.MoreVertical);
export const XIcon = createHugeIcon(iconMap.XIcon);
export const AnalyticsUpIcon = LineChart;
export const Rocket01Icon = Rocket;
export const Edit3 = Edit2;
export const ExternalLink = ExternalLinkIcon;

export const GitBranchIcon = createHugeIcon(iconMap.GitBranchIcon);
export const LayoutTemplate = createHugeIcon(iconMap.LayoutTemplate);
export const Tag01Icon = createHugeIcon(iconMap.Tag01Icon);
