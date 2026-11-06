import dotenv from "dotenv";

dotenv.config();

const env = {
  port: Number(process.env.PORT ?? 8080),

  frontendUrl:
    process.env.FRONTEND_URL ??
    "http://localhost:5173",

  uploadDir:
    process.env.UPLOAD_DIR ??
    "./uploads/original",

  maxFileSizeMb:
    Number(process.env.MAX_FILE_SIZE_MB ?? 4096),
};

export default env;