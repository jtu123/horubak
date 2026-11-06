import { Router } from "express";
import multer from "multer";
import { createProject } from "../controllers/project.controller";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 4 * 1024 * 1024 * 1024,
  },
});

router.post(
  "/",
  upload.single("file"),
  createProject
);

export default router;