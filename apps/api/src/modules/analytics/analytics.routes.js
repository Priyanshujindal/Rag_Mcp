import { Router } from "express";

const router = Router();

router.all("*", (_req, res) => {
  res.status(501).json({
    error: {
      code: "NOT_IMPLEMENTED",
      message: "Analytics service is not implemented yet.",
    },
  });
});

export default router;

