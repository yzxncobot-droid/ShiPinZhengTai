import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import usersRouter from "./users";
import videosRouter from "./videos";
import bundlesRouter from "./bundles";
import categoriesRouter from "./categories";
import subscriptionsRouter from "./subscriptions";
import walletRouter from "./wallet";
import topupsRouter from "./topups";
import transactionsRouter from "./transactions";
import settingsRouter from "./settings";
import analyticsRouter from "./analytics";
import leaderboardRouter from "./leaderboard";
import notificationsRouter from "./notifications";
import uploadRouter from "./upload";
import withdrawalsRouter from "./withdrawals";
import auditLogsRouter from "./audit-logs";
import systemRouter from "./system";
import announcementsRouter from "./announcements";
import chatRoomsRouter from "./chat-rooms";
// DM feature removed — routes/direct-messages.ts kept on disk but not registered
import chatUploadRouter from "./chat-upload";
import verificationsRouter from "./verifications";
import dropsRouter from "./drops";
import userManagementRouter from "./user-management";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(usersRouter);
router.use(videosRouter);
router.use(bundlesRouter);
router.use(categoriesRouter);
router.use(subscriptionsRouter);
router.use(walletRouter);
router.use(topupsRouter);
router.use(transactionsRouter);
router.use(settingsRouter);
router.use(analyticsRouter);
router.use(leaderboardRouter);
router.use(notificationsRouter);
router.use(uploadRouter);
router.use(withdrawalsRouter);
router.use(auditLogsRouter);
router.use(systemRouter);
router.use(announcementsRouter);
router.use(chatRoomsRouter);
// DM router removed
router.use(chatUploadRouter);
router.use(verificationsRouter);
router.use(dropsRouter);
router.use(userManagementRouter);

export default router;
