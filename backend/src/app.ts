import express from "express";
import cors from "cors";
import projectRoutes from "./routes/project.routes";

const app = express();

const PORT = 8080;

app.use(
  cors({
    origin: "http://localhost:5173",
  })
);

app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({
    success: true,
    message: "Backend server is running.",
  });
});

app.use("/api/projects", projectRoutes);

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});