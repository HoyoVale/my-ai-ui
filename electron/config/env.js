import dotenv from "dotenv";
import path from "node:path";

const envPath = path.resolve(
  process.cwd(),
  ".env"
);

const result = dotenv.config({
  path: envPath
});

if (result.error) {
  console.warn(
    `没有成功读取环境变量文件：${envPath}`
  );
}

export const mainEnv =
  Object.freeze({
    DEV_SERVER_URL:
      process.env
        .VITE_DEV_SERVER_URL ??
      "http://localhost:5173"
  });
