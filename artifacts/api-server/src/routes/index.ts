import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import usersRouter from "./users";
import videosRouter from "./videos";
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

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(usersRouter);
router.use(videosRouter);
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

export default router;
