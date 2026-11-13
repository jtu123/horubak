import 'dotenv/config';

const env = {
  uploadDir: process.env.UPLOAD_DIR ?? './data/originals',
  maxFileSizeMb: Number(process.env.MAX_FILE_SIZE_MB ?? 4096),
};

export default env;
