import { Router } from "express";
import { z } from "zod";
import { validate } from "../../middleware/validation.middleware.js";
import { authenticate } from "../../middleware/auth.middleware.js";
import {
  loginLimiter,
  loginEmailLimiter,
  registerLimiter,
  refreshLimiter,
} from "../../middleware/rate-limit.middleware.js";
import authController from "./auth.controller.js";

const router = Router();

const registerSchema = z
  .object({
    email: z.string().email("Invalid email address"),
    password: z.string().min(8, "Password must be at least 8 characters long"),
    name: z.string().min(1, "Name is required").trim(),
  })
  .strict();

const loginSchema = z
  .object({
    email: z.string().email("Invalid email address"),
    password: z.string().min(1, "Password is required"),
  })
  .strict();

router.post("/register", validate({ body: registerSchema }), registerLimiter, authController.register);
router.post("/login", validate({ body: loginSchema }), loginEmailLimiter, loginLimiter, authController.login);
router.post("/refresh", refreshLimiter, authController.refresh);
router.post("/logout", authController.logout);
router.get("/me", authenticate, authController.me);

export default router;
