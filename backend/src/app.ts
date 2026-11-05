import express from "express";
import cors from "cors";

import { env } from "./config/env";
import projectRoutes from "./routes/project.routes";

const app = express();

app.use(
  cors({
    origin: env.frontendUrl,
  })
);

app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({
    success: true,
    message: "Backend server is running.",
  });
});

app.use(
  "/api/projects",
  projectRoutes
);

app.listen(env.port, () => {
  console.log(
    `Server running on http://localhost:${env.port}`
  );
});