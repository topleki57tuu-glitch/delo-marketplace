/**
 * Единый набор иконок приложения.
 *
 * Раньше иконками служили эмодзи — 380 штук в 34 файлах. Это плохо по трём
 * причинам: они рисуются шрифтом и выглядят по-разному на Windows, macOS и
 * Android; у них нет единого размера и толщины штриха, поэтому интерфейс
 * «сыпется» визуально; скринридер читает их как «торт», «пакет», «звёздочка»
 * и мешает воспринимать текст.
 *
 * Здесь всё собрано в одном месте: компонент задаёт размер, толщину штриха и
 * поведение для скринридеров, а вызывающий код пишет <IconPin /> и не думает
 * об этом. Менять вид иконок по всему приложению теперь можно отсюда.
 *
 * Иконка по умолчанию декоративная (aria-hidden) — это правильно, когда рядом
 * есть текст. Если иконка несёт смысл сама по себе, передайте title:
 *   <IconStar title="Рейтинг" />
 */
import {
  ArrowDown,
  Baby,
  Ban,
  Banknote,
  Bell,
  BookOpen,
  Briefcase,
  Calendar,
  Camera,
  Car,
  ChartColumn,
  Check,
  Circle,
  CircleHelp,
  CircleUser,
  ClipboardList,
  CreditCard,
  Crown,
  Eye,
  FolderOpen,
  Gamepad2,
  Globe,
  GraduationCap,
  Hammer,
  Heart,
  House,
  Inbox,
  Key,
  Landmark,
  Laptop,
  Lightbulb,
  Link as LinkIcon,
  Lock,
  LogOut,
  Mail,
  MailOpen,
  Map as MapIcon,
  MapPin,
  Maximize,
  MessageCircle,
  Package,
  Palette,
  PartyPopper,
  Pencil,
  PenLine,
  Pin,
  Plus,
  Receipt,
  Recycle,
  RefreshCw,
  Rocket,
  Scale,
  Search,
  Settings,
  Shield,
  ShoppingBag,
  ShoppingCart,
  SlidersHorizontal,
  Smartphone,
  Smile,
  Sparkles,
  Star,
  StarOff,
  Target,
  ThumbsUp,
  Trash2,
  TrendingUp,
  TriangleAlert,
  Trophy,
  Truck,
  Upload,
  Users,
  Wrench,
  X,
  Zap,
} from 'lucide-react';

function createIcon(LucideIcon, defaultSize = 16) {
  const Icon = ({ size = defaultSize, className = '', title, strokeWidth = 2, ...rest }) => {
    if (title) {
      return (
        <LucideIcon
          size={size}
          strokeWidth={strokeWidth}
          className={className}
          role="img"
          aria-label={title}
          {...rest}
        />
      );
    }
    return (
      <LucideIcon
        size={size}
        strokeWidth={strokeWidth}
        className={className}
        aria-hidden="true"
        focusable="false"
        {...rest}
      />
    );
  };
  Icon.displayName = `Icon(${LucideIcon.displayName || LucideIcon.name || 'unknown'})`;
  return Icon;
}

/* --- Навигация и разделы --- */
export const IconTasks = createIcon(ClipboardList);
export const IconSpecialists = createIcon(Users);
export const IconProducts = createIcon(ShoppingBag);
export const IconCreate = createIcon(Plus);
export const IconProfile = createIcon(CircleUser);
export const IconOrders = createIcon(Receipt);
export const IconPurchases = createIcon(ShoppingCart);
export const IconMessages = createIcon(MessageCircle);
export const IconAdmin = createIcon(Shield);
export const IconLogout = createIcon(LogOut);

/* --- Действия --- */
export const IconCheck = createIcon(Check);
export const IconClose = createIcon(X);
export const IconWarning = createIcon(TriangleAlert);
export const IconEdit = createIcon(Pencil);
export const IconWrite = createIcon(PenLine);
export const IconTrash = createIcon(Trash2);
export const IconUpload = createIcon(Upload);
export const IconRefresh = createIcon(RefreshCw);
export const IconPlus = createIcon(Plus);
export const IconSettings = createIcon(Settings);
export const IconExpand = createIcon(Maximize);
export const IconDownload = createIcon(ArrowDown);
export const IconSearch = createIcon(Search);
export const IconFilter = createIcon(SlidersHorizontal);

/* --- Деньги --- */
export const IconWallet = createIcon(Banknote);
export const IconMoney = createIcon(Banknote);
export const IconCard = createIcon(CreditCard);
export const IconBank = createIcon(Landmark);
export const IconPayout = createIcon(TrendingUp);
export const IconJustice = createIcon(Scale);

/* --- Доставка и товары --- */
export const IconBox = createIcon(Package);
export const IconDelivery = createIcon(Truck);
export const IconPin = createIcon(MapPin);
export const IconMap = createIcon(MapIcon);
export const IconPinned = createIcon(Pin);
export const IconReceipt = createIcon(Receipt);

/* --- Статусы и метрики --- */
export const IconStar = createIcon(Star);
export const IconStarEmpty = createIcon(StarOff);
export const IconOnline = createIcon(Circle);
export const IconPro = createIcon(Crown);
export const IconTrophy = createIcon(Trophy);
export const IconRocket = createIcon(Rocket);
export const IconLightning = createIcon(Zap);
export const IconSparkles = createIcon(Sparkles);
export const IconTarget = createIcon(Target);
export const IconChart = createIcon(ChartColumn);
export const IconIdea = createIcon(Lightbulb);
export const IconRecycle = createIcon(Recycle);
export const IconParty = createIcon(PartyPopper);
export const IconLike = createIcon(ThumbsUp);
export const IconHeart = createIcon(Heart);
export const IconBan = createIcon(Ban);
export const IconQuestion = createIcon(CircleHelp);

/* --- Люди и доступ --- */
export const IconUser = createIcon(CircleUser);
export const IconUsers = createIcon(Users);
export const IconEye = createIcon(Eye);
export const IconSmile = createIcon(Smile);
export const IconLock = createIcon(Lock);
export const IconKey = createIcon(Key);

/* --- Связь и файлы --- */
export const IconBell = createIcon(Bell);
export const IconMail = createIcon(Mail);
export const IconMailOpen = createIcon(MailOpen);
export const IconInbox = createIcon(Inbox);
export const IconLink = createIcon(LinkIcon);
export const IconFolder = createIcon(FolderOpen);
export const IconCalendar = createIcon(Calendar);
export const IconGlobe = createIcon(Globe);

/* --- Профессии и техника --- */
export const IconPhone = createIcon(Smartphone);
export const IconLaptop = createIcon(Laptop);
export const IconCamera = createIcon(Camera);
export const IconTools = createIcon(Wrench);
export const IconHammer = createIcon(Hammer);
export const IconPalette = createIcon(Palette);
export const IconBook = createIcon(BookOpen);
export const IconGraduate = createIcon(GraduationCap);
export const IconBriefcase = createIcon(Briefcase);

/* --- Категории товаров (совпадают с ProductCategory) --- */
export const IconCatElectronics = createIcon(Smartphone);
export const IconCatClothing = createIcon(ShoppingBag);
export const IconCatHome = createIcon(House);
export const IconCatHobby = createIcon(Gamepad2);
export const IconCatAuto = createIcon(Car);
export const IconCatKids = createIcon(Baby);
export const IconCatOther = createIcon(Package);

/* --- Категории заданий (совпадают с TaskCategory) --- */
export const IconCatDesign = createIcon(Palette);
export const IconCatDevelopment = createIcon(Laptop);
export const IconCatWriting = createIcon(PenLine);
export const IconCatRepairs = createIcon(Wrench);
export const IconCatCleaning = createIcon(Sparkles);
export const IconCatDelivery = createIcon(Truck);
export const IconCatPhotoVideo = createIcon(Camera);
export const IconCatTutoring = createIcon(GraduationCap);
export const IconCatBeauty = createIcon(Smile);
export const IconCatEvents = createIcon(PartyPopper);
export const IconCatBusiness = createIcon(Briefcase);
export const IconCatTaskOther = createIcon(Package);
